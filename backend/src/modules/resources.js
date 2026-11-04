import { Router } from 'express';
import bcrypt from 'bcryptjs';
import * as M from '../models/index.js';
import { crud } from '../lib/crud.js';
import { ah, ok, bad, forbidden, conflict, notFound } from '../lib/http.js';
import { requirePermission, can, isBroad } from '../middleware/auth.js';
import { approvalTransitions, approvalLevels } from '../lib/approvals.js';
import { purchaseOrderPdf } from '../lib/pdf.js';
import { audit } from '../lib/audit.js';
import { z } from 'zod';
import { nextNumber } from '../lib/numbering.js';
import { notify, usersWithRole } from '../lib/notify.js';
import { clearPropertyCache } from '../middleware/scope.js';
import { passwordRule } from './auth.js';
import { assetExtend, ppmScheduleExtend } from './workorders.js';
import { leaveHooks } from './attendance.js';
import { draftPrFromAlerts, prepareStockCount, postCountVariance } from './inventory.js';
import { parse } from '../lib/http.js';

const r = Router();
const mount = (path, Model, opts) => r.use(`/${path}`, crud(Model, { exportName: path, ...opts }));
const pop = (path, select = 'name') => ({ path, select });
const own = (field) => (req) => (req.user.roles.includes('vendor') && !isBroad(req.user) ? { [field]: req.user.vendorId || null } : {});
const withCancel = (t, perm) => {
  t.map.submitted.push('cancelled');
  t.perms.cancelled = perm;
  return t;
};

// ── M1 Property & location setup ──
mount('organizations', M.Organization, { perm: 'property', search: ['name', 'gstin'] });
mount('properties', M.Property, {
  perm: 'property', search: ['name', 'code', 'city'], readPerm: ['property:read', 'dashboard:read', 'ticket:read'],
  scopeFilter: (req) => (req.user.isSuper ? {} : { _id: { $in: req.user.propertyIds } }),
  beforeUpdate: (data, req, doc) => { clearPropertyCache(doc._id); return data; },
  extend: (rt) => {
    rt.get('/:id/geofence', requirePermission('property:read', 'attendance:read'), ah(async (req, res) => {
      const p = await M.Property.findById(req.params.id).select('name geoFence').lean();
      if (!p) throw notFound('Property');
      ok(res, p);
    }));
    // FR-3.5: circle (centre + radius) or polygon geo-fence, drawn on the map editor.
    rt.put('/:id/geofence', requirePermission('property:update'), ah(async (req, res) => {
      const d = parse(z.object({
        type: z.enum(['circle', 'polygon']), lat: z.number().optional(), lng: z.number().optional(), radiusM: z.number().min(20).max(5000).optional(),
        polygon: z.array(z.tuple([z.number(), z.number()])).optional(), policy: z.enum(['flag', 'block']),
      }), req.body);
      if (d.type === 'polygon' && (d.polygon?.length || 0) < 3) throw bad('Draw at least 3 points for the boundary');
      if (d.type === 'circle' && (d.lat == null || d.lng == null)) throw bad('Pick the centre of the site on the map');
      const geoFence = d.type === 'polygon'
        ? { type: 'polygon', polygon: d.polygon, policy: d.policy, lat: d.polygon.reduce((a, p) => a + p[0], 0) / d.polygon.length, lng: d.polygon.reduce((a, p) => a + p[1], 0) / d.polygon.length, radiusM: d.radiusM }
        : { type: 'circle', lat: d.lat, lng: d.lng, radiusM: d.radiusM || 300, policy: d.policy };
      const p = await M.Property.findById(req.params.id);
      if (!p) throw notFound('Property');
      if (!req.user.isSuper && !req.user.propertyIds.includes(String(p._id))) throw forbidden();
      const before = p.toObject();
      p.geoFence = geoFence;
      await p.save();
      clearPropertyCache(p._id);
      await audit('update', 'Property', p, before);
      ok(res, { _id: p._id, geoFence: p.geoFence });
    }));
  },
});
mount('locations', M.Location, {
  perm: 'property', search: ['name', 'code', 'path'], sort: 'path', readPerm: ['property:read', 'ticket:read', 'hse:create', 'asset:read'],
  populate: [pop('parentId', 'name code path')],
  beforeCreate: async (data) => {
    const parent = data.parentId ? await M.Location.findById(data.parentId).lean() : null;
    return { ...data, path: parent ? `${parent.path} / ${data.name}` : data.name, level: parent ? (parent.level || 0) + 1 : 0 };
  },
});
mount('departments', M.Department, { perm: 'property', search: ['name', 'code'], sort: 'name', readPerm: ['property:read', 'employee:read', 'ticket:read', 'hse:create'], populate: [pop('headUserId')] });
mount('tenants', M.Tenant, { perm: 'property', search: ['name'], readPerm: ['property:read', 'ticket:read'], populate: [pop('units', 'name path')] });
mount('shifts', M.Shift, { perm: 'property', search: ['name', 'code'], sort: 'start', readPerm: ['property:read', 'roster:read', 'attendance:read'] });
mount('holidays', M.Holiday, { perm: 'property', search: ['name'], sort: 'date' });
mount('sla-policies', M.SlaPolicy, { perm: 'property', search: ['name'], readPerm: ['property:read', 'ticket:read'] });
mount('ticket-categories', M.TicketCategory, { perm: 'property', search: ['name', 'code'], sort: 'name', readPerm: ['property:read', 'ticket:read'], populate: [pop('sopId', 'title')] });
mount('approval-rules', M.ApprovalRule, { perm: 'property', search: ['entityType', 'description'], sort: 'entityType', readPerm: ['property:read'] });
mount('report-schedules', M.ReportSchedule, { perm: 'report', sort: 'type', readPerm: ['report:read'] });
mount('kpi-definitions', M.KpiDefinition, { perm: 'property', search: ['name', 'code'], sort: 'order', readPerm: ['property:read', 'dashboard:read'] });

