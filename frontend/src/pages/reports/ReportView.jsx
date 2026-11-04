import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Breadcrumbs, Button, Card, Grid, Link, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import PictureAsPdfOutlined from '@mui/icons-material/PictureAsPdfOutlined';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import CheckCircle from '@mui/icons-material/CheckCircle';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import ErrorRounded from '@mui/icons-material/ErrorRounded';
import { api, download } from '../../api/client';
import { useAction, usePerm } from '../../hooks';
import { hasRole } from '../../store/auth';
import { ErrorState, Loading, SectionCard, StatusChip, Timeline, StackTable } from '../../components/common';
import { Logo } from '../../layouts/AppLayout';
import { fmtDate, fmtDateTime, humanize, inr, label, num } from '../../utils/format';

const RAG = { green: [CheckCircle, 'success.main', 'On target'], amber: [WarningAmberRounded, 'warning.main', 'Watch'], red: [ErrorRounded, 'error.main', 'Off target'] };
const fmtVal = (k, v) => (v == null ? '—' : k.unit === '%' ? `${num(v)}%` : num(v));

function Section({ name, value }) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    if (!value.length) return <SectionCard title={humanize(name)}><Typography variant="body2" color="text.secondary">None in this period.</Typography></SectionCard>;
    const cols = Object.keys(value[0]).filter((c) => !c.startsWith('_') && typeof value[0][c] !== 'object');
    return (
      <SectionCard title={humanize(name)} noPad>
        <Box sx={{ overflowX: 'auto', px: 2, pb: 2 }}>
          <StackTable>
            <TableHead><TableRow>{cols.map((c) => <TableCell key={c} sx={{ fontWeight: 700 }}>{humanize(c)}</TableCell>)}</TableRow></TableHead>
            <TableBody>{value.map((r, i) => <TableRow key={i}>{cols.map((c) => <TableCell key={c}>{/date|end|Date/.test(c) && r[c] ? fmtDate(r[c]) : typeof r[c] === 'number' ? (/value|cost/.test(c) ? inr(r[c]) : num(r[c])) : label(r[c])}</TableCell>)}</TableRow>)}</TableBody>
          </StackTable>
        </Box>
      </SectionCard>
    );
  }
  if (typeof value === 'object') {
    const flat = Object.entries(value).filter(([, v]) => typeof v !== 'object' || v == null);
    const nested = Object.entries(value).filter(([, v]) => v && typeof v === 'object');
    return (
      <>
        {flat.length > 0 && (
          <SectionCard title={humanize(name)}>
            <Grid container spacing={1.5}>{flat.map(([k, v]) => <Grid item xs={6} sm={4} md={3} key={k}><Typography variant="caption" color="text.secondary">{humanize(k)}</Typography><Typography variant="h6">{typeof v === 'number' ? (/cost|materials|invoice|amc/i.test(`${name}${k}`) ? inr(v) : num(v)) : label(v)}</Typography></Grid>)}</Grid>
          </SectionCard>
        )}
        {nested.map(([k, v]) => <Section key={k} name={`${name} · ${k}`} value={v} />)}
      </>
    );
  }
  return <SectionCard title={humanize(name)}><Typography variant="h6">{typeof value === 'number' ? num(value) : String(value)}</Typography></SectionCard>;
}

