import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, Stack, Tab, Tabs } from '@mui/material';
import { api } from '../../api/client';
import { useAction, usePerm } from '../../hooks';
import { buildColumns, DataTable } from '../../components/DataTable';
import { PageHeader } from '../../components/common';

const TYPES = [['', 'All'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']];

export default function Reports() {
  const navigate = useNavigate();
  const { can } = usePerm();
  const [type, setType] = useState('');
  const gen = useAction((t) => api.post('/reports/generate', { type: t }), { success: (r) => `${r.title} ready (v${r.version})`, invalidate: ['reports'], onSuccess: (r) => navigate(`/reports/${r._id}`) });
  const columns = useMemo(() => buildColumns(['title|Report|strong', 'type', 'periodStart|From|date', 'periodEnd|To|date', 'version', 'status||status', 'signedBy.name|Signed off by']), []);
  return (
    <Box>
      <PageHeader title="Client reports" subtitle="Daily, weekly and monthly reports for the client. Drafts are generated automatically every morning."
        help="Each report shows every KPI as Target → Actual → Variance → Responsibility → Corrective action. The PM adds commentary, signs off and sends it; the owner acknowledges."
        actions={can('report:create') && <>
          <Button onClick={() => navigate('/reports/schedules')}>Schedules & recipients</Button>
          {TYPES.slice(1).map(([t, l]) => <Button key={t} variant={t === 'daily' ? 'contained' : 'outlined'} color="secondary" disabled={gen.isPending} onClick={() => gen.mutate(t)}>Generate {l.toLowerCase()}</Button>)}
        </>} />
      <Card>
        <Stack sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Tabs value={type} onChange={(e, v) => setType(v)} textColor="secondary" indicatorColor="secondary">{TYPES.map(([v, l]) => <Tab key={v} value={v} label={l} />)}</Tabs>
        </Stack>
        <DataTable url="/reports" qk="reports" columns={columns} params={type ? { 'filter[type]': type } : {}} onRowClick={(r) => navigate(`/reports/${r._id}`)} emptyTitle="No reports yet" emptyText="Use “Generate daily” to create one now." />
      </Card>
    </Box>
  );
}
