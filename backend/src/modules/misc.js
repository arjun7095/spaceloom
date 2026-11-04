import { Router } from 'express';
import { Amc, Asset, AssetCategory, Capa, ChecklistTemplate, ContractorDeployment, Department, Employee, Item, JobRun, KpiDefinition, KpiSnapshot, LeaveRequest, Location, Notification, OvertimeRequest, Permit, PpmSchedule, PurchaseOrder, PurchaseRequest, Regularization, Report, Store, Ticket, Vendor, VendorInvoice, WorkOrder, AmcVisit, VendorScore } from '../models/index.js';
import { ah, ok, bad, forbidden, notFound, escapeRx } from '../lib/http.js';
import { requirePermission, can, isSupervisorOnly } from '../middleware/auth.js';
import { upload, memoryUpload } from '../middleware/upload.js';
import { saveFile } from '../lib/storage.js';
import { canApproveLevel } from '../lib/approvals.js';
import { ALL_PERMISSIONS, MODULES } from '../constants/permissions.js';
import { readSheet, sendXlsx } from '../lib/excel.js';
import { env } from '../config/env.js';
import { clearPropertyCache } from '../middleware/scope.js';
import { ticketScope } from './tickets.js';
import { woScope } from './workorders.js';
import { postMovement } from './inventory.js';

export const miscRouter = Router();

// ── Uploads: stored through the storage adapter (local disk or S3); links are signed on the way out ──
miscRouter.post('/uploads', upload.array('files', 10), ah(async (req, res) => {
  if (!req.files?.length) throw bad('Choose a file to upload');
  const out = [];
  for (const f of req.files) out.push({ url: await saveFile(f.buffer, f.originalname, f.mimetype), name: f.originalname, size: f.size, type: f.mimetype });
  ok(res, out);
}));

// ── Notifications (FR-13.1) ──
miscRouter.get('/notifications', ah(async (req, res) => {
  const q = { userId: req.user._id, ...(req.query.unread === '1' && { readAt: null }) };
  const [rows, unread] = await Promise.all([
    Notification.find(q).sort('-createdAt').limit(Math.min(100, Number(req.query.limit) || 30)).lean(),
    Notification.countDocuments({ userId: req.user._id, readAt: null }),
  ]);
  ok(res, rows, { unread });
}));
miscRouter.patch('/notifications/:id/read', ah(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, userId: req.user._id }, { readAt: new Date() });
  ok(res, { read: true });
}));
miscRouter.post('/notifications/read-all', ah(async (req, res) => {
  await Notification.updateMany({ userId: req.user._id, readAt: null }, { readAt: new Date() });
  ok(res, { read: true });
}));

// ── Global search ──
miscRouter.get('/search', ah(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return ok(res, []);
  const rx = new RegExp(escapeRx(term.slice(0, 60)), 'i');
  const u = req.user;
  const jobs = [];
  if (can(u, 'ticket:read')) jobs.push(Ticket.find({ $and: [ticketScope(req), { $or: [{ number: rx }, { description: rx }] }] }).select('number description status').limit(5).lean().then((r) => r.map((x) => ({ type: 'Ticket', title: x.number, subtitle: x.description, status: x.status, link: `/tickets/${x._id}` }))));
  if (can(u, 'workorder:read')) jobs.push(WorkOrder.find({ $and: [woScope(req), { $or: [{ number: rx }, { title: rx }] }] }).select('number title status').limit(5).lean().then((r) => r.map((x) => ({ type: 'Work order', title: x.number, subtitle: x.title, status: x.status, link: `/work-orders/${x._id}` }))));
  if (can(u, 'asset:read')) jobs.push(Asset.find({ $or: [{ code: rx }, { name: rx }] }).select('code name status').limit(5).lean().then((r) => r.map((x) => ({ type: 'Asset', title: x.code, subtitle: x.name, status: x.status, link: `/assets/${x._id}` }))));
  if (can(u, 'employee:read') && !u.roles.every((r) => ['technician', 'vendor'].includes(r))) jobs.push(Employee.find({ $or: [{ code: rx }, { name: rx }] }).select('code name designation').limit(5).lean().then((r) => r.map((x) => ({ type: 'Employee', title: x.name, subtitle: `${x.code} · ${x.designation || ''}`, link: `/people/employees?id=${x._id}` }))));
  if (can(u, 'inventory:read')) jobs.push(Item.find({ $or: [{ code: rx }, { name: rx }] }).select('code name').limit(5).lean().then((r) => r.map((x) => ({ type: 'Item', title: x.name, subtitle: x.code, link: `/inventory?search=${encodeURIComponent(x.code)}` }))));
  if (can(u, 'vendor:read') && !u.roles.every((r) => r === 'vendor')) jobs.push(Vendor.find({ name: rx }).select('name types').limit(5).lean().then((r) => r.map((x) => ({ type: 'Vendor', title: x.name, subtitle: (x.types || []).join(', '), link: `/vendors/${x._id}` }))));
  ok(res, (await Promise.all(jobs)).flat());
}));

