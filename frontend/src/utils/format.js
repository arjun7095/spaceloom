import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export const fmtDate = (d) => (d ? dayjs(d).format('DD-MM-YYYY') : '—');
export const fmtDateTime = (d) => (d ? dayjs(d).format('DD-MM-YYYY HH:mm') : '—');
export const fmtTime = (d) => (d ? dayjs(d).format('HH:mm') : '—');
export const fromNow = (d) => (d ? dayjs(d).fromNow() : '—');
export const inr = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n));
export const num = (n) => (n == null ? '—' : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 }).format(n));
export const label = (s) => (s == null || s === '' ? '' : String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));
export const humanize = (key = '') => key.split('.').pop().replace(/Ids?$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
export const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
export const today = () => dayjs().format('YYYY-MM-DD');
// File links carry a signature query (?exp=…&sig=…); photos taken offline are "offline-file:" references.
export const isImageUrl = (u) => typeof u === 'string' && (u.startsWith('offline-file:') || /\.(jpe?g|png|webp|gif)$/i.test(u.split('?')[0]));

// A readable label for any referenced record.
export function refLabel(o) {
  if (o == null) return '';
  if (typeof o !== 'object') return String(o);
  if (o.path) return o.path;
  if (o.code && o.name) return `${o.code} · ${o.name}`;
  return o.name || o.number || o.title || o.email || o.label || o.code || '';
}

const COLORS = {
  success: ['closed', 'tenant_confirmed', 'verified', 'done', 'approved', 'paid', 'present', 'active', 'running', 'issued', 'received', 'signed_off', 'renewed', 'completed', 'returned', 'acknowledged_report'],
  info: ['new', 'assigned', 'acknowledged', 'scheduled', 'submitted', 'requested', 'planned', 'sent', 'in_progress', 'draft', 'counted', 'ordered', 'partially_received', 'immediate_action', 'investigation', 'capa', 'verification', 'standby', 'reported', 'partially_returned'],
  warning: ['major', 'high', 'on_hold', 'reopened', 'expiring', 'renewal_requested', 'half_day', 'under_maintenance', 'disputed', 'overdue', 'pending', 'open', 'leave', 'late', 'amber'],
  error: ['critical', 'breakdown', 'absent', 'rejected', 'missed', 'expired', 'blacklisted', 'breached', 'red'],
};
export function statusColor(s) {
  for (const [c, list] of Object.entries(COLORS)) if (list.includes(s)) return c;
  return 'default';
}
export const PRIORITY = { P1: { color: 'error', label: 'P1 · Critical' }, P2: { color: 'warning', label: 'P2 · High' }, P3: { color: 'info', label: 'P3 · Medium' }, P4: { color: 'default', label: 'P4 · Low' } };

export function duration(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// Mirrors the server: paused time is excluded, due dates move out by the pause on resume.
export function slaInfo(t, now = Date.now()) {
  const s = t?.sla || {};
  if (!s.resolutionDue) return null;
  const done = ['resolved', 'tenant_confirmed', 'closed', 'cancelled'].includes(t.status);
  const respondPhase = !s.respondedAt && !done;
  const due = +new Date(respondPhase ? s.responseDue : s.resolutionDue);
  const start = +new Date(s.startedAt || t.createdAt);
  const paused = (s.pausedMin || 0) * 60000;
  const eff = s.pausedAt ? +new Date(s.pausedAt) : now;
  const end = done ? +new Date(s.resolvedAt || eff) : eff;
  const span = due - start - paused;
  const pct = span > 0 ? Math.max(0, (end - start - paused) / span) : 1;
  const breached = respondPhase ? s.responseBreached || pct >= 1 : s.resolutionBreached || (!done && pct >= 1);
  if (done) return { pct: Math.min(pct, 1), state: s.resolutionBreached ? 'breach' : 'met', label: s.resolutionBreached ? 'Resolved late' : 'Resolved within SLA', phase: 'resolution' };
  if (s.pausedAt) return { pct, state: 'paused', label: `Paused · ${duration(due - eff)} left`, phase: respondPhase ? 'response' : 'resolution' };
  const left = due - now;
  return {
    pct,
    phase: respondPhase ? 'response' : 'resolution',
    state: breached ? 'breach' : pct >= 0.75 ? 'warn' : 'ok',
    label: left >= 0 ? `${respondPhase ? 'Respond' : 'Resolve'} in ${duration(left)}` : `Overdue by ${duration(left)}`,
  };
}
