import { useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Card, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, LinearProgress, MenuItem, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography } from '@mui/material';
import UploadFileOutlined from '@mui/icons-material/UploadFileOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import { api, download, uploadForm } from '../api/client';
import { useAuth } from '../store/auth';
import { useAction } from '../hooks';
import { PageHeader, QueryState, SectionCard, useDialogs, StackTable } from '../components/common';
import { fmtDateTime, fromNow, humanize } from '../utils/format';

const ENTITIES = [['locations', 'Locations (tower / floor / zone)'], ['departments', 'Departments'], ['employees', 'Employees'], ['vendors', 'Vendors'], ['assets', 'Assets'], ['items', 'Inventory items'], ['opening-stock', 'Opening stock'], ['ppm-schedules', 'PPM schedules']];

function Import() {
  const [entity, setEntity] = useState('employees');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const input = useRef();
  const validate = useAction((f) => uploadForm(`/imports/${entity}`, f, { mode: 'validate' }), { onSuccess: setResult });
  const commit = useAction(() => uploadForm(`/imports/${entity}`, file, { mode: 'commit' }), { success: (r) => `${r.imported} rows imported`, onSuccess: () => { setResult(null); setFile(null); } });
  const cols = result?.preview?.[0] ? Object.keys(result.preview[0]).slice(0, 8) : [];
  return (
    <Grid container spacing={2} sx={{ p: 2 }}>
      <Grid item xs={12} md={4}>
        <SectionCard title="1. Choose what to import">
          <Stack spacing={2}>
            <TextField select label="Data type" value={entity} onChange={(e) => { setEntity(e.target.value); setResult(null); setFile(null); }}>{ENTITIES.map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField>
            <Button startIcon={<FileDownloadOutlined />} variant="outlined" onClick={() => download(`/imports/${entity}/template`, {}, `${entity}-template.xlsx`)}>Download Excel template</Button>
            <Typography variant="caption" color="text.secondary">Fill one row per record. Reference other records by their code (for example departmentCode = ENG, locationCode = PTP-A-05-AHU).</Typography>
          </Stack>
        </SectionCard>
      </Grid>
      <Grid item xs={12} md={8}>
        <SectionCard title="2. Upload and check" subtitle="Nothing is saved until you press Import.">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button variant="contained" color="secondary" startIcon={<UploadFileOutlined />} disabled={validate.isPending} onClick={() => input.current.click()}>{file ? 'Choose another file' : 'Choose Excel or CSV file'}</Button>
              {file && <Typography variant="body2">{file.name}</Typography>}
              <input ref={input} hidden type="file" accept=".xlsx,.csv" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) { setFile(f); validate.mutate(f); } }} />
            </Stack>
            {validate.isPending && <LinearProgress color="secondary" />}
            {result && (
              <>
                <Stack direction="row" spacing={1}><Chip label={`${result.total} rows`} /><Chip color="success" label={`${result.valid} ready`} /><Chip color={result.invalid ? 'error' : 'default'} label={`${result.invalid} with errors`} /></Stack>
                {result.errors.length > 0 && (
                  <Alert severity="error"><b>Fix these rows and upload again:</b>{result.errors.slice(0, 10).map((e) => <Box key={e.row}>Row {e.row}: {e.errors.join('; ')}</Box>)}{result.errors.length > 10 && <Box>…and {result.errors.length - 10} more</Box>}</Alert>
                )}
                {cols.length > 0 && (
                  <Box sx={{ overflowX: 'auto' }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Preview (first {result.preview.length} valid rows)</Typography>
                    <Table size="small"><TableHead><TableRow>{cols.map((c) => <TableCell key={c} sx={{ fontWeight: 700 }}>{humanize(c)}</TableCell>)}</TableRow></TableHead>
                      <TableBody>{result.preview.map((r, i) => <TableRow key={i}>{cols.map((c) => <TableCell key={c}>{Array.isArray(r[c]) ? r[c].length : typeof r[c] === 'object' ? '✓' : String(r[c] ?? '')}</TableCell>)}</TableRow>)}</TableBody></Table>
                  </Box>
                )}
                <Box><Button variant="contained" color="secondary" disabled={result.invalid > 0 || !result.valid || commit.isPending} onClick={() => commit.mutate()}>Import {result.valid} rows</Button></Box>
              </>
            )}
          </Stack>
        </SectionCard>
      </Grid>
    </Grid>
  );
}

