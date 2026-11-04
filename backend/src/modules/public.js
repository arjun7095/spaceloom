import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ApiKey, Asset, Location, MeterReading, Property, PurchaseOrder, StockBalance, Ticket, TicketCategory, WorkOrder, OPEN_TICKET, PRIORITIES } from '../models/index.js';
import { ah, ok, parse, bad, forbidden, notFound, unauthorized, ApiError } from '../lib/http.js';
import { sha256 } from '../lib/crypto.js';
import { als } from '../lib/context.js';
import { createTicket } from './tickets.js';
import { ASSET_TO_TICKET_CAT } from './workorders.js';
import { computeKpis } from './dashboard.js';
import { processPunches } from './attendance.js';

// Public REST API for BMS / ERP / device integrations. Authenticate with "X-API-Key: ps_...".
// Every key belongs to one property and carries explicit scopes.
export const publicRouter = Router();
const r = publicRouter;

r.use(rateLimit({ windowMs: 60000, limit: 600, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.get('x-api-key') || req.ip }));
r.use(ah(async (req, res, next) => {
  const raw = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!raw) throw unauthorized('Send your API key in the X-API-Key header');
  const key = await ApiKey.findOne({ keyHash: sha256(raw), active: true }).setOptions({ unscoped: true }).lean();
  if (!key || (key.expiresAt && key.expiresAt < new Date())) throw new ApiError(401, 'INVALID_API_KEY', 'This API key is invalid, expired or revoked');
  const property = await Property.findById(key.propertyId).lean();
  if (!property) throw unauthorized('The property for this key no longer exists');
  req.apiKey = key;
  req.property = property;
  ApiKey.updateOne({ _id: key._id }, { lastUsedAt: new Date() }).setOptions({ unscoped: true }).catch(() => {});
  als.run({ propertyId: property._id, orgId: property.orgId, userName: `API key: ${key.name}`, ip: req.ip }, next);
}));
const scope = (s) => (req, res, next) => (req.apiKey.scopes.includes(s) ? next() : next(forbidden(`This API key does not have the "${s}" permission`)));
const page = (req) => ({ page: Math.max(1, Number(req.query.page) || 1), limit: Math.min(100, Math.max(1, Number(req.query.limit) || 50)) });
const assetByCode = async (code) => {
  const a = await Asset.findOne({ code: String(code).toUpperCase() }).populate('locationId', 'path code').populate('categoryId', 'code name').lean();
  if (!a) throw notFound('Asset');
  return a;
};

r.get('/assets', scope('assets:read'), ah(async (req, res) => {
  const { page: p, limit } = page(req);
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.criticality) q.criticality = req.query.criticality;
  const [rows, total] = await Promise.all([
    Asset.find(q).sort('code').skip((p - 1) * limit).limit(limit).populate('locationId', 'path').populate('categoryId', 'code').select('code name status criticality capacity runHours locationId categoryId').lean(),
    Asset.countDocuments(q),
  ]);
  ok(res, rows.map((a) => ({ code: a.code, name: a.name, category: a.categoryId?.code, status: a.status, criticality: a.criticality, capacity: a.capacity, runHours: a.runHours, location: a.locationId?.path })), { page: p, limit, total });
}));

r.get('/assets/:code', scope('assets:read'), ah(async (req, res) => {
  const a = await assetByCode(req.params.code);
  ok(res, { code: a.code, name: a.name, category: a.categoryId?.code, status: a.status, criticality: a.criticality, make: a.make, model: a.model, capacity: a.capacity, runHours: a.runHours, location: a.locationId?.path });
}));

