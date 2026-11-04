import cron from 'node-cron';
import { Amc, AmcVisit, Attendance, Compliance, Contract, JobRun, Permit, Property, ReportSchedule, Roster, SlaPolicy, Ticket, Vendor, VendorScore, WorkOrder } from '../models/index.js';
import { removeFile } from '../lib/storage.js';
import { logger } from '../lib/logger.js';
import { als, istDate, istAt, addDays, DAY_MS } from '../lib/context.js';
import { slaProgress } from '../lib/sla.js';
import { notify, usersWithRole } from '../lib/notify.js';
import { emitProperty } from '../lib/socket.js';
import { generatePpm } from '../modules/workorders.js';
import { afterTicketChange } from '../modules/tickets.js';
import { lowStock } from '../modules/inventory.js';
import { snapshotKpis } from '../modules/dashboard.js';
import { generateReport } from '../modules/reports.js';
import { computeVendorScore } from '../modules/misc.js';
import { simulateAttendance } from '../seed/simulate.js';
import { env } from '../config/env.js';

const DEFAULT_ESCALATION = [
  { level: 1, afterPct: 75, role: 'supervisor' },
  { level: 2, afterPct: 100, role: 'property_manager' },
  { level: 3, afterPct: 150, role: 'owner' },
];
const ROLE_NAME = { supervisor: 'Supervisor', property_manager: 'Property Manager', owner: 'Client / Owner' };

// FR-5.11: warn at 75%, escalate to PM on breach, then to the owner.
async function slaMonitor() {
  const tickets = await Ticket.find({ status: { $in: ['new', 'assigned', 'acknowledged', 'in_progress', 'reopened'] } });
  const policies = new Map();
  let escalations = 0;
  for (const t of tickets) {
    const now = new Date();
    let changed = false;
    if (!t.sla.respondedAt && !t.sla.responseBreached && now > t.sla.responseDue) { t.sla.responseBreached = true; changed = true; }
    if (!t.sla.resolvedAt && !t.sla.resolutionBreached && now > t.sla.resolutionDue) { t.sla.resolutionBreached = true; changed = true; }
    const p = slaProgress(t, now);
    const worst = Math.max(t.sla.respondedAt ? 0 : p.response, p.resolution) * 100;
    const key = String(t.sla.policyId);
    if (!policies.has(key)) policies.set(key, t.sla.policyId ? await SlaPolicy.findById(t.sla.policyId).lean() : null);
    const levels = [...(policies.get(key)?.escalation?.length ? policies.get(key).escalation : DEFAULT_ESCALATION)].sort((a, b) => a.level - b.level);
    for (const lv of levels) {
      if (lv.level <= (t.escalationLevel || 0) || worst < lv.afterPct) continue;
      const users = await usersWithRole(t.propertyId, [lv.role], lv.role === 'supervisor' ? t.assignedDeptId : undefined);
      const warn = lv.level === 1;
      await notify({
        userIds: users.map((u) => u._id), propertyId: t.propertyId, type: warn ? 'sla_warning' : 'sla_escalation',
        title: warn ? `SLA warning: ${t.number} has used ${Math.round(worst)}% of its time` : `Escalation L${lv.level}: ${t.number} has breached its SLA`,
        body: t.description.slice(0, 140), link: `/tickets/${t._id}`,
        channels: warn ? ['in_app', 'email'] : ['in_app', 'email', 'sms', 'whatsapp'],
      });
      t.escalationLevel = lv.level;
      t.history.push({ status: t.status, byName: 'SLA monitor', at: now, note: warn ? `Warning sent to supervisor at ${Math.round(worst)}% of SLA` : `Escalated to Level ${lv.level} (${ROLE_NAME[lv.role] || lv.role})` });
      emitProperty(String(t.propertyId), warn ? 'ticket:sla-warning' : 'ticket:sla-breached', { _id: t._id, number: t.number, level: lv.level });
      changed = true;
      escalations++;
    }
    if (changed) {
      await t.save();
      await afterTicketChange(t);
    }
  }
  return `checked ${tickets.length}, escalations ${escalations}`;
}

async function ticketAutoClose() {
  const rows = await Ticket.find({ status: 'resolved', 'sla.resolvedAt': { $lte: new Date(Date.now() - 48 * 36e5) } });
  for (const t of rows) {
    const at = new Date();
    t.history.push({ status: 'tenant_confirmed', byName: 'System', at, note: 'No response from tenant in 48 h — treated as confirmed' });
    t.history.push({ status: 'closed', byName: 'System', at });
    Object.assign(t, { status: 'closed', closedAt: at, tenantConfirmation: { status: 'auto', at } });
    await t.save();
    if (t.workOrderId) await WorkOrder.updateOne({ _id: t.workOrderId }, { status: 'closed' });
    await afterTicketChange(t);
  }
  return `closed ${rows.length}`;
}

