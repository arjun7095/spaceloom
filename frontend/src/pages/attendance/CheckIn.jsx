import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Circle, CircleMarker, Polygon } from 'react-leaflet';
import { Alert, Box, Button, Card, Chip, Stack, Typography } from '@mui/material';
import MyLocation from '@mui/icons-material/MyLocation';
import CheckCircle from '@mui/icons-material/CheckCircle';
import WarningAmber from '@mui/icons-material/WarningAmber';
import { api } from '../../api/client';
import { useAction, useNow } from '../../hooks';
import { EmptyState, ErrorState, Loading, PageHeader, SectionCard, StatusChip } from '../../components/common';
import { PhotoUpload } from '../../components/form';
import { duration, fmtDate, fmtTime, label } from '../../utils/format';
import { ACCENT } from '../../theme';

const dist = (a, b) => {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
};

const pointIn = ([lat, lng], poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

// Same rule as the server: circle (centre + radius) or polygon boundary.
function fenceStatus(pos, fence) {
  if (!pos || !fence) return null;
  if (fence.type === 'polygon' && fence.polygon?.length >= 3) {
    const inside = pointIn([pos.lat, pos.lng], fence.polygon);
    return { inside, meters: inside ? 0 : Math.min(...fence.polygon.map(([lat, lng]) => dist(pos, { lat, lng }))) };
  }
  if (fence.lat == null) return null;
  const meters = dist(pos, fence);
  return { inside: meters <= (fence.radiusM || 300), meters };
}

function useLocation() {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!navigator.geolocation) { setError('This device cannot share its location.'); return undefined; }
    const id = navigator.geolocation.watchPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }); setError(''); },
      (e) => setError(e.code === 1 ? 'Location permission is off. Allow location for this site in your browser to check in.' : 'Could not get your location. Move to an open area and try again.'),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return { pos, error };
}