// ── Approvals inbox (FR-2.3): everything waiting for the current user ──
const APPROVABLES = [
  [LeaveRequest, 'Leave request', '/people/leave', 'submitted', 'leave'],
  [OvertimeRequest, 'Overtime request', '/people/overtime', 'submitted', 'leave'],
  [Regularization, 'Attendance regularisation', '/people/regularizations', 'submitted', 'leave'],
  [ContractorDeployment, 'Contractor attendance', '/people/contractors', 'submitted', 'contractor'],
  [PurchaseRequest, 'Purchase request', '/procurement/requests', 'submitted', 'procurement'],
  [PurchaseOrder, 'Purchase order', '/procurement/orders', 'submitted', 'procurement'],
  [VendorInvoice, 'Vendor invoice', '/vendors/invoices', 'verified', 'vendor'],
  [Amc, 'AMC renewal', '/vendors/amcs', 'renewal_requested', 'vendor'],
  [Permit, 'Permit to work', '/hse/permits', 'requested', 'hse'],
  [Capa, 'CAPA verification', '/hse/capas', 'done', 'hse'],
  [Report, 'Client report sign-off', '/reports', 'draft', 'report'],
];

export async function approvalInbox(req) {
  const u = req.user;
  const out = [];
  for (const [Model, label, link, pending, mod] of APPROVABLES) {
    if (!can(u, `${mod}:approve`) || u.roles.includes('auditor')) continue;
    if (Model === Report && !u.isSuper && !u.roles.includes('property_manager')) continue;
    const pop = Model.schema.path('employeeId') ? [{ path: 'employeeId', select: 'name code' }] : Model.schema.path('vendorId') ? [{ path: 'vendorId', select: 'name' }] : [];
    const docs = await Model.find({ status: pending }).populate(pop).sort('createdAt').limit(50).lean();
    for (const d of docs) {
      if (isSupervisorOnly(u) && d.departmentId && !u.departmentIds.includes(String(d.departmentId))) continue;
      if (!(await canApproveLevel(u, d))) continue;
      out.push({
        _id: d._id, kind: label, link, status: d.status, at: d.createdAt,
        title: d.number || d.title || d.name || d.employeeId?.name || d.vendorId?.name || label,
        subtitle: d.employeeId?.name || d.vendorId?.name || d.reason || d.workDescription || d.action || '',
        amount: d.total ?? d.estTotal ?? d.value,
        level: d.approvalLevels?.[d.currentLevel || 0],
      });
    }
  }
  return out;
}
miscRouter.get('/approvals/inbox', ah(async (req, res) => ok(res, await approvalInbox(req))));

// ── Vendor scorecard (FR-7.6) ──
export async function computeVendorScore(vendorId, from, to) {
  const visits = await AmcVisit.find({ vendorId, plannedDate: { $gte: from, $lte: to } }).lean();
  const due = visits.filter((v) => v.plannedDate <= new Date());
  const onTime = due.filter((v) => v.status === 'done' && v.actualDate && Math.abs(v.actualDate - v.plannedDate) <= 3 * 864e5).length;
  const tickets = await Ticket.find({ vendorId, 'sla.resolvedAt': { $gte: from, $lte: to } }).select('sla tenantConfirmation').lean();
  const disputes = await VendorInvoice.countDocuments({ vendorId, status: 'disputed', createdAt: { $gte: from, $lte: to } });
  const ratings = tickets.map((t) => t.tenantConfirmation?.rating).filter(Boolean);
  const onTimeVisitPct = due.length ? Math.round((onTime / due.length) * 100) : 100;
  const slaPct = tickets.length ? Math.round((tickets.filter((t) => !t.sla?.resolutionBreached).length / tickets.length) * 100) : 100;
  const qualityRating = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 4;
  const score = Math.max(0, Math.round(onTimeVisitPct * 0.4 + slaPct * 0.3 + (qualityRating / 5) * 100 * 0.3 - disputes * 5));
  return { onTimeVisitPct, slaPct, qualityRating, disputes, score, visits: due.length };
}
miscRouter.get('/vendors/:id/scorecard', requirePermission('vendor:read'), ah(async (req, res) => {
  if (req.user.roles.includes('vendor') && String(req.user.vendorId) !== req.params.id && !req.user.isSuper) throw forbidden();
  const now = new Date();
  const current = await computeVendorScore(req.params.id, new Date(now.getFullYear(), now.getMonth(), 1), now);
  const history = await VendorScore.find({ vendorId: req.params.id }).sort('period').limit(12).lean();
  ok(res, { current, history });
}));

