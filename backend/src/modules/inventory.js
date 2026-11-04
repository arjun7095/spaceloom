import { Router } from 'express';
import { z } from 'zod';
import { Grn, Item, MaterialIssue, PurchaseOrder, PurchaseRequest, StockBalance, StockCount, StockLedger, Ticket, WorkOrder } from '../models/index.js';
import { crud } from '../lib/crud.js';
import { ah, ok, parse, bad, conflict, notFound, escapeRx } from '../lib/http.js';
import { requirePermission, isBroad, hasOnly } from '../middleware/auth.js';
import { withTransaction } from '../config/db.js';
import { nextNumber } from '../lib/numbering.js';
import { audit } from '../lib/audit.js';
import { ctx, istDate } from '../lib/context.js';
import { notify, usersWithRole } from '../lib/notify.js';
import { bumpKpis, emitProperty } from '../lib/socket.js';

// The only way stock changes (FR-6.3). A negative movement only succeeds when enough stock exists,
// so balances can never go below zero even without a replica-set transaction.
export async function postMovement({ storeId, itemId, qty, type, rate = 0, refType, refId, refNumber, note, session }) {
  const opts = session ? { session } : {};
  const cond = { storeId, itemId, ...(qty < 0 && { qty: { $gte: -qty } }) };
  const bal = await StockBalance.findOneAndUpdate(cond, { $inc: { qty, value: Math.round(qty * rate * 100) / 100 } }, { new: true, upsert: qty > 0, ...opts });
  if (!bal) {
    const item = await Item.findById(itemId).select('name').lean();
    const have = (await StockBalance.findOne({ storeId, itemId }).select('qty').lean())?.qty || 0;
    throw conflict(`Not enough stock of ${item?.name || 'this item'} (available: ${have})`);
  }
  await StockLedger.create([{ propertyId: bal.propertyId, orgId: bal.orgId, storeId, itemId, type, qty, rate, refType, refId, refNumber, balanceAfter: bal.qty, note, by: ctx().userId }], opts);
  return bal;
}

async function checkReorder(balances) {
  for (const bal of balances) {
    const item = await Item.findById(bal.itemId).lean();
    if (item?.reorderLevel != null && bal.qty <= item.reorderLevel) {
      emitProperty(String(bal.propertyId), 'stock:alert', { itemId: item._id, name: item.name, qty: bal.qty, reorderLevel: item.reorderLevel });
      const keepers = await usersWithRole(bal.propertyId, ['storekeeper', 'procurement']);
      await notify({ userIds: keepers.map((u) => u._id), propertyId: bal.propertyId, type: 'stock_low', title: `Reorder ${item.name}`, body: `Balance ${bal.qty} ${item.uom} is at or below the reorder level (${item.reorderLevel}).`, link: '/inventory?view=alerts', dedupeKey: `reorder:${item._id}:${istDate()}` });
    }
  }
  if (balances[0]) bumpKpis(balances[0].propertyId);
}

export async function lowStock() {
  return StockBalance.aggregate([
    { $lookup: { from: 'items', localField: 'itemId', foreignField: '_id', as: 'item' } },
    { $unwind: '$item' },
    { $match: { 'item.isDeleted': { $ne: true }, $expr: { $lte: ['$qty', { $ifNull: ['$item.reorderLevel', -1] }] } } },
    { $lookup: { from: 'stores', localField: 'storeId', foreignField: '_id', as: 'store' } },
    { $unwind: '$store' },
    { $project: { qty: 1, value: 1, storeId: 1, itemId: 1, propertyId: 1, 'item.code': 1, 'item.name': 1, 'item.uom': 1, 'item.reorderLevel': 1, 'item.reorderQty': 1, 'item.unitCost': 1, 'item.category': 1, 'item.preferredVendorId': 1, 'store.name': 1 } },
  ]);
}

const lines = z.array(z.object({ itemId: z.string().min(1), qty: z.number().positive('Quantity must be more than 0') })).min(1, 'Add at least one item');

export const stockRouter = Router();

stockRouter.get('/', requirePermission('inventory:read'), ah(async (req, res) => {
  const q = {};
  if (req.query.storeId) q.storeId = req.query.storeId;
  let rows = await StockBalance.find(q).populate('itemId', 'code name category uom unitCost reorderLevel minLevel maxLevel reorderQty binLocation isChemical').populate('storeId', 'name').lean();
  rows = rows.filter((r) => r.itemId);
  if (req.query.search) {
    const rx = new RegExp(escapeRx(req.query.search), 'i');
    rows = rows.filter((r) => rx.test(r.itemId.name) || rx.test(r.itemId.code));
  }
  if (req.query.category) rows = rows.filter((r) => r.itemId.category === req.query.category);
  if (req.query.view === 'alerts') rows = rows.filter((r) => r.itemId.reorderLevel != null && r.qty <= r.itemId.reorderLevel);
  rows.sort((a, b) => a.itemId.name.localeCompare(b.itemId.name));
  const total = rows.length;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 25);
  ok(res, rows.slice((page - 1) * limit, page * limit), { page, limit, total, totalValue: rows.reduce((a, r) => a + (r.qty * (r.itemId.unitCost || 0)), 0) });
}));

