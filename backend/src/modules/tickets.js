import { z } from 'zod';
import { Asset, Attendance, Department, Employee, MaterialIssue, Role, Roster, Ticket, TicketCategory, User, WorkOrder, OPEN_TICKET, PRIORITIES, WO_OPEN } from '../models/index.js';
import { crud } from '../lib/crud.js';
import { ah, ok, parse, bad, conflict, forbidden, notFound, label } from '../lib/http.js';
import { requirePermission, can, isBroad, hasOnly } from '../middleware/auth.js';
import { nextNumber } from '../lib/numbering.js';
import { buildSla } from '../lib/sla.js';
import { audit } from '../lib/audit.js';
import { notify, usersWithRole } from '../lib/notify.js';
import { emitProperty, emitUser, bumpKpis } from '../lib/socket.js';
import { istDate, istAt } from '../lib/context.js';

// FR-5.7 lifecycle. Any move not listed here returns 409.
export const TICKET_FLOW = {
  new: ['assigned', 'cancelled'],
  assigned: ['assigned', 'acknowledged', 'cancelled'],
  reopened: ['assigned', 'acknowledged'],
  acknowledged: ['in_progress', 'on_hold'],
  in_progress: ['on_hold', 'resolved'],
  on_hold: ['in_progress'],
  resolved: ['tenant_confirmed', 'reopened', 'closed'],
  tenant_confirmed: ['closed'],
};

export function moveTicket(t, to, user, note) {
  if (!(TICKET_FLOW[t.status] || []).includes(to)) throw conflict(`A ticket that is "${label(t.status)}" cannot move to "${label(to)}"`);
  t.status = to;
  t.history.push({ status: to, by: user?._id, byName: user?.name || 'System', at: new Date(), note });
}

const CRIT_PRIORITY = { critical: 'P1', high: 'P2', normal: 'P4' };
export function suggestPriority(category, asset) {
  const a = asset ? CRIT_PRIORITY[asset.criticality] || 'P4' : 'P4';
  const c = category?.defaultPriority || 'P3';
  return PRIORITIES[Math.min(PRIORITIES.indexOf(a), PRIORITIES.indexOf(c))];
}

export function ticketScope(req) {
  const u = req.user;
  if (isBroad(u)) return {};
  if (u.roles.includes('supervisor')) return { assignedDeptId: { $in: u.departmentIds } };
  if (u.roles.includes('technician')) return { $or: [{ assigneeId: u._id }, { reporterId: u._id }] };
  if (u.roles.includes('vendor')) return { vendorId: u.vendorId };
  if (u.roles.includes('tenant') && u.tenantId) return { tenantId: u.tenantId };
  return { reporterId: u._id };
}

export async function afterTicketChange(t, event = 'ticket:updated') {
  emitProperty(String(t.propertyId), event, { _id: t._id, number: t.number, status: t.status, priority: t.priority });
  bumpKpis(t.propertyId);
}

export async function createTicket({ property, user, data, source }) {
  const [category, asset] = await Promise.all([
    TicketCategory.findById(data.categoryId).lean(),
    data.assetId ? Asset.findById(data.assetId).lean() : null,
  ]);
  if (!category) throw bad('Choose a valid category', { categoryId: ['Invalid'] });
  const suggested = suggestPriority(category, asset);
  let priority = suggested;
  if (data.priority && data.priority !== suggested && !(user && hasOnly(user, 'tenant'))) {
    if (!data.priorityOverrideReason) throw bad('Give a reason for changing the suggested priority', { priorityOverrideReason: ['Required when you change the priority'] });
    priority = data.priority;
  }
  const dept = await Department.findOne({ code: category.departmentCode }).lean();
  const t = await Ticket.create({
    number: await nextNumber('TKT', property._id),
    source, categoryId: category._id, subCategory: data.subCategory, locationId: data.locationId || asset?.locationId,
    assetId: asset?._id, description: data.description, photos: data.photos || [],
    reporterId: user?._id, tenantId: data.tenantId || undefined,
    priority, suggestedPriority: suggested, priorityOverrideReason: priority !== suggested ? data.priorityOverrideReason : undefined,
    status: 'new', assignedDeptId: dept?._id, sla: await buildSla(property, priority),
    history: [{ status: 'new', by: user?._id, byName: user?.name || 'System', at: new Date(), note: `Raised via ${label(source)}` }],
  });
  await audit('create', 'Ticket', t);
  await afterTicketChange(t, 'ticket:created');
  const sups = await usersWithRole(property._id, ['supervisor'], dept?._id);
  await notify({
    userIds: sups.map((u) => u._id), propertyId: property._id, type: 'ticket_created',
    title: `New ${priority} ${category.name} ticket ${t.number}`, body: data.description.slice(0, 120), link: `/tickets/${t._id}`,
    channels: priority === 'P1' ? ['in_app', 'email', 'sms'] : ['in_app'],
  });
  return t;
}

