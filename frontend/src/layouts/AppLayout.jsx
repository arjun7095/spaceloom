import { memo, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  Alert, AppBar, Autocomplete, Avatar, Badge, BottomNavigation, BottomNavigationAction, Box, Button, Chip, Collapse, Dialog, DialogActions, DialogContent, Divider, Drawer,
  IconButton, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Popover, Stack, TextField, Toolbar, Tooltip, Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import HelpOutlineOutlined from '@mui/icons-material/HelpOutlineOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ApartmentOutlined from '@mui/icons-material/ApartmentOutlined';
import ArrowForward from '@mui/icons-material/ArrowForward';
import QrCodeScannerOutlined from '@mui/icons-material/QrCodeScannerOutlined';
import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import { alpha } from '@mui/material/styles';
import { create } from 'zustand';
import { BRAND, GREY, GRADIENT } from '../theme';
import { useAuth, can } from '../store/auth';
import { api, http, uploadFiles } from '../api/client';
import { clearQueue, count, flush, onQueueChange } from '../offline/queue';
import { disablePush } from '../offline/push';
import { QrScanDialog, scanPath } from '../components/QrScanner';
import { Loading, useDialogs } from '../components/common';
import { connectSocket, disconnectSocket, joinProperty } from '../api/socket';
import { bottomTabs, visibleNav } from '../config/nav';
import { WELCOME } from '../config/guide';
import { useDebounced, useMobile } from '../hooks';
import { fromNow } from '../utils/format';

export function Logo({ light, small, compact }) {
  return (
    <Stack direction="row" spacing={1.25} alignItems="center">
      <Box component="img" src="/favicon.svg" alt="" sx={{ width: small ? 30 : 36, height: small ? 30 : 36, borderRadius: '10px', boxShadow: light ? 'none' : `0 4px 12px ${alpha(BRAND[600], 0.3)}` }} />
      <Box sx={{ display: compact ? { xs: 'none', sm: 'block' } : 'block' }}>
        <Typography sx={{ fontFamily: (t) => t.typography.h6.fontFamily, fontWeight: 800, fontSize: small ? 16 : 18, lineHeight: 1.1, letterSpacing: -0.3, color: light ? '#fff' : 'text.primary' }}>PrimeSpace</Typography>
        <Typography sx={{ fontSize: 10.5, letterSpacing: 1.8, fontWeight: 700, color: light ? BRAND[200] : BRAND[600] }}>IPFM</Typography>
      </Box>
    </Stack>
  );
}

const initials = (name = '') => name.split(' ').map((x) => x[0]).slice(0, 2).join('');

// Shell UI state lives outside AppLayout, so opening the menu or a dialog re-renders only that piece, never the page.
const useShell = create(() => ({ menu: false, scan: false, search: false, online: navigator.onLine, pending: 0, navigating: false }));
const openShell = (key) => useShell.setState({ [key]: true });
const closeShell = (key) => useShell.setState({ [key]: false });
const closeMenu = () => closeShell('menu');

const ITEM_SX = {
  borderRadius: '10px', mb: 0.25, px: 1.25, color: GREY[700],
  '& .MuiListItemIcon-root': { color: GREY[500] },
  '&:hover': { bgcolor: GREY[100], color: GREY[900] },
  '&.active': { bgcolor: BRAND[50], color: BRAND[700], '& .MuiListItemIcon-root': { color: BRAND[600] }, '& .MuiListItemText-primary': { fontWeight: 650 } },
};
const DRAWER_ITEM_SX = { ...ITEM_SX, py: 1.1, minHeight: 44 };
const SIDEBAR_ITEM_SX = { ...ITEM_SX, py: 0.75 };
const HEADER_SX = { borderRadius: '8px', py: 0.25, px: 1.25, '&:hover': { bgcolor: 'transparent', '& *': { color: GREY[600] } } };
const GROUP_LABEL = { fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase', color: GREY[400] };
const ITEM_LABEL = { fontSize: 14, fontWeight: 500 };
const END_MATCH = ['/', '/inventory', '/tickets', '/reports'];

// drawer = the phone/tablet menu: bigger tap targets, fewer groups open, and links replace the menu's history entry.
const SideNav = memo(function SideNav({ onNavigate, drawer }) {
  const user = useAuth((s) => s.user);
  const { pathname, search } = useLocation();
  const groups = useMemo(() => visibleNav(user), [user]);
  const activeGroup = groups.find((g) => g.items.some((it) => it.to !== '/' && pathname.startsWith(it.to.split('?')[0])))?.label;
  const [closed, setClosed] = useState(() => new Set(groups.filter((g, i) => i > (drawer ? 1 : 3) && g.label !== activeGroup).map((g) => g.label)));
  // Reaching a page some other way (Today, a link) opens its group, so the menu always shows where you are.
  useEffect(() => {
    if (activeGroup) setClosed((s) => (s.has(activeGroup) ? new Set([...s].filter((l) => l !== activeGroup)) : s));
  }, [activeGroup]);
  const toggle = (l) => setClosed((s) => { const n = new Set(s); n.has(l) ? n.delete(l) : n.add(l); return n; });
  // Tapping the page you are already on just closes the menu.
  const go = (to) => (e) => {
    if (`${pathname}${search}` === to) { if (drawer) e.preventDefault(); } else useShell.setState({ navigating: true });
    onNavigate?.();
  };
  const itemSx = drawer ? DRAWER_ITEM_SX : SIDEBAR_ITEM_SX;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ px: 2.5, py: 2.25 }}><Logo /></Box>
      <Box className="ps-nav-scroll" sx={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', px: 1.5, pb: 2 }}>
        {groups.map((g) => (
          <Box key={g.label} sx={{ mb: 0.75 }}>
            <ListItemButton onClick={() => toggle(g.label)} aria-expanded={!closed.has(g.label)} sx={{ ...HEADER_SX, minHeight: drawer ? 40 : undefined }}>
              <ListItemText primary={g.label} primaryTypographyProps={GROUP_LABEL} />
              {closed.has(g.label) ? <ExpandMore sx={{ fontSize: 18, color: GREY[400] }} /> : <ExpandLess sx={{ fontSize: 18, color: GREY[400] }} />}
            </ListItemButton>
            <Collapse in={!closed.has(g.label)} unmountOnExit>
              <List dense disablePadding>
                {g.items.map((it) => (
                  <ListItemButton key={it.to} component={NavLink} to={it.to} end={END_MATCH.includes(it.to)} replace={drawer} onClick={go(it.to)} sx={itemSx}>
                    <ListItemIcon sx={{ minWidth: 34 }}><it.icon sx={{ fontSize: 20 }} /></ListItemIcon>
                    <ListItemText primary={it.label} primaryTypographyProps={ITEM_LABEL} />
                  </ListItemButton>
                ))}
              </List>
            </Collapse>
          </Box>
        ))}
      </Box>
      <Box sx={{ p: 1.5, pb: drawer ? 'calc(12px + env(safe-area-inset-bottom))' : 1.5 }}>
        <ListItemButton component={NavLink} to="/help" replace={drawer} onClick={go('/help')} sx={{ borderRadius: '14px', p: 1.5, gap: 1.5, alignItems: 'center', background: `linear-gradient(135deg, ${BRAND[50]} 0%, #F5F3FF 100%)`, border: `1px solid ${BRAND[100]}`, '&:hover': { borderColor: BRAND[200], background: `linear-gradient(135deg, ${BRAND[100]} 0%, #EDE9FE 100%)` } }}>
          <Avatar sx={{ width: 34, height: 34, background: GRADIENT, boxShadow: `0 4px 10px ${alpha(BRAND[600], 0.3)}` }}><HelpOutlineOutlined sx={{ fontSize: 19 }} /></Avatar>
          <ListItemText primary="Help center" secondary="Guides, glossary, demo script" primaryTypographyProps={{ fontSize: 14, fontWeight: 700, color: GREY[900] }} secondaryTypographyProps={{ fontSize: 11.5, color: GREY[600] }} />
        </ListItemButton>
      </Box>
    </Box>
  );
});