// ── M2 Users, roles, delegation ──
const ROLE_GUARD = async (roleIds, req) => {
  if (req.user.isSuper || !roleIds?.length) return;
  const roles = await M.Role.find({ _id: { $in: roleIds } }).lean();
  if (roles.some((x) => x.permissions.includes('*'))) throw forbidden('Only a Super Admin can grant the Super Admin role');
};
// A Property Manager can only give access to properties they have themselves.
const PROPERTY_GUARD = (propertyIds, req) => {
  if (req.user.isSuper || !propertyIds?.length) return;
  const mine = new Set(req.user.propertyIds.map(String));
  if (propertyIds.some((p) => !mine.has(String(p?._id || p)))) throw forbidden('You can only give access to your own properties');
};
mount('users', M.User, {
  perm: 'user', search: ['name', 'email', 'mobile'], sort: 'name',
  filterable: ['status', 'roleIds', 'departmentIds', 'propertyIds'],
  readonly: ['passwordHash', 'failedAttempts', 'lockUntil', 'tokenVersion', 'resetOtpHash', 'resetOtpExpires', 'lastLogin'],
  populate: [pop('roleIds', 'name key'), pop('propertyIds', 'name code'), pop('departmentIds', 'name'), pop('employeeId', 'code name'), pop('vendorId', 'code name'), pop('tenantId', 'name')],
  scopeFilter: (req) => (req.user.isSuper ? {} : { propertyIds: req.property._id }),
  beforeCreate: async (data, req) => {
    const password = parse(passwordRule, data.password || '');
    await ROLE_GUARD(data.roleIds, req);
    PROPERTY_GUARD(data.propertyIds, req);
    delete data.password;
    return { ...data, propertyIds: data.propertyIds?.length ? data.propertyIds : [req.property._id], passwordHash: await bcrypt.hash(password, 12) };
  },
  beforeUpdate: async (data, req) => {
    await ROLE_GUARD(data.roleIds, req);
    PROPERTY_GUARD(data.propertyIds, req);
    if (data.password) {
      data.passwordHash = await bcrypt.hash(parse(passwordRule, data.password), 12);
      data.tokenVersion = Date.now() % 1e6;
    }
    delete data.password;
    if (data.status === 'active') Object.assign(data, { failedAttempts: 0, lockUntil: null });
    return data;
  },
});
mount('roles', M.Role, {
  perm: 'admin', readPerm: 'user:read', search: ['name', 'key'], sort: 'name',
  beforeDelete: async (doc) => { if (doc.isSystem) throw conflict('System roles cannot be deleted; edit their permissions instead'); },
});
mount('delegations', M.Delegation, {
  perm: 'daily', populate: [pop('fromUserId'), pop('toUserId')],
  scopeFilter: (req) => (isBroad(req.user) ? {} : { $or: [{ fromUserId: req.user._id }, { toUserId: req.user._id }] }),
  beforeCreate: (data, req) => ({ ...data, fromUserId: req.user.isSuper || req.user.roles.includes('property_manager') ? data.fromUserId || req.user._id : req.user._id }),
});

