import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Box, Button, Card, CardActionArea, InputAdornment, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import Add from '@mui/icons-material/Add';
import Search from '@mui/icons-material/Search';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import { api, download } from '../../api/client';
import { hasRole } from '../../store/auth';
import { useDebounced, useMobile, usePerm } from '../../hooks';
import { buildColumns, DataTable } from '../../components/DataTable';
import { EmptyState, Loading, PageHeader, PriorityChip, SlaTimer, StatusChip } from '../../components/common';
import { fromNow } from '../../utils/format';

const STAFF_TABS = [['open', 'Open'], ['critical', 'Critical (P1)'], ['unassigned', 'To assign'], ['breached', 'SLA breached'], ['verification', 'Awaiting verification'], ['resolved', 'Resolved'], ['closed', 'Closed'], ['all', 'All'], ['mine', 'Mine']];
const TENANT_TABS = [['open', 'Open'], ['resolved', 'Please confirm'], ['closed', 'Closed'], ['all', 'All']];

function TicketCards({ params }) {
  const navigate = useNavigate();
  const q = useInfiniteQuery({
    queryKey: ['tickets', 'cards', params],
    queryFn: ({ pageParam }) => api.list('/tickets', { ...params, page: pageParam, limit: 15 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.meta.page * last.meta.limit < last.meta.total ? last.meta.page + 1 : undefined),
  });
  if (q.isLoading) return <Loading />;
  const rows = q.data?.pages.flatMap((p) => p.data) || [];
  if (!rows.length) return <EmptyState title="No tickets here" text="Raise a ticket and it will show up here with a live timer." action={<Button variant="contained" color="secondary" onClick={() => navigate('/tickets/new')}>Raise a ticket</Button>} />;
  return (
    <Stack spacing={1.25} sx={{ p: { xs: 0, sm: 1.5 } }}>
      {rows.map((t) => (
        <Card key={t._id}>
          <CardActionArea data-row-card onClick={() => navigate(`/tickets/${t._id}`)} sx={{ p: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center"><Typography fontWeight={800}>{t.number.split('-').slice(-1)[0]}</Typography><PriorityChip value={t.priority} short /></Stack>
              <StatusChip value={t.status} />
            </Stack>
            <Typography sx={{ mt: 1, fontWeight: 600 }}>{t.description}</Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: 'text.secondary', mt: 0.5 }}>
              <PlaceOutlined sx={{ fontSize: 16 }} /><Typography variant="body2" noWrap>{t.locationId?.path || '—'}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-end" sx={{ mt: 1.5 }}>
              <Typography variant="caption" color="text.secondary">{t.categoryId?.name} · {fromNow(t.createdAt)}{t.assigneeId ? ` · ${t.assigneeId.name}` : ''}</Typography>
              <SlaTimer ticket={t} compact />
            </Stack>
          </CardActionArea>
        </Card>
      ))}
      {q.hasNextPage && <Button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>Load more</Button>}
    </Stack>
  );
}

export default function TicketList() {
  const navigate = useNavigate();
  const { user, can } = usePerm();
  const mobile = useMobile();
  const tenant = hasRole(user, 'tenant') && user.layout === 'field';
  const tabs = tenant ? TENANT_TABS : STAFF_TABS;
  const [sp, setSp] = useSearchParams();
  const view = tabs.some(([v]) => v === sp.get('view')) ? sp.get('view') : 'open';
  const [search, setSearch] = useState('');
  const ds = useDebounced(search);
  const params = { ...(view !== 'all' && { view }), ...(ds && { search: ds }) };
  const columns = useMemo(() => buildColumns([
    { field: 'number', headerName: 'Ticket', minWidth: 190, flex: 0.9, renderCell: (p) => <Typography variant="body2" fontWeight={700}>{p.value}</Typography> },
    'priority||priority',
    { field: 'description', headerName: 'Problem & location', flex: 2, minWidth: 260, sortable: false, renderCell: (p) => <Box sx={{ lineHeight: 1.3, py: 0.75, overflow: 'hidden' }}><Typography variant="body2" fontWeight={600} noWrap>{p.value}</Typography><Typography variant="caption" color="text.secondary" noWrap component="div">{p.row.locationId?.path}{p.row.assetId ? ` · ${p.row.assetId.code}` : ''}</Typography></Box> },
    'categoryId.name|Category',
    'status||status',
    'sla|SLA|sla',
    'assigneeId.name|Assigned to',
    'createdAt|Raised|ago',
  ]), []);

  return (
    <Box>
      <PageHeader
        title={tenant ? 'My tickets' : 'Helpdesk tickets'}
        subtitle={tenant ? 'Everything you have reported, with a live countdown to the fix.' : 'Every complaint with its SLA clock. Amber = 75% of the time used, red = overdue.'}
        help="Each ticket gets a response and a resolution deadline from its priority. The clock pauses while a ticket is on hold. Supervisors are warned at 75%, the PM on breach, the owner after that."
        actions={<>
          {!tenant && <Button startIcon={<FileDownloadOutlined />} onClick={() => download('/tickets', { ...params, format: 'xlsx' }, 'tickets.xlsx')}>Export</Button>}
          {can('ticket:create') && <Button variant="contained" color="secondary" startIcon={<Add />} onClick={() => navigate('/tickets/new')}>Raise a ticket</Button>}
        </>}
      />
      <Card sx={tenant || mobile ? { bgcolor: 'transparent', border: 'none' } : undefined}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={1} sx={{ px: { md: 2 }, pt: 1, borderBottom: tenant || mobile ? 'none' : '1px solid', borderColor: 'divider' }}>
          <Tabs value={view} onChange={(e, v) => setSp({ view: v })} variant="scrollable" scrollButtons="auto" textColor="secondary" indicatorColor="secondary">
            {tabs.map(([v, l]) => <Tab key={v} value={v} label={l} />)}
          </Tabs>
          <TextField placeholder="Search number or text…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ maxWidth: { md: 300 }, pb: 1 }} InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />
        </Stack>
        {tenant || mobile ? <TicketCards params={params} /> : <DataTable url="/tickets" qk="tickets" columns={columns} params={params} rowHeight={60} onRowClick={(r) => navigate(`/tickets/${r._id}`)} emptyTitle="No tickets in this view" />}
      </Card>
    </Box>
  );
}