// ── Meta ──
miscRouter.get('/permissions', ah(async (req, res) => ok(res, { modules: MODULES, permissions: ALL_PERMISSIONS })));

// ── Admin: jobs, demo reset, KPI baseline (FR-13.3, FR-16.3, FR-16.4) ──
const adminOnly = (req) => {
  if (!req.user.isSuper && !req.user.roles.includes('property_manager')) throw forbidden('Only administrators can do this');
};
miscRouter.get('/admin/jobs', ah(async (req, res) => {
  adminOnly(req);
  const { JOBS } = await import('../jobs/scheduler.js');
  const runs = await JobRun.find().sort('-startedAt').limit(300).lean();
  ok(res, Object.entries(JOBS).map(([name, j]) => ({ name, cron: j.cron, description: j.description, last: runs.find((r) => r.name === name) || null, recent: runs.filter((r) => r.name === name).slice(0, 5) })));
}));
miscRouter.post('/admin/jobs/:name/run', ah(async (req, res) => {
  adminOnly(req);
  const { JOBS, runJob } = await import('../jobs/scheduler.js');
  if (!JOBS[req.params.name]) throw notFound('Job');
  ok(res, await runJob(req.params.name, { wait: true }));
}));
miscRouter.post('/admin/demo-reset', ah(async (req, res) => {
  adminOnly(req);
  if (!env.demoMode) throw forbidden('Demo mode is turned off on this server');
  const { seed } = await import('../seed/seed.js');
  const summary = await seed({ quiet: true });
  clearPropertyCache();
  ok(res, summary);
}));
miscRouter.get('/admin/kpi-baseline', requirePermission('dashboard:read'), ah(async (req, res) => {
  const [defs, snaps] = await Promise.all([KpiDefinition.find().sort('order').lean(), KpiSnapshot.find().sort('date').limit(30).lean()]);
  ok(res, defs.map((d) => {
    const vals = snaps.map((s) => s.values?.[d.code]?.actual).filter((v) => v != null);
    return { _id: d._id, code: d.code, name: d.name, unit: d.unit, target: d.target, baseline: d.baseline, measured: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null, days: vals.length };
  }));
}));
miscRouter.post('/admin/kpi-baseline/apply', requirePermission('property:update'), ah(async (req, res) => {
  const snaps = await KpiSnapshot.find().sort('date').limit(30).lean();
  const defs = await KpiDefinition.find();
  for (const d of defs) {
    const vals = snaps.map((s) => s.values?.[d.code]?.actual).filter((v) => v != null);
    if (vals.length) d.baseline = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    await d.save();
  }
  ok(res, { updated: defs.length });
}));

// ── Bulk import with validation preview (FR-16.1) ──
const list = (v) => (v == null || v === '' ? [] : String(v).split(/[,;|]/).map((s) => s.trim()).filter(Boolean));
const IMPORTS = {
  locations: { model: Location, perm: 'property:update', columns: ['code', 'name', 'type', 'parentCode'], refs: { parentCode: [Location, 'parentId'] } },
  departments: { model: Department, perm: 'property:update', columns: ['code', 'name', 'description'] },
  employees: { model: Employee, perm: 'employee:create', columns: ['code', 'name', 'mobile', 'email', 'departmentCode', 'designation', 'skills', 'employmentType', 'shiftGroup', 'joiningDate'], refs: { departmentCode: [Department, 'departmentId'] }, map: (r) => ({ ...r, skills: list(r.skills) }) },
  vendors: { model: Vendor, perm: 'vendor:create', columns: ['name', 'code', 'types', 'gstin', 'pan', 'address', 'contactName', 'contactPhone', 'contactEmail'], map: (r) => ({ ...r, types: list(r.types), contacts: r.contactName ? [{ name: r.contactName, phone: r.contactPhone, email: r.contactEmail }] : [] }) },
  assets: { model: Asset, perm: 'asset:create', columns: ['code', 'name', 'categoryCode', 'make', 'model', 'serialNo', 'capacity', 'locationCode', 'departmentCode', 'criticality', 'installDate', 'warrantyExpiry', 'cost'], refs: { categoryCode: [AssetCategory, 'categoryId'], locationCode: [Location, 'locationId'], departmentCode: [Department, 'departmentId'] } },
  items: { model: Item, perm: 'inventory:create', columns: ['code', 'name', 'category', 'uom', 'hsn', 'unitCost', 'minLevel', 'reorderLevel', 'reorderQty', 'maxLevel', 'binLocation'] },
  'ppm-schedules': { model: PpmSchedule, perm: 'ppm:create', columns: ['assetCode', 'templateName', 'frequency', 'startDate', 'departmentCode'], refs: { assetCode: [Asset, 'assetId'], departmentCode: [Department, 'departmentId'], templateName: [ChecklistTemplate, 'templateId', 'name'] }, map: (r) => ({ ...r, nextDueDate: r.startDate, title: undefined }) },
  'opening-stock': { perm: 'inventory:update', columns: ['storeCode', 'itemCode', 'qty'] },
};

