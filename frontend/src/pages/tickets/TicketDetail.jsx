import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Avatar, Box, Breadcrumbs, Button, Card, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Link, List, ListItemButton,
  ListItemText, MenuItem, Rating, Stack, TextField, Typography,
} from '@mui/material';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import PrecisionManufacturingOutlined from '@mui/icons-material/PrecisionManufacturingOutlined';
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined';
import StarRounded from '@mui/icons-material/StarRounded';
import { api } from '../../api/client';
import { useAction, usePerm, useNow } from '../../hooks';
import { ErrorState, KeyValue, Loading, PriorityChip, SectionCard, StatusChip, Timeline, useDialogs } from '../../components/common';
import WorkOrderPanel, { PartsDialog, ReturnForm } from '../../components/WorkOrderPanel';
import { CommentBox } from '../../components/Comments';
import { RefSelect } from '../../components/form';
import { PRIORITY, duration, fmtDateTime, fromNow, inr, label, slaInfo } from '../../utils/format';

const OFFLINE_OK = ['acknowledge', 'start', 'hold', 'resume'];

function SlaBar({ title, due, doneAt, breached, pct, paused }) {
  useNow(30000);
  const done = Boolean(doneAt);
  const left = +new Date(due) - Date.now();
  const color = done ? (breached ? 'error' : 'success') : breached || left < 0 ? 'error' : pct >= 0.75 ? 'warning' : 'success';
  const text = done ? `${breached ? 'Missed' : 'Met'} · ${fmtDateTime(doneAt)}` : paused ? 'Paused while on hold' : left >= 0 ? `${duration(left)} left · due ${fmtDateTime(due)}` : `Overdue by ${duration(left)}`;
  return (
    <Box sx={{ flex: 1, minWidth: 220 }}>
      <Stack direction="row" justifyContent="space-between"><Typography variant="caption" fontWeight={700}>{title}</Typography><Typography variant="caption" color={`${color}.main`} fontWeight={700}>{text}</Typography></Stack>
      <Box sx={{ mt: 0.5, height: 8, borderRadius: 4, bgcolor: 'grey.100', overflow: 'hidden' }}><Box sx={{ width: `${Math.min(100, (done ? 1 : pct) * 100)}%`, height: '100%', bgcolor: `${color}.main`, borderRadius: 4 }} /></Box>
    </Box>
  );
}