// Supervisor verification closes the work order and marks the ticket Resolved (FR-5.9).
export async function verifyTicket(t, user, { resolutionNotes } = {}) {
  const wo = t.workOrderId ? await WorkOrder.findById(t.workOrderId) : null;
  if (wo && wo.status !== 'completed') throw conflict('The technician has not completed the work order yet');
  if (!wo && !resolutionNotes && !t.resolutionNotes) throw bad('Add resolution notes', { resolutionNotes: ['Required'] });
  const now = new Date();
  moveTicket(t, 'resolved', user, 'Verified by supervisor');
  t.sla.resolvedAt = now;
  t.sla.resolutionBreached = now > t.sla.resolutionDue;
  t.awaitingVerification = false;
  t.resolutionNotes = resolutionNotes || t.resolutionNotes || wo?.findings;
  t.tenantConfirmation = { status: 'pending' };
  if (wo) {
    wo.status = 'verified';
    wo.verifiedBy = user._id;
    wo.verifiedAt = now;
    if (wo.type === 'breakdown') wo.downtimeMin = Math.round(((wo.completedAt || now) - t.createdAt) / 60000);
    wo.history.push({ status: 'verified', by: user._id, byName: user.name, at: now });
    await wo.save();
    if (wo.assetId) await Asset.updateOne({ _id: wo.assetId }, { status: 'running' });
  }
  await t.save();
  await notify({ userIds: [t.reporterId], propertyId: t.propertyId, type: 'ticket_resolved', title: `${t.number} is resolved`, body: 'Please confirm the fix and rate the service.', link: `/tickets/${t._id}`, channels: ['in_app', 'email'] });
  await afterTicketChange(t);
  return t;
}

const VIEWS = {
  open: { status: { $in: OPEN_TICKET } },
  critical: { status: { $in: OPEN_TICKET }, priority: 'P1' },
  unassigned: { status: { $in: ['new', 'reopened'] } },
  breached: { $or: [{ 'sla.resolutionBreached': true }, { 'sla.responseBreached': true }] },
  verification: { awaitingVerification: true },
  resolved: { status: 'resolved' },
  closed: { status: { $in: ['closed', 'tenant_confirmed', 'cancelled'] } },
};

const LIST_POP = [
  { path: 'categoryId', select: 'name code' },
  { path: 'locationId', select: 'name path' },
  { path: 'assetId', select: 'code name' },
  { path: 'assigneeId', select: 'name' },
  { path: 'tenantId', select: 'name' },
];
const DETAIL_POP = [
  { path: 'categoryId', select: 'name code subCategories' },
  { path: 'locationId', select: 'name code path' },
  { path: 'assetId', select: 'code name criticality status' },
  { path: 'assigneeId', select: 'name mobile email' },
  { path: 'reporterId', select: 'name email mobile' },
  { path: 'tenantId', select: 'name' },
  { path: 'assignedDeptId', select: 'name code' },
  { path: 'mergedInto', select: 'number' },
  { path: 'workOrderId', populate: { path: 'partsUsed.itemId', select: 'code name uom' } },
];

