import { Router } from 'express';
import { ah, ok, notFound, conflict, forbidden, bad, label, escapeRx } from './http.js';
import { requirePermission, can } from '../middleware/auth.js';
import { audit } from './audit.js';
import { nextNumber } from './numbering.js';
import { sendXlsx, toSheet } from './excel.js';
import { bumpKpis } from './socket.js';

const PROTECTED = ['_id', 'orgId', 'propertyId', 'createdBy', 'updatedBy', 'isDeleted', 'deletedAt', 'deletedBy', 'createdAt', 'updatedAt', 'number', 'approvals', 'approvalLevels', 'currentLevel', 'history'];
const NEVER_FILTER = /passwordHash|resetOtp|accountNo/;

export const clean = (body = {}, extra = []) => {
  const b = { ...body };
  for (const k of [...PROTECTED, ...extra]) delete b[k];
  return b;
};

const endOfDay = (d) => new Date(new Date(d).setHours(23, 59, 59, 999));

export function listQuery(Model, req, opts = {}) {
  const { search, filter = {}, from, to } = req.query;
  const q = { ...(opts.scopeFilter?.(req) || {}) };
  q.$and = [];
  if (search && opts.search?.length) {
    const rx = new RegExp(escapeRx(String(search).slice(0, 100)), 'i');
    q.$and.push({ $or: opts.search.map((f) => ({ [f]: rx })) });
  }
  if (filter && typeof filter === 'object') {
    for (const [k, v] of Object.entries(filter)) {
      if (v === '' || v == null || NEVER_FILTER.test(k) || !Model.schema.path(k)) continue;
      if (opts.filterable && !opts.filterable.includes(k)) continue;
      const vals = String(v).split(',');
      q[k] = vals.length > 1 ? { $in: vals } : vals[0] === 'null' ? null : vals[0];
    }
  }
  const df = opts.dateField || 'createdAt';
  if (from || to) q[df] = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: endOfDay(to) }) };
  opts.queryHook?.(q, req);
  if (!q.$and.length) delete q.$and;
  return q;
}

const safeSort = (s) => (typeof s === 'string' && /^-?[\w.]+( -?[\w.]+)*$/.test(s) ? s : null);

