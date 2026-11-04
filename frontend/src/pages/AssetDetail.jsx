import { useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Box, Breadcrumbs, Button, Card, Chip, Grid, Link, MenuItem, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import AddCircleOutline from '@mui/icons-material/AddCircleOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api/client';
import { RESOURCES } from '../config/resources';
import { useAction, usePerm } from '../hooks';
import { ErrorState, KeyValue, Loading, PageHeader, QueryState, SectionCard, StatusChip, EmptyState } from '../components/common';
import { ResourceForm } from '../components/form';
import dayjs from 'dayjs';
import { fmtDate, fmtDateTime, inr, label, num } from '../utils/format';
import { ACCENT, CHART } from '../theme';

const KIND = { ppm: 'PPM', breakdown: 'Breakdown', corrective: 'Corrective', ticket: 'Ticket', amc_visit: 'AMC visit', inspection: 'Inspection' };
const Metric = ({ title, value, hint }) => <Card sx={{ p: 2, height: '100%' }}><Typography variant="body2" color="text.secondary" fontWeight={600}>{title}</Typography><Typography sx={{ fontSize: 28, fontWeight: 800 }}>{value}</Typography>{hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}</Card>;

function History({ id }) {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['assets', 'history', id], queryFn: () => api.get(`/assets/${id}/history`) });
  return (
    <QueryState q={q}>
      {(h) => (
        <Stack spacing={2}>
          <Grid container spacing={2}>
            <Grid item xs={6} md={3}><Metric title="PPM done" value={h.totals.ppmDone} /></Grid>
            <Grid item xs={6} md={3}><Metric title="Breakdowns" value={h.totals.breakdowns} /></Grid>
            <Grid item xs={6} md={3}><Metric title="Downtime" value={`${num(h.totals.downtimeMin / 60)} h`} /></Grid>
            <Grid item xs={6} md={3}><Metric title="Parts cost" value={inr(h.totals.partsCost)} /></Grid>
          </Grid>
          <SectionCard title="Service history" subtitle="PPM, breakdowns, tickets and AMC visits, newest first">
            {h.events.length ? h.events.map((e, i) => (
              <Stack key={i} direction="row" spacing={1.5} alignItems="center" onClick={() => e.link && navigate(e.link)} sx={{ py: 1.25, borderBottom: '1px solid', borderColor: 'divider', cursor: e.link ? 'pointer' : 'default', '&:hover': e.link ? { bgcolor: 'grey.50' } : {} }}>
                <Typography variant="caption" color="text.secondary" sx={{ width: 84, flexShrink: 0 }}>{fmtDate(e.at)}</Typography>
                <Chip size="small" label={KIND[e.kind] || label(e.kind)} color={e.kind === 'breakdown' ? 'error' : e.kind === 'ppm' ? 'info' : 'default'} variant="outlined" sx={{ width: 96 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="body2" noWrap fontWeight={600}>{e.title}</Typography>{(e.cost > 0 || e.downtimeMin) && <Typography variant="caption" color="text.secondary">{e.cost > 0 ? `Parts ${inr(e.cost)}` : ''}{e.downtimeMin ? ` · downtime ${num(e.downtimeMin / 60)} h` : ''}</Typography>}</Box>
                <StatusChip value={e.status} />
              </Stack>
            )) : <EmptyState title="No history yet" />}
          </SectionCard>
        </Stack>
      )}
    </QueryState>
  );
}

function Readings({ id }) {
  const q = useQuery({ queryKey: ['assets', 'readings', id], queryFn: () => api.get(`/assets/${id}/meter-readings`) });
  const [f, setF] = useState({ type: 'energy', value: '', unit: 'kWh' });
  const [series_, setSeries] = useState(null);
  const add = useAction((b) => api.post(`/assets/${id}/meter-readings`, b), { success: 'Reading saved', invalidate: ['assets'], onSuccess: () => setF({ ...f, value: '' }) });
  // Each named reading (from log sheets or manual entry) is its own trend line.
  const names = [...new Set((q.data || []).map((r) => r.label || label(r.type)))];
  const shown = series_ && names.includes(series_) ? series_ : names[0];
  const rows = (q.data || []).filter((r) => (r.label || label(r.type)) === shown);
  const unit = rows[0]?.unit || '';
  const series = rows.map((r) => ({ at: fmtDate(r.readAt), value: r.value }));
  return (
    <Grid container spacing={2}>
      <Grid item xs={12} md={8}>
        <SectionCard title={shown ? `${shown} trend` : 'Readings'} subtitle={`${series.length} readings${unit ? ` · ${unit}` : ''}`} action={names.length > 1 && <TextField select size="small" value={shown} onChange={(e) => setSeries(e.target.value)} sx={{ minWidth: 200 }}>{names.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}</TextField>}>
          {series.length > 1 ? (
            <Box sx={{ height: 260 }} role="img" aria-label={`Line chart of ${f.type} readings`}>
              <ResponsiveContainer>
                <LineChart data={series} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={CHART.grid} />
                  <XAxis dataKey="at" tick={{ fill: CHART.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: CHART.axis, fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => [`${v} ${unit}`, shown]} />
                  <Line type="monotone" dataKey="value" stroke={ACCENT} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          ) : <EmptyState title="Not enough readings yet" text="Add two or more readings to see a trend." />}
        </SectionCard>
      </Grid>
      <Grid item xs={12} md={4}>
        <SectionCard title="Add a reading">
          <Stack spacing={2}>
            <TextField select label="Meter" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, unit: { energy: 'kWh', water: 'kL', dg_fuel: 'L', run_hours: 'h', temperature: '°C' }[e.target.value] || '' })}>
              {['energy', 'water', 'dg_fuel', 'run_hours', 'temperature', 'other'].map((t) => <MenuItem key={t} value={t}>{label(t)}</MenuItem>)}
            </TextField>
            <TextField type="number" label={`Value (${f.unit || 'unit'})`} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
            <Button variant="contained" color="secondary" disabled={f.value === '' || add.isPending} onClick={() => add.mutate({ type: f.type, value: Number(f.value), unit: f.unit })}>Save reading</Button>
          </Stack>
        </SectionCard>
      </Grid>
    </Grid>
  );
}

