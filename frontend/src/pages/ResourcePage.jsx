import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  Box, Button, Card, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, IconButton, InputAdornment, Stack, Step, StepLabel, Stepper,
  Tab, Tabs, TextField, Typography, Table, TableBody, TableCell, TableHead, TableRow,
} from '@mui/material';
import Add from '@mui/icons-material/Add';
import Close from '@mui/icons-material/Close';
import Search from '@mui/icons-material/Search';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import { RESOURCES } from '../config/resources';
import { api, download } from '../api/client';
import { buildColumns, DataTable } from '../components/DataTable';
import { FieldInput, ResourceForm, toPayload } from '../components/form';
import Comments from '../components/Comments';
import { ErrorState, KeyValue, Loading, PageHeader, StatusChip, Timeline, useDialogs, StackTable } from '../components/common';
import { useAction, useDebounced, useMobile, usePerm } from '../hooks';
import { fmtDate, fmtDateTime, getPath, humanize, inr, isImageUrl, label, refLabel } from '../utils/format';

function display(f, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  switch (f.t) {
    case 'date': return fmtDate(v);
    case 'datetime': return fmtDateTime(v);
    case 'bool': return v ? 'Yes' : 'No';
    case 'select': return label(v);
    case 'ref': return refLabel(v);
    case 'refs': return v.map(refLabel).join(', ');
    case 'tags': case 'multiselect': return v.map(label).join(', ');
    case 'photos': case 'file': return (
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {[].concat(v).map((u) => (isImageUrl(u) ? <a key={u} href={u} target="_blank" rel="noreferrer"><Box component="img" src={u} alt="" sx={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 1.5 }} /></a> : <a key={u} href={u} target="_blank" rel="noreferrer">Open file</a>))}
      </Stack>
    );
    case 'lines': return (
      <StackTable sx={{ bgcolor: 'grey.50', borderRadius: 2 }}>
        <TableHead><TableRow>{f.sub.map((s) => <TableCell key={s.n} sx={{ fontWeight: 700 }}>{s.l || humanize(s.n)}</TableCell>)}</TableRow></TableHead>
        <TableBody>{v.map((row, i) => <TableRow key={i}>{f.sub.map((s) => <TableCell key={s.n}>{display(s, row[s.n])}</TableCell>)}</TableRow>)}</TableBody>
      </StackTable>
    );
    case 'number': return /cost|amount|value|total|rate/i.test(f.n) ? inr(v) : v;
    default: return typeof v === 'object' ? refLabel(v) : String(v);
  }
}