// ── M3 People ──
mount('employees', M.Employee, {
  perm: 'employee', search: ['name', 'code', 'mobile', 'designation'], sort: 'code',
  populate: [pop('departmentId'), pop('supervisorId'), pop('contractorVendorId'), pop('userId', 'email')],
  scopeFilter: (req) => {
    const u = req.user;
    if (isBroad(u)) return {};
    if (u.roles.includes('supervisor')) return { departmentId: { $in: u.departmentIds } };
    if (u.roles.includes('vendor')) return { contractorVendorId: u.vendorId || null };
    return { _id: u.employeeId || null };
  },
});
mount('employees-org-chart', M.Employee, {
  perm: 'employee', disable: ['create', 'update', 'delete'], sort: 'name',
  extend: (rt) => rt.get('/tree', requirePermission('employee:read'), ah(async (req, res) => {
    ok(res, await M.Employee.find({ status: 'active' }).select('name code designation departmentId supervisorId photo').populate('departmentId', 'name').lean());
  })),
});
const leaveOpts = (entityType, label, onApproved) => ({
  perm: 'leave', label, populate: [pop('employeeId', 'name code'), pop('departmentId')], scopeFilter: leaveHooks.scope,
  beforeCreate: async (data, req) => ({ ...(await leaveHooks.beforeCreate(data, req)), approvalLevels: await approvalLevels(entityType) }),
  transitions: withCancel(approvalTransitions({ perm: 'leave:approve', onApproved }), 'leave:create'),
});
mount('leave-requests', M.LeaveRequest, leaveOpts('leave_request', 'Leave request', leaveHooks.onLeaveApproved));
mount('overtime-requests', M.OvertimeRequest, leaveOpts('overtime_request', 'Overtime request'));
mount('regularizations', M.Regularization, leaveOpts('regularization', 'Regularisation', leaveHooks.onRegularizationApproved));
mount('contractor-deployments', M.ContractorDeployment, {
  perm: 'contractor', sort: '-date', populate: [pop('vendorId'), pop('departmentId')], scopeFilter: own('vendorId'),
  beforeCreate: async (data, req) => ({ ...data, vendorId: req.user.roles.includes('vendor') ? req.user.vendorId : data.vendorId, approvalLevels: await approvalLevels('contractor_deployment') }),
  transitions: approvalTransitions({ perm: 'contractor:approve' }),
  queryHook: (q, req) => { if (req.query.view === 'shortfall') q.$and.push({ shortfall: { $gt: 0 } }); },
});

// ── M4 Assets & PPM ──
mount('asset-categories', M.AssetCategory, { perm: 'asset', search: ['name', 'code'], sort: 'name' });
mount('assets', M.Asset, {
  perm: 'asset', search: ['code', 'name', 'serialNo', 'make'], sort: 'code', readPerm: ['asset:read', 'ticket:create'],
  populate: [pop('categoryId', 'name code'), pop('locationId', 'name path'), pop('departmentId'), pop('amcId', 'name end')],
  extend: assetExtend,
});
mount('checklist-templates', M.ChecklistTemplate, { perm: 'ppm', search: ['name'], sort: 'name', readPerm: ['ppm:read', 'hse:read'], populate: [pop('sopId', 'title')] });
mount('ppm-schedules', M.PpmSchedule, {
  perm: 'ppm', search: ['title'], sort: 'nextDueDate',
  populate: [pop('assetId', 'code name'), pop('templateId'), pop('departmentId'), pop('assigneeIds')],
  beforeCreate: (data) => ({ ...data, nextDueDate: data.nextDueDate || data.startDate || new Date() }),
  extend: ppmScheduleExtend,
});