export default function AssetDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = usePerm();
  const [tab, setTab] = useState(0);
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ['assets', 'detail', id], queryFn: () => api.get(`/assets/${id}`) });
  const rel = useQuery({ queryKey: ['assets', 'rel', id], queryFn: () => api.get(`/assets/${id}/reliability`) });
  const ppm = useQuery({ queryKey: ['ppm-schedules', 'asset', id], queryFn: () => api.list('/ppm-schedules', { 'filter[assetId]': id }).then((r) => r.data) });
  const due = useQuery({ queryKey: ['work-orders', 'due', id], queryFn: () => api.list('/work-orders', { 'filter[assetId]': id, view: 'open', sort: 'plannedDate', limit: 10 }).then((r) => r.data.filter((w) => ['ppm', 'daily_check'].includes(w.type) && dayjs(w.plannedDate).isBefore(dayjs().endOf('day')))) });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const a = q.data;
  const url = `${window.location.origin}/assets/${a._id}`;
  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1.5 }} className="no-print"><Link component={RouterLink} to="/assets" underline="hover" color="inherit">Assets</Link><Typography color="text.primary">{a.code}</Typography></Breadcrumbs>
      <PageHeader title={`${a.code} · ${a.name}`} subtitle={`${a.categoryId?.name || ''} · ${a.locationId?.path || ''}`}
        actions={<>
          {can('asset:update') && <Button startIcon={<EditOutlined />} onClick={() => setEdit(true)}>Edit</Button>}
          {due.data?.[0] && <Button variant="outlined" color="secondary" onClick={() => navigate(`/work-orders/${due.data[0]._id}`)}>Start due {due.data[0].type === 'daily_check' ? 'daily check' : 'PPM'} ({due.data[0].number.split('-').pop()})</Button>}
          <Button variant="contained" color="secondary" startIcon={<AddCircleOutline />} onClick={() => navigate(`/tickets/new?assetId=${a._id}&locationId=${a.locationId?._id || ''}`)}>Raise a ticket</Button>
        </>}>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}><StatusChip value={a.status} /><StatusChip value={a.criticality} label={`${label(a.criticality)} criticality`} />{a.amcId && <Chip size="small" variant="outlined" label={`AMC until ${fmtDate(a.amcId.end)}`} />}</Stack>
      </PageHeader>
      {rel.data && (
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={6} md={3}><Metric title="Availability" value={`${rel.data.availabilityPct}%`} hint={`Last ${rel.data.windowDays} days`} /></Grid>
          <Grid item xs={6} md={3}><Metric title="MTTR" value={`${rel.data.mttrHours} h`} hint="Mean time to repair" /></Grid>
          <Grid item xs={6} md={3}><Metric title="MTBF" value={`${num(rel.data.mtbfHours)} h`} hint="Mean time between failures" /></Grid>
          <Grid item xs={6} md={3}><Metric title="Failures" value={rel.data.failures} hint="Breakdowns in the period" /></Grid>
        </Grid>
      )}
      <Card>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} textColor="secondary" indicatorColor="secondary" sx={{ px: 2, borderBottom: '1px solid', borderColor: 'divider' }} variant="scrollable">
          <Tab label="Overview" /><Tab label="History" /><Tab label="PPM schedules" /><Tab label="Meter readings" />
        </Tabs>
        <Box sx={{ p: 2 }}>
          {tab === 0 && (
            <Grid container spacing={3}>
              <Grid item xs={12} md={8}>
                <KeyValue items={[['Make / model', [a.make, a.model].filter(Boolean).join(' ') || '—'], ['Serial no.', a.serialNo], ['Capacity', a.capacity], ['Department', a.departmentId?.name], ['Installed', fmtDate(a.installDate)], ['Warranty until', fmtDate(a.warrantyExpiry)], ['Purchase cost', inr(a.cost)], ['Run hours', a.runHours != null ? num(a.runHours) : null], ...Object.entries(a.specs || {}).map(([k, v]) => [label(k).toUpperCase(), v])]} />
              </Grid>
              <Grid item xs={12} md={4}>
                <Stack alignItems="center" spacing={1} sx={{ p: 2, border: '1px dashed', borderColor: 'divider', borderRadius: 3 }}>
                  <QRCodeSVG value={url} size={140} />
                  <Typography fontWeight={800}>{a.code}</Typography>
                  <Typography variant="caption" color="text.secondary" textAlign="center">Stick this on the equipment. Scanning it opens this page to raise a ticket or start the PPM.</Typography>
                  <Button size="small" variant="outlined" onClick={() => window.print()} className="no-print">Print QR label</Button>
                </Stack>
              </Grid>
            </Grid>
          )}
          {tab === 1 && <History id={id} />}
          {tab === 2 && (
            <Stack spacing={1}>
              {(ppm.data || []).map((s) => (
                <Card key={s._id} sx={{ p: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography fontWeight={700}>{s.title}</Typography><Typography variant="body2" color="text.secondary">{label(s.frequency)} · next due {fmtDate(s.nextDueDate)} · {s.assigneeIds?.map((x) => x.name).join(', ') || 'unassigned'}</Typography></Box><Chip size="small" label={s.active ? 'Active' : 'Paused'} color={s.active ? 'success' : 'default'} /></Stack>
                </Card>
              ))}
              {!ppm.data?.length && <EmptyState title="No PPM schedule" text="Add one under Maintenance → PPM schedules." />}
            </Stack>
          )}
          {tab === 3 && <Readings id={id} />}
        </Box>
      </Card>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>Updated {fmtDateTime(a.updatedAt)}</Typography>
      {edit && <ResourceForm cfg={RESOURCES.assets} id={a._id} initial={a} onClose={() => setEdit(false)} onSaved={() => q.refetch()} />}
    </Box>
  );
}
