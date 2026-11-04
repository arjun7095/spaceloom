import { useEffect, useState } from 'react';
import { pushState, enablePush, disablePush } from '../offline/push';
import { Alert, Box, Button, Chip, Grid, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useAction } from '../hooks';
import { KeyValue, PageHeader, SectionCard, StackTable } from '../components/common';

const EVENTS = [['ticket_created', 'New ticket in my department'], ['wo_assigned', 'Job assigned to me'], ['sla_warning', 'SLA warning (75%)'], ['sla_escalation', 'SLA breach escalation'], ['approval', 'Something needs my approval'], ['stock_low', 'Low stock'], ['expiry', 'Contract / certificate expiry'], ['incident', 'Safety incident']];
const CHANNELS = ['push', 'email', 'sms', 'whatsapp'];
const CHANNEL_LABEL = { push: 'Phone push', email: 'Email', sms: 'SMS', whatsapp: 'WhatsApp' };
const PUSH_TEXT = {
  unsupported: 'This browser cannot show phone notifications.',
  'needs-install': 'Install the app (or open the production site) to get phone notifications on this device.',
  blocked: 'Notifications are blocked for this site. Allow them in the browser settings, then come back.',
  off: 'Off on this device.',
  on: 'On — this device gets a notification for new jobs, approvals and SLA alerts.',
};

function DeviceAndTests() {
  const [state, setState] = useState('…');
  const [results, setResults] = useState({});
  useEffect(() => { pushState().then(setState); }, []);
  const toggle = useAction(() => (state === 'on' ? disablePush() : enablePush()), { onSuccess: setState });
  const test = useAction((channel) => api.post('/notifications/test', { channel }), { onSuccess: (r) => setResults((x) => ({ ...x, [r.channel]: r })) });
  return (
    <SectionCard title="Phone notifications & delivery tests" subtitle="Turn on alerts for this device, and check that every channel reaches you.">
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <Box sx={{ flex: 1 }}><Typography fontWeight={700}>This device</Typography><Typography variant="body2" color="text.secondary">{PUSH_TEXT[state] || 'Checking…'}</Typography></Box>
          {['on', 'off'].includes(state) && <Button variant={state === 'on' ? 'outlined' : 'contained'} color="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate()}>{state === 'on' ? 'Turn off' : 'Turn on'}</Button>}
        </Stack>
        {toggle.error && <Alert severity="warning">{toggle.error.message}</Alert>}
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {CHANNELS.map((c) => <Button key={c} size="small" variant="outlined" disabled={test.isPending} onClick={() => test.mutate(c)}>Send me a test {CHANNEL_LABEL[c].toLowerCase()}</Button>)}
        </Stack>
        {Object.values(results).map((r) => <Alert key={r.channel} severity={r.ok ? 'success' : 'warning'}><b>{CHANNEL_LABEL[r.channel]}:</b> {r.ok ? `sent (${r.info})` : r.info}</Alert>)}
      </Stack>
    </SectionCard>
  );
}

export default function Profile() {
  const { user, setToken } = useAuth();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [prefs, setPrefs] = useState(user.notificationPrefs || {});
  const change = useAction((b) => api.patch('/auth/change-password', b), { success: 'Password changed', onSuccess: (r) => { setToken(r.accessToken); setPw({ currentPassword: '', newPassword: '', confirm: '' }); } });
  const savePrefs = useAction(() => api.patch('/auth/preferences', { notificationPrefs: prefs }), { success: 'Preferences saved', onSuccess: () => useAuth.setState((s) => ({ user: { ...s.user, notificationPrefs: prefs } })) });
  const on = (ev, ch) => prefs?.[ev]?.[ch] !== false;
  const toggle = (ev, ch) => setPrefs((p) => ({ ...p, [ev]: { ...(p?.[ev] || {}), [ch]: !on(ev, ch) } }));
  const mismatch = pw.confirm && pw.confirm !== pw.newPassword;
  return (
    <Box sx={{ maxWidth: 1100 }}>
      <PageHeader title="My profile" subtitle="Your account, password and how we notify you." />
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <SectionCard title="Account">
            <KeyValue items={[['Name', user.name], ['Email', user.email], ['Mobile', user.mobile], ['Roles', <Stack key="r" direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>{user.roles.map((r) => <Chip key={r.key} size="small" label={r.name} />)}</Stack>], ['Properties', user.properties.map((p) => p.name).join(', ')]]} />
          </SectionCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <SectionCard title="Change password" subtitle="You stay signed in on this device; other devices are signed out.">
            <Stack spacing={2}>
              <TextField type="password" label="Current password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
              <TextField type="password" label="New password" helperText="8+ characters with upper and lower case, a number and a symbol" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
              <TextField type="password" label="Confirm new password" error={Boolean(mismatch)} helperText={mismatch ? 'Does not match' : ' '} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
              {change.error && <Alert severity="error">{change.error.message}{change.error.details?.newPassword ? ` — ${[].concat(change.error.details.newPassword).join(', ')}` : ''}</Alert>}
              <Box><Button variant="contained" color="secondary" disabled={!pw.currentPassword || !pw.newPassword || mismatch || change.isPending} onClick={() => change.mutate({ currentPassword: pw.currentPassword, newPassword: pw.newPassword })}>Update password</Button></Box>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid item xs={12}><DeviceAndTests /></Grid>
        <Grid item xs={12}>
          <SectionCard title="Notifications" subtitle="In-app notifications are always on. Choose which events also reach you on your phone, by email, SMS or WhatsApp." action={<Button variant="contained" color="secondary" size="small" disabled={savePrefs.isPending} onClick={() => savePrefs.mutate()}>Save</Button>}>
            <Box sx={{ overflowX: 'auto' }}>
              <StackTable>
                <TableHead><TableRow><TableCell sx={{ fontWeight: 700 }}>Event</TableCell>{CHANNELS.map((c) => <TableCell key={c} align="center" sx={{ fontWeight: 700 }}>{CHANNEL_LABEL[c]}</TableCell>)}</TableRow></TableHead>
                <TableBody>
                  {EVENTS.map(([ev, l]) => (
                    <TableRow key={ev}><TableCell><Typography variant="body2">{l}</Typography></TableCell>{CHANNELS.map((c) => <TableCell key={c} align="center"><Switch size="small" color="secondary" checked={on(ev, c)} onChange={() => toggle(ev, c)} inputProps={{ 'aria-label': `${l} by ${c}` }} /></TableCell>)}</TableRow>
                  ))}
                </TableBody>
              </StackTable>
            </Box>
          </SectionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
