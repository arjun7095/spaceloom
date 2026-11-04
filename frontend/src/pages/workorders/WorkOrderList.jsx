import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Box, Button, Card, CardActionArea, Chip, IconButton, InputAdornment, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import Search from '@mui/icons-material/Search';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import TableRowsOutlined from '@mui/icons-material/TableRowsOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import { api } from '../../api/client';
import { useDebounced, useMobile, usePerm } from '../../hooks';
import { buildColumns, DataTable } from '../../components/DataTable';
import { EmptyState, Loading, PageHeader, PriorityChip, StatusChip } from '../../components/common';
import { fmtDate, label } from '../../utils/format';

const TABS = [['my', 'My jobs'], ['open', 'Open'], ['today', 'Due today'], ['overdue', 'Overdue'], ['verification', 'Awaiting verification'], ['done', 'Done'], ['all', 'All']];
const TYPES = [['', 'All types'], ['ppm', 'PPM'], ['daily_check', 'Daily log sheets'], ['breakdown', 'Breakdown'], ['corrective', 'Corrective'], ['amc_visit', 'AMC visit']];

function MonthCalendar({ type, onOpen }) {
  const [month, setMonth] = useState(dayjs().startOf('month'));
  const [day, setDay] = useState(null);
  const q = useQuery({ queryKey: ['work-orders', 'calendar', month.format('YYYY-MM'), type], queryFn: () => api.get('/work-orders/calendar', { month: month.format('YYYY-MM'), type: type || undefined }) });
  const byDay = {};
  for (const w of q.data || []) (byDay[dayjs(w.plannedDate).format('YYYY-MM-DD')] ||= []).push(w);
  const start = month.startOf('week');
  const cells = Array.from({ length: 42 }, (_, i) => start.add(i, 'day'));
  const selected = day ? byDay[day] || [] : [];
  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <IconButton onClick={() => setMonth(month.subtract(1, 'month'))} aria-label="Previous month"><ChevronLeft /></IconButton>
        <Typography variant="h6" sx={{ minWidth: 170, textAlign: 'center' }}>{month.format('MMMM YYYY')}</Typography>
        <IconButton onClick={() => setMonth(month.add(1, 'month'))} aria-label="Next month"><ChevronRight /></IconButton>
        <Button size="small" onClick={() => setMonth(dayjs().startOf('month'))}>This month</Button>
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={1.5} sx={{ display: { xs: 'none', sm: 'flex' } }}>
          {[['success', 'Done'], ['info', 'Planned'], ['error', 'Overdue']].map(([c, l]) => <Stack key={l} direction="row" spacing={0.5} alignItems="center"><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: `${c}.main` }} /><Typography variant="caption">{l}</Typography></Stack>)}
        </Stack>
      </Stack>
      {q.isLoading ? <Loading /> : (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.75 }}>
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <Typography key={d} variant="caption" fontWeight={700} color="text.secondary" textAlign="center">{d}</Typography>)}
          {cells.map((c) => {
            const k = c.format('YYYY-MM-DD');
            const list = byDay[k] || [];
            const overdue = list.filter((w) => !['completed', 'verified', 'closed', 'cancelled'].includes(w.status) && c.isBefore(dayjs(), 'day')).length;
            const done = list.filter((w) => ['completed', 'verified', 'closed'].includes(w.status)).length;
            return (
              <Box key={k} onClick={() => list.length && setDay(k)} sx={{ minHeight: { xs: 54, md: 84 }, p: 0.75, borderRadius: 2, border: '1px solid', borderColor: day === k ? 'secondary.main' : 'divider', bgcolor: c.month() !== month.month() ? 'grey.50' : '#fff', opacity: c.month() !== month.month() ? 0.55 : 1, cursor: list.length ? 'pointer' : 'default' }}>
                <Typography variant="caption" fontWeight={c.isSame(dayjs(), 'day') ? 800 : 500} color={c.isSame(dayjs(), 'day') ? 'secondary.main' : 'text.secondary'}>{c.date()}</Typography>
                {list.length > 0 && (
                  <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                    <Typography variant="caption" fontWeight={700} sx={{ display: { xs: 'none', md: 'block' } }}>{list.length} job{list.length > 1 ? 's' : ''}</Typography>
                    <Stack direction="row" spacing={0.4} flexWrap="wrap">
                      {done > 0 && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} title={`${done} done`} />}
                      {list.length - done - overdue > 0 && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'info.main' }} />}
                      {overdue > 0 && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} title={`${overdue} overdue`} />}
                    </Stack>
                  </Stack>
                )}
              </Box>
            );
          })}
        </Box>
      )}
      {day && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle1" sx={{ mb: 1 }}>{fmtDate(day)} · {selected.length} job(s)</Typography>
          <Stack spacing={0.75}>
            {selected.map((w) => (
              <Card key={w._id}><CardActionArea onClick={() => onOpen(w)} sx={{ px: 2, py: 1.25 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="body2" fontWeight={700}>{w.number} · {w.assetId?.code}</Typography><Typography variant="caption" color="text.secondary">{w.title}</Typography></Box><StatusChip value={w.status} /></Stack>
              </CardActionArea></Card>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
}

function WoCards({ params, onOpen }) {
  const q = useQuery({ queryKey: ['work-orders', 'cards', params], queryFn: () => api.list('/work-orders', { ...params, limit: 50, sort: 'plannedDate' }) });
  if (q.isLoading) return <Loading />;
  if (!q.data?.data.length) return <EmptyState title="No jobs here" text="New jobs appear here as soon as they are assigned to you." />;
  return (
    <Stack spacing={1.25}>
      {q.data.data.map((w) => (
        <Card key={w._id}><CardActionArea onClick={() => onOpen(w)} sx={{ p: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center"><Stack direction="row" spacing={1} alignItems="center"><Typography fontWeight={800}>{w.ticketId?.number || w.number}</Typography><Chip size="small" variant="outlined" label={label(w.type)} /></Stack><StatusChip value={w.status} /></Stack>
          <Typography sx={{ mt: 1, fontWeight: 600 }}>{w.title}</Typography>
          <Typography variant="body2" color="text.secondary">{w.assetId?.code ? `${w.assetId.code} · ` : ''}{w.locationId?.path}</Typography>
          <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}><Typography variant="caption" color="text.secondary">Due {fmtDate(w.plannedDate)}</Typography><PriorityChip value={w.priority} short /></Stack>
        </CardActionArea></Card>
      ))}
    </Stack>
  );
}

export default function WorkOrderList() {
  const navigate = useNavigate();
  const { user } = usePerm();
  const mobile = useMobile();
  const field = user.layout === 'field';
  const [sp, setSp] = useSearchParams();
  const view = TABS.some(([v]) => v === sp.get('view')) ? sp.get('view') : field ? 'my' : 'open';
  const type = sp.get('type') || '';
  const [mode, setMode] = useState(type === 'ppm' && !field ? 'calendar' : 'table');
  const [search, setSearch] = useState('');
  const ds = useDebounced(search);
  const params = { ...(view !== 'all' && { view }), ...(type && { 'filter[type]': type }), ...(ds && { search: ds }) };
  const update = (patch) => setSp({ ...Object.fromEntries(sp.entries()), ...patch });
  const open = (w) => navigate(w.ticketId ? `/tickets/${w.ticketId._id || w.ticketId}` : `/work-orders/${w._id}`);
  const columns = useMemo(() => buildColumns(['number|Work order|strong', 'type', 'title', 'assetId.code|Asset', 'locationId.path|Location', 'assigneeIds|Assigned to|chips', 'plannedDate|Due|date', 'status||status']), []);

  return (
    <Box>
      <PageHeader title={field ? 'My jobs' : 'Work orders'} subtitle={field ? 'Tap a job to open its checklist.' : 'PPM, breakdown and corrective jobs. PPM work orders are generated automatically from each asset’s schedule.'}
        help="Statuses: Scheduled → Assigned → In progress → Completed (by the technician) → Verified (by the supervisor) → Closed."
        actions={!field && <ToggleButtonGroup size="small" exclusive value={mode} onChange={(e, v) => v && setMode(v)}><ToggleButton value="table"><TableRowsOutlined fontSize="small" sx={{ mr: 0.5 }} />List</ToggleButton><ToggleButton value="calendar"><CalendarMonthOutlined fontSize="small" sx={{ mr: 0.5 }} />Calendar</ToggleButton></ToggleButtonGroup>} />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
        {TYPES.map(([v, l]) => <Chip key={v || 'all'} label={l} clickable color={type === v ? 'secondary' : 'default'} variant={type === v ? 'filled' : 'outlined'} onClick={() => update({ type: v })} />)}
      </Stack>
      <Card sx={field || mobile ? { bgcolor: 'transparent', border: 'none' } : undefined}>
        {mode === 'calendar' && !field ? <MonthCalendar type={type} onOpen={open} /> : (
          <>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1} sx={{ px: { md: 2 }, pt: 1, borderBottom: field || mobile ? 'none' : '1px solid', borderColor: 'divider', mb: field || mobile ? 1 : 0 }}>
              <Tabs value={view} onChange={(e, v) => update({ view: v })} variant="scrollable" scrollButtons="auto" textColor="secondary" indicatorColor="secondary">
                {TABS.map(([v, l]) => <Tab key={v} value={v} label={l} />)}
              </Tabs>
              {!field && <TextField placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ maxWidth: { md: 280 }, pb: 1 }} InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />}
            </Stack>
            {field || mobile ? <WoCards params={params} onOpen={open} /> : <DataTable url="/work-orders" qk="work-orders" columns={columns} params={params} onRowClick={open} emptyTitle="No work orders in this view" />}
          </>
        )}
      </Card>
    </Box>
  );
}