// Drag the menu left to close it. Moves the panel directly (no React renders while the finger moves).
function useSwipeToClose(onClose) {
  const drag = useRef(null);
  return {
    onTouchStart: (e) => { drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, horizontal: null }; },
    onTouchMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.touches[0].clientX - d.x;
      const dy = e.touches[0].clientY - d.y;
      if (d.horizontal === null && Math.abs(dx) + Math.abs(dy) > 8) d.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!d.horizontal) return;
      d.dx = Math.min(0, dx);
      Object.assign(e.currentTarget.style, { transition: 'none', transform: `translateX(${d.dx}px)` });
    },
    onTouchEnd: (e) => {
      const d = drag.current;
      drag.current = null;
      if (!d?.horizontal) return;
      const paper = e.currentTarget;
      if (d.dx < -64) {
        paper.style.transition = '';
        onClose();
      } else {
        Object.assign(paper.style, { transition: 'transform .2s ease-out', transform: 'none' });
      }
    },
  };
}

// Phone and tablet menu: built once and kept, swipe left to close, and the phone's Back button closes it.
function MobileNav() {
  const open = useShell((s) => s.menu);
  const swipe = useSwipeToClose(() => closeShell('menu'));
  useEffect(() => {
    if (!open) return undefined;
    window.history.pushState({ ...window.history.state, psMenu: true }, '');
    const onBack = () => closeShell('menu');
    window.addEventListener('popstate', onBack);
    // Show the current page in the middle of the menu.
    requestAnimationFrame(() => {
      const list = document.querySelector('.ps-mobile-nav .ps-nav-scroll');
      const active = list?.querySelector('a.active');
      if (active) list.scrollTop += active.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - active.offsetHeight) / 2;
    });
    return () => {
      window.removeEventListener('popstate', onBack);
      // Closed by a tap or the backdrop: drop the extra history entry. A menu link already replaced it.
      if (window.history.state?.psMenu) window.history.back();
    };
  }, [open]);
  return (
    <Drawer open={open} onClose={() => closeShell('menu')} ModalProps={{ keepMounted: true }} PaperProps={{ className: 'ps-mobile-nav', sx: { width: 'min(300px, 86vw)', bgcolor: '#fff', touchAction: 'pan-y' }, ...swipe }} className="no-print">
      <SideNav drawer onNavigate={closeMenu} />
    </Drawer>
  );
}

