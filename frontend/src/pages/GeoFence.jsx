import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapContainer, TileLayer, Circle, CircleMarker, Polygon, useMapEvents } from 'react-leaflet';
import { Alert, Box, Button, Card, Grid, MenuItem, Slider, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useAction } from '../hooks';
import { Loading, PageHeader } from '../components/common';
import { ACCENT } from '../theme';

function Clicks({ onClick }) {
  useMapEvents({ click: (e) => onClick([Math.round(e.latlng.lat * 1e6) / 1e6, Math.round(e.latlng.lng * 1e6) / 1e6]) });
  return null;
}

// FR-3.5: draw the property boundary as a circle (centre + radius) or a polygon.
export default function GeoFence() {
  const propertyId = useAuth((s) => s.propertyId);
  const q = useQuery({ queryKey: ['properties', 'geofence', propertyId], queryFn: () => api.get(`/properties/${propertyId}/geofence`), enabled: Boolean(propertyId) });
  const [f, setF] = useState(null);
  useEffect(() => {
    if (!q.data) return;
    const g = q.data.geoFence || {};
    setF({ type: g.type || 'circle', center: g.lat != null ? [g.lat, g.lng] : [17.4474, 78.3762], radiusM: g.radiusM || 300, polygon: g.polygon || [], policy: g.policy || 'flag' });
  }, [q.data]);
  const save = useAction((body) => api.put(`/properties/${propertyId}/geofence`, body), { success: 'Geo-fence saved — new check-ins use it straight away', invalidate: ['properties', 'attendance'] });
  if (!f) return <Loading />;
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const click = (pt) => (f.type === 'circle' ? set({ center: pt }) : set({ polygon: [...f.polygon, pt] }));
  const useHere = () => navigator.geolocation?.getCurrentPosition((p) => set({ center: [p.coords.latitude, p.coords.longitude] }));
  const ready = f.type === 'circle' || f.polygon.length >= 3;
  return (
    <Box>
      <PageHeader title={`Geo-fence · ${q.data.name}`} subtitle="Where staff may check in from their phones." help="A circle is quickest. Use a polygon for odd-shaped sites: click each corner in order around the boundary. Check-ins outside are flagged for the supervisor, or blocked if you choose." />
      <Grid container spacing={2}>
        <Grid item xs={12} md={8}>
          <Card sx={{ overflow: 'hidden', height: { xs: 360, md: 520 } }}>
            <MapContainer center={f.type === 'polygon' && f.polygon[0] ? f.polygon[0] : f.center} zoom={16} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
              <Clicks onClick={click} />
              {f.type === 'circle' && <><Circle center={f.center} radius={f.radiusM} pathOptions={{ color: ACCENT, fillOpacity: 0.15 }} /><CircleMarker center={f.center} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: ACCENT, fillOpacity: 1 }} /></>}
              {f.type === 'polygon' && f.polygon.length >= 2 && <Polygon positions={f.polygon} pathOptions={{ color: ACCENT, fillOpacity: 0.15 }} />}
              {f.type === 'polygon' && f.polygon.map((p, i) => <CircleMarker key={i} center={p} radius={6} pathOptions={{ color: '#fff', weight: 2, fillColor: i === 0 ? '#1570EF' : ACCENT, fillOpacity: 1 }} />)}
            </MapContainer>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card sx={{ p: 2.5 }}>
            <Stack spacing={2.5}>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Boundary shape</Typography>
                <ToggleButtonGroup exclusive fullWidth size="small" value={f.type} onChange={(e, v) => v && set({ type: v })}>
                  <ToggleButton value="circle">Circle</ToggleButton>
                  <ToggleButton value="polygon">Polygon</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              {f.type === 'circle' ? (
                <>
                  <Alert severity="info">Click the map to move the centre.</Alert>
                  <Box>
                    <Typography variant="subtitle2">Radius: {f.radiusM} m</Typography>
                    <Slider min={50} max={1000} step={10} value={f.radiusM} onChange={(e, v) => set({ radiusM: v })} color="secondary" />
                  </Box>
                  <Button variant="outlined" onClick={useHere}>Use my current location as the centre</Button>
                </>
              ) : (
                <>
                  <Alert severity="info">Click each corner of the site in order. {f.polygon.length} point{f.polygon.length === 1 ? '' : 's'} so far{f.polygon.length < 3 ? ' — at least 3 needed' : ''}.</Alert>
                  <Stack direction="row" spacing={1}>
                    <Button variant="outlined" disabled={!f.polygon.length} onClick={() => set({ polygon: f.polygon.slice(0, -1) })}>Undo last point</Button>
                    <Button color="error" disabled={!f.polygon.length} onClick={() => set({ polygon: [] })}>Clear</Button>
                  </Stack>
                </>
              )}
              <TextField select label="Check-in from outside the boundary" value={f.policy} onChange={(e) => set({ policy: e.target.value })}>
                <MenuItem value="flag">Allow, but flag it for the supervisor</MenuItem>
                <MenuItem value="block">Block the check-in</MenuItem>
              </TextField>
              {save.error && <Alert severity="error">{save.error.message}</Alert>}
              <Button variant="contained" color="secondary" size="large" disabled={!ready || save.isPending}
                onClick={() => save.mutate(f.type === 'circle' ? { type: 'circle', lat: f.center[0], lng: f.center[1], radiusM: f.radiusM, policy: f.policy } : { type: 'polygon', polygon: f.polygon, policy: f.policy })}>
                Save geo-fence
              </Button>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