function AssignDialog({ ticket, onClose }) {
  const q = useQuery({ queryKey: ['tickets', 'techs', ticket._id], queryFn: () => api.get(`/tickets/${ticket._id}/technicians`) });
  const [pick, setPick] = useState(null);
  const [note, setNote] = useState('');
  const go = useAction((b) => api.post(`/tickets/${ticket._id}/assign`, b), { success: 'Assigned — the technician has been notified', invalidate: ['tickets', 'today'], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Assign a technician<Typography variant="body2" color="text.secondary">Best matches first: right skill, on shift now, fewest open jobs.</Typography></DialogTitle>
      <DialogContent dividers>
        {q.isLoading ? <Loading /> : (
          <List disablePadding>
            {(q.data || []).map((t) => (
              <ListItemButton key={t._id} selected={pick === t._id} onClick={() => setPick(t._id)} sx={{ borderRadius: 2, mb: 1, border: '1px solid', borderColor: pick === t._id ? 'secondary.main' : 'divider' }}>
                <Avatar sx={{ mr: 1.5, bgcolor: t.onShift ? 'secondary.main' : 'grey.400' }}>{t.name.split(' ').map((x) => x[0]).join('').slice(0, 2)}</Avatar>
                <ListItemText primary={<Stack direction="row" spacing={1} alignItems="center"><b>{t.name}</b>{t.skillMatch && <Chip size="small" color="secondary" label="Skill match" />}</Stack>} secondary={`${t.designation || ''} · ${t.shift}`} />
                <Stack alignItems="flex-end" spacing={0.5}>
                  <Chip size="small" label={t.onShift ? (t.checkedIn ? 'Checked in' : 'On shift') : 'Off shift'} color={t.onShift ? 'success' : 'default'} variant={t.onShift ? 'filled' : 'outlined'} />
                  <Typography variant="caption" color="text.secondary">{t.openJobs} open job{t.openJobs === 1 ? '' : 's'}</Typography>
                </Stack>
              </ListItemButton>
            ))}
            {!q.data?.length && <Typography color="text.secondary">No technicians found for this department.</Typography>}
          </List>
        )}
        <TextField label="Note for the technician (optional)" value={note} onChange={(e) => setNote(e.target.value)} sx={{ mt: 1 }} />
      </DialogContent>
      <DialogActions><Button color="inherit" onClick={onClose}>Cancel</Button><Button variant="contained" color="secondary" disabled={!pick || go.isPending} onClick={() => go.mutate({ assigneeId: pick, note: note || undefined })}>Assign</Button></DialogActions>
    </Dialog>
  );
}

function ConfirmDialog({ ticket, onClose }) {
  const [accept, setAccept] = useState(true);
  const [rating, setRating] = useState(5);
  const go = useAction((b) => api.post(`/tickets/${ticket._id}/confirm`, b), { success: accept ? 'Thank you! The ticket is closed.' : 'Sorry about that — we have reopened it.', invalidate: ['tickets', 'kpis', 'today'], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Is it fixed?</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Stack direction="row" spacing={1}>
            <Button fullWidth variant={accept ? 'contained' : 'outlined'} color="success" onClick={() => setAccept(true)}>Yes, it's fixed</Button>
            <Button fullWidth variant={!accept ? 'contained' : 'outlined'} color="warning" onClick={() => setAccept(false)}>No, still a problem</Button>
          </Stack>
          {accept && <Box textAlign="center"><Typography variant="body2" color="text.secondary">How was the service?</Typography><Rating size="large" value={rating} onChange={(e, v) => setRating(v || 1)} icon={<StarRounded fontSize="inherit" />} emptyIcon={<StarRounded fontSize="inherit" />} /></Box>}
          <TextField multiline minRows={2} label={accept ? 'Anything to add? (optional)' : 'What is still wrong?'} required={!accept} value={comment} onChange={(e) => setComment(e.target.value)} />
          {go.error && <Alert severity="error">{go.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions><Button color="inherit" onClick={onClose}>Cancel</Button><Button variant="contained" color="secondary" disabled={go.isPending || (!accept && comment.trim().length < 3)} onClick={() => go.mutate({ accept, rating: accept ? rating : undefined, comment: comment || undefined })}>Submit</Button></DialogActions>
    </Dialog>
  );
}

function PriorityDialog({ ticket, onClose }) {
  const [priority, setPriority] = useState(ticket.priority);
  const [reason, setReason] = useState('');
  const go = useAction((b) => api.patch(`/tickets/${ticket._id}/priority`, b), { success: 'Priority changed; deadlines recalculated', invalidate: ['tickets', 'kpis'], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Change priority</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        <TextField select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>{Object.entries(PRIORITY).map(([k, p]) => <MenuItem key={k} value={k}>{p.label}</MenuItem>)}</TextField>
        <TextField label="Reason" required multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Stack></DialogContent>
      <DialogActions><Button color="inherit" onClick={onClose}>Cancel</Button><Button variant="contained" color="secondary" disabled={reason.trim().length < 3 || priority === ticket.priority} onClick={() => go.mutate({ priority, reason })}>Save</Button></DialogActions>
    </Dialog>
  );
}

function MergeDialog({ ticket, onClose }) {
  const navigate = useNavigate();
  const [target, setTarget] = useState(null);
  const go = useAction(() => api.post(`/tickets/${ticket._id}/merge`, { intoId: target }), { success: 'Merged — this ticket is now closed as a duplicate', invalidate: ['tickets', 'kpis'], onSuccess: () => { onClose(); navigate(`/tickets/${target}`); } });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Merge into another ticket<Typography variant="body2" color="text.secondary">Use this when the same problem was reported twice. This ticket is cancelled and a note is added to the other one.</Typography></DialogTitle>
      <DialogContent><Box sx={{ pt: 1 }}><RefSelect refTo="tickets" label="Keep this ticket open" value={target} onChange={setTarget} params={{ view: 'open' }} /></Box></DialogContent>
      <DialogActions><Button color="inherit" onClick={onClose}>Cancel</Button><Button variant="contained" color="secondary" disabled={!target || target === ticket._id || go.isPending} onClick={() => go.mutate()}>Merge</Button></DialogActions>
    </Dialog>
  );
}

function nextStep(t, me) {
  const tech = t.assigneeId?.name || 'the technician';
  if (t.status === 'new') return me.canAssign ? 'Assign a technician. The response clock is already running.' : `Your ticket is with the ${t.assignedDeptId?.name || ''} team. You will be notified when a technician is assigned.`;
  if (t.status === 'assigned' || t.status === 'reopened') return me.isAssignee ? 'Acknowledge to confirm you have seen this job. That meets the response SLA.' : `Waiting for ${tech} to acknowledge.${t.status === 'reopened' ? ' The tenant reported it is not fixed.' : ''}`;
  if (t.status === 'acknowledged') return me.isAssignee ? 'Start work when you reach the site.' : `${tech} has acknowledged and is on the way.`;
  if (t.status === 'in_progress' && t.awaitingVerification) return me.canVerify ? 'The technician has finished. Check the evidence below, then verify to resolve, or send it back.' : 'Work is done and waiting for the supervisor to verify it.';
  if (t.status === 'in_progress') return me.isAssignee ? 'Need parts? Request them below. When finished, fill the checklist, add photos, sign and complete.' : `${tech} is working on it.`;
  if (t.status === 'on_hold') return `On hold: ${t.holdReason || ''}. The SLA clock is paused.`;
  if (t.status === 'resolved') return me.isReporter ? 'We believe this is fixed. Please confirm and rate, or tell us what is still wrong.' : 'Resolved. Waiting for the tenant to confirm (auto-closes after 48 hours).';
  if (t.status === 'closed') return `Closed ${fromNow(t.closedAt)}${t.tenantConfirmation?.rating ? `, rated ${t.tenantConfirmation.rating}/5` : ''}.`;
  if (t.status === 'cancelled') return t.mergedInto ? `Merged into ${t.mergedInto.number}.` : 'This ticket was cancelled.';
  return '';
}

export default function TicketDetail() {
  const { id } = useParams();
  const { user, can } = usePerm();
  const { prompt } = useDialogs();
  const [dialog, setDialog] = useState(null);
  const [comment, setComment] = useState('');
  const q = useQuery({ queryKey: ['tickets', 'detail', id], queryFn: () => api.get(`/tickets/${id}`) });
  // Field actions go through the offline queue so a technician in a basement can still update the job.
  const act = useAction(({ path, body }) => (OFFLINE_OK.includes(path) ? api.offline('post', `/tickets/${id}/${path}`, body, `${label(path)} ${q.data?.number || ''}`) : api.post(`/tickets/${id}/${path}`, body)), { success: (r, v) => v.msg, invalidate: ['tickets', 'today', 'kpis', 'work-orders'] });
  const [returning, setReturning] = useState(null);
  const reject = useAction((reason) => api.post(`/work-orders/${q.data.workOrderId._id}/reject`, { reason }), { success: 'Sent back to the technician', invalidate: ['tickets', 'today'] });
  const addComment = useAction((b) => api.offline('post', `/tickets/${id}/comments`, b, 'Comment'), { invalidate: ['tickets'] });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const t = q.data;
  const wo = t.workOrderId;
  const me = {
    isAssignee: t.assigneeId?._id === user._id,
    isReporter: t.reporterId?._id === user._id || (user.tenantId && t.tenantId?._id === user.tenantId),
    canAssign: can('ticket:assign'),
    canVerify: can('ticket:verify'),
    office: user.layout !== 'field',
  };
  const worker = me.isAssignee || me.canAssign;
  const s = t.sla || {};
  const prog = slaInfo(t);
  const resolvedPct = prog?.phase === 'resolution' ? prog.pct : 0;
  const respPct = s.respondedAt ? 1 : prog?.pct || 0;
  const reason = async (path, title, msg) => {
    const r = await prompt({ title, label: 'Reason' });
    if (r) act.mutate({ path, body: { reason: r }, msg });
  };
  const buttons = [
    me.canAssign && ['new', 'assigned', 'reopened'].includes(t.status) && <Button key="as" variant="contained" color="secondary" onClick={() => setDialog('assign')}>{t.assigneeId ? 'Reassign' : 'Assign technician'}</Button>,
    worker && ['assigned', 'reopened'].includes(t.status) && t.assigneeId && <Button key="ack" variant="contained" color="secondary" onClick={() => act.mutate({ path: 'acknowledge', msg: 'Acknowledged — response SLA met' })}>Acknowledge</Button>,
    worker && t.status === 'acknowledged' && <Button key="st" variant="contained" color="secondary" onClick={() => act.mutate({ path: 'start', msg: 'Work started' })}>Start work</Button>,
    worker && t.status === 'on_hold' && <Button key="re" variant="contained" color="secondary" onClick={() => act.mutate({ path: 'resume', msg: 'Resumed — SLA clock running again' })}>Resume work</Button>,
    worker && wo && ['acknowledged', 'in_progress'].includes(t.status) && !t.awaitingVerification && <Button key="parts" variant="outlined" onClick={() => setDialog('parts')}>Request parts</Button>,
    worker && ['acknowledged', 'in_progress'].includes(t.status) && !t.awaitingVerification && <Button key="hold" variant="outlined" color="warning" onClick={async () => { const r = await prompt({ title: 'Put on hold', text: 'The SLA clock pauses until you resume.', label: 'Why? e.g. awaiting spares, awaiting tenant access' }); if (r) act.mutate({ path: 'hold', body: { reason: r }, msg: 'On hold — SLA paused' }); }}>Put on hold</Button>,
    me.canVerify && t.awaitingVerification && <Button key="ver" variant="contained" color="success" onClick={() => act.mutate({ path: 'verify', msg: 'Verified and resolved. The tenant has been asked to confirm.' })}>Verify & resolve</Button>,
    me.canVerify && t.awaitingVerification && <Button key="rej" variant="outlined" color="warning" onClick={async () => { const r = await prompt({ title: 'Send back to technician', label: 'What needs fixing?' }); if (r) reject.mutate(r); }}>Send back</Button>,
    me.canVerify && !wo && ['in_progress'].includes(t.status) && <Button key="ver2" variant="contained" color="success" onClick={async () => { const r = await prompt({ title: 'Resolve', label: 'Resolution notes' }); if (r) act.mutate({ path: 'verify', body: { resolutionNotes: r }, msg: 'Resolved' }); }}>Resolve</Button>,
    t.status === 'resolved' && (me.isReporter || (me.office && can('ticket:update'))) && <Button key="cf" variant="contained" color="secondary" onClick={() => setDialog('confirm')}>{me.isReporter ? 'Confirm fix & rate' : 'Record tenant confirmation'}</Button>,
    me.office && can('ticket:update') && !['resolved', 'closed', 'cancelled', 'tenant_confirmed'].includes(t.status) && !me.isAssignee && <Button key="pr" variant="text" onClick={() => setDialog('priority')}>Change priority</Button>,
    me.office && can('ticket:update') && ['new', 'assigned', 'acknowledged', 'in_progress', 'on_hold', 'reopened'].includes(t.status) && <Button key="mg" variant="text" onClick={() => setDialog('merge')}>Merge duplicate…</Button>,
    ['new', 'assigned'].includes(t.status) && (me.isReporter || (me.office && can('ticket:update'))) && <Button key="cx" variant="text" color="error" onClick={() => reason('cancel', 'Cancel this ticket?', 'Ticket cancelled')}>Cancel ticket</Button>,
  ].filter(Boolean);

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1.5 }}><Link component={RouterLink} to="/tickets" underline="hover" color="inherit">Tickets</Link><Typography color="text.primary">{t.number}</Typography></Breadcrumbs>
      <Card sx={{ p: { xs: 2, md: 3 }, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography variant="overline" color="text.secondary">{t.number}</Typography>
              <PriorityChip value={t.priority} /><StatusChip value={t.status} />
              {t.awaitingVerification && <Chip size="small" color="warning" label="Awaiting verification" />}
              {t.escalationLevel > 0 && <Chip size="small" color="error" variant="outlined" label={`Escalated L${t.escalationLevel}`} />}
            </Stack>
            <Typography variant="h5" sx={{ mt: 0.5 }}>{t.description}</Typography>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 1, color: 'text.secondary' }}>
              <Typography variant="body2">{t.categoryId?.name}{t.subCategory ? ` › ${t.subCategory}` : ''}</Typography>
              <Stack direction="row" spacing={0.5} alignItems="center"><PlaceOutlined sx={{ fontSize: 17 }} /><Typography variant="body2">{t.locationId?.path}</Typography></Stack>
              {t.assetId && <Stack direction="row" spacing={0.5} alignItems="center"><PrecisionManufacturingOutlined sx={{ fontSize: 17 }} /><Link component={RouterLink} to={`/assets/${t.assetId._id}`} variant="body2">{t.assetId.code} · {t.assetId.name}</Link></Stack>}
            </Stack>
          </Box>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} sx={{ mt: 2.5 }}>
          <SlaBar title={`Response (${t.priority})`} due={s.responseDue} doneAt={s.respondedAt} breached={s.responseBreached} pct={respPct} paused={Boolean(s.pausedAt)} />
          <SlaBar title="Resolution" due={s.resolutionDue} doneAt={s.resolvedAt} breached={s.resolutionBreached} pct={resolvedPct} paused={Boolean(s.pausedAt)} />
        </Stack>
        <Alert icon={<LightbulbOutlined />} severity="info" sx={{ mt: 2.5, bgcolor: 'primary.soft', color: 'text.primary', '& .MuiAlert-icon': { color: 'secondary.main' } }}>
          <b>Next step: </b>{nextStep(t, me)}
        </Alert>
        {buttons.length > 0 && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>{buttons}</Stack>}
      </Card>

      <Grid container spacing={2}>
        <Grid item xs={12} lg={8}>
          <Stack spacing={2}>
            {t.photos?.length > 0 && (
              <SectionCard title="Photos from the reporter">
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{t.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><Box component="img" src={u} alt="" sx={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 2 }} /></a>)}</Stack>
              </SectionCard>
            )}
            {wo && <WorkOrderPanel key={`${wo._id}-${wo.status}`} wo={wo} editable={worker && t.status === 'in_progress' && wo.status === 'in_progress'} onDone={() => q.refetch()} />}
            <SectionCard title="Activity" subtitle="Status changes and comments">
              <CommentBox busy={addComment.isPending} onPost={(text, mentions, reset) => addComment.mutate({ text, mentions }, { onSuccess: reset })} />
              <Timeline items={[
                ...(t.comments || []).map((c) => ({ status: 'comment', title: `💬 ${c.byName}`, note: c.text, at: c.at })),
                ...(t.history || []).map((h) => ({ ...h, title: label(h.status) })),
              ].sort((a, b) => new Date(b.at) - new Date(a.at))} />
            </SectionCard>
          </Stack>
        </Grid>
        <Grid item xs={12} lg={4}>
          <Stack spacing={2}>
            <SectionCard title="Details">
              <KeyValue items={[
                ['Raised by', t.reporterId?.name],
                t.tenantId && ['Tenant', t.tenantId.name],
                ['Channel', label(t.source)],
                ['Department', t.assignedDeptId?.name],
                ['Assigned to', t.assigneeId ? <span>{t.assigneeId.name}{t.assigneeId.mobile && <Typography variant="caption" color="text.secondary" display="block">{t.assigneeId.mobile}</Typography>}</span> : 'Not yet'],
                ['Raised', fmtDateTime(t.createdAt)],
                t.priorityOverrideReason && ['Priority note', t.priorityOverrideReason],
                t.resolutionNotes && ['Resolution', t.resolutionNotes],
                t.tenantConfirmation?.rating && ['Tenant rating', <Rating key="r" size="small" readOnly value={t.tenantConfirmation.rating} />],
              ]} />
            </SectionCard>
            <SectionCard title="Materials" subtitle="Parts issued against this job">
              {t.materialIssues?.length ? t.materialIssues.map((m) => (
                <Box key={m._id} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Stack direction="row" justifyContent="space-between"><Typography variant="body2" fontWeight={700}>{m.number}</Typography><StatusChip value={m.status} /></Stack>
                  <Typography variant="caption" color="text.secondary">{m.items.map((i) => `${i.itemId?.name} × ${i.qty}${i.returnedQty ? ` (${i.returnedQty} returned)` : ''}`).join(', ')}{m.totalCost ? ` · ${inr(m.totalCost)}` : ''}</Typography>
                  {worker && ['issued', 'partially_returned'].includes(m.status) && <Box><Button size="small" onClick={() => setReturning(m)}>Return unused parts</Button></Box>}
                </Box>
              )) : <Typography variant="body2" color="text.secondary">No parts requested yet.</Typography>}
            </SectionCard>
          </Stack>
        </Grid>
      </Grid>
      {dialog === 'assign' && <AssignDialog ticket={t} onClose={() => setDialog(null)} />}
      {dialog === 'confirm' && <ConfirmDialog ticket={t} onClose={() => setDialog(null)} />}
      {dialog === 'priority' && <PriorityDialog ticket={t} onClose={() => setDialog(null)} />}
      {dialog === 'merge' && <MergeDialog ticket={t} onClose={() => setDialog(null)} />}
      {returning && (
        <Dialog open onClose={() => setReturning(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Return unused parts · {returning.number}</DialogTitle>
          <DialogContent><Box sx={{ pt: 1 }}><ReturnForm issue={returning} onDone={() => { setReturning(null); q.refetch(); }} /></Box></DialogContent>
          <DialogActions><Button color="inherit" onClick={() => setReturning(null)}>Close</Button></DialogActions>
        </Dialog>
      )}
      {dialog === 'parts' && <PartsDialog wo={wo} onClose={() => { setDialog(null); q.refetch(); }} />}
    </Box>
  );
}
