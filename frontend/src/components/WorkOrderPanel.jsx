import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Grid, InputAdornment, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { api } from '../api/client';
import { useAction } from '../hooks';
import { FieldInput, PhotoUpload, SignaturePad, toPayload } from './form';
import { SectionCard, StatusChip, StackTable } from './common';
import { fmtDateTime, inr } from '../utils/format';

const outOfRange = (it, v) => (it.type === 'number' || it.type === 'reading') && v !== '' && v != null && ((it.min != null && Number(v) < it.min) || (it.max != null && Number(v) > it.max));
const range = (it) => (it.min != null || it.max != null ? `Expected ${it.min ?? '…'}–${it.max ?? '…'}${it.unit ? ` ${it.unit}` : ''}` : '');

function Photos({ title, urls }) {
  if (!urls?.length) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" fontWeight={700}>{title}</Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
        {urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><Box component="img" src={u} alt={title} sx={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 2, border: '1px solid', borderColor: 'divider' }} /></a>)}
      </Stack>
    </Box>
  );
}

export function PartsDialog({ wo, onClose }) {
  const [form, setForm] = useState({ storeId: null, items: [{}], note: '' });
  const stores = useQuery({ queryKey: ['ref', 'stores-all'], queryFn: () => api.list('/stores', { limit: 20 }).then((r) => r.data) });
  const storeId = form.storeId || stores.data?.find((s) => s.type === 'engineering')?._id || stores.data?.[0]?._id;
  const lines = { n: 'items', t: 'lines', l: 'Parts needed', sub: [{ n: 'itemId', l: 'Item', t: 'ref', ref: 'items' }, { n: 'qty', l: 'Qty', t: 'number' }] };
  const save = useAction((body) => api.offline('post', '/material-issues', body, `Parts request for ${wo.number}`), { success: 'Request sent to the store', invalidate: ['tickets', 'work-orders', 'today'], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Request parts</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">The storekeeper gets a notification and issues these against {wo.number}. The cost is added to the job and the asset history.</Typography>
          <TextField select SelectProps={{ native: true }} label="Store" value={storeId || ''} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
            {(stores.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </TextField>
          <FieldInput f={lines} value={form.items} onChange={(v) => setForm({ ...form, items: v })} />
          <TextField label="Note for the store (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          {save.error && <Alert severity="error">{save.error.message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="secondary" disabled={save.isPending} onClick={() => save.mutate({ storeId, workOrderId: wo._id, note: form.note || undefined, ...toPayload({ items: form.items.filter((i) => i.itemId && i.qty) }, [lines]) })}>Send request</Button>
      </DialogActions>
    </Dialog>
  );
}

// Returns unused parts to the store; the job's parts cost is reduced accordingly.
export function ReturnForm({ issue, onDone }) {
  const [qty, setQty] = useState({});
  const lines = issue.items.map((l) => ({ id: l.itemId?._id || l.itemId, name: l.itemId?.name || 'Item', uom: l.itemId?.uom || '', left: l.qty - (l.returnedQty || 0), issued: l.qty })).filter((l) => l.left > 0);
  const items = lines.map((l) => ({ itemId: l.id, qty: Number(qty[l.id] || 0) })).filter((l) => l.qty > 0);
  const valid = items.length > 0 && items.every((i) => i.qty <= lines.find((l) => l.id === i.itemId).left);
  const go = useAction(() => api.post(`/material-issues/${issue._id}/return`, { items }), { success: 'Returned to the store — stock and job cost updated', invalidate: ['tickets', 'work-orders', 'material-issues', 'stock'], onSuccess: onDone });
  if (!lines.length) return <Typography variant="body2" color="text.secondary">Everything issued has already been returned.</Typography>;
  return (
    <Stack spacing={1.25}>
      {lines.map((l) => (
        <Stack key={l.id} direction="row" alignItems="center" spacing={1}>
          <Typography variant="body2" sx={{ flex: 1 }}>{l.name} <Typography component="span" variant="caption" color="text.secondary">(issued {l.issued}, up to {l.left} can come back)</Typography></Typography>
          <TextField type="number" label="Return" sx={{ width: 100 }} inputProps={{ min: 0, max: l.left }} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
        </Stack>
      ))}
      <Box><Button variant="outlined" disabled={!valid || go.isPending} onClick={() => go.mutate()}>Return to store</Button></Box>
    </Stack>
  );
}

// Checklist, evidence and signature. Editable while the job is in progress for the person doing it.
export default function WorkOrderPanel({ wo, editable, onDone }) {
  const [values, setValues] = useState(() => wo.checklist.map((c) => ({ value: c.value ?? (c.type === 'yesno' ? undefined : ''), photoUrl: c.photoUrl })));
  const [findings, setFindings] = useState(wo.findings || '');
  const [before, setBefore] = useState(wo.beforePhotos || []);
  const [after, setAfter] = useState(wo.afterPhotos || []);
  const [signature, setSignature] = useState(null);
  const [queuedAt, setQueuedAt] = useState(null);
  const daily = wo.type === 'daily_check';
  const done = useAction((body) => api.offline('post', `/work-orders/${wo._id}/complete`, body, `Complete ${wo.number}`), {
    success: daily ? 'Log sheet saved' : 'Job completed — sent for supervisor verification',
    invalidate: ['tickets', 'work-orders', 'today', 'kpis'],
    onSuccess: (r) => (r?.queued ? setQueuedAt(new Date()) : onDone()),
  });
  const set = (i, patch) => setValues((v) => v.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const partsCost = (wo.partsUsed || []).reduce((a, p) => a + (p.cost || 0), 0);
  const answered = values.filter((v, i) => wo.checklist[i].type === 'photo' ? v.photoUrl : v.value !== undefined && v.value !== '').length;

  if (!editable) {
    return (
      <SectionCard title="Work order" subtitle={`${wo.number} · ${wo.checklist.length} checklist item(s)`} action={<StatusChip value={wo.status} />}>
        <Stack spacing={2}>
          {wo.checklist.some((c) => c.value != null) ? (
            <StackTable>
              <TableHead><TableRow><TableCell sx={{ fontWeight: 700 }}>Check</TableCell><TableCell sx={{ fontWeight: 700 }}>Result</TableCell></TableRow></TableHead>
              <TableBody>
                {wo.checklist.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>{c.label}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        {c.deviation ? <WarningAmberOutlined color="warning" fontSize="small" /> : c.value != null && <CheckCircleOutline color="success" fontSize="small" />}
                        <span>{c.type === 'yesno' ? (c.value === true ? 'Yes' : c.value === false ? 'No' : '—') : c.type === 'photo' ? (c.photoUrl ? <a href={c.photoUrl} target="_blank" rel="noreferrer">Photo</a> : '—') : `${c.value ?? '—'}${c.unit && c.value != null ? ` ${c.unit}` : ''}`}</span>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </StackTable>
          ) : <Typography variant="body2" color="text.secondary">The checklist will be filled in by the technician when the job is done.</Typography>}
          {wo.findings && <Box><Typography variant="caption" color="text.secondary" fontWeight={700}>Findings</Typography><Typography variant="body2">{wo.findings}</Typography></Box>}
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap><Photos title="Before" urls={wo.beforePhotos} /><Photos title="After" urls={wo.afterPhotos} /></Stack>
          {wo.partsUsed?.length > 0 && (
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700}>Parts used · {inr(partsCost)}</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>{wo.partsUsed.map((p, i) => <Chip key={i} size="small" label={`${p.itemId?.name || p.name} × ${p.qty} · ${inr(p.cost)}`} />)}</Stack>
            </Box>
          )}
          {wo.signature && <Box><Typography variant="caption" color="text.secondary" fontWeight={700}>Technician signature</Typography><Box component="img" src={wo.signature} alt="Signature" sx={{ display: 'block', height: 70, mt: 0.5 }} /></Box>}
          {wo.completedAt && <Typography variant="caption" color="text.secondary">Completed {fmtDateTime(wo.completedAt)}{wo.verifiedAt ? ` · verified ${fmtDateTime(wo.verifiedAt)}` : ''}{wo.downtimeMin ? ` · downtime ${Math.round(wo.downtimeMin / 6) / 10} h` : ''}</Typography>}
          {wo.rejectReason && wo.status === 'in_progress' && <Alert severity="warning">Sent back by supervisor: {wo.rejectReason}</Alert>}
        </Stack>
      </SectionCard>
    );
  }

  if (queuedAt) {
    return (
      <SectionCard title={daily ? 'Log sheet saved on this phone' : 'Job completed on this phone'}>
        <Alert severity="info">Saved at {queuedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} without signal. It will be sent automatically — with your photos and the time you finished — as soon as you are back online.</Alert>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={daily ? 'Fill the log sheet' : 'Complete the job'} subtitle={`${answered} of ${wo.checklist.length} checks answered`} action={<StatusChip value={wo.status} />}>
      <Stack spacing={2.5}>
        {wo.rejectReason && <Alert severity="warning">Your supervisor sent this back: {wo.rejectReason}</Alert>}
        <Stack spacing={1.5}>
          {wo.checklist.map((c, i) => {
            const v = values[i];
            const bad = outOfRange(c, v.value) || (c.type === 'yesno' && v.value === false);
            return (
              <Box key={i} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: bad ? 'warning.main' : 'divider', bgcolor: bad ? 'rgba(217,138,0,.05)' : undefined }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
                  <Typography variant="body2" fontWeight={600}>{i + 1}. {c.label}{c.required !== false && c.type !== 'photo' && <Typography component="span" color="error"> *</Typography>}</Typography>
                  {c.type === 'yesno' && (
                    <ToggleButtonGroup exclusive size="small" value={v.value} onChange={(e, val) => val !== null && set(i, { value: val })}>
                      <ToggleButton value color="success" sx={{ px: 3 }}>Yes</ToggleButton>
                      <ToggleButton value={false} color="warning" sx={{ px: 3 }}>No</ToggleButton>
                    </ToggleButtonGroup>
                  )}
                  {(c.type === 'number' || c.type === 'reading') && (
                    <TextField type="number" sx={{ maxWidth: { sm: 200 } }} value={v.value} onChange={(e) => set(i, { value: e.target.value === '' ? '' : Number(e.target.value) })}
                      helperText={bad ? 'Out of range' : range(c)} error={bad} InputProps={{ endAdornment: c.unit && <InputAdornment position="end">{c.unit}</InputAdornment> }} inputProps={{ inputMode: 'decimal', step: 'any' }} />
                  )}
                  {c.type === 'text' && <TextField sx={{ maxWidth: { sm: 320 } }} value={v.value} onChange={(e) => set(i, { value: e.target.value })} placeholder="Type here" />}
                  {c.type === 'photo' && <PhotoUpload multiple={false} value={v.photoUrl} capture="environment" onChange={(u) => set(i, { photoUrl: u, value: u ? 'photo' : '' })} />}
                </Stack>
                {bad && ['ppm', 'daily_check'].includes(wo.type) && c.type !== 'yesno' && <Typography variant="caption" color="warning.main">A breakdown ticket will be raised automatically for this reading.</Typography>}
              </Box>
            );
          })}
        </Stack>
        <TextField label={daily ? 'Remarks (optional)' : 'What did you find and fix?'} multiline minRows={daily ? 2 : 3} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder={daily ? 'Anything unusual during the round' : 'e.g. Pre-filter clogged and V-belt worn; both replaced, supply air back to 14 °C'} />
        {!daily && (
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}><Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>Before photos</Typography><PhotoUpload value={before} onChange={setBefore} capture="environment" /></Grid>
            <Grid item xs={12} sm={6}><Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>After photos {['breakdown', 'corrective'].includes(wo.type) && <Typography component="span" color="error">*</Typography>}</Typography><PhotoUpload value={after} onChange={setAfter} capture="environment" /></Grid>
          </Grid>
        )}
        <Box><Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>Your signature {daily ? '(optional)' : <Typography component="span" color="error">*</Typography>}</Typography><SignaturePad value={signature} onChange={setSignature} /></Box>
        {done.error && <Alert severity="error">{done.error.message}</Alert>}
        <Button size="large" variant="contained" color="secondary" disabled={done.isPending}
          onClick={() => done.mutate({ checklist: values.map((v) => ({ value: v.value === '' ? undefined : v.value, photoUrl: v.photoUrl })), findings: findings || undefined, beforePhotos: before, afterPhotos: after, signature: signature || undefined })}>
          {done.isPending ? 'Submitting…' : daily ? 'Save log sheet' : 'Complete job'}
        </Button>
      </Stack>
    </SectionCard>
  );
}