r.post('/assets/:code/readings', scope('readings:write'), ah(async (req, res) => {
  const d = parse(z.object({ type: z.enum(['energy', 'water', 'dg_fuel', 'run_hours', 'temperature', 'other']), value: z.number(), unit: z.string().optional(), label: z.string().optional(), readAt: z.string().optional() }), req.body);
  const a = await assetByCode(req.params.code);
  const m = await MeterReading.create({ ...d, assetId: a._id, readAt: d.readAt ? new Date(d.readAt) : new Date(), note: `via ${req.apiKey.name}` });
  if (d.type === 'run_hours') await Asset.updateOne({ _id: a._id }, { runHours: d.value });
  ok(res.status(201), { id: m._id, asset: a.code, type: m.type, value: m.value, readAt: m.readAt });
}));

// A BMS alarm becomes a ticket. Repeats of the same open alarm within 2 hours return the existing ticket.
r.post('/assets/:code/alarms', scope('tickets:write'), ah(async (req, res) => {
  const d = parse(z.object({ description: z.string().min(3), priority: z.enum(PRIORITIES).optional(), alarmCode: z.string().optional() }), req.body);
  const a = await assetByCode(req.params.code);
  const description = `BMS alarm${d.alarmCode ? ` ${d.alarmCode}` : ''} on ${a.code}: ${d.description}`;
  const dup = await Ticket.findOne({ assetId: a._id, source: 'bms', description, status: { $in: OPEN_TICKET }, createdAt: { $gte: new Date(Date.now() - 2 * 36e5) } }).lean();
  if (dup) return ok(res, { number: dup.number, status: dup.status, duplicate: true });
  const category = (await TicketCategory.findOne({ code: ASSET_TO_TICKET_CAT[a.categoryId?.code] || 'ELEC' }).lean()) || (await TicketCategory.findOne().lean());
  const t = await createTicket({ property: req.property, user: null, source: 'bms', data: { categoryId: category._id, assetId: a._id, locationId: a.locationId?._id, description, priority: d.priority, priorityOverrideReason: d.priority ? 'Priority set by BMS' : undefined } });
  ok(res.status(201), { number: t.number, status: t.status, priority: t.priority, resolutionDue: t.sla.resolutionDue });
}));

r.post('/tickets', scope('tickets:write'), ah(async (req, res) => {
  const d = parse(z.object({ categoryCode: z.string(), description: z.string().min(5), locationCode: z.string().optional(), assetCode: z.string().optional(), priority: z.enum(PRIORITIES).optional(), reference: z.string().optional() }), req.body);
  const category = await TicketCategory.findOne({ code: d.categoryCode.toUpperCase() }).lean();
  if (!category) throw bad(`Unknown categoryCode "${d.categoryCode}"`);
  const asset = d.assetCode ? await assetByCode(d.assetCode) : null;
  const location = d.locationCode ? await Location.findOne({ code: d.locationCode.toUpperCase() }).lean() : null;
  if (!asset && !location) throw bad('Send locationCode or assetCode');
  const t = await createTicket({ property: req.property, user: null, source: 'api', data: { categoryId: category._id, assetId: asset?._id, locationId: location?._id || asset?.locationId?._id, description: `${d.description}${d.reference ? ` (ref ${d.reference})` : ''}`, priority: d.priority, priorityOverrideReason: d.priority ? `Priority set by ${req.apiKey.name}` : undefined } });
  ok(res.status(201), { number: t.number, status: t.status, priority: t.priority, responseDue: t.sla.responseDue, resolutionDue: t.sla.resolutionDue });
}));

const ticketOut = (t) => ({ number: t.number, status: t.status, priority: t.priority, category: t.categoryId?.code, description: t.description, location: t.locationId?.path, asset: t.assetId?.code, createdAt: t.createdAt, responseDue: t.sla?.responseDue, resolutionDue: t.sla?.resolutionDue, respondedAt: t.sla?.respondedAt, resolvedAt: t.sla?.resolvedAt, slaBreached: Boolean(t.sla?.resolutionBreached || t.sla?.responseBreached), closedAt: t.closedAt });
const ticketPop = [{ path: 'categoryId', select: 'code' }, { path: 'locationId', select: 'path' }, { path: 'assetId', select: 'code' }];