function GlobalSearch({ onDone, autoFocus }) {
  const navigate = useNavigate();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  const q = useDebounced(input, 300);
  const { data = [], isFetching } = useQuery({ queryKey: ['search', q], queryFn: () => api.get('/search', { q }), enabled: q.length >= 2 });
  useEffect(() => {
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <Autocomplete
      size="small" sx={{ width: '100%' }} options={q.length >= 2 ? data : []} loading={isFetching} filterOptions={(x) => x} groupBy={(o) => o.type}
      forcePopupIcon={false} getOptionLabel={(o) => o.title || ''} inputValue={input} onInputChange={(e, v, r) => r !== 'reset' && setInput(v)}
      onChange={(e, v) => { if (v) { navigate(v.link); setInput(''); onDone?.(); } }} noOptionsText={q.length < 2 ? 'Type at least 2 letters' : 'No matches'}
      renderOption={(p, o) => <li {...p} key={o.link}><Box><Typography variant="body2" fontWeight={600}>{o.title}</Typography><Typography variant="caption" color="text.secondary" noWrap>{o.subtitle}</Typography></Box></li>}
      renderInput={(p) => (
        <TextField {...p} inputRef={ref} autoFocus={autoFocus} placeholder="Search tickets, assets, people, items…" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          InputProps={{
            ...p.InputProps,
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: GREY[400] }} /></InputAdornment>,
            endAdornment: <>{!input && !focused && !autoFocus && <Box component="kbd" sx={{ mr: 0.5, px: 0.75, py: 0.1, fontSize: 11, fontFamily: 'inherit', fontWeight: 600, color: GREY[500], bgcolor: '#fff', border: `1px solid ${GREY[200]}`, borderRadius: '6px', whiteSpace: 'nowrap' }}>Ctrl K</Box>}{p.InputProps.endAdornment}</>,
            sx: { bgcolor: GREY[100], '& fieldset': { border: 'none' }, '&.Mui-focused': { bgcolor: '#fff' } },
          }} />
      )}
    />
  );
}

