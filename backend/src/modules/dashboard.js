import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ActionItem, Amc, Asset, Attendance, Capa, Compliance, Incident, Inspection, KpiDefinition, KpiSnapshot, MaterialIssue, Observation, Property, Roster, ShiftLog, Ticket, WorkOrder, OPEN_TICKET, WO_DONE, WO_OPEN } from '../models/index.js';
import { ah, ok, parse } from '../lib/http.js';
import { requirePermission, can, isBroad, isSupervisorOnly } from '../middleware/auth.js';
import { als, istDate, istAt, addDays, DAY_MS } from '../lib/context.js';
import { todaySummary } from './attendance.js';
import { lowStock } from './inventory.js';
import { ticketScope } from './tickets.js';
import { woScope } from './workorders.js';
import { approvalInbox } from './misc.js';

export const KPI_DRILL = {
  attendance: '/attendance',
  sla: '/tickets?view=breached',
  ppm: '/work-orders?type=ppm',
  open_complaints: '/tickets?view=open',
  critical_complaints: '/tickets?view=critical',
  amc_due: '/vendors/amcs?view=expiring',
  inventory_alerts: '/inventory?view=alerts',
  hse_incidents: '/hse/incidents',
};

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);

// Live KPI values for the property in the current request context (FR-9.1).
export async function kpiValues() {
  const now = new Date();
  const todayStart = istAt(istDate(), '00:00');
  const d30 = new Date(+todayStart - 30 * DAY_MS);
  const [att, sla, ppm, open, critical, amcDue, low, incidents] = await Promise.all([
    todaySummary(),
    Ticket.aggregate([{ $match: { 'sla.resolvedAt': { $gte: d30 } } }, { $group: { _id: null, total: { $sum: 1 }, ok: { $sum: { $cond: [{ $or: ['$sla.resolutionBreached', '$sla.responseBreached'] }, 0, 1] } } } }]),
    WorkOrder.aggregate([{ $match: { type: 'ppm', plannedDate: { $gte: d30, $lt: todayStart } } }, { $group: { _id: null, total: { $sum: 1 }, done: { $sum: { $cond: [{ $in: ['$status', WO_DONE] }, 1, 0] } } } }]),
    Ticket.countDocuments({ status: { $in: OPEN_TICKET } }),
    Ticket.countDocuments({ status: { $in: OPEN_TICKET }, priority: 'P1' }),
    Amc.countDocuments({ end: { $gte: now, $lte: new Date(+now + 30 * DAY_MS) }, status: { $nin: ['renewed', 'expired'] } }),
    lowStock(),
    Incident.countDocuments({ occurredAt: { $gte: istAt(`${istDate().slice(0, 7)}-01`) } }),
  ]);
  return {
    attendance: att.planned ? att.pct : null,
    sla: pct(sla[0]?.ok || 0, sla[0]?.total || 0) ?? 100,
    ppm: pct(ppm[0]?.done || 0, ppm[0]?.total || 0) ?? 100,
    open_complaints: open,
    critical_complaints: critical,
    amc_due: amcDue,
    inventory_alerts: low.length,
    hse_incidents: incidents,
  };
}

export function rag(def, actual) {
  if (actual == null) return 'grey';
  const amber = def.amberAt ?? def.target;
  if (def.direction === 'lower') return actual <= def.target ? 'green' : actual <= amber ? 'amber' : 'red';
  return actual >= def.target ? 'green' : actual >= amber ? 'amber' : 'red';
}

export async function computeKpis() {
  const [values, defs, snaps] = await Promise.all([kpiValues(), KpiDefinition.find().sort('order').lean(), KpiSnapshot.find().sort('-date').limit(30).lean()]);
  const today = istDate();
  const yesterday = snaps.find((s) => s.date < today);
  const series = snaps.slice().reverse();
  return defs.map((d) => ({
    code: d.code, name: d.name, unit: d.unit, direction: d.direction, target: d.target, amberAt: d.amberAt, formula: d.formula, responsibility: d.responsibility, baseline: d.baseline,
    actual: values[d.code],
    status: rag(d, values[d.code]),
    previous: yesterday?.values?.[d.code]?.actual ?? null,
    trend: series.map((s) => ({ date: s.date, value: s.values?.[d.code]?.actual ?? null })),
    link: KPI_DRILL[d.code],
  }));
}