r.get('/tickets', scope('tickets:read'), ah(async (req, res) => {
  const { page: p, limit } = page(req);
  const q = {};
  if (req.query.status) q.status = { $in: String(req.query.status).split(',') };
  if (req.query.from) q.createdAt = { $gte: new Date(req.query.from) };
  const [rows, total] = await Promise.all([Ticket.find(q).sort('-createdAt').skip((p - 1) * limit).limit(limit).populate(ticketPop).lean(), Ticket.countDocuments(q)]);
  ok(res, rows.map(ticketOut), { page: p, limit, total });
}));

r.get('/tickets/:number', scope('tickets:read'), ah(async (req, res) => {
  const t = await Ticket.findOne({ number: req.params.number }).populate(ticketPop).lean();
  if (!t) throw notFound('Ticket');
  ok(res, ticketOut(t));
}));

r.get('/work-orders', scope('workorders:read'), ah(async (req, res) => {
  const { page: p, limit } = page(req);
  const q = {};
  if (req.query.status) q.status = { $in: String(req.query.status).split(',') };
  if (req.query.type) q.type = req.query.type;
  if (req.query.from) q.plannedDate = { $gte: new Date(req.query.from) };
  const [rows, total] = await Promise.all([WorkOrder.find(q).sort('-plannedDate').skip((p - 1) * limit).limit(limit).populate('assetId', 'code').select('number type title status priority plannedDate completedAt verifiedAt downtimeMin assetId partsUsed').lean(), WorkOrder.countDocuments(q)]);
  ok(res, rows.map((w) => ({ number: w.number, type: w.type, title: w.title, status: w.status, priority: w.priority, asset: w.assetId?.code, plannedDate: w.plannedDate, completedAt: w.completedAt, verifiedAt: w.verifiedAt, downtimeMin: w.downtimeMin, partsCost: (w.partsUsed || []).reduce((s, x) => s + (x.cost || 0), 0) })), { page: p, limit, total });
}));

r.get('/kpis', scope('kpis:read'), ah(async (req, res) => {
  ok(res, (await computeKpis()).map(({ code, name, unit, actual, target, status }) => ({ code, name, unit, actual, target, status })));
}));

r.get('/stock', scope('stock:read'), ah(async (req, res) => {
  const rows = await StockBalance.find().populate('itemId', 'code name uom reorderLevel unitCost').populate('storeId', 'name').lean();
  ok(res, rows.filter((b) => b.itemId).map((b) => ({ itemCode: b.itemId.code, item: b.itemId.name, store: b.storeId?.name, qty: b.qty, uom: b.itemId.uom, reorderLevel: b.itemId.reorderLevel, belowReorder: b.qty <= (b.itemId.reorderLevel ?? -1) })));
}));

r.get('/purchase-orders', scope('procurement:read'), ah(async (req, res) => {
  const q = req.query.status ? { status: { $in: String(req.query.status).split(',') } } : {};
  const rows = await PurchaseOrder.find(q).sort('-createdAt').limit(200).populate('vendorId', 'name gstin').populate('items.itemId', 'code name').lean();
  ok(res, rows.map((p) => ({ number: p.number, status: p.status, vendor: p.vendorId?.name, vendorGstin: p.vendorId?.gstin, subTotal: p.subTotal, gst: p.gst, total: p.total, deliveryDate: p.deliveryDate, items: p.items.map((i) => ({ itemCode: i.itemId?.code, item: i.itemId?.name, qty: i.qty, rate: i.rate, gstPct: i.gstPct, receivedQty: i.receivedQty })) })));
}));

r.post('/attendance/punches', scope('attendance:punch'), ah(async (req, res) => {
  const d = parse(z.object({ punches: z.array(z.object({ deviceId: z.string().optional(), employeeCode: z.string(), timestamp: z.string(), source: z.enum(['biometric', 'face']).optional() })).min(1).max(5000) }), req.body);
  ok(res, await processPunches(req.property._id, d.punches));
}));

