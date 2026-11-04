import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Box, Button, Card, Chip, IconButton, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography } from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import { api } from '../api/client';
import { EmptyState, PageHeader, QueryState, StatusChip, StackTable } from '../components/common';
import { fmtDate, fmtTime } from '../utils/format';

const outOfRange = (c) => (c.type === 'number' || c.type === 'reading') && c.value != null && c.value !== '' && ((c.min != null && Number(c.value) < c.min) || (c.max != null && Number(c.value) > c.max));
const show = (c) => (c.value == null || c.value === '' ? '—' : c.type === 'yesno' ? (c.value === true ? 'Yes' : c.value === false ? 'No' : '—') : `${c.value}${c.unit ? ` ${c.unit}` : ''}`);

// FR-4.5: one sheet per equipment type, one row per asset, readings across.
export default function LogSheets() {
  const navigate = useNavigate();
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'));
  const q = useQuery({ queryKey: ['work-orders', 'log-sheet', date], queryFn: () => api.get('/work-orders/log-sheet', { date }) });
  const move = (n) => setDate(dayjs(date).add(n, 'day').format('YYYY-MM-DD'));
  return (
    <Box>
      <PageHeader title="Daily log sheets" subtitle="Critical equipment readings taken on every round. Red values are outside the safe range and raise a ticket automatically."
        help="Technicians fill these from My jobs on their phone (also without signal). Every reading is saved to the asset's history, so you can see trends on the asset page."
        actions={<>
          <Stack direction="row" alignItems="center">
            <IconButton onClick={() => move(-1)} aria-label="Previous day"><ChevronLeft /></IconButton>
            <TextField type="date" value={date} onChange={(e) => setDate(e.target.value)} sx={{ width: 170 }} />
            <IconButton onClick={() => move(1)} disabled={date >= dayjs().format('YYYY-MM-DD')} aria-label="Next day"><ChevronRight /></IconButton>
          </Stack>
          <Button startIcon={<PrintOutlined />} onClick={() => window.print()}>Print</Button>
        </>} />
      <QueryState q={q} empty={<EmptyState title="No log sheets for this day" text="Daily checks are created each morning for DG sets, chillers and transformers that have a daily schedule." />}>
        {({ rows }) => {
          if (!rows.length) return <EmptyState title="No log sheets for this day" />;
          const groups = {};
          for (const r of rows) (groups[(r.scheduleId?.title || r.title).split(' – ')[0]] ||= []).push(r);
          return (
            <Stack spacing={2}>
              {Object.entries(groups).map(([name, list]) => {
                const cols = list[0].checklist;
                const done = list.filter((r) => r.status === 'closed').length;
                return (
                  <Card key={name} sx={{ overflowX: 'auto' }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2, py: 1.5 }}>
                      <Box><Typography variant="subtitle1">{name}</Typography><Typography variant="caption" color="text.secondary">{fmtDate(date)} · {done} of {list.length} taken</Typography></Box>
                      <Chip label={done === list.length ? 'Complete' : `${list.length - done} pending`} color={done === list.length ? 'success' : 'warning'} size="small" />
                    </Stack>
                    <StackTable>
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>Asset</TableCell>
                          {cols.map((c) => <TableCell key={c.label} sx={{ fontWeight: 700, minWidth: 110, maxWidth: 190, lineHeight: 1.3 }}>{c.label}{c.min != null ? <Typography variant="caption" color="text.secondary" display="block">{c.min}–{c.max} {c.unit}</Typography> : null}</TableCell>)}
                          <TableCell sx={{ fontWeight: 700 }}>Taken</TableCell>
                          <TableCell />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {list.map((r) => (
                          <TableRow key={r._id} hover>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}><b>{r.assetId?.code}</b><Typography variant="caption" color="text.secondary" display="block">{r.assigneeIds?.map((a) => a.name).join(', ')}</Typography></TableCell>
                            {r.checklist.map((c) => (
                              <TableCell key={c.label} sx={{ color: outOfRange(c) || (c.type === 'yesno' && c.value === false) ? 'error.main' : undefined, fontWeight: outOfRange(c) ? 700 : 400, whiteSpace: 'nowrap' }}>
                                {(outOfRange(c) || (c.type === 'yesno' && c.value === false)) && <Tooltip title="Outside the safe range"><WarningAmberRounded sx={{ fontSize: 15, verticalAlign: 'text-bottom', mr: 0.5 }} /></Tooltip>}
                                {show(c)}
                              </TableCell>
                            ))}
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.completedAt ? <>{fmtTime(r.completedAt)}{r.offlineSync && <Chip size="small" variant="outlined" label="synced later" sx={{ ml: 0.5 }} />}</> : <StatusChip value={r.status} />}</TableCell>
                            <TableCell align="right">{r.status !== 'closed' && <Button size="small" variant="contained" color="secondary" onClick={() => navigate(`/work-orders/${r._id}`)} className="no-print">Fill</Button>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </StackTable>
                  </Card>
                );
              })}
            </Stack>
          );
        }}
      </QueryState>
    </Box>
  );
}