export async function snapshotKpis(property) {
  return als.run({ propertyId: property._id, orgId: property.orgId }, async () => {
    const tiles = await computeKpis();
    const values = Object.fromEntries(tiles.map((t) => [t.code, { actual: t.actual, target: t.target, variance: t.actual == null ? null : Math.round((t.actual - t.target) * 10) / 10 }]));
    await KpiSnapshot.updateOne({ propertyId: property._id, date: istDate() }, { $set: { values, orgId: property.orgId, isDeleted: false } }, { upsert: true });
    return values;
  });
}

export const dashboardRouter = Router();

dashboardRouter.get('/kpis', requirePermission('dashboard:read'), ah(async (req, res) => {
  ok(res, { date: istDate(), updatedAt: new Date(), tiles: await computeKpis() });
}));

dashboardRouter.get('/trends', requirePermission('dashboard:read'), ah(async (req, res) => {
  const from = req.query.from || addDays(istDate(), -30);
  const to = req.query.to || istDate();
  const snaps = await KpiSnapshot.find({ date: { $gte: from, $lte: to } }).sort('date').lean();
  const kpi = req.query.kpi;
  ok(res, snaps.map((s) => (kpi ? { date: s.date, value: s.values?.[kpi]?.actual, target: s.values?.[kpi]?.target } : { date: s.date, ...Object.fromEntries(Object.entries(s.values || {}).map(([k, v]) => [k, v?.actual])) })));
}));

// Owner portfolio across every property they can access (FR-9.6).
dashboardRouter.get('/portfolio', requirePermission('dashboard:read'), ah(async (req, res) => {
  const props = await Property.find(req.user.isSuper ? {} : { _id: { $in: req.user.propertyIds } }).lean();
  const rows = [];
  for (const p of props) {
    const tiles = await als.run({ propertyId: p._id, orgId: p.orgId }, () => computeKpis());
    rows.push({ _id: p._id, name: p.name, code: p.code, city: p.city, type: p.type, areaSqft: p.areaSqft, tiles: tiles.map(({ code, name, unit, actual, target, status }) => ({ code, name, unit, actual, target, status })) });
  }
  ok(res, rows);
}));

