import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { api } from '../api/client';

// Works out what a scanned QR (or a typed code) points to: an asset, a location, or an app link.
export async function scanTarget(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Nothing was scanned');
  let url = null;
  try { url = new URL(raw, window.location.origin); } catch { /* not a URL */ }
  if (url && url.origin === window.location.origin && (raw.includes('/') || raw.startsWith('http'))) {
    const asset = url.pathname.match(/^\/assets\/([a-f0-9]{24})/);
    if (asset) return { type: 'asset', id: asset[1] };
    const loc = url.searchParams.get('locationId');
    if (url.pathname === '/tickets/new' && loc) return { type: 'location', id: loc };
    return { type: 'path', path: url.pathname + url.search };
  }
  const code = raw.toUpperCase();
  try {
    const a = await api.get(`/assets/by-code/${encodeURIComponent(code)}`);
    return { type: 'asset', id: a._id };
  } catch { /* not an asset code */ }
  const locs = await api.list('/locations', { search: code, limit: 5 }).then((r) => r.data).catch(() => []);
  const hit = locs.find((l) => l.code === code);
  if (hit) return { type: 'location', id: hit._id };
  throw new Error(`"${raw}" is not a PrimeSpace asset or location code`);
}

function Camera({ onText, onError }) {
  const started = useRef(false);
  useEffect(() => {
    const qr = new Html5Qrcode('ps-qr-reader', { verbose: false });
    let done = false;
    qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, (text) => {
      if (done) return;
      done = true;
      qr.stop().catch(() => {}).finally(() => onText(text));
    }, () => {})
      .then(() => { started.current = true; })
      .catch((err) => onError(String(err?.message || err).includes('Permission') ? 'Camera permission was denied. Allow the camera for this site, or type the code below.' : 'No camera is available. Type the code printed under the QR instead.'));
    return () => {
      done = true;
      if (started.current) qr.stop().catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <Box id="ps-qr-reader" sx={{ width: '100%', minHeight: 260, bgcolor: '#0B1220', borderRadius: 2, overflow: 'hidden', '& video': { borderRadius: 2 } }} />;
}

export function QrScanDialog({ open, onClose, onTarget, title = 'Scan a QR code' }) {
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const handle = async (text) => {
    setBusy(true);
    setError('');
    try {
      onTarget(await scanTarget(text));
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}<Typography variant="body2" color="text.secondary">Point the camera at the QR sticker on equipment or a location.</Typography></DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {open && <Camera key={open} onText={handle} onError={setError} />}
          {error && <Alert severity="warning">{error}</Alert>}
          <Stack direction="row" spacing={1}>
            <TextField label="Or type the code" placeholder="e.g. AHU-A-05 or PTP-A-05-EW" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code && handle(code)} />
            <Button variant="outlined" disabled={!code || busy} onClick={() => handle(code)}>Go</Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions><Button onClick={onClose} color="inherit">Close</Button></DialogActions>
    </Dialog>
  );
}

// Where a scan should take this user. Tenants go straight to raising a ticket.
export function scanPath(t, canSeeAssets) {
  if (t.type === 'asset') return canSeeAssets ? `/assets/${t.id}` : `/tickets/new?assetId=${t.id}`;
  if (t.type === 'location') return `/tickets/new?locationId=${t.id}`;
  return t.path;
}
