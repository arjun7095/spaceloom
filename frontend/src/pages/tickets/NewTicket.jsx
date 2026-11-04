import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import { Alert, Box, Button, Card, CardActionArea, Chip, Grid, Link, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import AcUnit from '@mui/icons-material/AcUnit';
import ElectricalServices from '@mui/icons-material/ElectricalServices';
import Plumbing from '@mui/icons-material/Plumbing';
import CleaningServices from '@mui/icons-material/CleaningServices';
import SecurityOutlined from '@mui/icons-material/SecurityOutlined';
import Elevator from '@mui/icons-material/Elevator';
import Construction from '@mui/icons-material/Construction';
import TvOutlined from '@mui/icons-material/TvOutlined';
import HelpOutline from '@mui/icons-material/HelpOutline';
import { api } from '../../api/client';
import { hasRole } from '../../store/auth';
import { useAction, usePerm } from '../../hooks';
import { PageHeader, PriorityChip, SectionCard } from '../../components/common';
import { PhotoUpload, RefSelect } from '../../components/form';
import { QrScanDialog } from '../../components/QrScanner';
import QrCodeScannerOutlined from '@mui/icons-material/QrCodeScannerOutlined';
import { PRIORITY, fromNow } from '../../utils/format';

const CAT_ICON = { HVAC: AcUnit, ELEC: ElectricalServices, PLUMB: Plumbing, HK: CleaningServices, SEC: SecurityOutlined, LIFT: Elevator, CIVIL: Construction, IT: TvOutlined };
const Step = ({ n, title, children, hint }) => (
  <SectionCard title={<Stack direction="row" spacing={1} alignItems="center"><Box sx={{ width: 26, height: 26, borderRadius: '50%', bgcolor: 'secondary.main', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800 }}>{n}</Box><span>{title}</span></Stack>} subtitle={hint}>
    {children}
  </SectionCard>
);

export default function NewTicket() {
  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();
  const { user } = usePerm();
  const [sp] = useSearchParams();
  const tenant = hasRole(user, 'tenant') && user.layout === 'field';
  const staff = !tenant && !hasRole(user, 'technician', 'vendor');
  const [f, setF] = useState({ categoryId: null, subCategory: '', locationId: sp.get('locationId'), assetId: sp.get('assetId'), description: '', photos: [], priority: null, priorityOverrideReason: '', tenantId: null });
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const [scanning, setScanning] = useState(false);
  const onScan = async (t) => {
    if (t.type === 'location') set({ locationId: t.id });
    if (t.type === 'asset') {
      const a = await api.get(`/assets/${t.id}`);
      set({ assetId: a._id, locationId: a.locationId?._id || f.locationId });
    }
  };
  const cats = useQuery({ queryKey: ['ref', 'ticket-categories-all'], queryFn: () => api.list('/ticket-categories', { limit: 50 }).then((r) => r.data) });
  const cat = cats.data?.find((c) => c._id === f.categoryId);
  const suggest = useQuery({ queryKey: ['suggest', f.categoryId, f.assetId], queryFn: () => api.get('/tickets/suggest-priority', { categoryId: f.categoryId, assetId: f.assetId || undefined }), enabled: Boolean(f.categoryId) });
  const dupes = useQuery({ queryKey: ['tickets', 'dupes', f.locationId, f.categoryId], queryFn: () => api.get('/tickets/check-duplicate', { locationId: f.locationId, categoryId: f.categoryId }), enabled: Boolean(f.locationId && f.categoryId) });
  const suggested = suggest.data?.priority;
  const priority = f.priority || suggested;
  const changed = staff && f.priority && f.priority !== suggested;
  useEffect(() => { set({ priority: null }); }, [suggested]);
  const create = useAction((body) => api.post('/tickets', body), {
    invalidate: ['tickets', 'today', 'kpis'],
    onSuccess: (t) => { enqueueSnackbar(`${t.number} raised — the ${t.priority} SLA clock has started`, { variant: 'success' }); navigate(`/tickets/${t._id}`, { replace: true }); },
  });
  const ready = f.categoryId && (f.locationId || f.assetId) && f.description.trim().length >= 5 && (!changed || f.priorityOverrideReason.trim().length >= 3);

  return (
    <Box sx={{ maxWidth: 880, mx: 'auto' }}>
      <PageHeader title={tenant ? 'Report a problem' : 'Raise a ticket'} subtitle="Four quick steps. We route it to the right team and start the SLA clock." help="The priority is suggested from the type of problem and how critical the equipment is. Helpdesk can change it with a reason." />
      <Stack spacing={2}>
        <Step n={1} title="What is the problem?" hint="Choose the closest match">
          <Grid container spacing={1.25}>
            {(cats.data || []).map((c) => {
              const I = CAT_ICON[c.code] || HelpOutline;
              const on = c._id === f.categoryId;
              return (
                <Grid item xs={6} sm={3} key={c._id}>
                  <Card sx={{ borderColor: on ? 'primary.main' : 'divider', bgcolor: on ? 'primary.soft' : undefined, boxShadow: (t) => (on ? `0 0 0 3px ${t.palette.primary[100]}` : undefined), transition: 'all .15s', '&:hover': { borderColor: on ? 'primary.main' : 'primary.200' } }}>
                    <CardActionArea onClick={() => set({ categoryId: c._id, subCategory: '' })} aria-pressed={on} sx={{ py: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Box sx={{ width: 48, height: 48, borderRadius: '14px', display: 'grid', placeItems: 'center', bgcolor: on ? 'primary.main' : 'primary.soft', color: on ? '#fff' : 'primary.main', transition: 'all .15s' }}><I sx={{ fontSize: 26 }} /></Box>
                      <Typography fontWeight={700} fontSize={14} color={on ? 'primary.ink' : 'text.primary'}>{c.name}</Typography>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
          {cat?.subCategories?.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
              {cat.subCategories.map((s) => <Chip key={s} label={s} clickable color={f.subCategory === s ? 'secondary' : 'default'} variant={f.subCategory === s ? 'filled' : 'outlined'} onClick={() => set({ subCategory: s })} />)}
            </Stack>
          )}
        </Step>

        <Step n={2} title="Where is it?" hint="Pick the floor or zone, or scan the QR sticker on the equipment or wall.">
          <Button startIcon={<QrCodeScannerOutlined />} variant="outlined" onClick={() => setScanning(true)} sx={{ mb: 2 }}>Scan a QR code</Button>
          <QrScanDialog open={scanning} onClose={() => setScanning(false)} onTarget={onScan} title="Scan the equipment or location QR" />
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}><RefSelect refTo="locations" label="Location" required value={f.locationId} onChange={(v) => set({ locationId: v })} /></Grid>
            <Grid item xs={12} sm={6}><RefSelect refTo="assets" label="Equipment (optional)" value={f.assetId} onChange={(v, o) => set({ assetId: v, ...(o?.locationId && !f.locationId && { locationId: o.locationId._id || o.locationId }) })} /></Grid>
            {staff && <Grid item xs={12} sm={6}><RefSelect refTo="tenants" label="On behalf of tenant (optional)" value={f.tenantId} onChange={(v) => set({ tenantId: v })} /></Grid>}
          </Grid>
          {dupes.data?.length > 0 && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              <b>Someone may have already reported this.</b> Open tickets for the same place and category in the last 2 hours:
              {dupes.data.map((d) => <Box key={d._id}><Link component="button" onClick={() => navigate(`/tickets/${d._id}`)}>{d.number}</Link> — {d.description} ({fromNow(d.createdAt)})</Box>)}
            </Alert>
          )}
        </Step>

        <Step n={3} title="Describe it" hint="A sentence is enough. Photos help the technician come prepared.">
          <Stack spacing={2}>
            <TextField multiline minRows={3} label="What is happening?" placeholder="e.g. AHU not cooling — the east wing is very warm since morning" value={f.description} onChange={(e) => set({ description: e.target.value })} />
            <PhotoUpload value={f.photos} onChange={(v) => set({ photos: v })} capture="environment" max={5} />
          </Stack>
        </Step>

        <Step n={4} title="Priority" hint="Decides the response and fix deadlines">
          {!f.categoryId ? <Typography color="text.secondary">Choose a problem type first.</Typography> : (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} alignItems="center"><Typography>Suggested:</Typography>{suggested && <PriorityChip value={suggested} />}<Typography variant="body2" color="text.secondary">based on {cat?.name}{f.assetId ? ' and how critical the equipment is' : ''}</Typography></Stack>
              {staff && (
                <>
                  <ToggleButtonGroup exclusive value={priority} onChange={(e, v) => v && set({ priority: v })} size="small">
                    {Object.entries(PRIORITY).map(([k, p]) => <ToggleButton key={k} value={k} sx={{ px: 2 }}>{p.label}</ToggleButton>)}
                  </ToggleButtonGroup>
                  {changed && <TextField label="Why are you changing the suggested priority?" required value={f.priorityOverrideReason} onChange={(e) => set({ priorityOverrideReason: e.target.value })} />}
                </>
              )}
            </Stack>
          )}
        </Step>

        {create.error && <Alert severity="error">{create.error.message}</Alert>}
        <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ pb: 2 }}>
          <Button color="inherit" onClick={() => navigate(-1)}>Cancel</Button>
          <Button variant="contained" color="secondary" size="large" disabled={!ready || create.isPending}
            onClick={() => create.mutate({ categoryId: f.categoryId, subCategory: f.subCategory || undefined, locationId: f.locationId || undefined, assetId: f.assetId || undefined, description: f.description.trim(), photos: f.photos, tenantId: f.tenantId || undefined, ...(changed && { priority: f.priority, priorityOverrideReason: f.priorityOverrideReason }), ...(sp.get('locationId') && !tenant && { source: 'qr' }) })}>
            {create.isPending ? 'Submitting…' : 'Submit ticket'}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