stockRouter.get('/ledger', requirePermission('inventory:read'), ah(async (req, res) => {
  const q = {};
  if (req.query.itemId) q.itemId = req.query.itemId;
  if (req.query.storeId) q.storeId = req.query.storeId;
  ok(res, await StockLedger.find(q).sort('-at').limit(300).populate('itemId', 'code name uom').populate('storeId', 'name').populate('by', 'name').lean());
}));

stockRouter.get('/alerts', requirePermission('inventory:read'), ah(async (req, res) => {
  const soon = new Date(Date.now() + 30 * 864e5);
  const [low, expiring] = await Promise.all([
    lowStock(),
    StockBalance.find({ 'batches.expiry': { $lte: soon } }).populate('itemId', 'code name uom').populate('storeId', 'name').lean(),
  ]);
  ok(res, { low, expiring: expiring.flatMap((b) => b.batches.filter((x) => x.expiry && x.expiry <= soon && x.qty > 0).map((x) => ({ item: b.itemId, store: b.storeId, ...x }))) });
}));

stockRouter.post('/adjust', requirePermission('inventory:update'), ah(async (req, res) => {
  const d = parse(z.object({ storeId: z.string(), itemId: z.string(), qty: z.number().refine((n) => n !== 0, 'Cannot be 0'), reason: z.string().min(3, 'Give a reason') }), req.body);
  const item = await Item.findById(d.itemId).lean();
  if (!item) throw notFound('Item');
  const bal = await postMovement({ storeId: d.storeId, itemId: d.itemId, qty: d.qty, type: d.qty > 0 && !(await StockLedger.exists({ storeId: d.storeId, itemId: d.itemId })) ? 'opening' : 'adjustment', rate: item.unitCost, refType: 'adjustment', note: d.reason });
  await checkReorder([bal]);
  ok(res, bal);
}));

stockRouter.post('/transfer', requirePermission('inventory:update'), ah(async (req, res) => {
  const d = parse(z.object({ fromStoreId: z.string(), toStoreId: z.string(), itemId: z.string(), qty: z.number().positive(), note: z.string().optional() }), req.body);
  if (d.fromStoreId === d.toStoreId) throw bad('Choose two different stores');
  const item = await Item.findById(d.itemId).lean();
  const result = await withTransaction(async (session) => {
    const out = await postMovement({ storeId: d.fromStoreId, itemId: d.itemId, qty: -d.qty, type: 'transfer_out', rate: item.unitCost, refType: 'transfer', note: d.note, session });
    const inn = await postMovement({ storeId: d.toStoreId, itemId: d.itemId, qty: d.qty, type: 'transfer_in', rate: item.unitCost, refType: 'transfer', note: d.note, session });
    return [out, inn];
  });
  await checkReorder([result[0]]);
  ok(res, result);
}));

// ── Material issue: request → issue → return; cost posts to the work order (FR-6.8) ──
const issueScope = (req) => (isBroad(req.user) || req.user.roles.includes('supervisor') ? {} : { requestedBy: req.user._id });

async function issueNow(mi, user) {
  const itemDocs = await Item.find({ _id: { $in: mi.items.map((i) => i.itemId) } }).lean();
  const balances = await withTransaction(async (session) => {
    const out = [];
    for (const line of mi.items) {
      const item = itemDocs.find((x) => String(x._id) === String(line.itemId));
      line.rate = item?.unitCost || 0;
      out.push(await postMovement({ storeId: mi.storeId, itemId: line.itemId, qty: -line.qty, type: 'issue', rate: line.rate, refType: 'MaterialIssue', refId: mi._id, refNumber: mi.number, session }));
    }
    return out;
  });
  mi.status = 'issued';
  mi.issuedBy = user._id;
  mi.issuedAt = new Date();
  mi.totalCost = mi.items.reduce((a, l) => a + l.qty * (l.rate || 0), 0);
  await mi.save();
  if (mi.workOrderId) {
    const wo = await WorkOrder.findById(mi.workOrderId);
    if (wo) {
      for (const l of mi.items) {
        const item = itemDocs.find((x) => String(x._id) === String(l.itemId));
        wo.partsUsed.push({ itemId: l.itemId, name: item?.name, qty: l.qty, cost: l.qty * (l.rate || 0), issueId: mi._id });
      }
      await wo.save();
      if (wo.ticketId) {
        await Ticket.updateOne({ _id: wo.ticketId }, { $push: { history: { status: 'in_progress', by: user._id, byName: user.name, at: new Date(), note: `Parts issued (${mi.number}): ${mi.items.map((l) => `${itemDocs.find((x) => String(x._id) === String(l.itemId))?.name} × ${l.qty}`).join(', ')}` } } });
        emitProperty(String(wo.propertyId), 'ticket:updated', { _id: wo.ticketId });
      }
    }
  }
  await checkReorder(balances);
  if (mi.requestedBy && String(mi.requestedBy) !== String(user._id)) {
    await notify({ userIds: [mi.requestedBy], propertyId: mi.propertyId, type: 'material_issued', title: `Materials ready: ${mi.number}`, body: 'Collect them from the store.', link: mi.ticketId ? `/tickets/${mi.ticketId}` : '/inventory/issues' });
  }
  return mi;
}