// Generic resource router: list (search/filter/sort/paginate/xlsx), get, create, update,
// soft delete, plus an optional state machine at POST /:id/transition.
// `extend(router)` registers custom routes first so they take precedence over /:id.
export function crud(Model, opts = {}) {
  const r = Router();
  const perm = opts.perm;
  const T = opts.transitions;
  const field = T?.field || 'status';
  const disabled = new Set(opts.disable || []);
  const scope = (req) => opts.scopeFilter?.(req) || {};
  const readPerms = opts.readPerm ? [].concat(opts.readPerm) : [`${perm}:read`];
  const allowed = (doc, user) => (T?.map[doc[field]] || []).filter((s) => can(user, T.perms?.[s] || `${perm}:update`));

  opts.extend?.(r);

  if (!disabled.has('list')) {
    r.get('/', requirePermission(...readPerms), ah(async (req, res) => {
      const q = listQuery(Model, req, opts);
      const sort = safeSort(req.query.sort) || opts.sort || '-createdAt';
      if (req.query.format === 'xlsx') {
        const rows = await Model.find(q).sort(sort).limit(10000).populate(opts.populate || []).lean();
        const { cols, flat } = toSheet(rows, opts.exportColumns);
        return sendXlsx(res, opts.exportName || Model.modelName, cols, flat);
      }
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const [data, total] = await Promise.all([
        Model.find(q).sort(sort).skip((page - 1) * limit).limit(limit).populate(opts.populate || []).select(opts.listSelect || '').lean(),
        Model.countDocuments(q),
      ]);
      ok(res, opts.mapOut ? data.map((d) => opts.mapOut(d, req)) : data, { page, limit, total });
    }));
  }

  if (!disabled.has('get')) {
    r.get('/:id', requirePermission(...readPerms), ah(async (req, res) => {
      const doc = await Model.findOne({ _id: req.params.id, ...scope(req) }).populate(opts.detailPopulate || opts.populate || []).lean();
      if (!doc) throw notFound(opts.label);
      const out = opts.mapOut ? opts.mapOut(doc, req) : doc;
      if (T) out.allowedTransitions = allowed(doc, req.user);
      ok(res, out);
    }));
  }

  if (!disabled.has('create')) {
    r.post('/', requirePermission(`${perm}:create`), ah(async (req, res) => {
      let data = clean(req.body, opts.readonly);
      if (T) delete data[field];
      if (opts.beforeCreate) data = (await opts.beforeCreate(data, req)) ?? data;
      if (opts.number) data.number = await nextNumber(opts.number, req.property?._id);
      const doc = await Model.create(data);
      await audit('create', Model.modelName, doc);
      await opts.afterCreate?.(doc, req);
      if (opts.kpi) bumpKpis(doc.propertyId);
      ok(res.status(201), doc);
    }));
  }

  if (!disabled.has('update')) {
    const update = ah(async (req, res) => {
      const doc = await Model.findOne({ _id: req.params.id, ...scope(req) });
      if (!doc) throw notFound(opts.label);
      if (opts.lockedWhen?.(doc)) throw conflict('This record is locked and can no longer be edited');
      const before = doc.toObject();
      let data = clean(req.body, opts.readonly);
      if (T) delete data[field];
      if (opts.beforeUpdate) data = (await opts.beforeUpdate(data, req, doc)) ?? data;
      doc.set(data);
      await doc.save();
      await audit('update', Model.modelName, doc, before);
      if (opts.kpi) bumpKpis(doc.propertyId);
      ok(res, doc);
    });
    r.patch('/:id', requirePermission(`${perm}:update`), update);
    r.put('/:id', requirePermission(`${perm}:update`), update);
  }

  if (!disabled.has('delete')) {
    r.delete('/:id', requirePermission(`${perm}:delete`), ah(async (req, res) => {
      const doc = await Model.findOne({ _id: req.params.id, ...scope(req) });
      if (!doc) throw notFound(opts.label);
      await opts.beforeDelete?.(doc, req);
      doc.isDeleted = true;
      doc.deletedAt = new Date();
      doc.deletedBy = req.user._id;
      await doc.save({ validateBeforeSave: false });
      await audit('delete', Model.modelName, { _id: doc._id, propertyId: doc.propertyId });
      if (opts.kpi) bumpKpis(doc.propertyId);
      ok(res, { _id: doc._id });
    }));
  }

  if (T) {
    r.post('/:id/transition', requirePermission(...readPerms), ah(async (req, res) => {
      const { to, note, ...extra } = req.body || {};
      const doc = await Model.findOne({ _id: req.params.id, ...scope(req) });
      if (!doc) throw notFound(opts.label);
      const from = doc[field];
      if (!(T.map[from] || []).includes(to)) throw conflict(`Cannot move from "${label(from)}" to "${label(to)}"`);
      if (!can(req.user, T.perms?.[to] || `${perm}:update`)) throw forbidden();
      await T.guard?.(doc, to, req);
      for (const k of T.require?.[to] || []) {
        if (extra[k] == null || extra[k] === '') if (doc[k] == null || doc[k] === '') throw bad(`Please fill in "${label(k)}"`, { [k]: ['Required'] });
      }
      const before = doc.toObject();
      for (const k of T.fields?.[to] || []) if (extra[k] !== undefined) doc.set(k, extra[k]);
      if (Model.schema.path('approvals') && /approved|rejected/.test(to)) {
        doc.approvals.push({ by: req.user._id, byName: req.user.name, action: to, level: doc.approvalLevels?.[doc.currentLevel || 0], comment: note, at: new Date() });
      }
      doc[field] = to;
      if (Model.schema.path('history')) doc.history.push({ status: to, by: req.user._id, byName: req.user.name, at: new Date(), note });
      await T.onEnter?.[to]?.(doc, req, extra);
      await doc.save();
      await audit(`transition:${to}`, Model.modelName, doc, before);
      await T.after?.(doc, req, to);
      if (opts.kpi) bumpKpis(doc.propertyId);
      ok(res, { ...doc.toObject(), allowedTransitions: allowed(doc, req.user) });
    }));
  }

  return r;
}