function GoLive() {
  const propertyId = useAuth((s) => s.propertyId);
  const prop = useQuery({ queryKey: ['properties', 'golive', propertyId], queryFn: () => api.get(`/properties/${propertyId}`), enabled: Boolean(propertyId) });
  const base = useQuery({ queryKey: ['kpis', 'baseline'], queryFn: () => api.get('/admin/kpi-baseline') });
  const save = useAction((goLive) => api.patch(`/properties/${propertyId}`, { goLive }), { success: 'Checklist updated', invalidate: ['properties'] });
  const apply = useAction(() => api.post('/admin/kpi-baseline/apply'), { success: 'Baseline saved to KPI definitions', invalidate: ['kpis'] });
  const tasks = prop.data?.goLive || [];
  const done = tasks.filter((t) => t.done).length;
  return (
    <Grid container spacing={2} sx={{ p: 2 }}>
      <Grid item xs={12} md={6}>
        <SectionCard title="Go-live checklist" subtitle={`${prop.data?.name || ''} · ${done} of ${tasks.length} done`}>
          <LinearProgress variant="determinate" value={tasks.length ? (done / tasks.length) * 100 : 0} color="secondary" sx={{ mb: 2 }} />
          {[1, 2, 3, 4, 5].map((phase) => tasks.some((t) => t.phase === phase) && (
            <Box key={phase} sx={{ mb: 1.5 }}>
              <Typography variant="overline" color="text.secondary">Phase {phase}</Typography>
              {tasks.map((t, i) => t.phase === phase && (
                <Stack key={i} direction="row" alignItems="center"><Checkbox color="secondary" checked={Boolean(t.done)} onChange={() => save.mutate(tasks.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} /><Typography variant="body2" sx={{ textDecoration: t.done ? 'line-through' : 'none', color: t.done ? 'text.secondary' : 'text.primary' }}>{t.task}</Typography></Stack>
              ))}
            </Box>
          ))}
        </SectionCard>
      </Grid>
      <Grid item xs={12} md={6}>
        <SectionCard title="KPI baseline" subtitle="Average of the first 30 days of snapshots, to agree targets with the client" action={<Button size="small" variant="outlined" disabled={apply.isPending} onClick={() => apply.mutate()}>Save as baseline</Button>}>
          <QueryState q={base}>
            {(rows) => (
              <StackTable>
                <TableHead><TableRow>{['KPI', 'Measured', 'Saved baseline', 'Target'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
                <TableBody>{rows.map((r) => <TableRow key={r.code}><TableCell>{r.name}</TableCell><TableCell>{r.measured ?? '—'}{r.unit === '%' && r.measured != null ? '%' : ''}<Typography variant="caption" color="text.secondary"> ({r.days} d)</Typography></TableCell><TableCell>{r.baseline ?? '—'}</TableCell><TableCell>{r.target}</TableCell></TableRow>)}</TableBody>
              </StackTable>
            )}
          </QueryState>
        </SectionCard>
      </Grid>
    </Grid>
  );
}

function Jobs() {
  const navigate = useNavigate();
  const { confirm } = useDialogs();
  const q = useQuery({ queryKey: ['jobs'], queryFn: () => api.get('/admin/jobs'), refetchInterval: 30000 });
  const run = useAction((name) => api.post(`/admin/jobs/${name}/run`), { success: (r) => `${r.name}: ${r.ok === false ? 'failed' : r.message || 'done'}`, invalidate: ['jobs', 'kpis', 'tickets', 'today'] });
  const reset = useAction(() => api.post('/admin/demo-reset'), { success: 'Demo data reset. Signing you out…', onSuccess: () => setTimeout(() => { useAuth.getState().logout(); navigate('/login'); }, 1200) });
  return (
    <Box sx={{ p: 2 }}>
      <QueryState q={q}>
        {(jobs) => (
          <Box sx={{ overflowX: 'auto' }}>
            <StackTable>
              <TableHead><TableRow>{['Job', 'What it does', 'Schedule', 'Last run', 'Result', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.name} hover>
                    <TableCell sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{j.name}</TableCell>
                    <TableCell sx={{ minWidth: 260 }}>{j.description}</TableCell>
                    <TableCell><code>{j.cron}</code></TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{j.last ? <span title={fmtDateTime(j.last.startedAt)}>{fromNow(j.last.startedAt)} · {j.last.durationMs} ms</span> : 'Not yet'}</TableCell>
                    <TableCell>{j.last && <Chip size="small" color={j.last.ok ? 'success' : 'error'} label={j.last.ok ? j.last.message : `Failed: ${j.last.message}`} sx={{ maxWidth: 260 }} />}</TableCell>
                    <TableCell><Button size="small" disabled={run.isPending} onClick={() => run.mutate(j.name)}>Run now</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </StackTable>
          </Box>
        )}
      </QueryState>
      <Card sx={{ p: 2, mt: 3, borderColor: 'error.light' }}>
        <Typography variant="subtitle1">Reset demo data</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Rebuilds Prime Tech Park from scratch: all changes, tickets and uploads made during the demo are removed. Everyone is signed out. Only available when the server runs in demo mode.</Typography>
        <Button color="error" variant="outlined" disabled={reset.isPending} onClick={async () => (await confirm({ title: 'Reset all demo data?', text: 'This cannot be undone.', danger: true, confirmText: 'Reset' })) && reset.mutate()}>{reset.isPending ? 'Resetting… (about 30 s)' : 'Reset demo data'}</Button>
      </Card>
    </Box>
  );
}

const SCOPE_TEXT = {
  'assets:read': 'Read assets', 'readings:write': 'Send meter / BMS readings', 'tickets:read': 'Read tickets', 'tickets:write': 'Create tickets and BMS alarms',
  'workorders:read': 'Read work orders', 'kpis:read': 'Read KPIs', 'stock:read': 'Read stock (ERP)', 'procurement:read': 'Read purchase orders (ERP)', 'attendance:punch': 'Send attendance punches (devices)',
};
const ENDPOINTS = [
  ['GET', '/assets', 'assets:read', 'Assets with status, criticality and location'],
  ['GET', '/assets/{code}', 'assets:read', 'One asset'],
  ['POST', '/assets/{code}/readings', 'readings:write', '{ type, value, unit, label } — meter or BMS reading'],
  ['POST', '/assets/{code}/alarms', 'tickets:write', '{ description, alarmCode, priority? } — BMS alarm becomes a ticket; repeats within 2 h are merged'],
  ['POST', '/tickets', 'tickets:write', '{ categoryCode, description, locationCode or assetCode, priority?, reference? }'],
  ['GET', '/tickets', 'tickets:read', 'Filter with ?status=new,assigned&from=2026-11-01'],
  ['GET', '/tickets/{number}', 'tickets:read', 'Status and SLA of one ticket'],
  ['GET', '/work-orders', 'workorders:read', 'Filter with ?status=&type=&from='],
  ['GET', '/kpis', 'kpis:read', 'The eight live KPI tiles'],
  ['GET', '/stock', 'stock:read', 'Balances with reorder flags'],
  ['GET', '/purchase-orders', 'procurement:read', 'POs with lines and GST'],
  ['POST', '/attendance/punches', 'attendance:punch', '{ punches: [{ employeeCode, timestamp, deviceId }] }'],
];

function Integrations() {
  const { confirm } = useDialogs();
  const status = useQuery({ queryKey: ['integrations'], queryFn: () => api.get('/admin/integrations') });
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get('/api-keys') });
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState(null);
  const [form, setForm] = useState({ name: '', scopes: [] });
  const create = useAction(() => api.post('/api-keys', form), { invalidate: ['api-keys'], onSuccess: (k) => { setCreated(k); setOpen(false); setForm({ name: '', scopes: [] }); } });
  const revoke = useAction((id) => api.del(`/api-keys/${id}`), { success: 'Key revoked — it stops working immediately', invalidate: ['api-keys'] });
  const st = status.data;
  return (
    <Grid container spacing={2} sx={{ p: 2 }}>
      <Grid item xs={12} md={5}>
        <SectionCard title="Connections" subtitle="Set in backend/.env; restart the API after changes">
          {st && (
            <Table size="small"><TableBody>
              {[['File storage', st.storage], ['Email', st.channels.email], ['SMS', st.channels.sms], ['WhatsApp', st.channels.whatsapp], ['Phone push', st.channels.push],
                ['Email-to-ticket', st.inboundEmail ? <code key="ie" style={{ wordBreak: 'break-all' }}>{st.inboundEmail}</code> : 'Off — set INBOUND_EMAIL_TOKEN'],
                ['Device punches', <code key="dp" style={{ wordBreak: 'break-all' }}>{st.devicePunchUrl}</code>]].map(([k, v]) => (
                <TableRow key={k}><TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</TableCell><TableCell>{/console|off/i.test(String(v)) ? <Chip size="small" color="warning" variant="outlined" label={v} /> : v}</TableCell></TableRow>
              ))}
            </TableBody></Table>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Point your mail provider's inbound webhook (Mailgun, SendGrid Inbound Parse, Postmark) at the email-to-ticket address. Only emails from registered users become tickets; they get a reply with the ticket number.</Typography>
        </SectionCard>
      </Grid>
      <Grid item xs={12} md={7}>
        <SectionCard title="API keys" subtitle="For BMS, ERP and device integrations. Each key works for this property only." action={<Button variant="contained" color="secondary" size="small" onClick={() => setOpen(true)}>Create key</Button>}>
          {created && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setCreated(null)} action={<Button color="inherit" size="small" onClick={() => navigator.clipboard?.writeText(created.key)}>Copy</Button>}>
              <b>Copy this key now — it will not be shown again.</b><Box component="code" sx={{ display: 'block', mt: 0.5, wordBreak: 'break-all' }}>{created.key}</Box>
            </Alert>
          )}
          <Box sx={{ overflowX: 'auto' }}>
            <StackTable>
              <TableHead><TableRow>{['Name', 'Key', 'Permissions', 'Last used', ''].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>
                {(keys.data || []).map((k) => (
                  <TableRow key={k._id} sx={{ opacity: k.active ? 1 : 0.5 }}>
                    <TableCell sx={{ fontWeight: 600 }}>{k.name}<Typography variant="caption" color="text.secondary" display="block">by {k.createdBy?.name || '—'}</Typography></TableCell>
                    <TableCell><code>{k.prefix}…</code></TableCell>
                    <TableCell>{k.scopes.map((x) => <Chip key={x} size="small" label={x} sx={{ mr: 0.5, mb: 0.5 }} />)}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{k.lastUsedAt ? fromNow(k.lastUsedAt) : 'Never'}</TableCell>
                    <TableCell>{k.active ? <Button size="small" color="error" onClick={async () => (await confirm({ title: `Revoke "${k.name}"?`, text: 'Anything using this key stops working immediately.', danger: true, confirmText: 'Revoke' })) && revoke.mutate(k._id)}>Revoke</Button> : <Chip size="small" label="Revoked" />}</TableCell>
                  </TableRow>
                ))}
                {!keys.data?.length && <TableRow><TableCell colSpan={5}><Typography variant="body2" color="text.secondary">No keys yet.</Typography></TableCell></TableRow>}
              </TableBody>
            </StackTable>
          </Box>
        </SectionCard>
      </Grid>
      <Grid item xs={12}>
        <SectionCard title="API reference" subtitle={st ? `Base URL ${st.publicApiBase} · send the key in the X-API-Key header` : ''}>
          <Box sx={{ overflowX: 'auto' }}>
            <StackTable>
              <TableHead><TableRow>{['Method', 'Path', 'Permission', 'What it does'].map((h) => <TableCell key={h} sx={{ fontWeight: 700 }}>{h}</TableCell>)}</TableRow></TableHead>
              <TableBody>{ENDPOINTS.map(([m, p, sc, d]) => <TableRow key={m + p}><TableCell><Chip size="small" label={m} color={m === 'GET' ? 'info' : 'secondary'} /></TableCell><TableCell><code>{p}</code></TableCell><TableCell><code>{sc}</code></TableCell><TableCell>{d}</TableCell></TableRow>)}</TableBody>
            </StackTable>
          </Box>
          <Box component="pre" sx={{ mt: 2, p: 2, bgcolor: '#0B1220', color: '#D7DEE8', borderRadius: 2, overflowX: 'auto', fontSize: 12 }}>{`curl -X POST ${st?.publicApiBase || 'http://localhost:5080/api/v1/public'}/assets/CH-02/alarms \\
  -H "X-API-Key: ps_your_key" -H "Content-Type: application/json" \\
  -d '{"description": "High condenser pressure", "alarmCode": "HP-01"}'`}</Box>
        </SectionCard>
      </Grid>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create an API key</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Name" placeholder="e.g. Honeywell BMS, SAP ERP, Gate biometric" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Typography variant="subtitle2">What may this key do?</Typography>
            <Grid container>
              {Object.entries(SCOPE_TEXT).map(([sc, txt]) => (
                <Grid item xs={12} sm={6} key={sc}>
                  <FormControlLabel control={<Checkbox color="secondary" checked={form.scopes.includes(sc)} onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, sc] : form.scopes.filter((x) => x !== sc) })} />} label={txt} />
                </Grid>
              ))}
            </Grid>
            {create.error && <Alert severity="error">{create.error.message}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions><Button color="inherit" onClick={() => setOpen(false)}>Cancel</Button><Button variant="contained" color="secondary" disabled={form.name.length < 2 || !form.scopes.length || create.isPending} onClick={() => create.mutate()}>Create key</Button></DialogActions>
      </Dialog>
    </Grid>
  );
}

const TABS = [['import', 'Bulk import', Import], ['golive', 'Go-live & KPI baseline', GoLive], ['jobs', 'System jobs', Jobs], ['api', 'API keys & integrations', Integrations]];

export default function Admin() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const current = TABS.find(([k]) => k === tab);
  if (!current) return <Navigate to="/admin/import" replace />;
  const [, , Comp] = current;
  return (
    <Box>
      <PageHeader title="Implementation & admin" subtitle="Load master data, track go-live, and watch the background jobs." help="Bulk import validates every row before anything is saved. System jobs run on a schedule (SLA checks every minute, PPM generation nightly, and so on); you can also run one now." />
      <Card>
        <Tabs value={tab} onChange={(e, v) => navigate(`/admin/${v}`)} textColor="secondary" indicatorColor="secondary" sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider' }} variant="scrollable">
          {TABS.map(([k, l]) => <Tab key={k} value={k} label={l} />)}
        </Tabs>
        <Comp />
      </Card>
    </Box>
  );
}

