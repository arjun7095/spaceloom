import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Drawer, FormControlLabel, Grid, IconButton, MenuItem, Stack, Switch,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import AddPhotoAlternateOutlined from '@mui/icons-material/AddPhotoAlternateOutlined';
import AttachFileOutlined from '@mui/icons-material/AttachFileOutlined';
import Close from '@mui/icons-material/Close';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import Add from '@mui/icons-material/Add';
import dayjs from 'dayjs';
import { api, uploadFiles } from '../api/client';
import { useAction, useDebounced, useMobile } from '../hooks';
import { getPath, humanize, isImageUrl, label, refLabel } from '../utils/format';
import { compressImage } from '../utils/image';
import { StackTable } from './common';
import { isOfflineFile, offlinePreview, saveOfflineFile } from '../offline/queue';

export const idOf = (v) => (v && typeof v === 'object' ? v._id : v);

export function RefSelect({ refTo, value, onChange, multiple, label: lbl, required, error, helperText, params, disabled, size }) {
  const [input, setInput] = useState('');
  const q = useDebounced(input, 300);
  const [known, setKnown] = useState({});
  const { data = [], isFetching } = useQuery({
    queryKey: ['ref', refTo, q, params],
    queryFn: () => api.list(`/${refTo}`, { search: q || undefined, limit: 30, ...params }).then((r) => r.data),
    staleTime: 60000,
  });
  useEffect(() => {
    const add = {};
    for (const o of [...data, ...[].concat(value || []).filter((v) => v && typeof v === 'object')]) add[o._id] = o;
    if (Object.keys(add).length) setKnown((k) => ({ ...k, ...add }));
  }, [data, value]);
  const missing = [].concat(value || []).filter((v) => typeof v === 'string' && !known[v]);
  useEffect(() => {
    missing.forEach((id) => api.get(`/${refTo}/${id}`).then((o) => setKnown((k) => ({ ...k, [id]: o }))).catch(() => {}));
  }, [missing.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const toObj = (v) => (typeof v === 'object' ? v : known[v] || { _id: v });
  return (
    <Autocomplete
      multiple={multiple}
      size={size || 'small'}
      disabled={disabled}
      options={data}
      loading={isFetching}
      value={multiple ? [].concat(value || []).map(toObj) : value ? toObj(value) : null}
      getOptionLabel={(o) => refLabel(o) || '…'}
      isOptionEqualToValue={(a, b) => a._id === idOf(b)}
      filterOptions={(x) => x}
      onInputChange={(e, v, reason) => reason === 'input' && setInput(v)}
      onChange={(e, v) => onChange(multiple ? v.map((x) => x._id) : v?._id ?? null, v)}
      renderOption={(props, o) => (
        <li {...props} key={o._id}>
          <Box>
            <Typography variant="body2">{refLabel(o)}</Typography>
            {(o.designation || o.email || o.uom) && <Typography variant="caption" color="text.secondary">{o.designation || o.email || o.uom}</Typography>}
          </Box>
        </li>
      )}
      renderInput={(p) => <TextField {...p} label={lbl} required={required} error={error} helperText={helperText} placeholder="Type to search" />}
    />
  );
}

export function PhotoUpload({ value, onChange, multiple = true, accept = 'image/*', capture, label: lbl = 'Add photo', max = 6 }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [previews, setPreviews] = useState({});
  const list = [].concat(value || []).filter(Boolean);
  // Local previews for photos that are waiting on this device to be uploaded.
  useEffect(() => {
    list.filter((u) => isOfflineFile(u) && !previews[u]).forEach((u) => offlinePreview(u).then((p) => p && setPreviews((s) => ({ ...s, [u]: p }))));
  }, [list.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true);
    setErr('');
    try {
      const prepared = await Promise.all(files.slice(0, max - list.length).map((f) => compressImage(f)));
      let urls;
      try {
        if (!navigator.onLine) throw Object.assign(new Error('offline'), { network: true });
        urls = (await uploadFiles(prepared)).map((u) => u.url);
      } catch (x) {
        if (!x.network) throw x;
        urls = await Promise.all(prepared.map((f) => saveOfflineFile(f)));
      }
      onChange(multiple ? [...list, ...urls] : urls[0]);
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  const isImg = isImageUrl;
  return (
    <Box>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {list.map((u) => (
          <Box key={u} sx={{ position: 'relative' }}>
            {isImg(u) ? (
              <Box component="a" href={previews[u] || u} target="_blank" rel="noreferrer"><Box component="img" src={previews[u] || u} alt="" sx={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 2, border: '1px solid', borderColor: 'divider', display: 'block' }} /></Box>
            ) : (
              <Chip icon={<AttachFileOutlined />} label="File" component="a" href={u} target="_blank" clickable />
            )}
            <IconButton size="small" aria-label="Remove" onClick={() => onChange(multiple ? list.filter((x) => x !== u) : null)} sx={{ position: 'absolute', top: -8, right: -8, bgcolor: 'background.paper', boxShadow: 1, '&:hover': { bgcolor: 'background.paper' } }}><Close sx={{ fontSize: 14 }} /></IconButton>
          </Box>
        ))}
        {(multiple ? list.length < max : !list.length) && (
          <Button variant="outlined" color="inherit" onClick={() => ref.current.click()} disabled={busy} sx={{ width: 76, height: 76, flexDirection: 'column', borderStyle: 'dashed', fontSize: 11, lineHeight: 1.2 }}>
            {busy ? <CircularProgress size={20} /> : <><AddPhotoAlternateOutlined />{lbl}</>}
          </Button>
        )}
      </Stack>
      <input ref={ref} type="file" hidden accept={accept} multiple={multiple} capture={capture} onChange={pick} />
      {err && <Typography variant="caption" color="error">{err}</Typography>}
    </Box>
  );
}

export function SignaturePad({ value, onChange }) {
  const canvas = useRef();
  const drawing = useRef(false);
  useEffect(() => {
    const c = canvas.current;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = 160 * ratio;
    const ctx = c.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#101828';
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.offsetWidth, 160);
      img.src = value;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pos = (e) => {
    const r = canvas.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const down = (e) => {
    drawing.current = true;
    canvas.current.setPointerCapture(e.pointerId);
    const ctx = canvas.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(...pos(e));
  };
  const move = (e) => {
    if (!drawing.current) return;
    const ctx = canvas.current.getContext('2d');
    ctx.lineTo(...pos(e));
    ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(canvas.current.toDataURL('image/png'));
  };
  const clear = () => {
    const c = canvas.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    onChange(null);
  };
  return (
    <Box>
      <Box component="canvas" ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        sx={{ width: '100%', height: 160, border: '1px dashed', borderColor: value ? 'secondary.main' : 'divider', borderRadius: 2, touchAction: 'none', bgcolor: 'grey.50', display: 'block', cursor: 'crosshair' }} />
      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">{value ? 'Signed ✓' : 'Sign above with your finger or mouse'}</Typography>
        <Button size="small" onClick={clear}>Clear</Button>
      </Stack>
    </Box>
  );
}

function LinesEditor({ sub, value, onChange }) {
  const rows = value || [];
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <Box sx={{ border: { sm: '1px solid' }, borderColor: { sm: 'divider' }, borderRadius: 2, overflowX: 'auto' }}>
      <StackTable>
        <TableHead><TableRow>{sub.map((f) => <TableCell key={f.n} sx={{ fontWeight: 700 }}>{f.l || humanize(f.n)}</TableCell>)}<TableCell /></TableRow></TableHead>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {sub.map((f) => <TableCell key={f.n} sx={{ minWidth: f.t === 'ref' ? 200 : 90, verticalAlign: 'top' }}><FieldInput f={{ ...f, l: '' }} value={r[f.n]} onChange={(v) => set(i, f.n, v)} dense /></TableCell>)}
              <TableCell padding="checkbox"><IconButton size="small" aria-label="Remove line" onClick={() => onChange(rows.filter((_, j) => j !== i))}><DeleteOutline fontSize="small" /></IconButton></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </StackTable>
      <Button size="small" startIcon={<Add />} sx={{ m: 1 }} onClick={() => onChange([...rows, {}])}>Add line</Button>
    </Box>
  );
}

const opt = (o) => (Array.isArray(o) ? o : [o, label(o)]);

export function FieldInput({ f, value, onChange, error, dense }) {
  const lbl = f.l ?? humanize(f.n);
  const common = { label: lbl, required: Boolean(f.req), error: Boolean(error), helperText: error || f.help, size: 'small' };
  switch (f.t) {
    case 'textarea':
      return <TextField {...common} multiline minRows={f.rows || 3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <TextField {...common} type="number" inputProps={{ min: f.min, max: f.max, step: f.step || 'any' }} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
    case 'date':
      return <TextField {...common} type="date" InputLabelProps={{ shrink: true }} value={value ? String(value).slice(0, 10) : ''} onChange={(e) => onChange(e.target.value)} />;
    case 'datetime':
      return <TextField {...common} type="datetime-local" InputLabelProps={{ shrink: true }} value={value ? dayjs(value).format('YYYY-MM-DDTHH:mm') : ''} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <TextField {...common} select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {!f.req && <MenuItem value=""><em>None</em></MenuItem>}
          {f.o.map(opt).map(([v, l]) => <MenuItem key={v} value={v}>{l}</MenuItem>)}
        </TextField>
      );
    case 'multiselect':
      return (
        <Autocomplete multiple size="small" options={f.o.map(opt)} value={f.o.map(opt).filter(([v]) => (value || []).includes(v))} getOptionLabel={(o) => o[1]}
          isOptionEqualToValue={(a, b) => a[0] === b[0]} onChange={(e, v) => onChange(v.map((x) => x[0]))} renderInput={(p) => <TextField {...p} {...common} />} />
      );
    case 'tags':
      return <Autocomplete multiple freeSolo size="small" options={f.o || []} value={value || []} onChange={(e, v) => onChange(v)} renderInput={(p) => <TextField {...p} {...common} helperText={error || f.help || 'Type and press Enter'} />} />;
    case 'bool':
      return <FormControlLabel control={<Switch checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} color="secondary" />} label={lbl} />;
    case 'ref':
    case 'refs':
      return <RefSelect refTo={f.ref} multiple={f.t === 'refs'} value={value} onChange={onChange} params={f.params} {...common} label={lbl} helperText={common.helperText} />;
    case 'lines':
      return <Box><Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{lbl}{f.req && ' *'}</Typography><LinesEditor sub={f.sub} value={value} onChange={onChange} />{error && <Typography variant="caption" color="error">{error}</Typography>}</Box>;
    case 'photos':
    case 'file':
      return <Box><Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{lbl}</Typography><PhotoUpload value={value} onChange={onChange} multiple={f.t === 'photos'} accept={f.t === 'file' ? 'image/*,application/pdf,.xlsx,.docx' : 'image/*'} label={f.t === 'file' ? 'Attach' : 'Add photo'} /></Box>;
    case 'password':
      return <TextField {...common} type="password" autoComplete="new-password" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <TextField {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} inputProps={{ style: dense ? { minWidth: 60 } : undefined }} />;
  }
}

export function toPayload(values, fields) {
  const out = { ...values };
  for (const f of fields) {
    const v = out[f.n];
    if (f.t === 'ref') out[f.n] = idOf(v) ?? null;
    else if (f.t === 'refs') out[f.n] = (v || []).map(idOf);
    else if (f.t === 'lines') out[f.n] = (v || []).map((row) => toPayload(row, f.sub));
    else if (f.t === 'number' && v === '') out[f.n] = undefined;
    else if (f.t === 'datetime' && v) out[f.n] = new Date(v).toISOString();
    else if ((f.t === 'date' || f.t === 'select') && v === '') out[f.n] = undefined;
  }
  return out;
}

// Create / edit drawer generated from a resource config.
export function ResourceForm({ cfg, id, initial = {}, onClose, onSaved }) {
  const mobile = useMobile();
  const fields = cfg.fields.filter((f) => !(id ? f.hideOnEdit : f.hideOnCreate));
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.n, getPath(initial, f.n) ?? f.def ?? (f.t === 'lines' ? [{}] : undefined)])));
  const [errors, setErrors] = useState({});
  const save = useAction(
    (body) => (id ? api.patch(`/${cfg.api}/${id}`, body) : api.post(`/${cfg.api}`, body)),
    { success: id ? 'Saved' : `${cfg.singular || 'Record'} created`, invalidate: [cfg.api, 'ref', cfg.qk].filter(Boolean), onSuccess: (d) => { onSaved?.(d); onClose(); } },
  );
  const submit = (e) => {
    e.preventDefault();
    setErrors({});
    save.mutate(toPayload(values, fields), { onError: (x) => setErrors(Object.fromEntries(Object.entries(x.details || {}).map(([k, v]) => [k.split('.')[0], [].concat(v)[0]]))) });
  };
  return (
    <Drawer anchor="right" open onClose={onClose} PaperProps={{ sx: { width: mobile ? '100%' : 560 } }}>
      <Box component="form" onSubmit={submit} sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 3, py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box>
            <Typography variant="h6">{id ? `Edit ${cfg.singular || ''}` : cfg.createLabel || `New ${cfg.singular || 'record'}`}</Typography>
            {cfg.formHelp && <Typography variant="body2" color="text.secondary">{cfg.formHelp}</Typography>}
          </Box>
          <IconButton onClick={onClose} aria-label="Close"><Close /></IconButton>
        </Stack>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
          {save.error && <Alert severity="error" sx={{ mb: 2 }}>{save.error.message}</Alert>}
          <Grid container spacing={2}>
            {fields.map((f) => (
              <Grid item xs={12} sm={f.full || ['textarea', 'lines', 'photos', 'file', 'refs', 'tags', 'multiselect'].includes(f.t) ? 12 : 6} key={f.n}>
                <FieldInput f={f} value={values[f.n]} error={errors[f.n]} onChange={(v) => setValues((s) => ({ ...s, [f.n]: v }))} />
              </Grid>
            ))}
          </Grid>
        </Box>
        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 3, py: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Button onClick={onClose} color="inherit">Cancel</Button>
          <Button type="submit" variant="contained" color="secondary" disabled={save.isPending}>{save.isPending ? 'Saving…' : id ? 'Save changes' : 'Create'}</Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
