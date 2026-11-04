import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Autocomplete, Box, Button, Card, Grid, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client';
import { useAction } from '../hooks';
import { PageHeader, PriorityChip, QueryState, SectionCard, StatusChip } from '../components/common';
import { RefSelect } from '../components/form';
import { fmtDate, fmtDateTime, fromNow } from '../utils/format';

const Stat = ({ k, v }) => <Grid item xs={6} sm={4} md={2}><Card sx={{ p: 1.75, height: '100%' }}><Typography variant="caption" color="text.secondary" fontWeight={600}>{k}</Typography><Typography sx={{ fontSize: 26, fontWeight: 800 }}>{v}</Typography></Card></Grid>;

export default function Eod() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['eod'], queryFn: () => api.get('/dashboard/eod/summary') });
  const [notes, setNotes] = useState('');
  const [priorities, setPriorities] = useState([]);
  const [handoverTo, setHandoverTo] = useState(null);
  const close = useAction((b) => api.post('/dashboard/eod/close', b), { success: 'Day closed — handover saved and priorities added as action points', invalidate: ['eod', 'action-items', 'today'] });
  return (
    <Box>
      <PageHeader title="End of day" subtitle={`Close the day for ${fmtDate(new Date())}: review what is pending, write the handover and set tomorrow's priorities.`} help="Closing the day stores a snapshot (attendance, open tickets), the pending list and your handover note. Each next-day priority becomes an action point due tomorrow." />
      <QueryState q={q}>
        {(s) => (
          <Stack spacing={2}>
            {s.closedLog?.closed && <Alert severity="success">The day was closed by {s.closedLog.closureSummary?.closedBy} at {fmtDateTime(s.closedLog.closureSummary?.at)}. You can close it again to add another handover note.</Alert>}
            <Grid container spacing={1.5}>
              <Stat k="Tickets raised" v={s.ticketsRaised} /><Stat k="Tickets closed" v={s.ticketsClosed} /><Stat k="Still open" v={s.ticketsOpen} />
              <Stat k="Jobs completed" v={s.workOrdersCompleted} /><Stat k="Jobs pending" v={s.workOrdersPending} /><Stat k="Attendance" v={`${s.attendancePct}%`} />
            </Grid>
            <Grid container spacing={2}>
              <Grid item xs={12} md={7}>
                <SectionCard title="Pending list" subtitle="Open tickets carried into tomorrow">
                  {s.pending.map((t) => (
                    <Stack key={t._id} direction="row" spacing={1} alignItems="center" onClick={() => navigate(`/tickets/${t._id}`)} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider', cursor: 'pointer' }}>
                      <PriorityChip value={t.priority} short />
                      <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" fontWeight={600} noWrap>{t.number} · {t.description}</Typography><Typography variant="caption" color="text.secondary">Raised {fromNow(t.createdAt)}</Typography></Box>
                      <StatusChip value={t.status} />
                    </Stack>
                  ))}
                  {!s.pending.length && <Typography color="text.secondary">Nothing pending. Great day!</Typography>}
                </SectionCard>
              </Grid>
              <Grid item xs={12} md={5}>
                <SectionCard title="Handover & tomorrow">
                  <Stack spacing={2}>
                    <TextField multiline minRows={4} label="Handover note" placeholder="What the next shift or tomorrow's team needs to know" value={notes} onChange={(e) => setNotes(e.target.value)} />
                    <Autocomplete multiple freeSolo options={[]} value={priorities} onChange={(e, v) => setPriorities(v)} renderInput={(p) => <TextField {...p} label="Tomorrow's priorities" helperText="Type one and press Enter" />} />
                    <RefSelect refTo="users" label="Hand over to (optional)" value={handoverTo} onChange={setHandoverTo} />
                    <Button variant="contained" color="secondary" size="large" disabled={close.isPending} onClick={() => close.mutate({ handoverNotes: notes || undefined, nextDayPriorities: priorities, handoverTo: handoverTo || undefined })}>Close the day</Button>
                  </Stack>
                </SectionCard>
              </Grid>
            </Grid>
            <SectionCard title="Open action points">
              {s.actions.map((a) => <Stack key={a._id} direction="row" justifyContent="space-between" sx={{ py: 0.75 }}><Typography variant="body2">{a.title} <Typography component="span" variant="caption" color="text.secondary">· {a.ownerId?.name} · due {fmtDate(a.dueDate)}</Typography></Typography><StatusChip value={a.status} /></Stack>)}
              {!s.actions.length && <Typography color="text.secondary">No open action points.</Typography>}
            </SectionCard>
          </Stack>
        )}
      </QueryState>
    </Box>
  );
}