function Notifications() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [anchor, setAnchor] = useState(null);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => api.list('/notifications', { limit: 20 }), refetchInterval: 120000 });
  const unread = data?.meta?.unread || 0;
  const open = async (n) => {
    setAnchor(null);
    if (!n.readAt) await api.patch(`/notifications/${n._id}/read`);
    qc.invalidateQueries({ queryKey: ['notifications'] });
    if (n.link) navigate(n.link);
  };
  return (
    <>
      <Tooltip title="Notifications"><IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Notifications"><Badge badgeContent={unread} color="error" max={99}><NotificationsNoneOutlined /></Badge></IconButton></Tooltip>
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }} PaperProps={{ sx: { width: 380, maxWidth: '95vw' } }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle1">Notifications</Typography>
          {unread > 0 && <Button size="small" onClick={async () => { await api.post('/notifications/read-all'); qc.invalidateQueries({ queryKey: ['notifications'] }); }}>Mark all read</Button>}
        </Stack>
        <Divider />
        <List dense sx={{ maxHeight: 440, overflowY: 'auto', py: 0 }}>
          {(data?.data || []).map((n) => (
            <ListItemButton key={n._id} onClick={() => open(n)} sx={{ alignItems: 'flex-start', bgcolor: n.readAt ? undefined : alpha(BRAND[600], 0.04), borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: n.readAt ? 'transparent' : n.type?.startsWith('sla') ? 'warning.main' : 'secondary.main', mt: 0.9, mr: 1.5, flexShrink: 0 }} />
              <ListItemText primary={n.title} secondary={<>{n.body && <span style={{ display: 'block' }}>{n.body}</span>}{fromNow(n.createdAt)}</>} primaryTypographyProps={{ fontWeight: n.readAt ? 500 : 700, fontSize: 14 }} secondaryTypographyProps={{ fontSize: 12 }} />
            </ListItemButton>
          ))}
          {!data?.data?.length && <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>You are all caught up.</Typography>}
        </List>
      </Popover>
    </>
  );
}

