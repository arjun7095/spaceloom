import { z } from 'zod';
import { Amc, AmcVisit, Asset, AssetCategory, ChecklistTemplate, MaterialIssue, MeterReading, PpmSchedule, Sop, Ticket, TicketCategory, WorkOrder, WO_OPEN, WO_DONE } from '../models/index.js';
import { crud } from '../lib/crud.js';
import { ah, ok, parse, bad, conflict, forbidden, notFound } from '../lib/http.js';
import { requirePermission, can, isBroad } from '../middleware/auth.js';
import { nextNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';
import { notify, usersWithRole } from '../lib/notify.js';
import { bumpKpis, emitProperty } from '../lib/socket.js';
import { createTicket, verifyTicket, afterTicketChange } from './tickets.js';
import { istDate, istAt, DAY_MS } from '../lib/context.js';

const STEP = { daily: [1, 'd'], weekly: [7, 'd'], fortnightly: [14, 'd'], monthly: [1, 'M'], quarterly: [3, 'M'], half_yearly: [6, 'M'], yearly: [12, 'M'] };
export function addFreq(date, freq) {
  const d = new Date(date);
  const [n, unit] = STEP[freq] || [30, 'd'];
  if (unit === 'd') d.setDate(d.getDate() + n);
  else d.setMonth(d.getMonth() + n);
  return d;
}

export const ASSET_TO_TICKET_CAT = { DG: 'ELEC', TRANSFORMER: 'ELEC', CHILLER: 'HVAC', AHU: 'HVAC', PUMP: 'PLUMB', STP: 'PLUMB', LIFT: 'LIFT', FIRE: 'ELEC' };

export function woScope(req) {
  const u = req.user;
  if (isBroad(u)) return {};
  if (u.roles.includes('supervisor')) return { $or: [{ departmentId: { $in: u.departmentIds } }, { assigneeIds: u._id }] };
  if (u.roles.includes('technician')) return { assigneeIds: u._id };
  if (u.roles.includes('vendor')) return { vendorId: u.vendorId };
  return { _id: null };
}

const checklistFrom = (tpl) => (tpl?.items || []).map((i) => ({ label: i.label, type: i.type, min: i.min, max: i.max, unit: i.unit, required: i.required, photoRequired: i.photoRequired, autoTicket: i.autoTicket }));

// Generates PPM work orders up to `daysAhead` days ahead (FR-4.3). Idempotent: one WO per schedule per date.
export async function generatePpm(daysAhead = 7, filter = {}) {
  const horizon = new Date(Date.now() + daysAhead * DAY_MS);
  const schedules = await PpmSchedule.find({ active: true, frequency: { $ne: 'run_hours' }, nextDueDate: { $lte: horizon }, ...filter })
    .populate('assetId', 'code name locationId departmentId').populate('templateId').lean();
  let created = 0;
  const make = async (s, planned) => {
    if (await WorkOrder.exists({ scheduleId: s._id, plannedDate: planned })) return;
    await WorkOrder.create({
      propertyId: s.propertyId, orgId: s.orgId, number: await nextNumber('WO', s.propertyId), type: s.kind === 'daily_check' ? 'daily_check' : 'ppm',
      title: s.title || `${s.kind === 'daily_check' ? 'Daily log' : 'PPM'} – ${s.assetId?.name}`, assetId: s.assetId?._id, scheduleId: s._id,
      locationId: s.assetId?.locationId, departmentId: s.departmentId || s.assetId?.departmentId,
      assigneeIds: s.assigneeIds, status: s.assigneeIds?.length ? 'assigned' : 'scheduled', priority: 'P3', plannedDate: planned,
      checklist: checklistFrom(s.templateId), history: [{ status: 'scheduled', byName: 'Scheduler', at: new Date() }],
    });
    created++;
  };
  const endOfToday = istAt(istDate(), '23:59');
  for (const s of schedules) {
    let due = new Date(s.nextDueDate);
    const until = s.kind === 'daily_check' ? endOfToday : horizon; // daily log sheets are created one day at a time
    for (let guard = 0; due <= until && guard < 60; guard++) {
      await make(s, due);
      due = addFreq(due, s.frequency);
    }
    await PpmSchedule.updateOne({ _id: s._id }, { nextDueDate: due }).setOptions({ unscoped: true });
  }
  const byHours = await PpmSchedule.find({ active: true, frequency: 'run_hours', ...filter }).populate('assetId', 'code name locationId departmentId runHours').populate('templateId').lean();
  for (const s of byHours) {
    const hours = s.assetId?.runHours || 0;
    if (hours - (s.lastRunHours || 0) >= (s.runHoursInterval || 250)) {
      await make(s, istAt(istDate(), '00:00'));
      await PpmSchedule.updateOne({ _id: s._id }, { lastRunHours: hours }).setOptions({ unscoped: true });
    }
  }
  return created;
}

const DETAIL_POP = [
  { path: 'assetId', select: 'code name criticality status categoryId locationId' },
  { path: 'locationId', select: 'name path' },
  { path: 'assigneeIds', select: 'name mobile' },
  { path: 'ticketId', select: 'number status description priority sla categoryId' },
  { path: 'scheduleId', select: 'frequency title sopId templateId' },
  { path: 'departmentId', select: 'name' },
  { path: 'verifiedBy', select: 'name' },
  { path: 'partsUsed.itemId', select: 'code name uom' },
];

async function load(req) {
  const wo = await WorkOrder.findOne({ _id: req.params.id, ...woScope(req) });
  if (!wo) throw notFound('Work order');
  return wo;
}
const isAssignee = (wo, u) => wo.assigneeIds.some((id) => String(id) === u.id);

const VIEWS = {
  open: () => ({ status: { $in: WO_OPEN } }),
  verification: () => ({ status: 'completed' }),
  done: () => ({ status: { $in: WO_DONE } }),
  overdue: () => ({ status: { $in: WO_OPEN }, plannedDate: { $lt: new Date(Date.now() - DAY_MS) } }),
  today: () => ({ plannedDate: { $gte: istAt(istDate(), '00:00'), $lte: istAt(istDate(), '23:59') } }),
};

function extend(r) {
  r.get('/calendar', requirePermission('workorder:read'), ah(async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : istDate().slice(0, 7);
    const start = istAt(`${month}-01`, '00:00');
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    const q = { ...woScope(req), plannedDate: { $gte: start, $lt: end } };
    if (req.query.type) q.type = req.query.type;
    const rows = await WorkOrder.find(q).select('number title type status plannedDate priority assetId').populate('assetId', 'code').sort('plannedDate').limit(2000).lean();
    ok(res, rows);
  }));

  // Daily critical-asset log sheet (FR-4.5): every daily check for one date with its readings.
  r.get('/log-sheet', requirePermission('workorder:read'), ah(async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : istDate();
    const rows = await WorkOrder.find({ type: 'daily_check', plannedDate: { $gte: istAt(date, '00:00'), $lte: istAt(date, '23:59') } })
      .populate('assetId', 'code name criticality status').populate('assigneeIds', 'name').populate('scheduleId', 'title')
      .select('number title status assetId checklist completedAt assigneeIds scheduleId offlineSync').sort('title').lean();
    ok(res, { date, rows });
  }));

  r.get('/:id', requirePermission('workorder:read'), ah(async (req, res) => {
    const wo = await WorkOrder.findOne({ _id: req.params.id, ...woScope(req) }).populate(DETAIL_POP).lean();
    if (!wo) throw notFound('Work order');
    let sopId = wo.scheduleId?.sopId;
    if (!sopId && wo.scheduleId?.templateId) sopId = (await ChecklistTemplate.findById(wo.scheduleId.templateId).select('sopId').lean())?.sopId;
    if (!sopId && wo.ticketId?.categoryId) sopId = (await TicketCategory.findById(wo.ticketId.categoryId).select('sopId').lean())?.sopId;
    const [issues, sop] = await Promise.all([
      MaterialIssue.find({ workOrderId: wo._id }).populate('items.itemId', 'code name uom').populate('storeId', 'name').sort('-createdAt').lean(),
      sopId ? Sop.findById(sopId).select('title version content fileUrl').lean() : null,
    ]);
    ok(res, { ...wo, materialIssues: issues, sop });
  }));

  r.post('/:id/assign', requirePermission('workorder:assign'), ah(async (req, res) => {
    const { assigneeIds } = parse(z.object({ assigneeIds: z.array(z.string()).min(1, 'Choose at least one person') }), req.body);
    const wo = await load(req);
    if (!['scheduled', 'assigned', 'on_hold'].includes(wo.status)) throw conflict('This work order can no longer be reassigned');
    const before = wo.toObject();
    wo.assigneeIds = assigneeIds;
    wo.status = 'assigned';
    wo.history.push({ status: 'assigned', by: req.user._id, byName: req.user.name, at: new Date() });
    await wo.save();
    await audit('update', 'WorkOrder', wo, before);
    await notify({ userIds: assigneeIds, propertyId: wo.propertyId, type: 'wo_assigned', title: `Work order ${wo.number} assigned to you`, body: wo.title, link: `/work-orders/${wo._id}` });
    ok(res, wo);
  }));

  r.post('/:id/start', requirePermission('workorder:update'), ah(async (req, res) => {
    const wo = await load(req);
    if (!isAssignee(wo, req.user) && !can(req.user, 'workorder:assign')) throw forbidden('Only the assigned person can start this job');
    if (!['scheduled', 'assigned', 'on_hold'].includes(wo.status)) throw conflict('This work order has already started or finished');
    wo.status = 'in_progress';
    wo.startedAt ||= new Date();
    if (!wo.assigneeIds.length) wo.assigneeIds = [req.user._id];
    wo.history.push({ status: 'in_progress', by: req.user._id, byName: req.user.name, at: new Date() });
    await wo.save();
    if (wo.ticketId) {
      const t = await Ticket.findById(wo.ticketId);
      if (t && ['assigned', 'reopened'].includes(t.status)) {
        t.status = 'acknowledged';
        t.sla.respondedAt ||= new Date();
        t.sla.responseBreached = t.sla.respondedAt > t.sla.responseDue;
        t.history.push({ status: 'acknowledged', by: req.user._id, byName: req.user.name, at: new Date() });
      }
      if (t && t.status === 'acknowledged') {
        t.status = 'in_progress';
        t.history.push({ status: 'in_progress', by: req.user._id, byName: req.user.name, at: new Date(), note: 'Work started' });
        await t.save();
        await afterTicketChange(t);
      }
    }
    ok(res, wo);
  }));

  r.post('/:id/complete', requirePermission('workorder:update'), ah(async (req, res) => {
    const d = parse(z.object({
      checklist: z.array(z.object({ value: z.any().optional(), photoUrl: z.string().optional() })).optional(),
      findings: z.string().max(4000).optional(),
      beforePhotos: z.array(z.string()).max(10).optional(),
      afterPhotos: z.array(z.string()).max(10).optional(),
      signature: z.string().max(500000).optional(),
      clientTime: z.string().optional(),
    }), req.body);
    const wo = await load(req);
    if (!isAssignee(wo, req.user) && !can(req.user, 'workorder:assign')) throw forbidden('Only the assigned person can complete this job');
    const routine = ['ppm', 'daily_check'].includes(wo.type);
    if (wo.status !== 'in_progress' && !(routine && ['scheduled', 'assigned'].includes(wo.status))) throw conflict('Start the job before completing it');
    // Work completed offline keeps the time it was really done (accepted up to 24 h back).
    const now = new Date();
    const client = d.clientTime ? new Date(d.clientTime) : null;
    const at = client && !Number.isNaN(+client) && client <= new Date(+now + 120000) && client >= new Date(+now - 864e5) && (!wo.startedAt || client >= wo.startedAt) ? client : now;
    const before = wo.toObject();
    const errors = {};
    const deviations = [];
    wo.checklist.forEach((item, i) => {
      const v = d.checklist?.[i]?.value;
      item.value = v;
      item.photoUrl = d.checklist?.[i]?.photoUrl || item.photoUrl;
      const empty = v === undefined || v === null || v === '';
      if (item.required && empty && item.type !== 'photo') errors[`checklist.${i}`] = ['Required'];
      if ((item.photoRequired || item.type === 'photo') && item.required !== false && !item.photoUrl) errors[`checklist.${i}`] = ['Photo required'];
      const n = Number(v);
      item.deviation = ((item.type === 'number' || item.type === 'reading') && !empty && ((item.min != null && n < item.min) || (item.max != null && n > item.max)))
        || (item.type === 'yesno' && item.required && (v === false || v === 'no'));
      if (item.deviation) deviations.push(item);
    });
    if (Object.keys(errors).length) throw bad('Please complete every required checklist item', errors);
    if (['breakdown', 'corrective'].includes(wo.type) && !d.afterPhotos?.length) throw bad('Add at least one "after" photo as completion evidence', { afterPhotos: ['Required'] });
    if (!d.signature && wo.type !== 'daily_check') throw bad('Please sign to confirm the work is complete', { signature: ['Required'] });
    const offlineSync = at < new Date(+now - 120000);
    // Daily log sheets need no supervisor sign-off; everything else waits for verification.
    Object.assign(wo, { findings: d.findings, beforePhotos: d.beforePhotos || [], afterPhotos: d.afterPhotos || [], signature: d.signature, status: wo.type === 'daily_check' ? 'closed' : 'completed', completedAt: at, startedAt: wo.startedAt || at, offlineSync });
    if (!wo.assigneeIds.length) wo.assigneeIds = [req.user._id];
    wo.history.push({ status: 'completed', by: req.user._id, byName: req.user.name, at, note: [deviations.length ? `${deviations.length} reading(s) out of range` : '', offlineSync ? 'done offline, synced later' : ''].filter(Boolean).join(' · ') || undefined });
    await wo.save();
    await audit('update', 'WorkOrder', wo, before);
    // Numeric checklist readings feed the asset's meter-reading history (log sheets, trends, run hours).
    if (routine && wo.assetId) {
      const readings = wo.checklist.filter((c) => ['number', 'reading'].includes(c.type) && c.value !== '' && c.value != null && !Number.isNaN(Number(c.value)));
      for (const c of readings) {
        const type = c.unit === 'h' ? 'run_hours' : /°C/.test(c.unit || '') ? 'temperature' : /fuel/i.test(c.label) ? 'dg_fuel' : /kwh/i.test(c.unit || '') ? 'energy' : 'other';
        await MeterReading.create({ propertyId: wo.propertyId, orgId: wo.orgId, assetId: wo.assetId, type, label: c.label, value: Number(c.value), unit: c.unit, readAt: at, workOrderId: wo._id });
        if (type === 'run_hours') await Asset.updateOne({ _id: wo.assetId }, { runHours: Number(c.value) });
      }
    }

    if (wo.ticketId) {
      const t = await Ticket.findById(wo.ticketId);
      if (t) {
        t.awaitingVerification = true;
        t.resolutionNotes = d.findings;
        t.history.push({ status: t.status, by: req.user._id, byName: req.user.name, at: new Date(), note: 'Work completed — waiting for supervisor verification' });
        await t.save();
        await afterTicketChange(t);
      }
    }
    // FR-4.4: out-of-range readings on PPM raise a breakdown ticket automatically.
    if (routine && deviations.some((x) => x.autoTicket !== false)) {
      const asset = await Asset.findById(wo.assetId).lean();
      const ac = asset && (await AssetCategory.findById(asset.categoryId).lean());
      const cat = (await TicketCategory.findOne({ code: ASSET_TO_TICKET_CAT[ac?.code] || 'ELEC' }).lean()) || (await TicketCategory.findOne().lean());
      if (cat) {
        await createTicket({
          property: req.property, user: req.user, source: 'checklist',
          data: { categoryId: cat._id, assetId: wo.assetId, locationId: wo.locationId, description: `Checklist deviation on ${asset?.code} during ${wo.number}: ${deviations.map((x) => `${x.label} = ${x.value}${x.unit ? ` ${x.unit}` : ''}`).join('; ')}` },
        });
      }
    }
    const sups = wo.type === 'daily_check' ? [] : await usersWithRole(wo.propertyId, ['supervisor'], wo.departmentId);
    await notify({ userIds: sups.map((u) => u._id), propertyId: wo.propertyId, type: 'wo_completed', title: `${wo.number} is ready for verification`, body: wo.title, link: wo.ticketId ? `/tickets/${wo.ticketId}` : `/work-orders/${wo._id}` });
    emitProperty(String(wo.propertyId), 'wo:updated', { _id: wo._id, status: wo.status });
    bumpKpis(wo.propertyId);
    ok(res, wo);
  }));

  r.post('/:id/verify', requirePermission('workorder:verify'), ah(async (req, res) => {
    const wo = await load(req);
    if (wo.status !== 'completed') throw conflict('Only completed work orders can be verified');
    if (wo.ticketId) {
      const t = await Ticket.findById(wo.ticketId);
      await verifyTicket(t, req.user);
      return ok(res, await WorkOrder.findById(wo._id).lean());
    }
    const before = wo.toObject();
    Object.assign(wo, { status: 'verified', verifiedBy: req.user._id, verifiedAt: new Date() });
    wo.history.push({ status: 'verified', by: req.user._id, byName: req.user.name, at: new Date() });
    await wo.save();
    await audit('update', 'WorkOrder', wo, before);
    bumpKpis(wo.propertyId);
    ok(res, wo);
  }));

  r.post('/:id/reject', requirePermission('workorder:verify'), ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(3, 'Tell the technician what to fix') }), req.body);
    const wo = await load(req);
    if (wo.status !== 'completed') throw conflict('Only completed work orders can be sent back');
    wo.status = 'in_progress';
    wo.rejectReason = reason;
    wo.history.push({ status: 'in_progress', by: req.user._id, byName: req.user.name, at: new Date(), note: `Sent back: ${reason}` });
    await wo.save();
    if (wo.ticketId) await Ticket.updateOne({ _id: wo.ticketId }, { awaitingVerification: false, $push: { history: { status: 'in_progress', by: req.user._id, byName: req.user.name, at: new Date(), note: `Supervisor sent the work back: ${reason}` } } });
    await notify({ userIds: wo.assigneeIds, propertyId: wo.propertyId, type: 'wo_rejected', title: `${wo.number} needs more work`, body: reason, link: wo.ticketId ? `/tickets/${wo.ticketId}` : `/work-orders/${wo._id}` });
    ok(res, wo);
  }));
}