// ── M6 Inventory & procurement ──
mount('items', M.Item, { perm: 'inventory', search: ['code', 'name', 'hsn'], sort: 'code', readPerm: ['inventory:read', 'procurement:read'], populate: [pop('preferredVendorId')] });
mount('stores', M.Store, { perm: 'inventory', search: ['name'], sort: 'name', readPerm: ['inventory:read', 'procurement:read'] });
mount('stock-counts', M.StockCount, {
  perm: 'inventory', number: 'SC', populate: [pop('storeId'), pop('lines.itemId', 'code name uom'), pop('approvedBy')],
  beforeCreate: prepareStockCount,
  lockedWhen: (doc) => doc.status === 'approved',
  transitions: {
    map: { planned: ['counted', 'cancelled'], counted: ['approved', 'planned'] },
    perms: { approved: 'inventory:approve', counted: 'inventory:update', cancelled: 'inventory:update', planned: 'inventory:update' },
    onEnter: { approved: async (doc, req) => { doc.approvedBy = req.user._id; await postCountVariance(doc); } },
  },
});
mount('purchase-requests', M.PurchaseRequest, {
  perm: 'procurement', number: 'PR', search: ['number', 'reason'], kpi: false,
  populate: [pop('requestedBy'), pop('items.itemId', 'code name uom'), pop('workOrderId', 'number')],
  beforeCreate: async (data, req) => {
    const est = (data.items || []).reduce((a, i) => a + (i.qty || 0) * (i.rate || 0), 0);
    return { ...data, requestedBy: req.user._id, approvalLevels: await approvalLevels('purchase_request', est) };
  },
  lockedWhen: (doc) => !['draft', 'submitted'].includes(doc.status),
  transitions: (() => {
    const t = approvalTransitions({ perm: 'procurement:approve', extraMap: { draft: ['submitted', 'cancelled'], approved: ['ordered'] }, link: () => '/procurement/requests' });
    Object.assign(t.perms, { submitted: 'procurement:create', cancelled: 'procurement:create', ordered: 'procurement:update' });
    return t;
  })(),
  extend: (rt) => rt.post('/from-alerts', requirePermission('procurement:create'), ah(async (req, res) => ok(res.status(201), await draftPrFromAlerts(req)))),
});
mount('quotations', M.Quotation, {
  perm: 'procurement', populate: [pop('vendorId'), pop('prId', 'number'), pop('items.itemId', 'code name')], sort: 'total',
  beforeUpdate: async (data, req, doc) => {
    if (data.selected) await M.Quotation.updateMany({ prId: doc.prId, _id: { $ne: doc._id } }, { selected: false });
    return data;
  },
  beforeCreate: async (data) => {
    const pr = await M.PurchaseRequest.findById(data.prId).lean();
    if (!pr) throw bad('Choose a purchase request');
    const total = (data.items || []).reduce((a, q) => a + (q.rate || 0) * (pr.items.find((i) => String(i.itemId) === String(q.itemId))?.qty || 0), 0);
    return { ...data, total };
  },
});
mount('purchase-orders', M.PurchaseOrder, {
  perm: 'procurement', number: 'PO', search: ['number', 'terms'],
  extend: (rt) => rt.get('/:id/pdf', requirePermission('procurement:read'), ah(async (req, res) => {
    const po = await M.PurchaseOrder.findOne({ _id: req.params.id, ...own('vendorId')(req) }).populate('vendorId', 'name gstin address').populate('prId', 'number').populate('items.itemId', 'code name uom hsn').lean();
    if (!po) throw notFound('Purchase order');
    const pdf = await purchaseOrderPdf(po, await M.Property.findById(req.property._id).lean());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + po.number + '.pdf"');
    res.end(pdf);
  })),
  populate: [pop('vendorId', 'name gstin address'), pop('prId', 'number'), pop('items.itemId', 'code name uom hsn')],
  scopeFilter: own('vendorId'),
  lockedWhen: (doc) => doc.status !== 'draft',
  beforeCreate: async (data) => {
    if (data.prId && !data.items?.length) {
      const pr = await M.PurchaseRequest.findById(data.prId).lean();
      if (!pr || pr.status !== 'approved') throw bad('The purchase request must be approved first');
      const quote = await M.Quotation.findOne({ prId: pr._id, vendorId: data.vendorId }).lean();
      const items = await M.Item.find({ _id: { $in: pr.items.map((i) => i.itemId) } }).lean();
      data.items = pr.items.map((l) => {
        const it = items.find((x) => String(x._id) === String(l.itemId));
        return { itemId: l.itemId, qty: l.qty, rate: quote?.items.find((q) => String(q.itemId) === String(l.itemId))?.rate ?? l.rate ?? it?.unitCost, gstPct: it?.gstPct ?? 18 };
      });
    }
    return data;
  },
  afterCreate: async (po) => { if (po.prId) await M.PurchaseRequest.updateOne({ _id: po.prId }, { status: 'ordered' }); },
  transitions: (() => {
    const t = approvalTransitions({ perm: 'procurement:approve', extraMap: { draft: ['submitted', 'cancelled'], approved: ['sent'], received: ['closed'], partially_received: ['closed'] }, link: () => '/procurement/orders' });
    Object.assign(t.perms, { submitted: 'procurement:create', cancelled: 'procurement:create', sent: 'procurement:update', closed: 'procurement:update' });
    const enter = t.onEnter;
    t.onEnter = { ...enter, submitted: async (doc) => { doc.approvalLevels = await approvalLevels('purchase_order', doc.total || 0); doc.currentLevel = 0; } };
    return t;
  })(),
});