function PropertySwitcher() {
  const { user, propertyId, setProperty } = useAuth();
  const qc = useQueryClient();
  const compact = useMobile();
  const props = user?.properties || [];
  const current = props.find((p) => p._id === propertyId) || props[0];
  const [anchor, setAnchor] = useState(null);
  if (!current || (compact && props.length < 2)) return null;
  return (
    <>
      {compact ? (
        <Tooltip title={`Property: ${current.name}`}><IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label={`Switch property (now ${current.name})`}><ApartmentOutlined sx={{ color: BRAND[600] }} /></IconButton></Tooltip>
      ) : (
        <Button variant="outlined" startIcon={<ApartmentOutlined sx={{ color: BRAND[600] }} />} endIcon={props.length > 1 ? <ExpandMore sx={{ color: GREY[400] }} /> : null} onClick={(e) => props.length > 1 && setAnchor(e.currentTarget)} sx={{ cursor: props.length > 1 ? 'pointer' : 'default', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {current.name}
        </Button>
      )}
      <Menu open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}>
        {props.map((p) => <MenuItem key={p._id} selected={p._id === current._id} onClick={() => { setProperty(p._id); joinProperty(p._id); qc.invalidateQueries(); setAnchor(null); }}>{p.name}<Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{p.city}</Typography></MenuItem>)}
      </Menu>
    </>
  );
}

// Replays offline actions when the connection returns and keeps a field user's jobs cached for offline use.
// Renders nothing; online state and the queue size go to the shell store for the chip and the banner.
function OfflineSync() {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const user = useAuth((s) => s.user);
  const layout = user?.layout;
  const online = useShell((s) => s.online);
  useEffect(() => {
    const run = async () => {
      const r = await flush({ send: (method, url, data) => http.request({ method, url, data }), upload: uploadFiles });
      if (r.sent) {
        enqueueSnackbar(`Back online — synced ${r.sent} offline action${r.sent > 1 ? 's' : ''}`, { variant: 'success' });
        qc.invalidateQueries();
      }
      r.failed.forEach((f) => enqueueSnackbar(`Could not sync "${f.label}": ${f.message}`, { variant: 'warning', autoHideDuration: 9000 }));
    };
    const setPending = (pending) => useShell.setState({ pending });
    const up = () => { useShell.setState({ online: true }); run(); };
    const down = () => useShell.setState({ online: false });
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const unsub = onQueueChange(setPending);
    count().then(setPending);
    run();
    const timer = setInterval(run, 30000);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); unsub(); clearInterval(timer); };
  }, [qc, enqueueSnackbar]);
  useEffect(() => {
    if (layout !== 'field' || !online || !navigator.serviceWorker?.controller) return undefined;
    // Only what this role may open, so the cache holds exactly the screens the user can use offline.
    const warm = async () => {
      try {
        if (can(user, 'workorder:read') || can(user, 'ticket:read')) await api.get('/dashboard/today').catch(() => {});
        if (user.employeeId) await api.get('/attendance/my').catch(() => {});
        if (can(user, 'ticket:read')) {
          const open = await api.list('/tickets', { view: 'open', limit: 25 }).catch(() => ({ data: [] }));
          for (const t of open.data) await api.get(`/tickets/${t._id}`).catch(() => {});
        }
        if (can(user, 'workorder:read')) {
          const mine = await api.list('/work-orders', { view: 'my', limit: 50, sort: 'plannedDate' });
          for (const w of mine.data.slice(0, 25)) await api.get(`/work-orders/${w._id}`).catch(() => {});
        }
      } catch { /* best effort */ }
    };
    warm();
    const timer = setInterval(warm, 10 * 60000);
    return () => clearInterval(timer);
  }, [layout, online]);
  return null;
}

function SyncStatus() {
  const online = useShell((s) => s.online);
  const pending = useShell((s) => s.pending);
  if (online && !pending) return null;
  return (
    <Tooltip title={online ? 'Sending the actions you took offline' : 'You are offline. Keep working — your actions are saved on this device and sync later.'}>
      <Chip size="small" icon={online ? <SyncOutlined /> : <CloudOffOutlined />} color={online ? 'info' : 'warning'} label={online ? `Syncing ${pending}…` : pending ? `Offline · ${pending} to sync` : 'Offline'} sx={{ '& .MuiChip-label': { display: { xs: 'none', sm: 'block' } } }} />
    </Tooltip>
  );
}

function OfflineBanner() {
  const online = useShell((s) => s.online);
  if (online) return null;
  return (
    <Alert severity="warning" icon={<CloudOffOutlined />} sx={{ borderRadius: 0 }} className="no-print">
      You are offline. You can keep working — check-ins, checklists and job updates are saved on this device and sync automatically when you are back online.
    </Alert>
  );
}

