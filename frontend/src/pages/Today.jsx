import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import NotificationsActiveOutlined from '@mui/icons-material/NotificationsActiveOutlined';
import { pushState, enablePush } from '../offline/push';
import { useQuery } from '@tanstack/react-query';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Avatar, Box, Button, Chip, Grid, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import BuildOutlined from '@mui/icons-material/BuildOutlined';
import TimerOutlined from '@mui/icons-material/TimerOutlined';
import PersonAddAlt1Outlined from '@mui/icons-material/PersonAddAlt1Outlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import HowToRegOutlined from '@mui/icons-material/HowToRegOutlined';
import EventRepeatOutlined from '@mui/icons-material/EventRepeatOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import OutboxOutlined from '@mui/icons-material/OutboxOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import ReportProblemOutlined from '@mui/icons-material/ReportProblemOutlined';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useAction } from '../hooks';
import { PageHeader, PriorityChip, QueryState, SectionCard, SlaTimer, StatusChip } from '../components/common';
import { fmtDate, fmtDateTime, fromNow, label } from '../utils/format';

const Icon = ({ icon: I, color = 'secondary' }) => <Avatar sx={{ width: 32, height: 32, bgcolor: `${color}.main`, opacity: 0.9 }}><I sx={{ fontSize: 18 }} /></Avatar>;
const Empty = ({ text }) => <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>{text}</Typography>;

function Block({ title, subtitle, icon, color, count, children, action }) {
  return (
    <SectionCard title={<Stack direction="row" spacing={1} alignItems="center"><span>{title}</span>{count != null && <Chip size="small" label={count} />}</Stack>} subtitle={subtitle} icon={<Icon icon={icon} color={color} />} action={action}>
      {children}
    </SectionCard>
  );
}

function PushPrompt() {
  const [state, setState] = useState(null);
  const [hidden, setHidden] = useState(() => localStorage.getItem('ps-push-prompt') === 'no');
  useEffect(() => { pushState().then(setState); }, []);
  const turnOn = useAction(() => enablePush(), { success: 'Job alerts are on for this phone', onSuccess: setState });
  if (hidden || state !== 'off') return null;
  return (
    <Grid item xs={12}>
      <Alert severity="info" icon={<NotificationsActiveOutlined />} action={<Stack direction="row" spacing={1}><Button color="inherit" size="small" onClick={() => { localStorage.setItem('ps-push-prompt', 'no'); setHidden(true); }}>Not now</Button><Button variant="contained" color="secondary" size="small" disabled={turnOn.isPending} onClick={() => turnOn.mutate()}>Turn on</Button></Stack>}>
        Turn on job alerts so this phone buzzes when a job is assigned to you — even when the app is closed.
      </Alert>
    </Grid>
  );
}

// Job and ticket rows stack (details above the SLA bar) when their card is narrow: phones, or half-width cards on tablets.
const ROW = {
  borderRadius: 2, mb: 0.5, gap: 1,
  '@container (max-width: 480px)': { flexDirection: 'column', alignItems: 'stretch', gap: 0.25, '& > .MuiStack-root': { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } },
};