// ── M7 Vendors & AMC ──
mount('vendors', M.Vendor, {
  perm: 'vendor', search: ['name', 'code', 'gstin'], sort: 'name', readPerm: ['vendor:read', 'procurement:read', 'inventory:read'],
  scopeFilter: (req) => (req.user.roles.includes('vendor') && !isBroad(req.user) ? { _id: req.user.vendorId || null } : {}),
  mapOut: (d) => ({ ...d, bank: d.bank ? { ...d.bank, accountNoMasked: d.bank.last4 ? `XXXX XXXX ${d.bank.last4}` : '' } : d.bank }),
});
mount('contracts', M.Contract, { perm: 'vendor', search: ['number', 'title', 'scope'], sort: 'end', populate: [pop('vendorId')], scopeFilter: own('vendorId') });
mount('amcs', M.Amc, {
  perm: 'vendor', search: ['name'], sort: 'end', populate: [pop('vendorId'), pop('contractId', 'number'), pop('assetIds', 'code name')], scopeFilter: own('vendorId'),
  queryHook: (q, req) => {
    if (req.query.view === 'expiring') q.$and.push({ end: { $gte: new Date(), $lte: new Date(Date.now() + 30 * 864e5) }, status: { $nin: ['renewed', 'expired'] } });
  },
  transitions: (() => {
    const t = approvalTransitions({
      pending: 'renewal_requested', approved: 'renewed', rejected: 'expiring', perm: 'vendor:approve',
      extraMap: { active: ['renewal_requested'], expiring: ['renewal_requested'], draft: ['active'] },
      onApproved: async (doc) => {
        const end = new Date(doc.end);
        end.setFullYear(end.getFullYear() + 1);
        Object.assign(doc, { start: doc.end, end, status: 'active' });
      },
    });
    t.perms.renewal_requested = 'vendor:update';
    t.perms.active = 'vendor:update';
    t.fields = { renewal_requested: ['value'] };
    t.onEnter.renewal_requested = async (doc) => { doc.approvalLevels = await approvalLevels('amc_renewal', doc.value || 0); doc.currentLevel = 0; };
    return t;
  })(),
});
const notVendor = async (doc, to, req) => {
  if (['verified', 'approved', 'paid', 'done', 'missed'].includes(to) && req.user.roles.includes('vendor') && !isBroad(req.user) && to !== 'done') throw forbidden('This step is done by PrimeSpace staff');
};
mount('amc-visits', M.AmcVisit, {
  perm: 'vendor', sort: 'plannedDate', dateField: 'plannedDate', populate: [pop('amcId'), pop('vendorId'), pop('workOrderId', 'number')], scopeFilter: own('vendorId'),
  transitions: {
    map: { scheduled: ['done', 'missed'], missed: ['done'] },
    fields: { done: ['actualDate', 'technicianName', 'reportUrl', 'findings'] },
    require: { done: ['actualDate', 'technicianName'] },
    guard: notVendor,
  },
});
mount('vendor-invoices', M.VendorInvoice, {
  perm: 'vendor', search: ['number'], populate: [pop('vendorId'), pop('poId', 'number total'), pop('contractId', 'number')], scopeFilter: own('vendorId'),
  beforeCreate: (data, req) => ({ ...data, vendorId: req.user.roles.includes('vendor') && !isBroad(req.user) ? req.user.vendorId : data.vendorId }),
  lockedWhen: (doc) => !['submitted', 'disputed'].includes(doc.status),
  transitions: {
    map: { submitted: ['verified', 'disputed'], verified: ['approved', 'disputed'], approved: ['paid'], disputed: ['submitted'] },
    perms: { approved: 'vendor:approve', verified: 'vendor:update', paid: 'vendor:update', disputed: 'vendor:update', submitted: 'vendor:update' },
    fields: { disputed: ['disputeReason'], paid: ['paymentRef'] },
    require: { disputed: ['disputeReason'], paid: ['paymentRef'] },
    guard: async (doc, to, req) => {
      if (['verified', 'approved', 'paid', 'disputed'].includes(to) && req.user.roles.includes('vendor') && !isBroad(req.user)) throw forbidden('This step is done by PrimeSpace staff');
      if (to === 'verified' && doc.poId) {
        const grn = await M.Grn.exists({ poId: doc.poId });
        if (!grn) throw conflict('No goods receipt exists for this PO yet');
      }
    },
  },
});
mount('vendor-scores', M.VendorScore, { perm: 'vendor', sort: '-period', populate: [pop('vendorId')], disable: ['create', 'update', 'delete'], scopeFilter: own('vendorId') });

