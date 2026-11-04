import { z } from 'zod';
import { ActionItem, Amc, AmcVisit, Incident, KpiSnapshot, Report, ReportSchedule, StockLedger, Ticket, VendorInvoice, WorkOrder, PRIORITIES, WO_DONE } from '../models/index.js';
import { reportPdf } from '../lib/pdf.js';
import { crud } from '../lib/crud.js';
import { ah, ok, parse, forbidden, notFound } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';
import { istDate, istAt, addDays } from '../lib/context.js';
import { computeKpis } from './dashboard.js';
import { todaySummary } from './attendance.js';
import { lowStock } from './inventory.js';
import { sendXlsx } from '../lib/excel.js';
import { sendEmail } from '../lib/notify.js';
import { env } from '../config/env.js';

const round = (n) => Math.round(n * 10) / 10;

export function periodFor(type, date = istDate()) {
  if (type === 'daily') return { start: istAt(date, '00:00'), end: istAt(date, '23:59'), label: date };
  if (type === 'weekly') return { start: istAt(addDays(date, -6), '00:00'), end: istAt(date, '23:59'), label: `${addDays(date, -6)} to ${date}` };
  const m = date.slice(0, 7);
  const end = new Date(istAt(`${m}-01`));
  end.setMonth(end.getMonth() + 1);
  return { start: istAt(`${m}-01`), end: new Date(+end - 60000), label: m };
}