export default function CheckIn() {
  useNow(60000);
  const q = useQuery({ queryKey: ['attendance', 'my'], queryFn: () => api.get('/attendance/my') });
  const { pos, error } = useLocation();
  const [selfie, setSelfie] = useState(null);
  const [local, setLocal] = useState({}); // check-in / out saved offline and not yet synced
  const go = useAction((path) => api.offline('post', `/attendance/${path}`, { lat: pos?.lat, lng: pos?.lng, accuracy: pos?.accuracy, selfieUrl: selfie || undefined }, path === 'check-in' ? 'Check-in' : 'Check-out'), {
    success: (r, path) => (path === 'check-in' ? `Checked in at ${fmtTime(r.checkIn.time)}${r.exceptions?.length ? ` · flagged: ${r.exceptions.map(label).join(', ')}` : ''}` : `Checked out · ${duration((r.workedMin || 0) * 60000)} worked`),
    invalidate: ['attendance', 'kpis'],
    onSuccess: (r, path) => {
      setSelfie(null);
      if (r?.queued) setLocal((x) => ({ ...x, [path === 'check-in' ? 'in' : 'out']: new Date() }));
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  if (!d?.linked) return <EmptyState title="Your login is not linked to an employee record" text="Ask your supervisor or the admin team to link your user to your employee profile, then you can check in here." />;
  const fence = d.property?.geoFence;
  const status = fenceStatus(pos, fence);
  const meters = status?.meters ?? null;
  const inside = Boolean(status?.inside);
  const shift = d.roster?.shiftId;
  const open = d.open || (local.in && !local.out ? { checkIn: { time: local.in }, pending: true, exceptions: [] } : null);
  const doneToday = d.today?.checkOut?.time || local.out;

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto' }}>
      <PageHeader title="Check in / out" subtitle={`${d.employee.name} · ${d.employee.departmentId?.name || ''}`} help="Your location is compared with the property boundary. Check-ins from outside are flagged for your supervisor. A selfie is optional but recommended." />
      <Card sx={{ overflow: 'hidden', mb: 2 }}>
        {fence?.lat != null && (
          <Box sx={{ height: 220 }}>
            <MapContainer center={[fence.lat, fence.lng]} zoom={16} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false} attributionControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {fence.type === 'polygon' && fence.polygon?.length >= 3
                ? <Polygon positions={fence.polygon} pathOptions={{ color: ACCENT, fillOpacity: 0.12 }} />
                : <Circle center={[fence.lat, fence.lng]} radius={fence.radiusM || 300} pathOptions={{ color: ACCENT, fillOpacity: 0.12 }} />}
              {pos && <CircleMarker center={[pos.lat, pos.lng]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1570EF', fillOpacity: 1 }} />}
            </MapContainer>
          </Box>
        )}
        <Stack spacing={2} sx={{ p: 2.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap spacing={1}>
            <Box>
              <Typography variant="overline" color="text.secondary">Today's shift</Typography>
              <Typography variant="h6">{d.roster?.isWeeklyOff ? 'Weekly off' : shift ? `${shift.name} · ${shift.start}–${shift.end}` : 'Not rostered'}</Typography>
            </Box>
            {error ? <Chip color="warning" icon={<WarningAmber />} label="Location unavailable" /> : !pos ? <Chip icon={<MyLocation />} label="Finding you…" /> : inside ? <Chip color="success" icon={<CheckCircle />} label={fence?.type === 'polygon' ? 'Inside the site boundary' : `Inside the site · ${meters} m`} /> : <Chip color="warning" icon={<WarningAmber />} label={`${meters} m away — outside the boundary`} />}
          </Stack>
          {error && <Alert severity="warning">{error}</Alert>}
          {doneToday ? (
            <Alert severity="info">You checked out at {fmtTime(local.out || d.today?.checkOut?.time)}{local.out ? ' — saved on this phone, it will sync when you are back online' : ''}. See you next shift!</Alert>
          ) : open ? (
            <Alert severity={open.pending ? 'info' : 'success'} icon={<CheckCircle />}>{open.pending ? 'Saved offline — ' : ''}Checked in at <b>{fmtTime(open.checkIn.time)}</b> · {duration(Date.now() - new Date(open.checkIn.time))} so far{open.exceptions?.length ? ` · flagged: ${open.exceptions.map(label).join(', ')}` : ''}</Alert>
          ) : (
            <Box><Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>Selfie (optional)</Typography><PhotoUpload multiple={false} value={selfie} onChange={setSelfie} capture="user" label="Take selfie" /></Box>
          )}
          {!doneToday && (
            <Button size="large" variant="contained" color={open ? 'primary' : 'secondary'} disabled={go.isPending || (!pos && !open)} onClick={() => go.mutate(open ? 'check-out' : 'check-in')} sx={{ py: 1.75, fontSize: 18, borderRadius: 3 }}>
              {go.isPending ? 'Please wait…' : open ? 'Check out' : 'Check in'}
            </Button>
          )}
        </Stack>
      </Card>

      <SectionCard title="My roster this week" sx={{ mb: 2 }}>
        <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 0.5 }}>
          {d.week.map((r) => (
            <Box key={r.date} sx={{ minWidth: 72, textAlign: 'center', p: 1, borderRadius: 2, border: '1px solid', borderColor: r.date === d.roster?.date ? 'secondary.main' : 'divider' }}>
              <Typography variant="caption" color="text.secondary">{new Date(`${r.date}T12:00:00`).toLocaleDateString('en-IN', { weekday: 'short' })}</Typography>
              <Typography fontWeight={800}>{r.isWeeklyOff ? 'OFF' : r.shiftId?.code || '—'}</Typography>
              <Typography variant="caption" color="text.secondary">{r.shiftId && !r.isWeeklyOff ? r.shiftId.start : ''}</Typography>
            </Box>
          ))}
        </Stack>
      </SectionCard>

      <SectionCard title="Last 30 days">
        <Stack spacing={0.5}>
          {d.history.slice(0, 15).map((h) => (
            <Stack key={h._id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="body2" sx={{ width: 96 }}>{fmtDate(h.date)}</Typography>
              <StatusChip value={h.status} />
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{h.checkIn?.time ? `${fmtTime(h.checkIn.time)} – ${h.checkOut?.time ? fmtTime(h.checkOut.time) : '…'}` : ''}</Typography>
              {h.exceptions?.map((e) => <Chip key={e} size="small" color="warning" variant="outlined" label={label(e)} />)}
            </Stack>
          ))}
          {!d.history.length && <Typography color="text.secondary">No attendance yet.</Typography>}
        </Stack>
      </SectionCard>
    </Box>
  );
}