async function prepare(entity, rows) {
  const cfg = IMPORTS[entity];
  const cache = new Map();
  const lookup = async (Model, key, value) => {
    const ck = `${Model.modelName}:${key}:${value}`;
    if (!cache.has(ck)) cache.set(ck, await Model.findOne({ [key]: key === 'code' ? String(value).toUpperCase() : value }).select('_id path').lean());
    return cache.get(ck);
  };
  const out = [];
  for (const [i, raw] of rows.entries()) {
    const errors = [];
    if (entity === 'opening-stock') {
      const store = await lookup(Store, 'code', raw.storeCode);
      const item = await lookup(Item, 'code', raw.itemCode);
      if (!store) errors.push(`Unknown store code "${raw.storeCode}"`);
      if (!item) errors.push(`Unknown item code "${raw.itemCode}"`);
      if (!(Number(raw.qty) > 0)) errors.push('qty must be more than 0');
      out.push({ row: i + 2, data: { storeId: store?._id, itemId: item?._id, qty: Number(raw.qty) }, errors });
      continue;
    }
    let doc = cfg.map ? cfg.map({ ...raw }) : { ...raw };
    for (const [col, [Model, field, key = 'code']] of Object.entries(cfg.refs || {})) {
      if (doc[col] == null || doc[col] === '') { delete doc[col]; continue; }
      const found = await lookup(Model, key, doc[col]);
      if (!found) errors.push(`Unknown ${col} "${doc[col]}"`);
      else {
        doc[field] = found._id;
        if (entity === 'locations' && col === 'parentCode') doc.path = `${found.path} / ${doc.name}`;
      }
      delete doc[col];
    }
    if (entity === 'locations' && !doc.path) doc.path = doc.name;
    for (const k of Object.keys(doc)) if (doc[k] === '' || doc[k] == null) delete doc[k];
    const err = new cfg.model(doc).validateSync();
    if (err) errors.push(...Object.values(err.errors).map((e) => e.message));
    out.push({ row: i + 2, data: doc, errors });
  }
  return out;
}

miscRouter.get('/imports/:entity/template', ah(async (req, res) => {
  const cfg = IMPORTS[req.params.entity];
  if (!cfg) throw notFound('Import type');
  await sendXlsx(res, `${req.params.entity}-template`, cfg.columns.map((c) => ({ key: c, header: c, width: 20 })), []);
}));
miscRouter.post('/imports/:entity', memoryUpload.single('file'), ah(async (req, res) => {
  const cfg = IMPORTS[req.params.entity];
  if (!cfg) throw notFound('Import type');
  if (!can(req.user, cfg.perm)) throw forbidden();
  if (!req.file) throw bad('Attach an Excel or CSV file');
  const rows = await readSheet(req.file.buffer, req.file.originalname);
  if (!rows.length) throw bad('The file has no data rows');
  if (rows.length > 5000) throw bad('Import at most 5,000 rows at a time');
  const prepared = await prepare(req.params.entity, rows);
  const valid = prepared.filter((p) => !p.errors.length);
  const summary = { total: prepared.length, valid: valid.length, invalid: prepared.length - valid.length, errors: prepared.filter((p) => p.errors.length).slice(0, 200).map(({ row, errors }) => ({ row, errors })), preview: valid.slice(0, 20).map((p) => p.data) };
  if (req.query.mode !== 'commit') return ok(res, summary);
  if (summary.invalid) throw bad('Fix the rows with errors before importing', summary.errors);
  if (req.params.entity === 'opening-stock') {
    for (const p of valid) await postMovement({ ...p.data, type: 'opening', refType: 'import' });
  } else {
    await cfg.model.insertMany(valid.map((p) => ({ ...p.data, propertyId: req.property._id, orgId: req.property.orgId, createdBy: req.user._id })));
  }
  ok(res, { ...summary, imported: valid.length });
}));

export { Store };