export default function Today() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const q = useQuery({ queryKey: ['today'], queryFn: () => api.get('/dashboard/today'), refetchInterval: 60000 });
  const issue = useAction((id) => api.post(`/material-issues/${id}/issue`), { success: 'Issued — stock updated', invalidate: ['today', 'stock', 'kpis'] });
  const openWo = (w) => navigate(w.ticketId ? `/tickets/${w.ticketId._id || w.ticketId}` : `/work-orders/${w._id}`);

  return (
    <Box>
      <PageHeader title="Today" subtitle={`${fmtDate(new Date())} · what needs you right now`} help="A single board for your day: your jobs, tickets at risk of missing SLA, work waiting for your verification, attendance and stores. It refreshes itself." />
      <QueryState q={q}>
        {({ sections: s }) => (
          <Grid container spacing={2}>
            {user.layout === 'field' && <PushPrompt />}
            {s.approvals > 0 && (
              <Grid item xs={12}>
                <Button fullWidth variant="outlined" color="secondary" startIcon={<TaskAltOutlined />} onClick={() => navigate('/approvals')} sx={{ justifyContent: 'flex-start', py: 1.5, bgcolor: 'primary.soft' }}>
                  {s.approvals} item{s.approvals === 1 ? ' is' : 's are'} waiting for your approval — review now
                </Button>
              </Grid>
            )}

            {s.myWork && (
              <Grid item xs={12} md={6}>
                <Block title="My jobs" subtitle="Assigned to you, due today or overdue" icon={BuildOutlined} count={s.myWork.length}>
                  {s.myWork.length ? (
                    <List dense disablePadding sx={{ containerType: 'inline-size' }}>
                      {s.myWork.map((w) => (
                        <ListItemButton key={w._id} onClick={() => openWo(w)} sx={{ ...ROW, border: '1px solid', borderColor: 'divider' }}>
                          <ListItemText primary={<Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><b style={{ whiteSpace: 'nowrap' }}>{w.ticketId?.number || w.number}</b><Chip size="small" label={label(w.type)} variant="outlined" /></Stack>} secondary={`${w.title} · ${w.assetId?.code || w.locationId?.path || ''}`} />
                          <Stack alignItems="flex-end" spacing={0.5}><StatusChip value={w.status} /><Typography variant="caption" color={new Date(w.plannedDate) < new Date(Date.now() - 864e5) ? 'error.main' : 'text.secondary'}>{fmtDate(w.plannedDate)}</Typography></Stack>
                        </ListItemButton>
                      ))}
                    </List>
                  ) : <Empty text="Nothing assigned to you right now. New jobs appear here instantly." />}
                </Block>
              </Grid>
            )}

            {s.unassigned && (
              <Grid item xs={12} md={6}>
                <Block title="New tickets to assign" subtitle="Pick a technician for each" icon={PersonAddAlt1Outlined} color="info" count={s.unassigned.length}>
                  {s.unassigned.length ? (
                    <List dense disablePadding sx={{ containerType: 'inline-size' }}>
                      {s.unassigned.map((t) => (
                        <ListItemButton key={t._id} onClick={() => navigate(`/tickets/${t._id}`)} sx={{ ...ROW, border: '1px solid', borderColor: 'divider' }}>
                          <ListItemText primary={<Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><b style={{ whiteSpace: 'nowrap' }}>{t.number}</b><PriorityChip value={t.priority} short /></Stack>} secondary={`${t.description} · ${t.locationId?.path || ''}`} />
                          <SlaTimer ticket={t} compact />
                        </ListItemButton>
                      ))}
                    </List>
                  ) : <Empty text="All tickets are assigned." />}
                </Block>
              </Grid>
            )}

            {s.slaRisk && (
              <Grid item xs={12} md={6}>
                <Block title="SLA at risk" subtitle="Due within 2 hours or already overdue" icon={TimerOutlined} color="warning" count={s.slaRisk.length}>
                  {s.slaRisk.length ? (
                    <List dense disablePadding sx={{ containerType: 'inline-size' }}>
                      {s.slaRisk.map((t) => (
                        <ListItemButton key={t._id} onClick={() => navigate(`/tickets/${t._id}`)} sx={ROW}>
                          <ListItemText primary={<Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><b style={{ whiteSpace: 'nowrap' }}>{t.number}</b><PriorityChip value={t.priority} short /><StatusChip value={t.status} /></Stack>} secondary={t.description} />
                          <SlaTimer ticket={t} compact />
                        </ListItemButton>
                      ))}
                    </List>
                  ) : <Empty text="No tickets are close to their deadline. 👍" />}
                </Block>
              </Grid>
            )}

            {s.toVerify && (
              <Grid item xs={12} md={6}>
                <Block title="Waiting for your verification" subtitle="Completed by technicians — check and close" icon={FactCheckOutlined} color="success" count={s.toVerify.length}>
                  {s.toVerify.length ? (
                    <List dense disablePadding sx={{ containerType: 'inline-size' }}>
                      {s.toVerify.map((w) => (
                        <ListItemButton key={w._id} onClick={() => openWo(w)} sx={{ borderRadius: 2, mb: 0.5 }}>
                          <ListItemText primary={<b>{w.number}</b>} secondary={`${w.title} · by ${w.assigneeIds?.map((a) => a.name).join(', ')} · ${fromNow(w.completedAt)}`} />
                          <Button size="small" variant="contained" color="secondary">Review</Button>
                        </ListItemButton>
                      ))}
                    </List>
                  ) : <Empty text="Nothing to verify." />}
                </Block>
              </Grid>
            )}

            {s.attendance && (
              <Grid item xs={12} md={6}>
                <Block title="Attendance & deployment" subtitle={`${s.attendance.present}/${s.attendance.planned} present (${s.attendance.pct}%) · ${s.attendanceExceptions || 0} exceptions to review`} icon={HowToRegOutlined} action={<Button size="small" onClick={() => navigate('/attendance')}>Open</Button>}>
                  {(s.deployment || []).map((d) => (
                    <Accordion key={d.shift} disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '8px !important', mb: 1, '&:before': { display: 'none' } }}>
                      <AccordionSummary expandIcon={<ExpandMore />}><Typography variant="body2" fontWeight={700} sx={{ flex: 1 }}>{d.shift}</Typography><Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>{d.present}/{d.total} in</Typography></AccordionSummary>
                      <AccordionDetails sx={{ pt: 0 }}>
                        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.75}>
                          {d.people.map((p, i) => <Chip key={i} size="small" label={p.name} color={p.present ? 'success' : 'default'} variant={p.present ? 'filled' : 'outlined'} title={`${p.designation || ''}${p.post ? ` · ${p.post}` : ''}`} />)}
                        </Stack>
                      </AccordionDetails>
                    </Accordion>
                  ))}
                </Block>
              </Grid>
            )}

            {(s.ppmToday || s.criticalChecks) && (
              <Grid item xs={12} md={6}>
                <Block title="PPM & critical assets" subtitle="Today's planned maintenance" icon={EventRepeatOutlined} color="info">
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                    {(s.ppmToday || []).map((p) => <Chip key={p.status} label={`${label(p.status)}: ${p.count}`} />)}
                    {!s.ppmToday?.length && <Typography variant="body2" color="text.secondary">No PPM planned today.</Typography>}
                  </Stack>
                  {s.criticalAssetsDown?.length > 0 && (
                    <Box sx={{ mb: 1.5 }}>
                      <Typography variant="caption" fontWeight={700} color="error.main">Critical assets not running</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>{s.criticalAssetsDown.map((a) => <Chip key={a._id} color="error" variant="outlined" icon={<WarningAmberOutlined />} label={`${a.code} · ${label(a.status)}`} onClick={() => navigate(`/assets/${a._id}`)} />)}</Stack>
                    </Box>
                  )}
                  {s.criticalChecks?.map((w) => (
                    <ListItemButton key={w._id} dense onClick={() => navigate(`/work-orders/${w._id}`)} sx={{ borderRadius: 2 }}>
                      <ListItemText primary={`${w.assetId.code} · ${w.assetId.name}`} secondary={w.number} />
                      <StatusChip value={w.status} />
                    </ListItemButton>
                  ))}
                </Block>
              </Grid>
            )}

            {s.materialRequests && (
              <Grid item xs={12} md={6}>
                <Block title="Material requests" subtitle="Issue parts against work orders" icon={OutboxOutlined} count={s.materialRequests.length}>
                  {s.materialRequests.length ? s.materialRequests.map((m) => (
                    <Stack key={m._id} direction="row" alignItems="center" spacing={1} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={700}>{m.number} {m.workOrderId && `· ${m.workOrderId.number}`}</Typography>
                        <Typography variant="caption" color="text.secondary">{m.items.map((i) => `${i.itemId?.name} × ${i.qty}`).join(', ')} · {m.requestedBy?.name}</Typography>
                      </Box>
                      <Button size="small" variant="contained" color="secondary" disabled={issue.isPending} onClick={() => issue.mutate(m._id)}>Issue</Button>
                    </Stack>
                  )) : <Empty text="No pending requests." />}
                </Block>
              </Grid>
            )}

            {s.lowStock && (
              <Grid item xs={12} md={6}>
                <Block title="Low stock" subtitle="At or below reorder level" icon={Inventory2Outlined} color="warning" count={s.lowStock.length} action={<Button size="small" onClick={() => navigate('/inventory?view=alerts')}>All alerts</Button>}>
                  {s.lowStock.length ? s.lowStock.map((l) => (
                    <Stack key={`${l.itemId}-${l.storeId}`} direction="row" justifyContent="space-between" sx={{ py: 0.75 }}>
                      <Typography variant="body2">{l.item.name}<Typography component="span" variant="caption" color="text.secondary"> · {l.store.name}</Typography></Typography>
                      <Typography variant="body2" fontWeight={700} color="warning.main">{l.qty} / {l.item.reorderLevel}</Typography>
                    </Stack>
                  )) : <Empty text="Stock levels are healthy." />}
                </Block>
              </Grid>
            )}

            {s.openIncidents && (
              <Grid item xs={12} md={6}>
                <Block title="Safety" subtitle={`${s.overdueCapas || 0} overdue CAPA · ${s.inspectionsDue?.length || 0} inspections due`} icon={ReportProblemOutlined} color="error">
                  {s.openIncidents.map((i) => (
                    <ListItemButton key={i._id} dense onClick={() => navigate(`/hse/incidents?id=${i._id}`)} sx={{ borderRadius: 2 }}>
                      <ListItemText primary={`${i.number} · ${i.title}`} secondary={fmtDateTime(i.occurredAt)} />
                      <StatusChip value={i.status} />
                    </ListItemButton>
                  ))}
                  {s.inspectionsDue?.map((i) => (
                    <ListItemButton key={i._id} dense onClick={() => navigate(`/hse/inspections?id=${i._id}`)} sx={{ borderRadius: 2 }}>
                      <ListItemText primary={i.title} secondary={`Inspection due ${fmtDateTime(i.scheduledDate)}`} />
                    </ListItemButton>
                  ))}
                  {!s.openIncidents.length && !s.inspectionsDue?.length && <Empty text="No open incidents." />}
                </Block>
              </Grid>
            )}

            {s.actionItems && (s.actionItems.length > 0 || user.layout !== 'field') && (
              <Grid item xs={12} md={6}>
                <Block title="My action points" subtitle="From the daily review and reports" icon={FlagOutlined} color="info" count={s.actionItems.length}>
                  {s.actionItems.length ? s.actionItems.map((a) => (
                    <ListItemButton key={a._id} dense onClick={() => navigate(`/daily/actions?id=${a._id}`)} sx={{ borderRadius: 2 }}>
                      <ListItemText primary={a.title} secondary={a.dueDate ? `Due ${fmtDate(a.dueDate)}` : ''} />
                      <StatusChip value={a.status} />
                    </ListItemButton>
                  )) : <Empty text="No action points for you." />}
                </Block>
              </Grid>
            )}
          </Grid>
        )}
      </QueryState>
    </Box>
  );
}