async function attendanceAbsentMarker() {
  const now = new Date();
  const today = istDate();
  const dates = [addDays(today, -1), today];
  const rosters = await Roster.find({ date: { $in: dates }, isWeeklyOff: { $ne: true }, shiftId: { $ne: null } }).populate('shiftId').lean();
  const atts = await Attendance.find({ date: { $in: dates } });
  const byKey = new Map(atts.map((a) => [`${a.employeeId}:${a.date}`, a]));
  let absent = 0;
  let missed = 0;
  for (const r of rosters) {
    const s = r.shiftId;
    if (!s) continue;
    const end = +istAt(r.date, s.end) + (s.crossesMidnight ? DAY_MS : 0);
    const att = byKey.get(`${r.employeeId}:${r.date}`);
    if (!att && +now > end + (s.graceMin || 0) * 60000) {
      await Attendance.create({ propertyId: r.propertyId, orgId: r.orgId, employeeId: r.employeeId, departmentId: r.departmentId, date: r.date, shiftId: s._id, status: 'absent', exceptions: ['absent'] });
      absent++;
    } else if (att?.checkIn?.time && !att.checkOut?.time && +now > end + 2 * 36e5 && !att.exceptions.includes('missed_punch')) {
      att.exceptions.push('missed_punch');
      await att.save();
      missed++;
    }
  }
  return `absent ${absent}, missed punch ${missed}`;
}

// FR-7.7 / FR-8.6: alerts at 90/60/30/7 days, plus status roll-over for expired records.
async function expiryAlerts() {
  const now = Date.now();
  const soon = new Date(now + 90 * DAY_MS);
  let sent = 0;
  const alert = async (doc, propertyId, label, name, date, link, roles = ['property_manager']) => {
    const days = Math.ceil((new Date(date) - now) / DAY_MS);
    const bucket = [90, 60, 30, 7].filter((t) => days <= t).pop();
    if (!bucket) return;
    const users = await usersWithRole(propertyId, roles);
    await notify({ userIds: users.map((u) => u._id), propertyId, type: 'expiry', title: `${label} expires in ${days} day${days === 1 ? '' : 's'}: ${name}`, link, dedupeKey: `expiry:${doc._id}:${bucket}`, channels: bucket <= 7 ? ['in_app', 'email'] : ['in_app'] });
    sent++;
  };
  for (const c of await Contract.find({ end: { $gte: new Date(now), $lte: soon }, status: { $in: ['active', 'expiring'] } }).lean()) await alert(c, c.propertyId, 'Contract', c.title || c.number, c.end, '/vendors/contracts');
  for (const a of await Amc.find({ end: { $gte: new Date(now), $lte: soon }, status: { $in: ['active', 'expiring'] } })) {
    if (a.status === 'active') { a.status = 'expiring'; await a.save(); }
    await alert(a, a.propertyId, 'AMC', a.name, a.end, '/vendors/amcs', ['property_manager', 'owner']);
  }
  for (const c of await Compliance.find({ validTo: { $gte: new Date(now), $lte: soon } }).lean()) await alert(c, c.propertyId, 'Statutory certificate', c.name, c.validTo, '/hse/compliances', ['property_manager', 'hse_officer']);
  for (const v of await Vendor.find({ 'documents.expiry': { $gte: new Date(now), $lte: soon } }).lean()) {
    for (const d of v.documents.filter((x) => x.expiry && x.expiry <= soon && x.expiry >= new Date(now))) await alert({ _id: `${v._id}-${d._id}` }, null, `${v.name} document`, d.name || d.type, d.expiry, `/vendors/${v._id}`);
  }
  await Amc.updateMany({ end: { $lt: new Date(now) }, status: { $in: ['active', 'expiring', 'renewal_requested'] } }, { status: 'expired' });
  await Contract.updateMany({ end: { $lt: new Date(now) }, status: { $in: ['active', 'expiring'] } }, { status: 'expired' });
  await Permit.updateMany({ validTo: { $lt: new Date(now) }, status: { $in: ['approved', 'active'] } }, { status: 'expired' });
  return `alerts ${sent}`;
}