export default function ReportView() {
  const { id } = useParams();
  const { user, can } = usePerm();
  const q = useQuery({ queryKey: ['reports', 'detail', id], queryFn: () => api.get(`/reports/${id}`) });
  const [kpis, setKpis] = useState([]);
  const [commentary, setCommentary] = useState('');
  useEffect(() => { if (q.data) { setKpis(q.data.kpis); setCommentary(q.data.commentary || ''); } }, [q.data]);
  const save = useAction((b) => api.patch(`/reports/${id}`, b), { success: 'Saved', invalidate: ['reports'] });
  const move = useAction(({ to, note }) => api.post(`/reports/${id}/transition`, { to, note }), { success: (r, v) => ({ signed_off: 'Signed off', sent: 'Sent to the client', acknowledged: 'Acknowledged', draft: 'Reopened for editing' }[v.to]), invalidate: ['reports', 'approvals'] });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data;
  const editable = r.status === 'draft' && (hasRole(user, 'property_manager') || user.permissions.includes('*'));
  const tLabel = { signed_off: 'Sign off', sent: 'Send to client', acknowledged: 'Acknowledge', draft: 'Reopen draft' };
  const dirty = commentary !== (r.commentary || '') || JSON.stringify(kpis) !== JSON.stringify(r.kpis);

  return (
    <Box>
      <Breadcrumbs sx={{ mb: 1.5 }} className="no-print"><Link component={RouterLink} to="/reports" underline="hover" color="inherit">Client reports</Link><Typography color="text.primary">{r.title}</Typography></Breadcrumbs>
      <Card sx={{ p: { xs: 2, md: 3 }, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
          <Box>
            <Box sx={{ display: 'none', '@media print': { display: 'block', mb: 2 } }}><Logo /></Box>
            <Typography variant="overline" color="text.secondary">{label(r.type)} report · version {r.version}</Typography>
            <Typography variant="h5">{r.title}</Typography>
            <Typography color="text.secondary">{fmtDate(r.periodStart)} to {fmtDate(r.periodEnd)}{r.signedAt ? ` · signed off by ${r.signedBy?.name} on ${fmtDateTime(r.signedAt)}` : ''}</Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="flex-start" flexWrap="wrap" useFlexGap className="no-print">
            <StatusChip value={r.status} />
            <Button startIcon={<FileDownloadOutlined />} onClick={() => download(`/reports/${id}/xlsx`, {}, `${r.title}.xlsx`)}>Excel</Button>
            <Button startIcon={<PictureAsPdfOutlined />} onClick={() => download(`/reports/${id}/pdf`, {}, `${r.title}.pdf`)}>PDF</Button>
            <Button startIcon={<PrintOutlined />} onClick={() => window.print()}>Print</Button>
            {(r.allowedTransitions || []).map((to) => <Button key={to} variant={to === 'draft' ? 'text' : 'contained'} color="secondary" disabled={dirty || move.isPending} onClick={() => move.mutate({ to })}>{tLabel[to] || label(to)}</Button>)}
          </Stack>
        </Stack>
        {dirty && <Alert severity="info" sx={{ mt: 2 }} className="no-print">Save your changes before signing off.</Alert>}
      </Card>

      <SectionCard title="KPI scorecard" subtitle="Target → Actual → Variance → Responsibility → Corrective action" noPad sx={{ mb: 2 }}>
        <Box sx={{ overflowX: 'auto', px: 2, pb: 2 }}>
          <StackTable>
            <TableHead><TableRow>{['KPI', 'Target', 'Actual', 'Variance', 'Status', 'Responsibility', 'Corrective action'].map((h) => <TableCell key={h} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {kpis.map((k, i) => {
                const [I, color, text] = RAG[k.status] || [];
                return (
                  <TableRow key={k.code}>
                    <TableCell sx={{ fontWeight: 600 }}>{k.name}</TableCell>
                    <TableCell>{fmtVal(k, k.target)}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{fmtVal(k, k.actual)}</TableCell>
                    <TableCell sx={{ color: k.variance < 0 ? 'error.main' : 'success.main', fontWeight: 600 }}>{k.variance == null ? '—' : `${k.variance > 0 ? '+' : ''}${num(k.variance)}`}</TableCell>
                    <TableCell>{I && <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color }}><I sx={{ fontSize: 16 }} /><Typography variant="caption" fontWeight={700}>{text}</Typography></Stack>}</TableCell>
                    <TableCell sx={{ minWidth: 140 }}>{editable ? <TextField variant="standard" value={k.responsibility || ''} onChange={(e) => setKpis(kpis.map((x, j) => (j === i ? { ...x, responsibility: e.target.value } : x)))} /> : k.responsibility}</TableCell>
                    <TableCell sx={{ minWidth: 260 }}>{editable ? <TextField variant="standard" multiline placeholder={k.status === 'green' ? 'Optional' : 'What will be done to close the gap?'} value={k.correctiveAction || ''} onChange={(e) => setKpis(kpis.map((x, j) => (j === i ? { ...x, correctiveAction: e.target.value } : x)))} /> : k.correctiveAction || '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </StackTable>
        </Box>
      </SectionCard>

      <SectionCard title="Property Manager's commentary" sx={{ mb: 2 }}>
        {editable ? (
          <Stack spacing={1.5}>
            <TextField multiline minRows={4} placeholder="Summarise the period for the client: highlights, issues, and what you are doing about them." value={commentary} onChange={(e) => setCommentary(e.target.value)} />
            <Box className="no-print"><Button variant="contained" color="secondary" disabled={!dirty || save.isPending} onClick={() => save.mutate({ commentary, kpis })}>Save draft</Button></Box>
          </Stack>
        ) : <Typography sx={{ whiteSpace: 'pre-wrap' }}>{r.commentary || 'No commentary.'}</Typography>}
      </SectionCard>

      <Stack spacing={2}>{Object.entries(r.data || {}).map(([k, v]) => <Section key={k} name={k} value={v} />)}</Stack>
      {r.history?.length > 0 && <SectionCard title="Version history" sx={{ mt: 2 }}><Timeline items={[...r.history].reverse()} /></SectionCard>}
      {can('report:approve') && hasRole(user, 'owner') && r.status === 'sent' && <Alert severity="info" sx={{ mt: 2 }}>Please review and acknowledge this report.</Alert>}
    </Box>
  );
}