function UserMenu() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const { confirm } = useDialogs();
  const [anchor, setAnchor] = useState(null);
  const signOut = async () => {
    setAnchor(null);
    const waiting = await count();
    if (waiting && !(await confirm({ title: 'Sign out with unsynced work?', text: `${waiting} action(s) you took offline have not been sent yet. Signing out deletes them from this device.`, danger: true, confirmText: 'Sign out anyway' }))) return;
    await clearQueue();
    await disablePush().catch(() => {});
    if ('caches' in window) await Promise.all(['api', 'files'].map((k) => caches.delete(k)));
    try { await http.post('/auth/logout'); } catch { /* ignore */ }
    disconnectSocket();
    qc.clear();
    logout();
    navigate('/login');
  };
  return (
    <>
      <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Account" sx={{ p: 0.5 }}><Avatar sx={{ width: 34, height: 34, background: GRADIENT, fontSize: 13.5 }}>{initials(user?.name)}</Avatar></IconButton>
      <Menu open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)} PaperProps={{ sx: { minWidth: 260 } }} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 1.5, py: 1.25 }}>
          <Avatar sx={{ width: 40, height: 40, background: GRADIENT, fontSize: 15 }}>{initials(user?.name)}</Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography fontWeight={700} noWrap>{user?.name}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>{user?.roles?.map((r) => r.name).join(', ')}</Typography>
          </Box>
        </Stack>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem onClick={() => { setAnchor(null); navigate('/profile'); }}>My profile & password</MenuItem>
        <MenuItem onClick={() => { setAnchor(null); navigate('/help'); }}>Help center</MenuItem>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem onClick={signOut} sx={{ color: 'error.main' }}>Sign out</MenuItem>
      </Menu>
    </>
  );
}

