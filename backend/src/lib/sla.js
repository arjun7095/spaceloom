import { SlaPolicy } from '../models/index.js';

const MIN = 60000;
const IST = 330;

// Adds SLA minutes on a 24x7 or business-hours calendar (FR-5.4). Business hours are IST wall-clock.
export function addSlaMinutes(start, minutes, cal = {}) {
  if (!cal.calendar || cal.calendar === '24x7') return new Date(+start + minutes * MIN);
  const [oh, om] = (cal.open || '09:00').split(':').map(Number);
  const [ch, cm] = (cal.close || '18:00').split(':').map(Number);
  const workDays = cal.workDays || [1, 2, 3, 4, 5, 6];
  const holidays = new Set(cal.holidays || []);
  let t = +start + IST * MIN;
  let left = minutes;
  for (let guard = 0; left > 0 && guard < 400; guard++) {
    const d = new Date(t);
    const day0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const open = day0 + (oh * 60 + om) * MIN;
    const close = day0 + (ch * 60 + cm) * MIN;
    const iso = new Date(day0).toISOString().slice(0, 10);
    if (workDays.includes(new Date(day0).getUTCDay()) && !holidays.has(iso) && t < close) {
      const from = Math.max(t, open);
      const avail = (close - from) / MIN;
      if (left <= avail) return new Date(from + left * MIN - IST * MIN);
      left -= avail;
    }
    t = day0 + 24 * 60 * MIN;
  }
  return new Date(t - IST * MIN);
}

export async function policyFor(property) {
  return (property?.slaPolicyId && (await SlaPolicy.findById(property.slaPolicyId).lean())) || SlaPolicy.findOne({ isDefault: true }).lean();
}

export async function buildSla(property, priority, start = new Date()) {
  const policy = await policyFor(property);
  const rule = policy?.rules?.find((r) => r.priority === priority) || { responseMin: 120, resolutionMin: 1440 };
  const cal = { calendar: property?.is24x7 ? '24x7' : policy?.calendar, ...property?.operatingHours };
  return {
    policyId: policy?._id,
    startedAt: start,
    responseDue: addSlaMinutes(start, rule.responseMin, cal),
    resolutionDue: addSlaMinutes(start, rule.resolutionMin, cal),
    pausedMin: 0,
  };
}

// Fraction of the SLA window used (1 = breached). Paused time is excluded; due dates are
// pushed out by the pause on resume, so the span stays the original target.
export function slaProgress(t, now = new Date()) {
  const s = t.sla || {};
  const eff = s.pausedAt ? +new Date(s.pausedAt) : +now;
  const paused = (s.pausedMin || 0) * MIN;
  const start = +new Date(s.startedAt || t.createdAt);
  const pct = (due, doneAt) => {
    if (!due) return 0;
    const end = doneAt ? +new Date(doneAt) : eff;
    const span = +new Date(due) - start - paused;
    return span > 0 ? Math.max(0, (end - start - paused) / span) : 1;
  };
  return { response: pct(s.responseDue, s.respondedAt), resolution: pct(s.resolutionDue, s.resolvedAt) };
}
