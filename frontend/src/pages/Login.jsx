import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert, Avatar, Box, Button, Card, CardActionArea, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid, IconButton,
  InputAdornment, Link, Stack, TextField, Typography,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import SupportAgentOutlined from '@mui/icons-material/SupportAgentOutlined';
import EngineeringOutlined from '@mui/icons-material/EngineeringOutlined';
import FingerprintOutlined from '@mui/icons-material/FingerprintOutlined';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import ManageAccountsOutlined from '@mui/icons-material/ManageAccountsOutlined';
import SupervisorAccountOutlined from '@mui/icons-material/SupervisorAccountOutlined';
import HeadsetMicOutlined from '@mui/icons-material/HeadsetMicOutlined';
import HandymanOutlined from '@mui/icons-material/HandymanOutlined';
import StorefrontOutlined from '@mui/icons-material/StorefrontOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import HealthAndSafetyOutlined from '@mui/icons-material/HealthAndSafetyOutlined';
import BusinessCenterOutlined from '@mui/icons-material/BusinessCenterOutlined';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import HandshakeOutlined from '@mui/icons-material/HandshakeOutlined';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import PolicyOutlined from '@mui/icons-material/PolicyOutlined';
import axios from 'axios';
import { useAuth } from '../store/auth';
import { DEMO_PASSWORD, DEMO_ROLES } from '../config/guide';
import { Logo } from '../layouts/AppLayout';
import { alpha } from '@mui/material/styles';
import { BRAND, GRADIENT, GREY, SHADOW, VIOLET } from '../theme';

const ROLE_ICON = { manager: ManageAccountsOutlined, supervisor: SupervisorAccountOutlined, helpdesk: HeadsetMicOutlined, technician: HandymanOutlined, tenant: StorefrontOutlined, store: Inventory2Outlined, hse: HealthAndSafetyOutlined, owner: BusinessCenterOutlined, procurement: ShoppingCartOutlined, vendor: HandshakeOutlined, admin: AdminPanelSettingsOutlined, auditor: PolicyOutlined };
const ROLE_TINT = [BRAND[600], '#0086C9', VIOLET, '#DC6803', '#079455', '#E31B54'];

const FEATURES = [
  [SupportAgentOutlined, 'Helpdesk with live SLA clocks', 'Every complaint has an owner, a deadline and automatic escalation.'],
  [EngineeringOutlined, 'Assets, PPM and work orders', 'Checklists, photos and signatures from a phone.'],
  [FingerprintOutlined, 'Attendance with geo-fencing', 'Rosters, check-ins, exceptions and payroll export.'],
  [AssessmentOutlined, 'KPI dashboard and client reports', 'Target → actual → variance, signed off by the PM.'],
];

const post = (url, body) => axios.post(`/api/v1${url}`, body, { withCredentials: true }).then((r) => r.data.data).catch((e) => { throw new Error(e.response?.data?.error?.message || 'Cannot reach the server'); });

function ForgotPassword({ open, onClose }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ identifier: '', otp: '', newPassword: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (e) { setMsg({ severity: 'error', text: e.message }); } finally { setBusy(false); }
  };
  const send = () => run(async () => {
    const r = await post('/auth/forgot-password', { identifier: form.identifier });
    setMsg({ severity: 'info', text: r.devOtp ? `${r.message} (Demo server: your code is ${r.devOtp})` : r.message });
    setStep(1);
  });
  const reset = () => run(async () => {
    await post('/auth/reset-password', form);
    setStep(2);
    setMsg({ severity: 'success', text: 'Password updated. You can sign in now.' });
  });
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Reset your password</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {msg && <Alert severity={msg.severity}>{msg.text}</Alert>}
          {step < 2 && <TextField label="Email or mobile" value={form.identifier} disabled={step > 0} onChange={(e) => setForm({ ...form, identifier: e.target.value })} />}
          {step === 1 && (
            <>
              <TextField label="6-digit code" value={form.otp} inputProps={{ maxLength: 6, inputMode: 'numeric' }} onChange={(e) => setForm({ ...form, otp: e.target.value })} />
              <TextField label="New password" type="password" value={form.newPassword} helperText="8+ characters with upper and lower case, a number and a symbol" onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>{step === 2 ? 'Close' : 'Cancel'}</Button>
        {step === 0 && <Button variant="contained" color="secondary" disabled={busy || form.identifier.length < 3} onClick={send}>Send code</Button>}
        {step === 1 && <Button variant="contained" color="secondary" disabled={busy} onClick={reset}>Set new password</Button>}
      </DialogActions>
    </Dialog>
  );
}