const createSchema = z.object({
  categoryId: z.string({ required_error: 'Choose a category' }).min(1, 'Choose a category'),
  subCategory: z.string().optional(),
  locationId: z.string().optional().nullable(),
  assetId: z.string().optional().nullable(),
  description: z.string().min(5, 'Describe the problem in a few words').max(2000),
  photos: z.array(z.string()).max(5).optional(),
  priority: z.enum(PRIORITIES).optional(),
  priorityOverrideReason: z.string().optional(),
  source: z.enum(['helpdesk', 'mobile', 'qr', 'email']).optional(),
  tenantId: z.string().optional().nullable(),
});

async function load(req) {
  const t = await Ticket.findOne({ _id: req.params.id, ...ticketScope(req) });
  if (!t) throw notFound('Ticket');
  return t;
}
const isAssignee = (t, u) => String(t.assigneeId) === u.id;
function ensureWorker(t, req) {
  if (!isAssignee(t, req.user) && !can(req.user, 'ticket:assign')) throw forbidden('Only the assigned technician or a supervisor can do this');
}
async function saveAndBroadcast(req, res, t, before) {
  await t.save();
  await audit('update', 'Ticket', t, before);
  await afterTicketChange(t);
  ok(res, t);
}

function extend(r) {
  r.get('/dashboard', requirePermission('ticket:read'), ah(async (req, res) => {
    const scope = ticketScope(req);
    const now = Date.now();
    const d30 = new Date(now - 30 * 864e5);
    const [open, resolved, trend] = await Promise.all([
      Ticket.find({ ...scope, status: { $in: OPEN_TICKET } }).select('priority createdAt categoryId assignedDeptId sla status').populate('categoryId', 'name').populate('assignedDeptId', 'name').lean(),
      Ticket.find({ ...scope, 'sla.resolvedAt': { $gte: d30 } }).select('priority sla').lean(),
      Ticket.aggregate([
        { $match: { createdAt: { $gte: new Date(now - 14 * 864e5) } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, raised: { $sum: 1 }, closed: { $sum: { $cond: [{ $in: ['$status', ['closed', 'tenant_confirmed']] }, 1, 0] } } } },
        { $sort: { _id: 1 } },
      ]),
    ]);
    const ageing = { '0-4h': 0, '4-24h': 0, '1-3d': 0, '>3d': 0 };
    const byCategory = {};
    const byDepartment = {};
    for (const t of open) {
      const h = (now - t.createdAt) / 36e5;
      ageing[h < 4 ? '0-4h' : h < 24 ? '4-24h' : h < 72 ? '1-3d' : '>3d']++;
      const c = t.categoryId?.name || 'Other';
      byCategory[c] = (byCategory[c] || 0) + 1;
      const d = t.assignedDeptId?.name || 'Unassigned';
      byDepartment[d] = (byDepartment[d] || 0) + 1;
    }
    const compliant = (t) => !t.sla?.resolutionBreached && !t.sla?.responseBreached;
    const byPriority = PRIORITIES.map((p) => {
      const rows = resolved.filter((t) => t.priority === p);
      return { priority: p, total: rows.length, compliant: rows.filter(compliant).length };
    });
    ok(res, {
      open: open.length,
      critical: open.filter((t) => t.priority === 'P1').length,
      breachedOpen: open.filter((t) => t.sla?.resolutionBreached || t.sla?.responseBreached).length,
      ageing: Object.entries(ageing).map(([bucket, count]) => ({ bucket, count })),
      byCategory: Object.entries(byCategory).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      byDepartment: Object.entries(byDepartment).map(([name, count]) => ({ name, count })),
      slaCompliance: resolved.length ? Math.round((resolved.filter(compliant).length / resolved.length) * 1000) / 10 : 100,
      byPriority,
      trend: trend.map((d) => ({ date: d._id, raised: d.raised, closed: d.closed })),
    });
  }));

  r.get('/check-duplicate', requirePermission('ticket:read'), ah(async (req, res) => {
    const { locationId, categoryId } = req.query;
    if (!locationId || !categoryId) return ok(res, []);
    const rows = await Ticket.find({ locationId, categoryId, status: { $in: OPEN_TICKET }, createdAt: { $gte: new Date(Date.now() - 2 * 36e5) } })
      .select('number description status priority createdAt').limit(5).lean();
    ok(res, rows);
  }));

  r.get('/suggest-priority', requirePermission('ticket:read'), ah(async (req, res) => {
    const [category, asset] = await Promise.all([
      req.query.categoryId ? TicketCategory.findById(req.query.categoryId).lean() : null,
      req.query.assetId ? Asset.findById(req.query.assetId).lean() : null,
    ]);
    ok(res, { priority: suggestPriority(category, asset), departmentCode: category?.departmentCode });
  }));

  r.post('/', requirePermission('ticket:create'), ah(async (req, res) => {
    const d = parse(createSchema, req.body);
    const tenantOnly = hasOnly(req.user, 'tenant');
    const source = tenantOnly ? 'tenant_portal' : d.source || (req.user.roles.includes('helpdesk') ? 'helpdesk' : 'mobile');
    if (tenantOnly) d.tenantId = req.user.tenantId;
    if (!d.locationId && !d.assetId) throw bad('Choose where the problem is', { locationId: ['Required'] });
    const t = await createTicket({ property: req.property, user: req.user, data: d, source });
    ok(res.status(201), t);
  }));

  r.get('/:id', requirePermission('ticket:read'), ah(async (req, res) => {
    const t = await Ticket.findOne({ _id: req.params.id, ...ticketScope(req) }).populate(DETAIL_POP).lean();
    if (!t) throw notFound('Ticket');
    const issues = t.workOrderId ? await MaterialIssue.find({ workOrderId: t.workOrderId._id }).populate('items.itemId', 'code name uom').populate('storeId', 'name').lean() : [];
    ok(res, { ...t, materialIssues: issues });
  }));

  // Technicians for assignment: skill match, on shift today, open workload (FR-5.6).
  r.get('/:id/technicians', requirePermission('ticket:assign'), ah(async (req, res) => {
    const t = await load(req);
    const cat = await TicketCategory.findById(t.categoryId).lean();
    const roleIds = (await Role.find({ key: 'technician' }).select('_id').lean()).map((x) => x._id);
    const users = await User.find({ roleIds: { $in: roleIds }, propertyIds: t.propertyId, status: 'active' })
      .populate('employeeId', 'name code skills departmentId designation').select('name mobile employeeId').lean();
    const pool = users.filter((u) => !t.assignedDeptId || String(u.employeeId?.departmentId) === String(t.assignedDeptId));
    const empIds = pool.map((u) => u.employeeId?._id).filter(Boolean);
    const today = istDate();
    const [rosters, atts, loads] = await Promise.all([
      Roster.find({ employeeId: { $in: empIds }, date: today }).populate('shiftId', 'name code start end crossesMidnight').lean(),
      Attendance.find({ employeeId: { $in: empIds }, date: today }).select('employeeId checkIn checkOut').lean(),
      WorkOrder.aggregate([{ $match: { assigneeIds: { $in: pool.map((u) => u._id) }, status: { $in: WO_OPEN }, plannedDate: { $lte: istAt(today, '23:59') } } }, { $unwind: '$assigneeIds' }, { $group: { _id: '$assigneeIds', n: { $sum: 1 } } }]),
    ]);
    const now = new Date();
    const skillKey = (cat?.code || '').toLowerCase();
    const rows = pool.map((u) => {
      const eid = String(u.employeeId?._id);
      const ro = rosters.find((x) => String(x.employeeId) === eid);
      const at = atts.find((x) => String(x.employeeId) === eid);
      const s = ro?.shiftId;
      let inShiftWindow = false;
      if (s && !ro.isWeeklyOff) {
        const start = istAt(today, s.start);
        const end = new Date(+istAt(today, s.end) + (s.crossesMidnight ? 864e5 : 0));
        inShiftWindow = now >= start && now <= end;
      }
      const skills = u.employeeId?.skills || [];
      return {
        _id: u._id, name: u.name, mobile: u.mobile, designation: u.employeeId?.designation, skills,
        skillMatch: skills.some((k) => k.toLowerCase() === skillKey),
        shift: ro?.isWeeklyOff ? 'Weekly off' : s ? `${s.name} (${s.start}–${s.end})` : 'Not rostered',
        onShift: Boolean(at?.checkIn?.time && !at?.checkOut?.time) || inShiftWindow,
        checkedIn: Boolean(at?.checkIn?.time && !at?.checkOut?.time),
        openJobs: loads.find((l) => String(l._id) === String(u._id))?.n || 0,
      };
    });
    rows.sort((a, b) => b.skillMatch - a.skillMatch || b.onShift - a.onShift || a.openJobs - b.openJobs);
    ok(res, rows);
  }));

  r.post('/:id/assign', requirePermission('ticket:assign'), ah(async (req, res) => {
    const { assigneeId, note } = parse(z.object({ assigneeId: z.string().min(1, 'Choose a technician'), note: z.string().optional() }), req.body);
    const t = await load(req);
    const before = t.toObject();
    const tech = await User.findById(assigneeId).lean();
    if (!tech) throw bad('Technician not found');
    moveTicket(t, 'assigned', req.user, `Assigned to ${tech.name}${note ? ` — ${note}` : ''}`);
    t.assigneeId = tech._id;
    if (!t.workOrderId) {
      const wo = await WorkOrder.create({
        number: await nextNumber('WO', t.propertyId), type: t.assetId ? 'breakdown' : 'corrective', title: t.description.slice(0, 80),
        ticketId: t._id, assetId: t.assetId, locationId: t.locationId, departmentId: t.assignedDeptId, assigneeIds: [tech._id],
        status: 'assigned', priority: t.priority, plannedDate: new Date(),
        checklist: [
          { label: 'Equipment isolated / area made safe', type: 'yesno', required: true },
          { label: 'Root cause identified', type: 'text', required: true },
          { label: 'Equipment tested and working after repair', type: 'yesno', required: true },
          { label: 'Work area cleaned', type: 'yesno', required: false },
        ],
        history: [{ status: 'assigned', by: req.user._id, byName: req.user.name, at: new Date(), note: `Created from ${t.number}` }],
      });
      t.workOrderId = wo._id;
      if (t.assetId) await Asset.updateOne({ _id: t.assetId }, { status: 'breakdown' });
    } else {
      await WorkOrder.updateOne({ _id: t.workOrderId }, { assigneeIds: [tech._id], status: 'assigned' });
    }
    await saveAndBroadcast(req, res, t, before);
    emitUser(String(tech._id), 'wo:assigned', { ticketId: t._id, number: t.number });
    await notify({ userIds: [tech._id], propertyId: t.propertyId, type: 'wo_assigned', title: `You have a new ${t.priority} job: ${t.number}`, body: t.description.slice(0, 120), link: `/tickets/${t._id}`, channels: ['in_app', 'sms'] });
  }));

  r.post('/:id/acknowledge', requirePermission('ticket:update'), ah(async (req, res) => {
    const t = await load(req);
    ensureWorker(t, req);
    const before = t.toObject();
    moveTicket(t, 'acknowledged', req.user, req.body?.note);
    t.sla.respondedAt = new Date();
    t.sla.responseBreached = t.sla.respondedAt > t.sla.responseDue;
    await saveAndBroadcast(req, res, t, before);
  }));

  r.post('/:id/start', requirePermission('ticket:update'), ah(async (req, res) => {
    const t = await load(req);
    ensureWorker(t, req);
    const before = t.toObject();
    moveTicket(t, 'in_progress', req.user, req.body?.note);
    if (t.workOrderId) await WorkOrder.updateOne({ _id: t.workOrderId, status: { $in: ['assigned', 'scheduled'] } }, { status: 'in_progress', startedAt: new Date() });
    await saveAndBroadcast(req, res, t, before);
  }));

  r.post('/:id/hold', requirePermission('ticket:update'), ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(3, 'Say why the work is on hold') }), req.body);
    const t = await load(req);
    ensureWorker(t, req);
    const before = t.toObject();
    moveTicket(t, 'on_hold', req.user, reason);
    t.holdReason = reason;
    t.sla.pausedAt = new Date();
    if (t.workOrderId) await WorkOrder.updateOne({ _id: t.workOrderId }, { status: 'on_hold' });
    await saveAndBroadcast(req, res, t, before);
  }));

  r.post('/:id/resume', requirePermission('ticket:update'), ah(async (req, res) => {
    const t = await load(req);
    ensureWorker(t, req);
    const before = t.toObject();
    moveTicket(t, 'in_progress', req.user, 'Work resumed');
    if (t.sla.pausedAt) {
      const ms = Date.now() - t.sla.pausedAt;
      t.sla.pausedMin = (t.sla.pausedMin || 0) + Math.round(ms / 60000);
      if (!t.sla.respondedAt) t.sla.responseDue = new Date(+t.sla.responseDue + ms);
      t.sla.resolutionDue = new Date(+t.sla.resolutionDue + ms);
      t.sla.pausedAt = undefined;
    }
    t.holdReason = undefined;
    if (t.workOrderId) await WorkOrder.updateOne({ _id: t.workOrderId }, { status: 'in_progress' });
    await saveAndBroadcast(req, res, t, before);
  }));

  r.post('/:id/verify', requirePermission('ticket:verify'), ah(async (req, res) => {
    const t = await load(req);
    const before = t.toObject();
    await verifyTicket(t, req.user, req.body || {});
    await audit('update', 'Ticket', t, before);
    ok(res, t);
  }));

  r.post('/:id/confirm', requirePermission('ticket:read'), ah(async (req, res) => {
    const d = parse(z.object({ accept: z.boolean(), rating: z.number().int().min(1).max(5).optional(), comment: z.string().max(500).optional() }), req.body);
    const t = await load(req);
    const own = String(t.reporterId) === req.user.id || (req.user.tenantId && String(t.tenantId) === String(req.user.tenantId));
    if (!own && !(can(req.user, 'ticket:update') && isBroad(req.user))) throw forbidden('Only the person who raised the ticket can confirm it');
    if (d.accept && !d.rating) throw bad('Please rate the service', { rating: ['Required'] });
    if (!d.accept && !d.comment) throw bad('Tell us what is still wrong', { comment: ['Required'] });
    const before = t.toObject();
    if (d.accept) {
      moveTicket(t, 'tenant_confirmed', req.user, `Rated ${d.rating}/5${d.comment ? ` — ${d.comment}` : ''}`);
      moveTicket(t, 'closed', req.user, 'Closed after tenant confirmation');
      t.closedAt = new Date();
      t.tenantConfirmation = { status: 'confirmed', rating: d.rating, comment: d.comment, at: new Date() };
      if (t.workOrderId) await WorkOrder.updateOne({ _id: t.workOrderId }, { status: 'closed' });
    } else {
      moveTicket(t, 'reopened', req.user, `Reopened by tenant: ${d.comment}`);
      t.tenantConfirmation = { status: 'rejected', comment: d.comment, at: new Date() };
      t.sla.resolvedAt = undefined;
      if (t.workOrderId) await WorkOrder.updateOne({ _id: t.workOrderId }, { status: 'assigned' });
      const sups = await usersWithRole(t.propertyId, ['supervisor'], t.assignedDeptId);
      await notify({ userIds: [...sups.map((u) => u._id), t.assigneeId], propertyId: t.propertyId, type: 'ticket_reopened', title: `${t.number} was reopened by the tenant`, body: d.comment, link: `/tickets/${t._id}` });
    }
    await saveAndBroadcast(req, res, t, before);
  }));

  r.post('/:id/cancel', requirePermission('ticket:read'), ah(async (req, res) => {
    const { reason } = parse(z.object({ reason: z.string().min(3, 'Give a reason') }), req.body);
    const t = await load(req);
    const ownNew = String(t.reporterId) === req.user.id && t.status === 'new';
    if (!ownNew && !(can(req.user, 'ticket:update') && !hasOnly(req.user, 'technician', 'tenant'))) throw forbidden();
    const before = t.toObject();
    moveTicket(t, 'cancelled', req.user, reason);
    await saveAndBroadcast(req, res, t, before);
  }));

  r.patch('/:id/priority', requirePermission('ticket:update'), ah(async (req, res) => {
    const d = parse(z.object({ priority: z.enum(PRIORITIES), reason: z.string().min(3, 'Give a reason for the change') }), req.body);
    if (hasOnly(req.user, 'technician', 'tenant', 'vendor')) throw forbidden();
    const t = await load(req);
    if (!OPEN_TICKET.includes(t.status) || t.status === 'resolved') throw conflict('Priority can only change while the ticket is open');
    const before = t.toObject();
    const sla = await buildSla(req.property, d.priority, t.sla.startedAt || t.createdAt);
    Object.assign(t.sla, { policyId: sla.policyId, responseDue: new Date(+sla.responseDue + (t.sla.pausedMin || 0) * 60000), resolutionDue: new Date(+sla.resolutionDue + (t.sla.pausedMin || 0) * 60000) });
    t.history.push({ status: t.status, by: req.user._id, byName: req.user.name, at: new Date(), note: `Priority ${t.priority} → ${d.priority}: ${d.reason}` });
    t.priority = d.priority;
    t.priorityOverrideReason = d.reason;
    await saveAndBroadcast(req, res, t, before);
  }));

  r.post('/:id/merge', requirePermission('ticket:update'), ah(async (req, res) => {
    const { intoId } = parse(z.object({ intoId: z.string().min(1) }), req.body);
    const t = await load(req);
    const target = await Ticket.findById(intoId);
    if (!target || String(target._id) === String(t._id)) throw bad('Choose another ticket to merge into');
    if (!OPEN_TICKET.includes(t.status)) throw conflict('Only open tickets can be merged');
    const before = t.toObject();
    t.mergedInto = target._id;
    t.status = 'cancelled';
    t.history.push({ status: 'cancelled', by: req.user._id, byName: req.user.name, at: new Date(), note: `Merged into ${target.number}` });
    target.comments.push({ by: req.user._id, byName: req.user.name, text: `${t.number} was merged into this ticket: ${t.description}`, at: new Date() });
    await target.save();
    await saveAndBroadcast(req, res, t, before);
  }));

  r.post('/:id/comments', requirePermission('ticket:read'), ah(async (req, res) => {
    const d = parse(z.object({ text: z.string().min(1).max(2000), mentions: z.array(z.string()).max(10).optional() }), req.body);
    const t = await load(req);
    t.comments.push({ by: req.user._id, byName: req.user.name, text: d.text, mentions: d.mentions || [], at: new Date() });
    await t.save();
    const targets = [...(d.mentions || []), t.assigneeId, t.reporterId].filter((x) => x && String(x) !== req.user.id);
    await notify({ userIds: targets, propertyId: t.propertyId, type: 'comment', title: `${req.user.name} commented on ${t.number}`, body: d.text.slice(0, 120), link: `/tickets/${t._id}` });
    await afterTicketChange(t);
    ok(res, t.comments.at(-1));
  }));
}

export default crud(Ticket, {
  perm: 'ticket',
  label: 'Ticket',
  search: ['number', 'description', 'subCategory'],
  populate: LIST_POP,
  scopeFilter: ticketScope,
  disable: ['create', 'update', 'delete'],
  queryHook: (q, req) => {
    const v = req.query.view;
    if (VIEWS[v]) q.$and.push(VIEWS[v]);
    if (v === 'mine') q.$and.push({ $or: [{ assigneeId: req.user._id }, { reporterId: req.user._id }] });
  },
  extend,
});