// ── Role-aware "Today" board (FR-10.1–10.3) ──
dashboardRouter.get('/today', requirePermission('dashboard:read', 'workorder:read', 'ticket:read'), ah(async (req, res) => {
  const u = req.user;
  const today = istDate();
  const dayStart = istAt(today, '00:00');
  const dayEnd = istAt(today, '23:59');
  const now = new Date();
  const deptQ = isSupervisorOnly(u) ? { departmentId: { $in: u.departmentIds } } : {};
  const tQ = ticketScope(req);
  const jobs = [];
  const s = {};

  jobs.push(WorkOrder.find({ assigneeIds: u._id, status: { $in: [...WO_OPEN] }, plannedDate: { $lte: dayEnd } }).sort('plannedDate').limit(25)
    .populate('assetId', 'code name').populate('locationId', 'path').populate('ticketId', 'number').lean().then((r) => { s.myWork = r; }));

  if (can(u, 'ticket:read')) {
    jobs.push(Ticket.find({ $and: [tQ, { status: { $in: ['new', 'assigned', 'acknowledged', 'in_progress', 'on_hold', 'reopened'] }, $or: [{ 'sla.resolutionDue': { $lte: new Date(+now + 2 * 36e5) } }, { 'sla.resolutionBreached': true }, { 'sla.responseBreached': true }] }] })
      .select('number description priority status sla createdAt').sort('sla.resolutionDue').limit(10).lean().then((r) => { s.slaRisk = r; }));
  }
  if (can(u, 'ticket:assign')) {
    jobs.push(Ticket.find({ ...tQ, status: { $in: ['new', 'reopened'] } }).select('number description priority status sla createdAt locationId').populate('locationId', 'path').sort('priority createdAt').limit(15).lean().then((r) => { s.unassigned = r; }));
  }
  if (can(u, 'workorder:verify')) {
    jobs.push(WorkOrder.find({ ...woScope(req), status: 'completed' }).select('number title type completedAt assigneeIds ticketId').populate('assigneeIds', 'name').sort('completedAt').limit(15).lean().then((r) => { s.toVerify = r; }));
  }
  if (can(u, 'attendance:approve')) {
    jobs.push(todaySummary(deptQ.departmentId ? { departmentId: deptQ.departmentId } : {}).then((r) => { s.attendance = r; }));
    jobs.push(Attendance.countDocuments({ ...deptQ, date: { $gte: addDays(today, -7) }, exceptions: { $ne: [] }, exceptionResolved: { $ne: true } }).then((n) => { s.attendanceExceptions = n; }));
    jobs.push(Roster.find({ ...deptQ, date: today, isWeeklyOff: { $ne: true } }).populate('employeeId', 'name designation').populate('shiftId', 'name code start end').populate('postLocationId', 'path').lean().then(async (rows) => {
      const att = await Attendance.find({ date: today, employeeId: { $in: rows.map((r) => r.employeeId?._id) } }).select('employeeId status checkIn').lean();
      const present = new Set(att.filter((a) => a.checkIn?.time).map((a) => String(a.employeeId)));
      const byShift = {};
      for (const r of rows) {
        const k = r.shiftId ? `${r.shiftId.name} (${r.shiftId.start}–${r.shiftId.end})` : 'Unassigned';
        (byShift[k] ||= []).push({ name: r.employeeId?.name, designation: r.employeeId?.designation, post: r.postLocationId?.path, present: present.has(String(r.employeeId?._id)) });
      }
      s.deployment = Object.entries(byShift).map(([shift, people]) => ({ shift, total: people.length, present: people.filter((p) => p.present).length, people: people.slice(0, 40) }));
    }));
  }
  if (can(u, 'ppm:read') && !u.roles.every((r) => ['technician', 'tenant', 'vendor'].includes(r))) {
    jobs.push(WorkOrder.aggregate([{ $match: { ...(deptQ.departmentId && { departmentId: { $in: u.departmentIds.map((x) => new mongoose.Types.ObjectId(x)) } }), type: 'ppm', plannedDate: { $gte: dayStart, $lte: dayEnd } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).then((r) => { s.ppmToday = r.map((x) => ({ status: x._id, count: x.n })); }));
    jobs.push(Asset.find({ criticality: 'critical', status: { $in: ['breakdown', 'under_maintenance'] } }).select('code name status').limit(10).lean().then((r) => { s.criticalAssetsDown = r; }));
    jobs.push(WorkOrder.find({ ...deptQ, type: { $in: ['ppm', 'daily_check'] }, plannedDate: { $gte: dayStart, $lte: dayEnd } }).populate({ path: 'assetId', select: 'code name criticality', match: { criticality: 'critical' } }).select('number status assetId title').lean().then((r) => { s.criticalChecks = r.filter((w) => w.assetId).slice(0, 15); }));
  }
  if (can(u, 'inventory:update')) {
    jobs.push(MaterialIssue.find({ status: 'requested' }).populate('requestedBy', 'name').populate('workOrderId', 'number').populate('items.itemId', 'name uom').sort('createdAt').limit(15).lean().then((r) => { s.materialRequests = r; }));
    jobs.push(lowStock().then((r) => { s.lowStock = r.slice(0, 10); }));
  }
  if (can(u, 'hse:update')) {
    jobs.push(Incident.find({ status: { $ne: 'closed' } }).select('number title severity status occurredAt').sort('-occurredAt').limit(10).lean().then((r) => { s.openIncidents = r; }));
    jobs.push(Capa.countDocuments({ status: { $in: ['open', 'in_progress'] }, dueDate: { $lt: now } }).then((n) => { s.overdueCapas = n; }));
    jobs.push(Inspection.find({ status: 'scheduled', scheduledDate: { $lte: dayEnd } }).select('title scheduledDate type').limit(10).lean().then((r) => { s.inspectionsDue = r; }));
  }
  jobs.push(ActionItem.find({ ownerId: u._id, status: { $in: ['open', 'in_progress'] } }).sort('dueDate').limit(15).lean().then((r) => { s.actionItems = r; }));
  jobs.push(approvalInbox(req).then((r) => { s.approvals = r.length; }));
  await Promise.all(jobs);
  ok(res, { date: today, sections: s });
}));

// ── End of day (FR-10.5) ──
dashboardRouter.get('/eod/summary', requirePermission('daily:read'), ah(async (req, res) => {
  const today = istDate();
  const dayStart = istAt(today, '00:00');
  const [raised, closed, open, wosDone, wosPending, incidents, att, pending, actions, log] = await Promise.all([
    Ticket.countDocuments({ createdAt: { $gte: dayStart } }),
    Ticket.countDocuments({ closedAt: { $gte: dayStart } }),
    Ticket.countDocuments({ status: { $in: OPEN_TICKET } }),
    WorkOrder.countDocuments({ completedAt: { $gte: dayStart } }),
    WorkOrder.countDocuments({ status: { $in: WO_OPEN }, plannedDate: { $lt: istAt(today, '23:59') } }),
    Incident.countDocuments({ occurredAt: { $gte: dayStart } }),
    todaySummary(),
    Ticket.find({ status: { $in: OPEN_TICKET } }).select('number description priority status sla createdAt').sort('priority createdAt').limit(20).lean(),
    ActionItem.find({ status: { $in: ['open', 'in_progress'] } }).populate('ownerId', 'name').sort('dueDate').limit(20).lean(),
    ShiftLog.findOne({ date: today, kind: 'eod' }).lean(),
  ]);
  ok(res, { date: today, ticketsRaised: raised, ticketsClosed: closed, ticketsOpen: open, workOrdersCompleted: wosDone, workOrdersPending: wosPending, incidents, attendancePct: att.pct, pending, actions, closedLog: log });
}));

dashboardRouter.post('/eod/close', requirePermission('daily:create'), ah(async (req, res) => {
  const d = parse(z.object({ handoverNotes: z.string().max(4000).optional(), nextDayPriorities: z.array(z.string()).max(20).default([]), handoverTo: z.string().optional() }), req.body);
  const today = istDate();
  const pending = await Ticket.find({ status: { $in: OPEN_TICKET } }).select('number description').limit(50).lean();
  const att = await todaySummary();
  const log = await ShiftLog.findOneAndUpdate(
    { date: today, kind: 'eod' },
    {
      $set: { closed: true, handoverTo: d.handoverTo || undefined, nextDayPriorities: d.nextDayPriorities, pendingItems: pending.map((t) => `${t.number} — ${t.description.slice(0, 80)}`), closureSummary: { attendancePct: att.pct, openTickets: pending.length, closedBy: req.user.name, at: new Date() } },
      $push: { entries: { time: new Date(), text: d.handoverNotes || 'Day closed', by: req.user._id, byName: req.user.name } },
    },
    { upsert: true, new: true },
  );
  for (const p of d.nextDayPriorities) await ActionItem.create({ source: 'eod', title: p, ownerId: d.handoverTo || req.user._id, dueDate: istAt(addDays(today, 1), '18:00') });
  ok(res, log);
}));

// ── HSE metrics (FR-8.9) ──
dashboardRouter.get('/hse/metrics', requirePermission('hse:read'), ah(async (req, res) => {
  const yearStart = istAt(`${istDate().slice(0, 4)}-01-01`);
  const now = new Date();
  const [byType, lti, nearMiss, openCapa, overdueCapa, insp, obs, expiring] = await Promise.all([
    Incident.aggregate([{ $match: { occurredAt: { $gte: yearStart } } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Incident.countDocuments({ lti: true, occurredAt: { $gte: yearStart } }),
    Incident.countDocuments({ type: 'near_miss', occurredAt: { $gte: yearStart } }),
    Capa.countDocuments({ status: { $in: ['open', 'in_progress', 'done'] } }),
    Capa.countDocuments({ status: { $in: ['open', 'in_progress'] }, dueDate: { $lt: now } }),
    Inspection.aggregate([{ $match: { scheduledDate: { $lte: now } } }, { $group: { _id: null, total: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } } } }]),
    Observation.aggregate([{ $group: { _id: { $switch: { branches: [{ case: { $gte: ['$riskScore', 15] }, then: 'High' }, { case: { $gte: ['$riskScore', 8] }, then: 'Medium' }], default: 'Low' } }, n: { $sum: 1 } } }]),
    Compliance.countDocuments({ validTo: { $lte: new Date(+now + 60 * DAY_MS) } }),
  ]);
  ok(res, {
    incidentsByType: byType.map((x) => ({ name: x._id, count: x.n })), lti, nearMiss, openCapa, overdueCapa,
    inspectionCompliance: pct(insp[0]?.done || 0, insp[0]?.total || 0) ?? 100,
    observationsByRisk: obs.map((x) => ({ name: x._id, count: x.n })), compliancesExpiring: expiring,
  });
}));

export { isBroad };