export default function Login() {
  const { user, token, setSession } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [forgot, setForgot] = useState(false);
  if (user && token) return <Navigate to="/" replace />;

  const signIn = async (id, pw, key = 'form') => {
    setBusy(key);
    setError('');
    try {
      const data = await post('/auth/login', { identifier: id, password: pw });
      setSession(data);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  };

  return (
    <Grid container sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Grid item xs={12} md={5} sx={{ position: 'relative', overflow: 'hidden', background: GRADIENT, color: '#fff', p: { xs: 3, md: 6 }, display: 'flex', flexDirection: 'column' }}>
        {/* Soft light orbs and a faint grid give the panel depth without competing with the text. */}
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, backgroundImage: `linear-gradient(${alpha('#fff', 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${alpha('#fff', 0.05)} 1px, transparent 1px)`, backgroundSize: '40px 40px', maskImage: 'radial-gradient(ellipse at 30% 40%, #000 20%, transparent 75%)' }} />
        <Box aria-hidden sx={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', right: -160, bottom: -140, background: `radial-gradient(circle, ${alpha('#A78BFA', 0.55)} 0%, transparent 70%)` }} />
        <Box aria-hidden sx={{ position: 'absolute', width: 320, height: 320, borderRadius: '50%', left: -120, top: -100, background: `radial-gradient(circle, ${alpha(BRAND[400], 0.45)} 0%, transparent 70%)` }} />
        <Box sx={{ position: 'relative' }}><Logo light /></Box>
        <Box sx={{ position: 'relative', my: { xs: 3, md: 'auto' } }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.5, borderRadius: 99, bgcolor: alpha('#fff', 0.1), border: `1px solid ${alpha('#fff', 0.18)}`, fontSize: 12.5, fontWeight: 600, color: BRAND[100] }}>
            <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#A5F3C4' }} /> Shaping modern spaces
          </Box>
          <Typography sx={{ fontFamily: (t) => t.typography.h4.fontFamily, fontSize: { xs: 30, md: 44 }, fontWeight: 800, lineHeight: 1.1, letterSpacing: -1.2, mt: 2.5, mb: 2 }}>
            Run every building <Box component="span" sx={{ background: 'linear-gradient(90deg, #C7D2FE, #F0ABFC)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>from one place.</Box>
          </Typography>
          <Typography sx={{ color: alpha('#fff', 0.78), mb: 4, maxWidth: 460, display: { xs: 'none', sm: 'block' } }}>Manpower, attendance, maintenance, helpdesk, stores, vendors, safety and client reporting — with an owner and a deadline on every task.</Typography>
          <Stack spacing={1.5} sx={{ display: { xs: 'none', md: 'flex' } }}>
            {FEATURES.map(([Icon, title, text]) => (
              <Stack key={title} direction="row" spacing={2} alignItems="center" sx={{ p: 1.5, borderRadius: '14px', bgcolor: alpha('#fff', 0.06), border: `1px solid ${alpha('#fff', 0.1)}`, backdropFilter: 'blur(6px)' }}>
                <Avatar variant="rounded" sx={{ bgcolor: alpha('#fff', 0.14), color: '#fff', width: 40, height: 40, borderRadius: '11px' }}><Icon fontSize="small" /></Avatar>
                <Box><Typography fontWeight={700} fontSize={15}>{title}</Typography><Typography variant="body2" sx={{ color: alpha('#fff', 0.7) }}>{text}</Typography></Box>
              </Stack>
            ))}
          </Stack>
        </Box>
        <Typography variant="caption" sx={{ position: 'relative', color: alpha('#fff', 0.6), display: { xs: 'none', md: 'block' } }}>Pilot: Prime Tech Park, Hyderabad · 500,000 sq.ft. · 3 towers · 24×7</Typography>
      </Grid>

      <Grid item xs={12} md={7} sx={{ display: 'flex', justifyContent: 'center', p: { xs: 2, sm: 4 }, overflowY: 'auto' }}>
        <Box sx={{ width: '100%', maxWidth: 640, my: 'auto' }}>
          <Card sx={{ p: { xs: 2.5, sm: 4 }, mb: 3.5, boxShadow: SHADOW.md }}>
            <Typography variant="h5">Welcome back</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>Sign in with your work email or mobile number.</Typography>
            <Box component="form" onSubmit={(e) => { e.preventDefault(); signIn(identifier, password); }}>
              <Stack spacing={2}>
                {error && <Alert severity="error">{error}</Alert>}
                <TextField label="Email or mobile" autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus size="medium" />
                <TextField label="Password" type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} size="medium"
                  InputProps={{ endAdornment: <InputAdornment position="end"><IconButton onClick={() => setShow(!show)} edge="end" aria-label={show ? 'Hide password' : 'Show password'}>{show ? <VisibilityOff /> : <Visibility />}</IconButton></InputAdornment> }} />
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Link component="button" type="button" variant="body2" onClick={() => setForgot(true)}>Forgot password?</Link>
                  <Button type="submit" variant="contained" color="secondary" size="large" disabled={!identifier || !password || Boolean(busy)} sx={{ minWidth: 140 }}>
                    {busy === 'form' ? <CircularProgress size={22} color="inherit" /> : 'Sign in'}
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </Card>

          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 0.5 }}>
            <Typography variant="subtitle1">New here? Explore as a demo user</Typography>
            <Box sx={{ flex: 1, height: '1px', bgcolor: GREY[200] }} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.75 }}>One click signs you in. Every demo account uses the password <Box component="code" sx={{ px: 0.75, py: 0.25, borderRadius: '6px', bgcolor: BRAND[50], color: BRAND[700], fontWeight: 700, fontSize: 13 }}>{DEMO_PASSWORD}</Box></Typography>
          <Grid container spacing={1.5}>
            {DEMO_ROLES.map((r, i) => {
              const Icon = ROLE_ICON[r.icon];
              const tint = ROLE_TINT[i % ROLE_TINT.length];
              return (
                <Grid item xs={12} sm={6} md={4} key={r.email}>
                  <Card sx={{ height: '100%', transition: 'all .18s', '&:hover': { borderColor: alpha(tint, 0.45), transform: 'translateY(-2px)', boxShadow: SHADOW.lg } }}>
                    <CardActionArea sx={{ p: 1.5, height: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-start', gap: 1.25 }} disabled={Boolean(busy)} onClick={() => signIn(r.email, DEMO_PASSWORD, r.email)}>
                      <Avatar variant="rounded" sx={{ bgcolor: alpha(tint, 0.1), color: tint, width: 38, height: 38, borderRadius: '10px' }}>{busy === r.email ? <CircularProgress size={18} color="inherit" /> : <Icon fontSize="small" />}</Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography fontWeight={700} fontSize={14} lineHeight={1.3}>{r.role}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.35 }}>{r.blurb}</Typography>
                      </Box>
                    </CardActionArea>
                  </Card>
                </Grid>
              );
            })}
          </Grid>
        </Box>
      </Grid>
      <ForgotPassword open={forgot} onClose={() => setForgot(false)} />
    </Grid>
  );
}