export const materialIssues = crud(MaterialIssue, {
  perm: 'inventory',
  label: 'Material issue',
  number: 'MI',
  search: ['number', 'note'],
  scopeFilter: issueScope,
  populate: [{ path: 'storeId', select: 'name' }, { path: 'workOrderId', select: 'number title' }, { path: 'requestedBy', select: 'name' }, { path: 'items.itemId', select: 'code name uom' }, { path: 'departmentId', select: 'name' }],
  disable: ['update', 'delete'],
  readonly: ['status', 'issuedBy', 'issuedAt', 'totalCost'],
  beforeCreate: async (data, req) => {
    parse(z.object({ storeId: z.string().min(1, 'Choose a store'), items: lines }).passthrough(), data);
    let ticketId;
    if (data.workOrderId) ticketId = (await WorkOrder.findById(data.workOrderId).select('ticketId').lean())?.ticketId;
    return { ...data, ticketId, requestedBy: req.user._id, status: 'requested' };
  },
  afterCreate: async (mi, req) => {
    if (req.body.issueNow && !hasOnly(req.user, 'technician') && req.user.perms.has('inventory:update')) return issueNow(mi, req.user);
    const keepers = await usersWithRole(mi.propertyId, ['storekeeper']);
    await notify({ userIds: keepers.map((u) => u._id), propertyId: mi.propertyId, type: 'material_request', title: `Material request ${mi.number}`, body: `${req.user.name} requested ${mi.items.length} item(s)`, link: '/inventory/issues' });
  },
  extend: (r) => {
    r.post('/:id/issue', requirePermission('inventory:update'), ah(async (req, res) => {
      const mi = await MaterialIssue.findById(req.params.id);
      if (!mi) throw notFound('Material issue');
      if (mi.status !== 'requested') throw conflict('This request has already been handled');
      if (req.body?.storeId) mi.storeId = req.body.storeId;
      await issueNow(mi, req.user);
      await audit('transition:issued', 'MaterialIssue', mi);
      ok(res, mi);
    }));
    r.post('/:id/reject', requirePermission('inventory:update'), ah(async (req, res) => {
      const mi = await MaterialIssue.findById(req.params.id);
      if (!mi || mi.status !== 'requested') throw conflict('Only open requests can be rejected');
      mi.status = 'rejected';
      mi.rejectReason = req.body?.reason;
      await mi.save();
      ok(res, mi);
    }));
    r.post('/:id/return', requirePermission('inventory:create'), ah(async (req, res) => {
      const d = parse(z.object({ items: lines }), req.body);
      const mi = await MaterialIssue.findById(req.params.id);
      if (!mi || !['issued', 'partially_returned'].includes(mi.status)) throw conflict('Only issued materials can be returned');
      await withTransaction(async (session) => {
        for (const ret of d.items) {
          const line = mi.items.find((l) => String(l.itemId) === ret.itemId);
          if (!line || ret.qty > line.qty - line.returnedQty) throw bad('You cannot return more than was issued');
          line.returnedQty += ret.qty;
          await postMovement({ storeId: mi.storeId, itemId: ret.itemId, qty: ret.qty, type: 'return', rate: line.rate, refType: 'MaterialIssue', refId: mi._id, refNumber: mi.number, session });
        }
      });
      mi.status = mi.items.every((l) => l.returnedQty >= l.qty) ? 'returned' : 'partially_returned';
      mi.totalCost = mi.items.reduce((a, l) => a + (l.qty - l.returnedQty) * (l.rate || 0), 0);
      await mi.save();
      if (mi.workOrderId) {
        const wo = await WorkOrder.findById(mi.workOrderId);
        for (const p of wo?.partsUsed || []) {
          const line = mi.items.find((l) => String(l.itemId) === String(p.itemId));
          if (line && String(p.issueId) === String(mi._id)) {
            p.qty = line.qty - line.returnedQty;
            p.cost = p.qty * (line.rate || 0);
          }
        }
        await wo?.save();
      }
      ok(res, mi);
    }));
  },
});