function TransitionDialog({ cfg, doc, to, onClose }) {
  const fields = cfg.tFields?.[to] || [];
  const [values, setValues] = useState({});
  const [note, setNote] = useState('');
  const go = useAction((body) => api.post(`/${cfg.api}/${doc._id}/transition`, body), { success: `${cfg.singular || 'Record'} updated`, invalidate: [cfg.api, 'approvals', 'today', 'kpis'], onSuccess: onClose });
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{cfg.tLabels?.[to] || label(to)}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {fields.map((f) => <FieldInput key={f.n} f={f} value={values[f.n]} onChange={(v) => setValues((s) => ({ ...s, [f.n]: v }))} />)}
          <TextField label="Comment (optional)" multiline minRows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>Cancel</Button>
        <Button variant="contained" color={/reject|cancel|dispute/.test(to) ? 'error' : 'secondary'} disabled={go.isPending} onClick={() => go.mutate({ to, note: note || undefined, ...toPayload(values, fields) })}>{cfg.tLabels?.[to] || label(to)}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function DetailDrawer({ cfg, id, onClose, onEdit }) {
  const mobile = useMobile();
  const qc = useQueryClient();
  const { can } = usePerm();
  const { confirm, prompt } = useDialogs();
  const { enqueueSnackbar } = useSnackbar();
  const [moving, setMoving] = useState(null);
  const q = useQuery({ queryKey: [cfg.api, 'one', id], queryFn: () => api.get(`/${cfg.api}/${id}`) });
  const del = useAction(() => api.del(`/${cfg.api}/${id}`), { success: 'Deleted', invalidate: [cfg.api], onSuccess: onClose });
  const act = useAction(({ a, extra }) => a.run(q.data, extra), { invalidate: [cfg.api, 'today', 'kpis', 'stock'] });
  const doc = q.data;
  const stageIdx = doc && cfg.stages ? cfg.stages.findIndex(([s]) => s === doc.status) : -1;
  const runAction = async (a) => {
    let extra;
    if (a.prompt) {
      extra = await prompt({ title: a.label, label: a.prompt });
      if (!extra) return;
    }
    act.mutate({ a, extra }, {
      onSuccess: (r) => {
        if (a.success) enqueueSnackbar(typeof a.success === 'function' ? a.success(r) : a.success, { variant: 'success' });
        qc.invalidateQueries({ queryKey: [cfg.api] });
      },
    });
  };
  return (
    <Drawer anchor="right" open onClose={onClose} PaperProps={{ sx: { width: mobile ? '100%' : 620 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary">{cfg.singular || cfg.title}</Typography>
          <Typography variant="h6" noWrap>{doc ? doc.number || refLabel(doc) || doc.title || cfg.singular : '…'}</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {doc?.status && <StatusChip value={doc.status} />}
          <IconButton onClick={onClose} aria-label="Close"><Close /></IconButton>
        </Stack>
      </Stack>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
        {q.isLoading && <Loading />}
        {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
        {doc && (
          <Stack spacing={3}>
            {cfg.stages && (
              <Stepper activeStep={stageIdx} alternativeLabel={!mobile} orientation={mobile ? 'vertical' : 'horizontal'}>
                {cfg.stages.map(([s, l]) => <Step key={s} completed={stageIdx > cfg.stages.findIndex(([x]) => x === s) || doc.status === 'closed'}><StepLabel>{l}</StepLabel></Step>)}
              </Stepper>
            )}
            {(doc.allowedTransitions?.length > 0 || cfg.actions?.length > 0) && (
              <Box sx={{ p: 2, bgcolor: 'primary.soft', borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>What would you like to do?</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {doc.allowedTransitions?.map((to) => (
                    <Button key={to} size="small" variant={/reject|cancel|dispute|missed/.test(to) ? 'outlined' : 'contained'} color={/reject|cancel|dispute|missed/.test(to) ? 'error' : 'secondary'} onClick={() => setMoving(to)}>{cfg.tLabels?.[to] || label(to)}</Button>
                  ))}
                  {cfg.actions?.filter((a) => (!a.perm || can(a.perm)) && (!a.show || a.show(doc))).map((a) => (
                    <Button key={a.label} size="small" variant="outlined" color={a.color || 'primary'} disabled={act.isPending} onClick={() => runAction(a)}>{a.label}</Button>
                  ))}
                </Stack>
              </Box>
            )}
            <KeyValue items={[
              ...cfg.fields.filter((f) => f.t !== 'password' && f.t !== 'lines').map((f) => [f.l || humanize(f.n), display(f, getPath(doc, f.n))]),
              ...(cfg.show || []).map(([k, fn]) => [k, fn(doc) || '—']),
              ['Created', fmtDateTime(doc.createdAt)],
            ]} />
            {cfg.fields.filter((f) => f.t === 'lines' && getPath(doc, f.n)?.length).map((f) => (
              <Box key={f.n}><Typography variant="subtitle2" sx={{ mb: 1 }}>{f.l || humanize(f.n)}</Typography>{display(f, getPath(doc, f.n))}</Box>
            ))}
            {cfg.detail?.(doc)}
            {cfg.comments && <Comments entity={cfg.comments} entityId={doc._id} />}
            {doc.approvals?.length > 0 && (
              <Box><Typography variant="subtitle2" sx={{ mb: 1 }}>Approvals</Typography><Timeline items={doc.approvals.map((a) => ({ status: a.action, title: `${label(a.action)}${a.level ? ` (${label(a.level)})` : ''}`, byName: a.byName, at: a.at, note: a.comment }))} /></Box>
            )}
            {doc.history?.length > 0 && <Box><Typography variant="subtitle2" sx={{ mb: 1 }}>History</Typography><Timeline items={[...doc.history].reverse()} /></Box>}
          </Stack>
        )}
      </Box>
      {doc && (
        <>
          <Divider />
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 3, py: 1.5 }}>
            {!cfg.noDelete && can(`${cfg.perm}:delete`) && (
              <Button color="error" startIcon={<DeleteOutline />} onClick={async () => (await confirm({ title: `Delete this ${cfg.singular || 'record'}?`, text: 'It will be hidden everywhere. The audit log keeps a record.', danger: true, confirmText: 'Delete' })) && del.mutate()}>Delete</Button>
            )}
            {!cfg.noEdit && can(`${cfg.perm}:update`) && <Button variant="outlined" startIcon={<EditOutlined />} onClick={() => onEdit(doc)}>Edit</Button>}
          </Stack>
        </>
      )}
      {moving && <TransitionDialog cfg={cfg} doc={doc} to={moving} onClose={() => { setMoving(null); q.refetch(); }} />}
    </Drawer>
  );
}

export default function ResourcePage({ rk }) {
  const cfg = RESOURCES[rk];
  const { user, can } = usePerm();
  const navigate = useNavigate();
  const params = useParams();
  const [sp, setSp] = useSearchParams();
  const initialTab = Math.max(0, (cfg.tabs || []).findIndex((t) => t.q?.view && t.q.view === sp.get('view')));
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState(sp.get('search') || '');
  const ds = useDebounced(search);
  const [form, setForm] = useState(null);
  const detailId = params.id || sp.get('id');
  const columns = useMemo(() => buildColumns(cfg.cols), [cfg]);
  const extra = Object.fromEntries([...sp.entries()].filter(([k]) => k.startsWith('filter[')));
  const query = { ...(cfg.tabs?.[tab]?.q || {}), ...extra, ...(ds && { search: ds }) };
  const header = useAction((a) => a.run(), { invalidate: [cfg.api] });
  const { enqueueSnackbar } = useSnackbar();
  const closeDetail = () => {
    if (params.id) navigate(cfg.path);
    else { sp.delete('id'); setSp(sp, { replace: true }); }
  };
  return (
    <Box>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle} help={cfg.help} actions={<>
        {(cfg.headerActions || []).filter((a) => !a.perm || can(a.perm)).map((a) => (
          <Button key={a.label} variant="outlined" disabled={header.isPending} onClick={() => header.mutate(a, { onSuccess: (r) => enqueueSnackbar(a.success?.(r) || 'Done', { variant: 'success' }) })}>{a.label}</Button>
        ))}
        <Button startIcon={<FileDownloadOutlined />} onClick={() => download(`/${cfg.api}`, { ...query, format: 'xlsx' }, `${cfg.api}.xlsx`)}>Export</Button>
        {!cfg.noCreate && can(`${cfg.perm}:create`) && <Button variant="contained" color="secondary" startIcon={<Add />} onClick={() => setForm({ initial: cfg.defaults?.(user) || {} })}>{cfg.createLabel || `Add ${cfg.singular || ''}`}</Button>}
      </>} />
      <Card>
        <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} justifyContent="space-between" spacing={1} sx={{ px: 2, pt: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
          {cfg.tabs ? (
            <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" textColor="secondary" indicatorColor="secondary">
              {cfg.tabs.map((t) => <Tab key={t.label} label={t.label} />)}
            </Tabs>
          ) : <Box />}
          <TextField placeholder={`Search ${cfg.title.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} sx={{ maxWidth: { md: 320 }, pb: 1 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }} />
        </Stack>
        <DataTable url={`/${cfg.api}`} qk={cfg.api} columns={columns} params={query}
          onRowClick={(row) => (cfg.rowLink ? navigate(cfg.rowLink(row)) : setSp((s) => { s.set('id', row._id); return s; }))}
          emptyText={!cfg.noCreate && can(`${cfg.perm}:create`) ? `Use “${cfg.createLabel || `Add ${cfg.singular}`}” to create the first one.` : 'Nothing matches this view yet.'} />
      </Card>
      {form && <ResourceForm cfg={cfg} id={form.id} initial={form.initial} onClose={() => setForm(null)} />}
      {detailId && !cfg.rowLink && <DetailDrawer cfg={cfg} id={detailId} onClose={closeDetail} onEdit={(doc) => setForm({ id: doc._id, initial: doc })} />}
    </Box>
  );
}