function WelcomeDialog() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const key = `ps-welcome-${user?._id}`;
  const [open, setOpen] = useState(() => !localStorage.getItem(key));
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('ps-welcome', show);
    return () => window.removeEventListener('ps-welcome', show);
  }, []);
  const role = user?.roles?.map((r) => r.key).find((k) => WELCOME[k]);
  const w = WELCOME[role];
  if (!w) return null;
  const close = () => { localStorage.setItem(key, '1'); setOpen(false); };
  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <Box sx={{ position: 'relative', overflow: 'hidden', background: GRADIENT, color: '#fff', px: 3, pt: 3.5, pb: 3 }}>
        <Box aria-hidden sx={{ position: 'absolute', right: -40, top: -60, width: 200, height: 200, borderRadius: '50%', bgcolor: alpha('#fff', 0.08) }} />
        <Box aria-hidden sx={{ position: 'absolute', right: 60, bottom: -70, width: 140, height: 140, borderRadius: '50%', bgcolor: alpha('#fff', 0.06) }} />
        <Typography variant="overline" sx={{ color: BRAND[200], position: 'relative' }}>Welcome, {user.name.split(' ')[0]}</Typography>
        <Typography variant="h5" sx={{ position: 'relative' }}>{w.title}</Typography>
        <Typography sx={{ mt: 1, color: alpha('#fff', 0.82), position: 'relative' }}>{w.intro}</Typography>
      </Box>
      <DialogContent sx={{ pt: '20px !important' }}>
        <Stack spacing={1.25}>
          {w.steps.map(([title, text, to], i) => (
            <Paper key={title} variant="outlined" onClick={() => { close(); navigate(to); }}
              sx={{ p: 1.5, display: 'flex', gap: 1.5, alignItems: 'center', cursor: 'pointer', borderRadius: '14px', transition: 'all .15s', '&:hover': { borderColor: BRAND[200], bgcolor: BRAND[50], '& .go': { color: BRAND[600], transform: 'translateX(2px)' } } }}>
              <Avatar sx={{ bgcolor: BRAND[50], color: BRAND[700], border: `1px solid ${BRAND[100]}`, fontWeight: 800, width: 36, height: 36, fontSize: 15 }}>{i + 1}</Avatar>
              <Box sx={{ flex: 1 }}><Typography fontWeight={700}>{title}</Typography><Typography variant="body2" color="text.secondary">{text}</Typography></Box>
              <ArrowForward className="go" aria-label={`Go to ${title}`} sx={{ color: GREY[400], transition: 'all .15s' }} />
            </Paper>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>Reopen this any time from Help center.</Typography>
        <Button variant="contained" color="secondary" onClick={close}>Got it</Button>
      </DialogActions>
    </Dialog>
  );
}

function useLiveUpdates() {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const propertyId = useAuth((s) => s.propertyId);
  useEffect(() => {
    const s = connectSocket();
    const inv = (...keys) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    const handlers = {
      'ticket:created': () => inv('tickets', 'today', 'ticket-dashboard'),
      'ticket:updated': () => inv('tickets', 'today', 'work-orders', 'ticket-dashboard'),
      'ticket:sla-warning': () => inv('tickets', 'today'),
      'ticket:sla-breached': () => inv('tickets', 'today'),
      'wo:updated': () => inv('work-orders', 'today'),
      'wo:assigned': () => inv('work-orders', 'today', 'tickets'),
      'kpi:updated': () => inv('kpis', 'ticket-dashboard', 'attendance'),
      'stock:alert': () => inv('stock', 'today'),
      'attendance:exception': () => inv('attendance'),
      'notification:new': (n) => {
        inv('notifications', 'approvals');
        enqueueSnackbar(n.title, { variant: n.type?.startsWith('sla') ? 'warning' : 'info' });
      },
    };
    Object.entries(handlers).forEach(([e, h]) => s.on(e, h));
    return () => Object.entries(handlers).forEach(([e, h]) => s.off(e, h));
  }, [qc, enqueueSnackbar]);
  useEffect(() => joinProperty(propertyId), [propertyId]);
}

function TopBar({ field, mobile }) {
  const navigate = useNavigate();
  return (
    // Solid on phones: a blurred, see-through bar costs every scroll frame on mid-range phones.
    <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: '1px solid', borderColor: 'divider', bgcolor: { xs: '#fff', md: alpha('#fff', 0.85) }, backdropFilter: { md: 'saturate(180%) blur(12px)' } }} className="no-print">
      <Toolbar sx={{ gap: 0.75, minHeight: { xs: 60, md: 64 }, px: { md: 3 } }}>
        {(field || mobile) && <IconButton edge="start" onClick={() => openShell('menu')} aria-label="Open menu"><MenuIcon /></IconButton>}
        {(field || mobile) && <Logo small compact={!field} />}
        {!field && <Box sx={{ display: { xs: 'none', sm: 'block' }, flex: { sm: 1, md: 'none' }, width: { md: 400 }, maxWidth: 420, minWidth: 0, ml: { sm: 2, md: 0 } }}><GlobalSearch /></Box>}
        <Box sx={{ flex: 1 }} />
        {!field && <Tooltip title="Search"><IconButton onClick={() => openShell('search')} aria-label="Search" sx={{ display: { sm: 'none' } }}><SearchIcon /></IconButton></Tooltip>}
        <SyncStatus />
        {!field && <PropertySwitcher />}
        <Tooltip title="Scan a QR code"><IconButton onClick={() => openShell('scan')} aria-label="Scan a QR code"><QrCodeScannerOutlined /></IconButton></Tooltip>
        <Tooltip title="Help center"><IconButton onClick={() => navigate('/help')} aria-label="Help" sx={{ display: field ? undefined : { xs: 'none', sm: 'inline-flex' } }}><HelpOutlineOutlined /></IconButton></Tooltip>
        <Notifications />
        <UserMenu />
      </Toolbar>
    </AppBar>
  );
}