// ── GRN against a PO; stock goes up on receipt (FR-6.7) ──
export const grns = crud(Grn, {
  perm: 'inventory',
  label: 'Goods receipt',
  number: 'GRN',
  search: ['number'],
  populate: [{ path: 'poId', select: 'number vendorId' }, { path: 'storeId', select: 'name' }, { path: 'items.itemId', select: 'code name uom' }, { path: 'receivedBy', select: 'name' }],
  disable: ['update', 'delete'],
  extend: (r) => {
    r.post('/', requirePermission('inventory:create'), ah(async (req, res) => {
      const d = parse(z.object({
        poId: z.string().min(1, 'Choose a purchase order'), storeId: z.string().min(1, 'Choose a store'), notes: z.string().optional(),
        items: z.array(z.object({ itemId: z.string(), receivedQty: z.number().min(0), rejectedQty: z.number().min(0).default(0), reason: z.string().optional(), batchNo: z.string().optional(), expiry: z.string().optional() })).min(1),
      }), req.body);
      const po = await PurchaseOrder.findById(d.poId);
      if (!po) throw notFound('Purchase order');
      if (!['approved', 'sent', 'partially_received'].includes(po.status)) throw conflict('Only approved POs can be received');
      for (const l of d.items) {
        const pl = po.items.find((x) => String(x.itemId) === l.itemId);
        if (!pl) throw bad('An item is not on this PO');
        if (l.rejectedQty > 0 && !l.reason) throw bad('Give a reason for rejected quantity');
        if ((pl.receivedQty || 0) + l.receivedQty > pl.qty) throw bad('Received quantity is more than ordered');
      }
      const grn = await Grn.create({ ...d, number: await nextNumber('GRN', req.property._id), receivedBy: req.user._id });
      const balances = await withTransaction(async (session) => {
        const out = [];
        for (const l of d.items.filter((x) => x.receivedQty > 0)) {
          const pl = po.items.find((x) => String(x.itemId) === l.itemId);
          pl.receivedQty = (pl.receivedQty || 0) + l.receivedQty;
          const bal = await postMovement({ storeId: d.storeId, itemId: l.itemId, qty: l.receivedQty, type: 'grn', rate: pl.rate, refType: 'Grn', refId: grn._id, refNumber: grn.number, session });
          if (l.batchNo) await StockBalance.updateOne({ _id: bal._id }, { $push: { batches: { batchNo: l.batchNo, expiry: l.expiry ? new Date(l.expiry) : undefined, qty: l.receivedQty } } }, session ? { session } : {});
          out.push(bal);
        }
        return out;
      });
      po.status = po.items.every((x) => (x.receivedQty || 0) >= x.qty) ? 'received' : 'partially_received';
      po.history?.push?.({ status: po.status, by: req.user._id, byName: req.user.name, at: new Date(), note: grn.number });
      await po.save();
      await audit('create', 'Grn', grn);
      bumpKpis(req.property._id);
      ok(res.status(201), { grn, balances });
    }));
  },
});

// ── PR from reorder alerts (FR-6.10) ──
export async function draftPrFromAlerts(req) {
  const low = await lowStock();
  if (!low.length) throw bad('No items are below their reorder level');
  const seen = new Set();
  const items = low.filter((l) => !seen.has(String(l.itemId)) && seen.add(String(l.itemId))).map((l) => ({ itemId: l.itemId, qty: l.item.reorderQty || Math.max(1, (l.item.reorderLevel || 0) * 2 - l.qty), rate: l.item.unitCost, reason: `Balance ${l.qty} ≤ reorder level ${l.item.reorderLevel}` }));
  const pr = await PurchaseRequest.create({ number: await nextNumber('PR', req.property._id), items, reason: 'Auto-drafted from reorder alerts', requestedBy: req.user._id, status: 'draft', approvalLevels: ['supervisor', 'property_manager'] });
  await audit('create', 'PurchaseRequest', pr);
  return pr;
}

// ── Stock count: lines pre-filled from the system balance; approval posts the variance (FR-6.11) ──
export async function prepareStockCount(data) {
  const bals = await StockBalance.find({ storeId: data.storeId }).lean();
  return { ...data, lines: data.lines?.length ? data.lines : bals.map((b) => ({ itemId: b.itemId, systemQty: b.qty })) };
}

export async function postCountVariance(count) {
  for (const l of count.lines) {
    if (l.countedQty == null || !l.variance) continue;
    const item = await Item.findById(l.itemId).select('unitCost').lean();
    await postMovement({ storeId: count.storeId, itemId: l.itemId, qty: l.variance, type: 'count', rate: item?.unitCost, refType: 'StockCount', refId: count._id, refNumber: count.number });
  }
}

export { StockCount };
