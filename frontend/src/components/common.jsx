import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert, Avatar, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, LinearProgress, Stack, Table, TextField, Tooltip, Typography,
} from '@mui/material';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import InboxOutlined from '@mui/icons-material/InboxOutlined';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import { label, statusColor, PRIORITY, fmtDateTime, slaInfo } from '../utils/format';
import { useNow } from '../hooks';

// Page title + plain-language explanation so a first-time user knows what the page is for.
export function PageHeader({ title, subtitle, help, actions, children }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" spacing={1.5}>
        <Box>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="h5" component="h1" sx={{ fontSize: { xs: '1.35rem', md: '1.6rem' } }}>{title}</Typography>
            {help && (
              <Tooltip title={<Typography variant="body2" sx={{ p: 0.5 }}>{help}</Typography>}>
                <IconButton size="small" aria-label="What is this page?" sx={{ color: 'grey.400', '&:hover': { color: 'primary.main', bgcolor: 'primary.soft' } }}><InfoOutlined sx={{ fontSize: 18 }} /></IconButton>
              </Tooltip>
            )}
          </Stack>
          {subtitle && <Typography color="text.secondary" component="div" sx={{ mt: 0.5, maxWidth: 820 }}>{subtitle}</Typography>}
        </Box>
        {actions && <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap className="no-print">{actions}</Stack>}
      </Stack>
      {children}
    </Box>
  );
}

// Soft badge with a status dot; colours come from the theme's Chip overrides.
const Dot = () => <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'currentColor', flexShrink: 0 }} />;

export function StatusChip({ value, size = 'small', ...rest }) {
  if (!value) return null;
  return <Chip size={size} icon={<Dot />} label={label(value)} color={statusColor(value)} variant={statusColor(value) === 'default' ? 'outlined' : 'filled'} sx={{ borderRadius: '8px' }} {...rest} />;
}

export function PriorityChip({ value, short }) {
  const p = PRIORITY[value];
  if (!p) return null;
  return <Chip size="small" label={short ? value : p.label} color={p.color} variant={value === 'P4' ? 'outlined' : 'filled'} sx={{ borderRadius: '8px' }} />;
}

export function SlaTimer({ ticket, compact }) {
  useNow(30000);
  const s = slaInfo(ticket);
  if (!s) return null;
  const color = { ok: 'success', warn: 'warning', breach: 'error', paused: 'info', met: 'success' }[s.state];
  return (
    <Box sx={{ minWidth: compact ? 120 : 180 }}>
      <Typography variant="caption" fontWeight={700} color={`${color}.dark`}>{s.label}</Typography>
      <LinearProgress variant="determinate" value={Math.min(100, s.pct * 100)} color={color} sx={{ height: compact ? 5 : 8, mt: 0.25 }} />
    </Box>
  );
}

export function EmptyState({ title = 'Nothing here yet', text, action, icon }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 6, px: 2, textAlign: 'center' }}>
      <Avatar sx={{ bgcolor: 'primary.soft', color: 'primary.main', width: 56, height: 56, boxShadow: (t) => `0 0 0 8px ${t.palette.grey[50]}` }}>{icon || <InboxOutlined />}</Avatar>
      <Typography variant="subtitle1">{title}</Typography>
      {text && <Typography color="text.secondary" sx={{ maxWidth: 420 }}>{text}</Typography>}
      {action}
    </Stack>
  );
}

export const Loading = ({ label: text = 'Loading…' }) => (
  <Stack alignItems="center" spacing={1.5} sx={{ py: 8 }}><CircularProgress color="secondary" /><Typography color="text.secondary">{text}</Typography></Stack>
);

export const ErrorState = ({ error, onRetry }) => (
  <EmptyState icon={<ErrorOutline />} title="Couldn't load this" text={error?.message || 'Something went wrong.'} action={onRetry && <Button onClick={onRetry}>Try again</Button>} />
);

// Wraps a react-query result with loading / error / empty handling.
export function QueryState({ q, empty, children }) {
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (empty && (!q.data || (Array.isArray(q.data) && !q.data.length) || (Array.isArray(q.data?.data) && !q.data.data.length))) return empty;
  return children(q.data);
}