// Builds a client report (FR-11.1–11.4). Every KPI row: Target → Actual → Variance → Responsibility → Corrective action.
export async function buildReport(type, date) {
  const { start, end, label } = periodFor(type, date);
  const range = { $gte: start, $lte: end };
  const tiles = await computeKpis();
  const kpis = tiles.map((t) => ({
    code: t.code, name: t.name, unit: t.unit, target: t.target, actual: t.actual, status: t.status, responsibility: t.responsibility,
    variance: t.actual == null ? null : round(t.direction === 'lower' ? t.target - t.actual : t.actual - t.target), correctiveAction: '',
  }));
  const data = {};
  if (type === 'daily') {
    const [manpower, incidents, breakdowns, complaints] = await Promise.all([
      todaySummary(),
      Incident.find({ occurredAt: range }).select('number title type severity status').lean(),
      WorkOrder.find({ type: 'breakdown', createdAt: range }).populate('assetId', 'code name criticality').select('number title status downtimeMin assetId').lean(),
      Ticket.find({ createdAt: range, priority: { $in: ['P1', 'P2'] } }).populate('categoryId', 'name').select('number description priority status categoryId').lean(),
    ]);
    Object.assign(data, {
      manpower,
      incidents,
      criticalBreakdowns: breakdowns.filter((w) => ['critical', 'high'].includes(w.assetId?.criticality)).map((w) => ({ number: w.number, asset: `${w.assetId?.code} ${w.assetId?.name}`, status: w.status, downtimeMin: w.downtimeMin })),
      majorComplaints: complaints.map((t) => ({ number: t.number, category: t.categoryId?.name, priority: t.priority, status: t.status, description: t.description })),
    });
  }
  if (type === 'weekly') {
    const [ppm, resolved, snaps, low, consumption, visits] = await Promise.all([
      WorkOrder.find({ type: 'ppm', plannedDate: range }).select('status plannedDate').lean(),
      Ticket.find({ 'sla.resolvedAt': range }).select('priority sla').lean(),
      KpiSnapshot.find({ date: { $gte: istDate(start), $lte: istDate(end) } }).lean(),
      lowStock(),
      StockLedger.aggregate([{ $match: { type: 'issue', at: range } }, { $group: { _id: '$itemId', qty: { $sum: { $multiply: ['$qty', -1] } }, value: { $sum: { $multiply: ['$qty', '$rate', -1] } } } }, { $sort: { value: -1 } }, { $limit: 10 }, { $lookup: { from: 'items', localField: '_id', foreignField: '_id', as: 'item' } }, { $unwind: '$item' }, { $project: { name: '$item.name', uom: '$item.uom', qty: 1, value: 1 } }]),
      AmcVisit.find({ plannedDate: range }).populate('vendorId', 'name').select('status vendorId').lean(),
    ]);
    const vend = {};
    for (const v of visits) {
      const k = v.vendorId?.name || '—';
      vend[k] ||= { vendor: k, planned: 0, done: 0, missed: 0 };
      vend[k].planned++;
      if (v.status === 'done') vend[k].done++;
      if (v.status === 'missed') vend[k].missed++;
    }
    const att = snaps.map((s) => s.values?.attendance?.actual).filter((x) => x != null);
    Object.assign(data, {
      ppm: { planned: ppm.length, done: ppm.filter((w) => WO_DONE.includes(w.status)).length, overdue: ppm.filter((w) => !WO_DONE.includes(w.status) && w.plannedDate < new Date()).length },
      sla: PRIORITIES.map((p) => { const rows = resolved.filter((t) => t.priority === p); return { priority: p, resolved: rows.length, compliant: rows.filter((t) => !t.sla?.resolutionBreached && !t.sla?.responseBreached).length }; }),
      attendanceAvg: att.length ? round(att.reduce((a, b) => a + b, 0) / att.length) : null,
      inventory: { lowStock: low.map((l) => ({ item: l.item.name, store: l.store.name, qty: l.qty, reorderLevel: l.item.reorderLevel })), topConsumption: consumption },
      vendorPerformance: Object.values(vend),
    });
  }
  if (type === 'monthly') {
    const [snaps, issues, invoices, amcs, incidents, actions] = await Promise.all([
      KpiSnapshot.find({ date: { $gte: istDate(start), $lte: istDate(end) } }).sort('date').lean(),
      StockLedger.aggregate([{ $match: { type: 'issue', at: range } }, { $group: { _id: null, value: { $sum: { $multiply: ['$qty', '$rate', -1] } } } }]),
      VendorInvoice.aggregate([{ $match: { status: { $in: ['approved', 'paid'] }, createdAt: range } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
      Amc.find({ status: { $nin: ['expired'] } }).populate('vendorId', 'name').select('name vendorId end status value').lean(),
      Incident.aggregate([{ $match: { occurredAt: range } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
      ActionItem.find({ createdAt: range }).populate('ownerId', 'name').select('title status dueDate ownerId').lean(),
    ]);
    Object.assign(data, {
      kpiTrend: snaps.map((s) => ({ date: s.date, ...Object.fromEntries(Object.entries(s.values || {}).map(([k, v]) => [k, v?.actual])) })),
      cost: { materials: Math.round(issues[0]?.value || 0), vendorInvoices: Math.round(invoices[0]?.total || 0), amc: Math.round(amcs.reduce((a, x) => a + (x.value || 0), 0) / 12) },
      amcStatus: amcs.map((a) => ({ name: a.name, vendor: a.vendorId?.name, end: a.end, status: a.status })),
      hse: incidents.map((i) => ({ type: i._id, count: i.n })),
      improvementActions: actions.map((a) => ({ title: a.title, owner: a.ownerId?.name, status: a.status, dueDate: a.dueDate })),
    });
  }
  return { periodStart: start, periodEnd: end, title: `${type[0].toUpperCase()}${type.slice(1)} report · ${label}`, kpis, data };
}

// Emails the report as a PDF to the schedule's recipients plus the property's client distribution list.
export async function sendReport(doc, property, user) {
  const schedules = await ReportSchedule.find({ type: doc.type, enabled: true }).lean();
  const to = [...new Set([...schedules.flatMap((s) => s.recipients || []), ...(property?.settings?.reportRecipients || [])].map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return 0;
  const rep = { ...(doc.toObject ? doc.toObject() : doc), signedBy: { name: user?.name } };
  const pdf = await reportPdf(rep, property);
  const text = `${doc.title}\n${property?.name || ''}\n\n${doc.commentary || ''}\n\nThe signed-off report is attached as a PDF. View it online: ${env.clientUrls[0]}/reports/${doc._id}`;
  await sendEmail(to.join(','), `${doc.title} — ${property?.name || 'PrimeSpace'}`, text, [{ filename: `${doc.title.replace(/[^\w-]+/g, '_')}.pdf`, content: pdf, contentType: 'application/pdf' }]);
  return to.length;
}

export async function generateReport(type, date, user) {
  const built = await buildReport(type, date);
  const existing = await Report.findOne({ type, periodStart: built.periodStart });
  if (existing && existing.status === 'draft') {
    existing.set({ ...built, kpis: built.kpis.map((k) => ({ ...k, correctiveAction: existing.kpis.find((e) => e.code === k.code)?.correctiveAction || '' })), version: existing.version + 1 });
    existing.history.push({ status: 'draft', by: user?._id, byName: user?.name || 'Scheduler', at: new Date(), note: `Regenerated (v${existing.version})` });
    return existing.save();
  }
  return Report.create({ ...built, type, version: existing ? existing.version + 1 : 1, history: [{ status: 'draft', by: user?._id, byName: user?.name || 'Scheduler', at: new Date(), note: 'Generated' }] });
}

export default crud(Report, {
  perm: 'report',
  label: 'Report',
  search: ['title'],
  sort: '-periodStart',
  populate: [{ path: 'signedBy', select: 'name' }, { path: 'acknowledgedBy', select: 'name' }],
  listSelect: '-data',
  disable: ['create'],
  lockedWhen: (doc) => doc.status !== 'draft',
  beforeUpdate: (data) => ({ commentary: data.commentary, kpis: data.kpis }),
  transitions: {
    map: { draft: ['signed_off'], signed_off: ['sent', 'draft'], sent: ['acknowledged'] },
    perms: { signed_off: 'report:approve', draft: 'report:approve', sent: 'report:create', acknowledged: 'report:approve' },
    guard: async (doc, to, req) => {
      const r = req.user.roles;
      if (['signed_off', 'draft', 'sent'].includes(to) && !req.user.isSuper && !r.includes('property_manager')) throw forbidden('Only the Property Manager can sign off and send client reports');
      if (to === 'acknowledged' && !req.user.isSuper && !r.includes('owner')) throw forbidden('Only the client / owner can acknowledge a report');
    },
    onEnter: {
      signed_off: async (doc, req) => {
        Object.assign(doc, { signedBy: req.user._id, signedAt: new Date() });
        const schedule = await ReportSchedule.findOne({ type: doc.type, enabled: true, sendOnSignOff: true }).lean();
        if (!schedule) return;
        const n = await sendReport(doc, req.property, req.user);
        if (n) {
          Object.assign(doc, { status: 'sent', sentAt: new Date() });
          doc.history.push({ status: 'sent', by: req.user._id, byName: req.user.name, at: new Date(), note: `Emailed with PDF to ${n} recipient(s) on sign-off` });
        }
      },
      sent: async (doc, req) => {
        doc.sentAt = new Date();
        const n = await sendReport(doc, req.property, req.user);
        doc.history.at(-1).note = `Emailed with PDF to ${n} recipient(s)`;
      },
      acknowledged: async (doc, req) => Object.assign(doc, { acknowledgedBy: req.user._id, acknowledgedAt: new Date() }),
    },
  },
  extend: (r) => {
    r.post('/generate', requirePermission('report:create'), ah(async (req, res) => {
      const d = parse(z.object({ type: z.enum(['daily', 'weekly', 'monthly']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.body);
      ok(res.status(201), await generateReport(d.type, d.date || istDate(), req.user));
    }));
    r.get('/:id/pdf', requirePermission('report:read'), ah(async (req, res) => {
      const rep = await Report.findById(req.params.id).populate('signedBy', 'name').lean();
      if (!rep) throw notFound('Report');
      const pdf = await reportPdf(rep, req.property);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${rep.title.replace(/[^\w-]+/g, '_')}.pdf"`);
      res.end(pdf);
    }));
    r.get('/:id/xlsx', requirePermission('report:read'), ah(async (req, res) => {
      const rep = await Report.findById(req.params.id).lean();
      if (!rep) throw notFound('Report');
      const cols = [['name', 'KPI'], ['target', 'Target'], ['actual', 'Actual'], ['variance', 'Variance'], ['status', 'Status'], ['responsibility', 'Responsibility'], ['correctiveAction', 'Corrective action']].map(([key, header]) => ({ key, header, width: key === 'correctiveAction' ? 50 : 18 }));
      await sendXlsx(res, rep.title.replace(/[^\w-]+/g, '_'), cols, rep.kpis);
    }));
  },
});