// ── M8 HSE ──
const hseScope = (field) => (req) => (can(req.user, 'hse:update') || isBroad(req.user) ? {} : { [field]: req.user._id });
mount('incidents', M.Incident, {
  perm: 'hse', number: 'INC', search: ['number', 'title', 'description'], sort: '-occurredAt', kpi: true, readPerm: ['hse:read', 'hse:create'],
  populate: [pop('locationId', 'path'), pop('reportedBy'), pop('capaIds', 'number action status')],
  scopeFilter: hseScope('reportedBy'),
  beforeCreate: (data, req) => ({ ...data, reportedBy: req.user._id, history: [{ status: 'reported', by: req.user._id, byName: req.user.name, at: new Date() }] }),
  afterCreate: async (doc) => {
    const people = await usersWithRole(doc.propertyId, ['hse_officer', 'property_manager']);
    await notify({ userIds: people.map((u) => u._id), propertyId: doc.propertyId, type: 'incident', title: `${doc.severity} incident reported: ${doc.title}`, body: doc.description, link: `/hse/incidents?id=${doc._id}`, channels: doc.severity === 'critical' ? ['in_app', 'email', 'sms'] : ['in_app'] });
  },
  transitions: {
    map: { reported: ['immediate_action'], immediate_action: ['investigation'], investigation: ['capa'], capa: ['verification'], verification: ['closed', 'capa'] },
    perms: { closed: 'hse:approve' },
    fields: { immediate_action: ['immediateAction'], investigation: ['rootCause', 'lti'], capa: ['correctiveAction'], verification: ['verificationNote'] },
    require: { immediate_action: ['immediateAction'], investigation: ['rootCause'], capa: ['correctiveAction'], verification: ['verificationNote'] },
    onEnter: {
      capa: async (doc, req, extra) => {
        if (doc.capaIds?.length && !extra.correctiveAction) return;
        const capa = await M.Capa.create({ number: await nextNumber('CAPA', doc.propertyId), sourceType: 'incident', sourceId: doc._id, kind: 'corrective', action: extra.correctiveAction || doc.correctiveAction, ownerId: extra.ownerId || req.user._id, dueDate: extra.dueDate || new Date(Date.now() + 7 * 864e5) });
        doc.capaIds.push(capa._id);
      },
    },
  },
});
mount('inspections', M.Inspection, {
  perm: 'hse', search: ['title'], sort: 'scheduledDate', dateField: 'scheduledDate', populate: [pop('locationId', 'path'), pop('doneBy'), pop('templateId')],
  transitions: { map: { scheduled: ['done'], overdue: ['done'] }, fields: { done: ['results', 'score', 'findings'] }, onEnter: { done: async (doc, req) => Object.assign(doc, { doneBy: req.user._id, doneAt: new Date() }) } },
});
mount('observations', M.Observation, {
  perm: 'hse', search: ['description'], readPerm: ['hse:read', 'hse:create'], populate: [pop('locationId', 'path'), pop('capaId', 'number status')],
  scopeFilter: hseScope('createdBy'),
  transitions: {
    map: { open: ['capa', 'closed'], capa: ['closed'] },
    onEnter: { capa: async (doc, req, extra) => { const c = await M.Capa.create({ number: await nextNumber('CAPA', doc.propertyId), sourceType: 'observation', sourceId: doc._id, kind: 'preventive', action: extra.action || `Fix: ${doc.description}`, ownerId: extra.ownerId || req.user._id, dueDate: new Date(Date.now() + 7 * 864e5) }); doc.capaId = c._id; } },
  },
});
mount('capas', M.Capa, {
  perm: 'hse', number: 'CAPA', search: ['number', 'action'], sort: 'dueDate', populate: [pop('ownerId'), pop('verifiedBy')],
  queryHook: (q, req) => { if (req.query.view === 'overdue') q.$and.push({ status: { $in: ['open', 'in_progress'] }, dueDate: { $lt: new Date() } }); },
  transitions: {
    map: { open: ['in_progress', 'done'], in_progress: ['done'], done: ['verified', 'in_progress'], verified: ['closed'] },
    perms: { verified: 'hse:approve', closed: 'hse:approve' },
    fields: { done: ['evidence'] },
    onEnter: { verified: async (doc, req) => { doc.verifiedBy = req.user._id; } },
  },
});
mount('compliances', M.Compliance, { perm: 'hse', search: ['name', 'authority', 'certificateNo'], sort: 'validTo', populate: [pop('ownerId')] });
mount('permits', M.Permit, {
  perm: 'hse', number: 'PTW', search: ['number', 'workDescription', 'contractor'], populate: [pop('locationId', 'path'), pop('requestedBy')], readPerm: ['hse:read', 'hse:create'],
  beforeCreate: async (data, req) => ({ ...data, requestedBy: req.user._id, approvalLevels: await approvalLevels('permit') }),
  transitions: (() => {
    const t = approvalTransitions({ pending: 'requested', approved: 'approved', rejected: 'cancelled', perm: 'hse:approve', extraMap: { approved: ['active', 'cancelled'], active: ['closed'] } });
    Object.assign(t.perms, { active: 'hse:update', closed: 'hse:update' });
    return t;
  })(),
});
mount('trainings', M.Training, { perm: 'hse', search: ['topic', 'trainer'], sort: '-date', populate: [pop('attendees', 'name code')] });