async function reorderCheck() {
  const low = await lowStock();
  for (const l of low) {
    const users = await usersWithRole(l.propertyId, ['storekeeper', 'procurement']);
    await notify({ userIds: users.map((u) => u._id), propertyId: l.propertyId, type: 'stock_low', title: `Reorder ${l.item.name}`, body: `${l.store.name}: ${l.qty} ${l.item.uom} left (reorder level ${l.item.reorderLevel})`, link: '/inventory?view=alerts', dedupeKey: `reorder:${l.itemId}:${l.storeId}:${istDate()}` });
  }
  return `low ${low.length}`;
}

async function amcVisitGenerator() {
  const step = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
  const amcs = await Amc.find({ status: { $in: ['active', 'expiring', 'renewal_requested'] } }).lean();
  const today = istAt(istDate());
  const horizon = new Date(Date.now() + 365 * DAY_MS);
  let created = 0;
  for (const a of amcs) {
    const d = new Date(a.start);
    for (let guard = 0; d <= a.end && d <= horizon && guard < 60; guard++) {
      if (d >= today && !(await AmcVisit.exists({ amcId: a._id, plannedDate: d }))) {
        await AmcVisit.create({ propertyId: a.propertyId, orgId: a.orgId, amcId: a._id, vendorId: a.vendorId, plannedDate: new Date(d) });
        created++;
      }
      d.setMonth(d.getMonth() + (step[a.visitFrequency] || 3));
    }
  }
  const missed = await AmcVisit.updateMany({ status: 'scheduled', plannedDate: { $lt: new Date(Date.now() - 3 * DAY_MS) } }, { status: 'missed' });
  return `created ${created}, marked missed ${missed.modifiedCount}`;
}

const eachProperty = async (fn) => {
  const props = await Property.find({ status: { $ne: 'inactive' } }).lean();
  for (const p of props) await als.run({ propertyId: p._id, orgId: p.orgId }, () => fn(p));
  return props.length;
};

async function kpiSnapshot() {
  const n = await eachProperty((p) => snapshotKpis(p));
  await JobRun.deleteMany({ startedAt: { $lt: new Date(Date.now() - 7 * DAY_MS) } });
  return `snapshots ${n}`;
}

// Runs every 5 minutes; each enabled schedule generates its draft once per period after its time of day.
async function reportScheduler() {
  const now = new Date();
  const today = istDate(now);
  const hhmm = new Date(+now + 330 * 60000).toISOString().slice(11, 16);
  const dow = istAt(today, '12:00').getUTCDay();
  const dom = Number(today.slice(8, 10));
  let n = 0;
  for (const s of await ReportSchedule.find({ enabled: true }).lean()) {
    if (hhmm < (s.time || '07:00')) continue;
    if (s.type === 'weekly' && dow !== (s.dayOfWeek ?? 1)) continue;
    if (s.type === 'monthly' && dom !== (s.dayOfMonth ?? 1)) continue;
    const key = `${s.type}:${today}`;
    if (s.lastRunKey === key) continue;
    const p = await Property.findById(s.propertyId).lean();
    if (!p) continue;
    const date = s.type === 'monthly' ? addDays(`${today.slice(0, 7)}-01`, -1) : addDays(today, -1);
    const rep = await als.run({ propertyId: p._id, orgId: p.orgId }, () => generateReport(s.type, date));
    await ReportSchedule.updateOne({ _id: s._id }, { lastRunKey: key, lastRunAt: now });
    const pms = await usersWithRole(p._id, ['property_manager']);
    await notify({ userIds: pms.map((u) => u._id), propertyId: p._id, type: 'report_ready', title: `${rep.title} is ready for your review`, body: s.sendOnSignOff ? 'It will be emailed to the client when you sign it off.' : undefined, link: `/reports/${rep._id}` });
    n++;
  }
  return `generated ${n}`;
}

// DPDP: selfies and GPS points are kept only as long as the property's retention setting allows.
async function privacyRetention() {
  let purged = 0;
  for (const p of await Property.find().lean()) {
    const cutoff = addDays(istDate(), -(p.settings?.selfieRetentionDays ?? 90));
    const rows = await Attendance.find({
      propertyId: p._id, date: { $lt: cutoff },
      $or: [{ 'checkIn.selfieUrl': { $type: 'string' } }, { 'checkOut.selfieUrl': { $type: 'string' } }, { 'checkIn.lat': { $type: 'number' } }, { 'checkOut.lat': { $type: 'number' } }],
    }).select('checkIn checkOut').lean();
    for (const a of rows) {
      await removeFile(a.checkIn?.selfieUrl).catch(() => {});
      await removeFile(a.checkOut?.selfieUrl).catch(() => {});
    }
    if (rows.length) {
      await Attendance.updateMany({ _id: { $in: rows.map((x) => x._id) } }, {
        $unset: { 'checkIn.selfieUrl': 1, 'checkIn.lat': 1, 'checkIn.lng': 1, 'checkOut.selfieUrl': 1, 'checkOut.lat': 1, 'checkOut.lng': 1 },
        $set: { privacyPurgedAt: new Date() },
      });
    }
    purged += rows.length;
  }
  return `purged selfies/location from ${purged} attendance record(s)`;
}