export default crud(WorkOrder, {
  perm: 'workorder',
  label: 'Work order',
  search: ['number', 'title', 'findings'],
  populate: [{ path: 'assetId', select: 'code name' }, { path: 'locationId', select: 'path name' }, { path: 'assigneeIds', select: 'name' }, { path: 'ticketId', select: 'number' }],
  scopeFilter: woScope,
  number: 'WO',
  kpi: true,
  disable: ['update'],
  dateField: 'plannedDate',
  queryHook: (q, req) => {
    const v = req.query.view;
    if (VIEWS[v]) q.$and.push(VIEWS[v]());
    if (v === 'my') q.$and.push({ assigneeIds: req.user._id, status: { $in: [...WO_OPEN, 'completed'] } });
  },
  beforeCreate: async (data) => {
    const tpl = data.templateId ? await ChecklistTemplate.findById(data.templateId).lean() : null;
    return { ...data, status: data.assigneeIds?.length ? 'assigned' : 'scheduled', checklist: tpl ? checklistFrom(tpl) : data.checklist || [], plannedDate: data.plannedDate || new Date() };
  },
  extend,
});

// ── Asset extras: history timeline, reliability, meter readings, QR lookup ───
export function assetExtend(r) {
  r.get('/by-code/:code', requirePermission('asset:read'), ah(async (req, res) => {
    const a = await Asset.findOne({ code: req.params.code.toUpperCase() }).select('_id code name').lean();
    if (!a) throw notFound('Asset');
    ok(res, a);
  }));

  r.get('/:id/history', requirePermission('asset:read'), ah(async (req, res) => {
    const id = req.params.id;
    const amcs = await Amc.find({ assetIds: id }).select('_id name').lean();
    const [wos, tickets, visits, readings] = await Promise.all([
      WorkOrder.find({ assetId: id }).select('number type title status plannedDate completedAt downtimeMin partsUsed ticketId').sort('-plannedDate').limit(200).lean(),
      Ticket.find({ assetId: id }).select('number description status priority createdAt').sort('-createdAt').limit(100).lean(),
      AmcVisit.find({ amcId: { $in: amcs.map((a) => a._id) } }).select('plannedDate actualDate status findings technicianName amcId').sort('-plannedDate').limit(50).lean(),
      MeterReading.find({ assetId: id }).sort('-readAt').limit(30).lean(),
    ]);
    const events = [
      ...wos.map((w) => ({ at: w.completedAt || w.plannedDate, kind: w.type, title: `${w.number} · ${w.title || w.type}`, status: w.status, cost: (w.partsUsed || []).reduce((a, p) => a + (p.cost || 0), 0), downtimeMin: w.downtimeMin, link: w.ticketId ? `/tickets/${w.ticketId}` : `/work-orders/${w._id}` })),
      ...tickets.map((t) => ({ at: t.createdAt, kind: 'ticket', title: `${t.number} · ${t.description}`, status: t.status, priority: t.priority, link: `/tickets/${t._id}` })),
      ...visits.map((v) => ({ at: v.actualDate || v.plannedDate, kind: 'amc_visit', title: `AMC visit · ${amcs.find((a) => String(a._id) === String(v.amcId))?.name || ''}`, status: v.status, note: v.findings })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));
    const totals = {
      partsCost: events.reduce((a, e) => a + (e.cost || 0), 0),
      downtimeMin: wos.reduce((a, w) => a + (w.downtimeMin || 0), 0),
      ppmDone: wos.filter((w) => w.type === 'ppm' && WO_DONE.includes(w.status)).length,
      breakdowns: wos.filter((w) => w.type === 'breakdown').length,
    };
    ok(res, { events, totals, readings });
  }));

  r.get('/:id/reliability', requirePermission('asset:read'), ah(async (req, res) => {
    const asset = await Asset.findById(req.params.id).lean();
    if (!asset) throw notFound('Asset');
    const since = new Date(Math.max(Date.now() - 365 * DAY_MS, +new Date(asset.installDate || 0)));
    const fails = await WorkOrder.find({ assetId: asset._id, type: 'breakdown', status: { $in: WO_DONE }, completedAt: { $gte: since } }).select('downtimeMin').lean();
    const downH = fails.reduce((a, w) => a + (w.downtimeMin || 0), 0) / 60;
    const windowH = (Date.now() - since) / 36e5;
    ok(res, {
      failures: fails.length,
      mttrHours: fails.length ? Math.round((downH / fails.length) * 10) / 10 : 0,
      mtbfHours: fails.length ? Math.round((windowH - downH) / fails.length) : Math.round(windowH),
      availabilityPct: Math.round(((windowH - downH) / windowH) * 1000) / 10,
      windowDays: Math.round(windowH / 24),
    });
  }));

  r.get('/:id/meter-readings', requirePermission('asset:read'), ah(async (req, res) => {
    ok(res, await MeterReading.find({ assetId: req.params.id }).sort('readAt').limit(500).lean());
  }));

  r.post('/:id/meter-readings', requirePermission('asset:read'), ah(async (req, res) => {
    const d = parse(z.object({ type: z.enum(['energy', 'water', 'dg_fuel', 'run_hours', 'temperature', 'other']), value: z.number(), unit: z.string().optional(), note: z.string().optional(), readAt: z.string().optional() }), req.body);
    const asset = await Asset.findById(req.params.id);
    if (!asset) throw notFound('Asset');
    const m = await MeterReading.create({ ...d, assetId: asset._id, readAt: d.readAt ? new Date(d.readAt) : new Date() });
    if (d.type === 'run_hours') await Asset.updateOne({ _id: asset._id }, { runHours: d.value });
    ok(res.status(201), m);
  }));
}

export function ppmScheduleExtend(r) {
  r.post('/:id/generate', requirePermission('ppm:create'), ah(async (req, res) => {
    const n = await generatePpm(Number(req.body?.days) || 30, { _id: req.params.id });
    ok(res, { created: n });
  }));
}