// ── M10–M12 Daily ops, SOPs, audit ──
mount('sops', M.Sop, {
  perm: 'sop', search: ['title', 'content'], sort: 'title', readPerm: ['sop:read', 'workorder:read'], populate: [pop('ownerId')],
  extend: (rt) => rt.post('/:id/acknowledge', requirePermission('sop:read', 'workorder:read'), ah(async (req, res) => {
    const sop = await M.Sop.findById(req.params.id);
    if (!sop) throw notFound('SOP');
    if (!sop.acknowledgements.some((a) => String(a.userId) === req.user.id)) sop.acknowledgements.push({ userId: req.user._id, at: new Date() });
    await sop.save();
    ok(res, { acknowledged: true, count: sop.acknowledgements.length });
  })),
});
mount('action-items', M.ActionItem, {
  perm: 'daily', search: ['title', 'note'], sort: 'dueDate', populate: [pop('ownerId')],
  scopeFilter: (req) => (isBroad(req.user) || req.user.roles.includes('supervisor') ? {} : { ownerId: req.user._id }),
  afterCreate: async (doc, req) => { if (String(doc.ownerId) !== req.user.id) await notify({ userIds: [doc.ownerId], propertyId: doc.propertyId, type: 'action_item', title: `New action point: ${doc.title}`, link: '/daily/actions' }); },
  transitions: { map: { open: ['in_progress', 'done', 'cancelled'], in_progress: ['done', 'open'], done: ['open'] } },
});
mount('shift-logs', M.ShiftLog, {
  perm: 'daily', sort: '-date', populate: [pop('departmentId'), pop('shiftId'), pop('handoverTo')],
  extend: (rt) => rt.post('/:id/entries', requirePermission('daily:create'), ah(async (req, res) => {
    const text = String(req.body?.text || '').trim();
    if (!text) throw bad('Write something first');
    const log = await M.ShiftLog.findById(req.params.id);
    if (!log) throw notFound('Log');
    log.entries.push({ time: new Date(), text, by: req.user._id, byName: req.user.name });
    await log.save();
    ok(res, log);
  })),
});
mount('audit-logs', M.AuditLog, { perm: 'audit', search: ['entity', 'action', 'userName'], sort: '-at', dateField: 'at', disable: ['create', 'update', 'delete'] });

export default r;
