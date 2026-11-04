import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Box, Button, Card, Chip, Stack, Typography } from '@mui/material';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import { api } from '../api/client';
import { useAction } from '../hooks';
import { EmptyState, PageHeader, QueryState, useDialogs } from '../components/common';
import { fromNow, inr, label } from '../utils/format';

// link (from the server) → [api path, approve state, reject state]
const ACTIONS = {
  '/people/leave': ['leave-requests', 'approved', 'rejected'],
  '/people/overtime': ['overtime-requests', 'approved', 'rejected'],
  '/people/regularizations': ['regularizations', 'approved', 'rejected'],
  '/people/contractors': ['contractor-deployments', 'approved', 'rejected'],
  '/procurement/requests': ['purchase-requests', 'approved', 'rejected'],
  '/procurement/orders': ['purchase-orders', 'approved', 'rejected'],
  '/vendors/invoices': ['vendor-invoices', 'approved', 'disputed'],
  '/vendors/amcs': ['amcs', 'renewed', 'expiring'],
  '/hse/permits': ['permits', 'approved', 'cancelled'],
  '/hse/capas': ['capas', 'verified', 'in_progress'],
};

export default function Approvals() {
  const navigate = useNavigate();
  const { prompt } = useDialogs();
  const q = useQuery({ queryKey: ['approvals'], queryFn: () => api.get('/approvals/inbox') });
  const act = useAction(({ path, id, body }) => api.post(`/${path}/${id}/transition`, body), { success: (r, v) => (v.approve ? 'Approved' : 'Sent back'), invalidate: ['approvals', 'today'] });
  const decide = async (a, approve) => {
    const [path, ok, no] = ACTIONS[a.link];
    const note = await prompt({ title: approve ? `Approve ${a.title}?` : `Reject ${a.title}?`, label: approve ? 'Comment (optional)' : 'Reason', required: !approve, confirmText: approve ? 'Approve' : 'Reject' });
    if (note === null) return;
    act.mutate({ path, id: a._id, approve, body: { to: approve ? ok : no, note: note || undefined, ...(no === 'disputed' && !approve && { disputeReason: note }) } });
  };
  return (
    <Box>
      <PageHeader title="Approvals" subtitle="Everything waiting for your decision, oldest first." help="Multi-level approvals move to the next approver automatically. Requests above the value limit go to the owner after the PM. If you are away, set up a delegation under Admin → Delegations." />
      <QueryState q={q} empty={<EmptyState icon={<TaskAltOutlined />} title="You're all caught up" text="New requests appear here, and you get a notification." />}>
        {(rows) => (
          <Stack spacing={1.25}>
            {rows.map((a) => (
              <Card key={`${a.kind}-${a._id}`} sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={a.kind} color="secondary" variant="outlined" />
                      {a.level && <Chip size="small" label={`Level: ${label(a.level)}`} />}
                      <Typography variant="caption" color="text.secondary">{fromNow(a.at)}</Typography>
                    </Stack>
                    <Typography fontWeight={700} sx={{ mt: 0.75 }}>{a.title}</Typography>
                    {a.subtitle && <Typography variant="body2" color="text.secondary" noWrap>{a.subtitle}</Typography>}
                  </Box>
                  {a.amount != null && <Typography variant="h6" sx={{ minWidth: 120, textAlign: { md: 'right' } }}>{inr(a.amount)}</Typography>}
                  <Stack direction="row" spacing={1}>
                    <Button onClick={() => navigate(a.link === '/reports' ? `/reports/${a._id}` : `${a.link}?id=${a._id}`)}>Open</Button>
                    {ACTIONS[a.link] && <Button color="error" variant="outlined" disabled={act.isPending} onClick={() => decide(a, false)}>Reject</Button>}
                    {ACTIONS[a.link] ? <Button color="secondary" variant="contained" disabled={act.isPending} onClick={() => decide(a, true)}>Approve</Button> : <Button color="secondary" variant="contained" onClick={() => navigate(`/reports/${a._id}`)}>Review & sign off</Button>}
                  </Stack>
                </Stack>
              </Card>
            ))}
          </Stack>
        )}
      </QueryState>
    </Box>
  );
}
