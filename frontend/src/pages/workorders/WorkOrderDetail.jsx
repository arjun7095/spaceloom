import { useState } from 'react';
import { Link as RouterLink, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Accordion, AccordionDetails, AccordionSummary, Box, Breadcrumbs, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Link, Stack, Typography } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import MenuBookOutlined from '@mui/icons-material/MenuBookOutlined';
import { api } from '../../api/client';
import { useAction, usePerm } from '../../hooks';
import { ErrorState, KeyValue, Loading, PriorityChip, SectionCard, StatusChip, Timeline, useDialogs } from '../../components/common';
import { RefSelect } from '../../components/form';
import WorkOrderPanel, { PartsDialog } from '../../components/WorkOrderPanel';
import Comments from '../../components/Comments';
import { fmtDate, fmtDateTime, label } from '../../utils/format';

function AssignDialog({ wo, onClose }) {
  const [ids, setIds] = useState(wo.assigneeIds.map((a) => a._id));
  const go = useAction((b) => api.post(`/work-orders/${wo._id}/assign`, b), { success: 'Assigned', invalidate: ['work-orders'], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Assign work order</DialogTitle>
      <DialogContent><Box sx={{ pt: 1 }}><RefSelect refTo="users" multiple label="Technicians" value={ids} onChange={setIds} /></Box></DialogContent>
      <DialogActions><Button color="inherit" onClick={onClose}>Cancel</Button><Button variant="contained" color="secondary" disabled={!ids.length} onClick={() => go.mutate({ assigneeIds: ids })}>Assign</Button></DialogActions>
    </Dialog>
  );
}

export default function WorkOrderDetail() {
  const { id } = useParams();
  const { user, can } = usePerm();
  const { prompt } = useDialogs();
  const [dialog, setDialog] = useState(null);
  const q = useQuery({ queryKey: ['work-orders', 'detail', id], queryFn: () => api.get(`/work-orders/${id}`) });
  const act = useAction(({ path, body }) => api.post(`/work-orders/${id}/${path}`, body), { success: (r, v) => v.msg, invalidate: ['work-orders', 'today', 'kpis'] });
  const ack = useAction((sopId) => api.post(`/sops/${sopId}/acknowledge`), { success: 'Thanks — recorded that you have read the SOP' });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const wo = q.data;
  if (wo.ticketId && user.layout === 'field') return <Navigate to={`/tickets/${wo.ticketId._id}`} replace />;
  const mine = wo.assigneeIds.some((a) => a._id === user._id);
  const worker = mine || can('workorder:assign');

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1.5 }}><Link component={RouterLink} to="/work-orders" underline="hover" color="inherit">Work orders</Link><Typography color="text.primary">{wo.number}</Typography></Breadcrumbs>
      <Card sx={{ p: { xs: 2, md: 3 }, mb: 2 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="overline" color="text.secondary">{wo.number}</Typography>
          <Chip size="small" variant="outlined" label={label(wo.type)} /><PriorityChip value={wo.priority} /><StatusChip value={wo.status} />
        </Stack>
        <Typography variant="h5" sx={{ mt: 0.5 }}>{wo.title}</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {wo.assetId && <Link component={RouterLink} to={`/assets/${wo.assetId._id}`}>{wo.assetId.code} · {wo.assetId.name}</Link>}{wo.locationId && ` · ${wo.locationId.path}`} · due {fmtDate(wo.plannedDate)}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
          {can('workorder:assign') && ['scheduled', 'assigned', 'on_hold'].includes(wo.status) && <Button variant="outlined" onClick={() => setDialog('assign')}>{wo.assigneeIds.length ? 'Reassign' : 'Assign'}</Button>}
          {worker && ['scheduled', 'assigned', 'on_hold'].includes(wo.status) && <Button variant="contained" color="secondary" onClick={() => act.mutate({ path: 'start', msg: 'Job started' })}>Start job</Button>}
          {worker && wo.status === 'in_progress' && <Button variant="outlined" onClick={() => setDialog('parts')}>Request parts</Button>}
          {can('workorder:verify') && wo.status === 'completed' && <Button variant="contained" color="success" onClick={() => act.mutate({ path: 'verify', msg: 'Verified' })}>Verify</Button>}
          {can('workorder:verify') && wo.status === 'completed' && <Button variant="outlined" color="warning" onClick={async () => { const r = await prompt({ title: 'Send back', label: 'What needs fixing?' }); if (r) act.mutate({ path: 'reject', body: { reason: r }, msg: 'Sent back' }); }}>Send back</Button>}
          {wo.ticketId && <Button component={RouterLink} to={`/tickets/${wo.ticketId._id}`}>Open ticket {wo.ticketId.number}</Button>}
        </Stack>
      </Card>
      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <Stack spacing={2}>
            {wo.sop && (
              <Accordion disableGutters sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '14px !important', '&:before': { display: 'none' } }} elevation={0}>
                <AccordionSummary expandIcon={<ExpandMore />}><Stack direction="row" spacing={1} alignItems="center"><MenuBookOutlined color="secondary" /><Typography fontWeight={700}>How to do this job: {wo.sop.title}</Typography><Chip size="small" label={`v${wo.sop.version}`} /></Stack></AccordionSummary>
                <AccordionDetails>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: 1.5 }}>{wo.sop.content}</Typography>
                  <Button size="small" variant="outlined" onClick={() => ack.mutate(wo.sop._id)}>I have read this SOP</Button>
                </AccordionDetails>
              </Accordion>
            )}
            <WorkOrderPanel key={wo.status} wo={wo} editable={worker && (wo.status === 'in_progress' || (['ppm', 'daily_check'].includes(wo.type) && ['scheduled', 'assigned'].includes(wo.status)))} onDone={() => q.refetch()} />
          </Stack>
        </Grid>
        <Grid item xs={12} lg={4}>
          <Stack spacing={2}>
            <SectionCard title="Details">
              <KeyValue items={[
                ['Assigned to', wo.assigneeIds.map((a) => a.name).join(', ') || 'Not yet'],
                ['Department', wo.departmentId?.name],
                ['Frequency', wo.scheduleId && label(wo.scheduleId.frequency)],
                ['Started', fmtDateTime(wo.startedAt)],
                ['Completed', fmtDateTime(wo.completedAt)],
                ['Verified by', wo.verifiedBy?.name],
              ]} />
            </SectionCard>
            <SectionCard title="History"><Timeline items={[...(wo.history || [])].reverse()} /></SectionCard>
            <Comments entity="WorkOrder" entityId={wo._id} />
          </Stack>
        </Grid>
      </Grid>
      {dialog === 'assign' && <AssignDialog wo={wo} onClose={() => setDialog(null)} />}
      {dialog === 'parts' && <PartsDialog wo={wo} onClose={() => { setDialog(null); q.refetch(); }} />}
    </Box>
  );
}