async function vendorScores() {
  const first = istAt(`${istDate().slice(0, 7)}-01`);
  const prevStart = new Date(first);
  prevStart.setMonth(prevStart.getMonth() - 1);
  const period = istDate(prevStart).slice(0, 7);
  let n = 0;
  await eachProperty(async (p) => {
    const vendors = await Vendor.find({ status: 'active' }).setOptions({ unscoped: true }).select('_id').lean();
    for (const v of vendors) {
      const s = await computeVendorScore(v._id, prevStart, new Date(+first - 1));
      await VendorScore.updateOne({ propertyId: p._id, vendorId: v._id, period }, { $set: { ...s, orgId: p.orgId, isDeleted: false } }, { upsert: true });
      n++;
    }
  });
  return `scores ${n}`;
}

export const JOBS = {
  'sla-monitor': { cron: '* * * * *', description: 'Every minute: SLA breach flags, 75% warning, 3-level escalation', run: slaMonitor },
  'ppm-generator': { cron: '30 0 * * *', description: 'Daily 00:30: creates PPM work orders 7 days ahead', run: () => generatePpm(7).then((n) => `created ${n}`) },
  'amc-visit-generator': { cron: '0 1 * * *', description: 'Daily 01:00: schedules AMC visits and flags missed ones', run: amcVisitGenerator },
  'expiry-alerts': { cron: '0 8 * * *', description: 'Daily 08:00: contract, AMC, document and certificate expiry alerts', run: expiryAlerts },
  'reorder-check': { cron: '0 * * * *', description: 'Hourly: low-stock alerts to stores and procurement', run: reorderCheck },
  'attendance-absent-marker': { cron: '15 * * * *', description: 'Hourly: marks absentees after shift end and flags missed punches', run: attendanceAbsentMarker },
  'ticket-auto-close': { cron: '5 * * * *', description: 'Hourly: closes tickets resolved more than 48 h ago without tenant response', run: ticketAutoClose },
  'kpi-snapshot': { cron: '55 23 * * *', description: 'Daily 23:55: stores KPI values for trends', run: kpiSnapshot },
  'report-scheduler': { cron: '*/5 * * * *', description: 'Every 5 min: drafts daily / weekly / monthly client reports per Reports → Schedules', run: reportScheduler },
  'privacy-retention': { cron: '30 2 * * *', description: 'Daily 02:30: deletes selfies and GPS points older than the retention period (DPDP)', run: privacyRetention },
  'vendor-score': { cron: '0 2 1 * *', description: '1st of month 02:00: vendor performance scorecards', run: vendorScores },
  ...(env.demoMode && {
    'demo-simulator': {
      cron: '*/10 * * * *', description: 'Demo mode only: simulated biometric punches on the demo property',
      run: async () => {
        let n = 0;
        for (const p of await Property.find({ isDemo: true }).lean()) n += await simulateAttendance(p);
        return `punches ${n}`;
      },
    },
  }),
};

const running = new Map();

// Scheduled runs skip if the previous run is still going; manual runs ({ wait: true }) queue behind it.
export async function runJob(name, { wait = false } = {}) {
  if (running.has(name)) {
    if (!wait) return { name, skipped: true };
    await running.get(name).catch(() => {});
  }
  const started = new Date();
  let ok = true;
  let message;
  const p = JOBS[name].run();
  running.set(name, p);
  try {
    message = String((await p) ?? 'ok');
  } catch (err) {
    ok = false;
    message = err.message;
    logger.error({ err, job: name }, 'job failed');
  } finally {
    if (running.get(name) === p) running.delete(name);
  }
  const finished = new Date();
  const run = await JobRun.create({ name, startedAt: started, finishedAt: finished, durationMs: finished - started, ok, message });
  return run.toObject();
}

export function startScheduler() {
  for (const [name, job] of Object.entries(JOBS)) cron.schedule(job.cron, () => runJob(name), { timezone: 'Asia/Kolkata' });
  setTimeout(() => ['ppm-generator', 'amc-visit-generator'].forEach((n) => runJob(n)), 3000);
  logger.info(`Scheduler started with ${Object.keys(JOBS).length} jobs`);
}