export function SectionCard({ title, subtitle, action, children, sx, noPad, icon }) {
  return (
    <Card sx={{ height: '100%', ...sx }}>
      {(title || action) && (
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ px: 2.5, pt: 2, pb: noPad ? 1.5 : 0.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            {icon}
            <Box>
              <Typography variant="subtitle1">{title}</Typography>
              {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
            </Box>
          </Stack>
          {action}
        </Stack>
      )}
      {noPad ? children : <CardContent sx={{ pt: 1, px: 2.5, '&:last-child': { pb: 2.5 } }}>{children}</CardContent>}
    </Card>
  );
}

// On phones each row becomes a card: the first cell is its title, the others show "Column: value".
// Cells holding an input put the column name above it. Labels are copied from the header row.
const STACKED = (t) => ({
  [t.breakpoints.down('sm')]: {
    '& thead': { display: 'none' },
    '& tbody, & tr, & td': { display: 'block', width: '100%' },
    '& tbody tr': { border: `1px solid ${t.palette.divider}`, borderRadius: '12px', mb: 1.25, px: 1.5, py: 0.75, bgcolor: 'background.paper' },
    '& tbody tr:last-of-type': { mb: 0 },
    '& td': { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5, border: 'none', px: 0, py: 0.75, textAlign: 'right', minWidth: '0 !important', whiteSpace: 'normal !important' },
    '& td::before': { content: 'attr(data-label)', fontWeight: 600, fontSize: 12.5, color: 'text.secondary', textAlign: 'left', flexShrink: 0, maxWidth: '48%' },
    '& td:not([data-label])::before, & td[data-label=""]::before': { display: 'none' },
    '& td:first-of-type': { justifyContent: 'flex-start', textAlign: 'left', fontWeight: 700, fontSize: 15 },
    '& td:first-of-type::before': { display: 'none' },
    '& td:has(.MuiInputBase-root)': { flexDirection: 'column', alignItems: 'stretch', textAlign: 'left', gap: 0.5, fontWeight: 400, fontSize: 14 },
    '& td:first-of-type:has(.MuiInputBase-root)::before': { display: 'block' },
    '& td:empty': { display: 'none' },
  },
});

export function StackTable({ children, sx, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return undefined;
    const apply = () => {
      // textContent, not innerText: the header row is hidden on phones, and hidden text loses its line breaks.
      const heads = [...table.querySelectorAll('thead th')].map((th) => [...th.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' · '));
      table.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => {
        if (td.getAttribute('data-label') !== (heads[i] || '')) td.setAttribute('data-label', heads[i] || '');
      }));
    };
    apply();
    const watcher = new MutationObserver(apply);
    watcher.observe(table, { childList: true, subtree: true, characterData: true });
    return () => watcher.disconnect();
  }, []);
  return <Table ref={ref} size="small" sx={[STACKED, ...(sx ? [].concat(sx) : [])]} {...rest}>{children}</Table>;
}

export function KeyValue({ items }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, rowGap: 1, columnGap: 2 }}>
      {items.filter(Boolean).map(([k, v]) => [
        <Typography key={`${k}-k`} variant="body2" color="text.secondary">{k}</Typography>,
        <Box key={`${k}-v`} sx={{ typography: 'body2', fontWeight: 500, wordBreak: 'break-word' }}>{v ?? '—'}</Box>,
      ])}
    </Box>
  );
}

export function Timeline({ items = [] }) {
  if (!items.length) return <Typography color="text.secondary" variant="body2">No history yet.</Typography>;
  return (
    <Stack spacing={0}>
      {items.map((h, i) => (
        <Stack key={i} direction="row" spacing={1.5}>
          <Stack alignItems="center">
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', mt: 0.75, bgcolor: `${statusColor(h.status) === 'default' ? 'grey' : statusColor(h.status)}.main` }} />
            {i < items.length - 1 && <Box sx={{ width: 2, flex: 1, bgcolor: 'divider', my: 0.5 }} />}
          </Stack>
          <Box sx={{ pb: 2 }}>
            <Typography variant="body2" fontWeight={700}>{h.title || label(h.status)}</Typography>
            {h.note && <Typography variant="body2" color="text.secondary">{h.note}</Typography>}
            <Typography variant="caption" color="text.secondary">{[h.byName, fmtDateTime(h.at)].filter(Boolean).join(' · ')}</Typography>
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

// Promise-based confirm / prompt dialogs: const ok = await confirm({...}); const text = await prompt({...}).
const DialogCtx = createContext(null);
export function DialogProvider({ children }) {
  const [state, setState] = useState(null);
  const [value, setValue] = useState('');
  const open = useCallback((opts, kind) => new Promise((resolve) => { setValue(opts.initial || ''); setState({ ...opts, kind, resolve }); }), []);
  const close = (result) => { state?.resolve(result); setState(null); };
  return (
    <DialogCtx.Provider value={open}>
      {children}
      <Dialog open={Boolean(state)} onClose={() => close(state?.kind === 'prompt' ? null : false)} maxWidth="xs" fullWidth>
        {state && (
          <>
            <DialogTitle>{state.title}</DialogTitle>
            <DialogContent>
              {state.text && <Typography color="text.secondary" sx={{ mb: state.kind === 'prompt' ? 2 : 0 }}>{state.text}</Typography>}
              {state.kind === 'prompt' && <TextField autoFocus multiline minRows={2} label={state.label || 'Reason'} value={value} onChange={(e) => setValue(e.target.value)} />}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => close(state.kind === 'prompt' ? null : false)} color="inherit">Cancel</Button>
              <Button variant="contained" color={state.danger ? 'error' : 'secondary'} disabled={state.kind === 'prompt' && state.required !== false && value.trim().length < 3} onClick={() => close(state.kind === 'prompt' ? value.trim() : true)}>
                {state.confirmText || (state.kind === 'prompt' ? 'Submit' : 'Confirm')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </DialogCtx.Provider>
  );
}
export function useDialogs() {
  const open = useContext(DialogCtx);
  return { confirm: (o) => open(o, 'confirm'), prompt: (o) => open(o, 'prompt') };
}

export const Hint = ({ children, severity = 'info', sx }) => <Alert severity={severity} sx={{ borderRadius: 2, ...sx }}>{children}</Alert>;