function ShellDialogs() {
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const scan = useShell((s) => s.scan);
  const searching = useShell((s) => s.search);
  return (
    <>
      <QrScanDialog open={scan} onClose={() => closeShell('scan')} onTarget={(t) => navigate(scanPath(t, can(user, 'asset:read')))} />
      <Dialog open={searching} onClose={() => closeShell('search')} fullScreen PaperProps={{ sx: { borderRadius: 0 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ flex: 1 }}><GlobalSearch autoFocus onDone={() => closeShell('search')} /></Box>
          <Button onClick={() => closeShell('search')}>Cancel</Button>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>Search tickets by number or text, assets by code, people by name and items by code.</Typography>
      </Dialog>
    </>
  );
}

const TAB_SX = {
  minWidth: 0, px: 0.5, color: GREY[500], gap: 0.25,
  '& .MuiSvgIcon-root': { boxSizing: 'content-box', px: 2, py: 0.4, borderRadius: 999, transition: 'background-color .2s' },
  '&.Mui-selected': { color: BRAND[700], '& .MuiSvgIcon-root': { bgcolor: BRAND[50] } },
  '& .MuiBottomNavigationAction-label': { fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', '&.Mui-selected': { fontSize: 11.5 } },
};

function BottomTabs({ user }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const tabs = bottomTabs(user);
  const exact = tabs.findIndex((t) => `${pathname}${search}` === t.to);
  const current = exact >= 0 ? exact : tabs.findIndex((t) => t.to !== '/' && pathname.startsWith(t.to.split('?')[0]));
  return (
    <Paper elevation={0} square sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100, pb: 'env(safe-area-inset-bottom)', bgcolor: '#fff', borderTop: `1px solid ${GREY[200]}`, boxShadow: '0 -4px 16px rgba(16,24,40,.05)' }} className="no-print">
      <BottomNavigation showLabels value={current} sx={{ height: 68, bgcolor: 'transparent' }}>
        {tabs.map((t) => (
          <BottomNavigationAction key={t.to} label={t.label} icon={<t.icon />} onClick={() => { if (t.to === '#menu') return openShell('menu'); if (`${pathname}${search}` !== t.to) useShell.setState({ navigating: true }); return navigate(t.to); }} sx={TAB_SX} />
        ))}
      </BottomNavigation>
    </Paper>
  );
}

const NAV_BAR_SX = {
  position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 1400, overflow: 'hidden', pointerEvents: 'none',
  '&::before': { content: '""', position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%', borderRadius: 3, bgcolor: 'secondary.main', willChange: 'transform', animation: 'ps-nav-bar 1s ease-in-out infinite' },
  '@keyframes ps-nav-bar': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(250%)' } },
};

// Thin bar at the top from a menu or tab tap until the next page is on screen (navigations keep the old page meanwhile).
function NavProgress() {
  const busy = useShell((s) => s.navigating);
  const { key } = useLocation();
  useEffect(() => { useShell.setState({ navigating: false }); }, [key]);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setTimeout(() => useShell.setState({ navigating: false }), 10000);
    return () => clearTimeout(t);
  }, [busy]);
  // Animates transform only, so it runs on the compositor and never slows the page that is being built.
  return busy ? <Box role="progressbar" aria-label="Opening page" sx={NAV_BAR_SX} /> : null;
}

const SIDEBAR_PAPER = { sx: { width: 272, bgcolor: '#fff', borderRight: `1px solid ${GREY[200]}` } };

export default function AppLayout() {
  const user = useAuth((s) => s.user);
  const mobile = useMobile();
  const field = user?.layout === 'field';
  useLiveUpdates();
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <OfflineSync />
      <NavProgress />
      {!field && !mobile && <Drawer variant="permanent" PaperProps={SIDEBAR_PAPER} sx={{ width: 272, flexShrink: 0 }} className="no-print"><SideNav /></Drawer>}
      {(field || mobile) && <MobileNav />}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar field={field} mobile={mobile} />
        <OfflineBanner />
        <ShellDialogs />
        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 3 }, pb: field ? 11 : 4, width: '100%', maxWidth: field ? 820 : 1600, mx: 'auto' }}>
          {/* Pages load on demand; only this area waits, so the menu and top bar never freeze. */}
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </Box>
        {field && <BottomTabs user={user} />}
      </Box>
      <WelcomeDialog />
    </Box>
  );
}
