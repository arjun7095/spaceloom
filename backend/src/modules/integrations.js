import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { ApiKey, Capa, Comment, Incident, Location, Notification, Property, PurchaseOrder, PurchaseRequest, PushSubscription, Tenant, TicketCategory, User, WorkOrder, API_SCOPES } from '../models/index.js';
import { ah, ok, parse, bad, forbidden, notFound, ApiError } from '../lib/http.js';
import { can, toAuthUser } from '../middleware/auth.js';
import { vapidKeys } from '../lib/push.js';
import { channelStatus, deliver, notify, sendEmail } from '../lib/notify.js';
import { storageKind } from '../lib/storage.js';
import { sha256 } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { als } from '../lib/context.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { woScope } from './workorders.js';
import { createTicket } from './tickets.js';

export const integrationsRouter = Router();
const r = integrationsRouter;
const adminOnly = (req) => {
  if (!req.user.isSuper && !req.user.roles.includes('property_manager')) throw forbidden('Only administrators can do this');
};

// ── Phone push (FR-13.1) ──
r.get('/push/key', ah(async (req, res) => ok(res, { publicKey: (await vapidKeys()).publicKey })));
r.post('/push/subscribe', ah(async (req, res) => {
  const d = parse(z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }).passthrough(), req.body);
  await PushSubscription.updateOne({ endpoint: d.endpoint }, { userId: req.user._id, keys: d.keys, userAgent: req.get('user-agent')?.slice(0, 200) }, { upsert: true });
  ok(res, { subscribed: true });
}));
r.post('/push/unsubscribe', ah(async (req, res) => {
  if (req.body?.endpoint) await PushSubscription.deleteOne({ endpoint: req.body.endpoint, userId: req.user._id });
  ok(res, { unsubscribed: true });
}));

// Sends a test message to the signed-in user on one channel and reports what happened.
r.post('/notifications/test', ah(async (req, res) => {
  const { channel } = parse(z.object({ channel: z.enum(['email', 'sms', 'whatsapp', 'push']) }), req.body);
  const user = await User.findById(req.user._id).select('email mobile').lean();
  const n = await Notification.create({ userId: user._id, propertyId: req.property?._id, type: 'test', title: 'Test notification from PrimeSpace IPFM', body: `If you received this, ${channel} delivery works.`, link: '/profile', channels: ['in_app', channel] });
  const [d] = await deliver(user, n, [channel]);
  ok(res, d || { channel, ok: false, info: channel === 'push' ? 'This device has not turned on phone notifications yet' : 'Nothing was sent' });
}));

r.get('/admin/integrations', ah(async (req, res) => {
  adminOnly(req);
  ok(res, {
    storage: storageKind(),
    channels: channelStatus(),
    inboundEmail: env.inboundEmailToken ? `${req.protocol}://${req.get('host')}/api/v1/inbound/email?token=<INBOUND_EMAIL_TOKEN>` : null,
    devicePunchUrl: `${req.protocol}://${req.get('host')}/api/v1/attendance/device-punches`,
    publicApiBase: `${req.protocol}://${req.get('host')}/api/v1/public`,
    scopes: API_SCOPES,
  });
}));

// ── Comments with @mentions on work orders, PRs, POs, incidents and CAPAs (FR-13.5) ──
const COMMENTABLE = {
  WorkOrder: { model: WorkOrder, perm: 'workorder:read', scope: woScope, link: (d) => `/work-orders/${d._id}`, watchers: (d) => d.assigneeIds || [] },
  PurchaseRequest: { model: PurchaseRequest, perm: 'procurement:read', link: (d) => `/procurement/requests?id=${d._id}`, watchers: (d) => [d.requestedBy] },
  PurchaseOrder: { model: PurchaseOrder, perm: 'procurement:read', link: (d) => `/procurement/orders?id=${d._id}`, watchers: (d) => [d.createdBy] },
  Incident: { model: Incident, perm: 'hse:read', link: (d) => `/hse/incidents?id=${d._id}`, watchers: (d) => [d.reportedBy] },
  Capa: { model: Capa, perm: 'hse:read', link: (d) => `/hse/capas?id=${d._id}`, watchers: (d) => [d.ownerId] },
};
async function commentTarget(req, entity, id) {
  const c = COMMENTABLE[entity];
  if (!c) throw bad('Comments are not available for this record');
  if (!can(req.user, c.perm)) throw forbidden();
  const doc = await c.model.findOne({ _id: id, ...(c.scope?.(req) || {}) }).lean();
  if (!doc) throw notFound();
  return { c, doc };
}
r.get('/comments', ah(async (req, res) => {
  await commentTarget(req, req.query.entity, req.query.entityId);
  ok(res, await Comment.find({ entity: req.query.entity, entityId: req.query.entityId }).sort('createdAt').populate('mentions', 'name').lean());
}));
r.post('/comments', ah(async (req, res) => {
  const d = parse(z.object({ entity: z.string(), entityId: z.string(), text: z.string().min(1).max(2000), mentions: z.array(z.string()).max(10).optional() }), req.body);
  const { c, doc } = await commentTarget(req, d.entity, d.entityId);
  const comment = await Comment.create({ entity: d.entity, entityId: d.entityId, text: d.text, mentions: d.mentions || [], byName: req.user.name });
  const targets = [...(d.mentions || []), ...c.watchers(doc)].filter((x) => x && String(x) !== req.user.id);
  await notify({ userIds: targets, propertyId: doc.propertyId, type: 'comment', title: `${req.user.name} ${d.mentions?.length ? 'mentioned you' : 'commented'} on ${doc.number || doc.title || d.entity}`, body: d.text.slice(0, 140), link: c.link(doc) });
  ok(res.status(201), await Comment.findById(comment._id).populate('mentions', 'name').lean());
}));

// ── API keys for BMS / ERP integrations (FR-15.5) ──
r.get('/api-keys', ah(async (req, res) => {
  adminOnly(req);
  ok(res, await ApiKey.find().sort('-createdAt').populate('createdBy', 'name').lean());
}));
r.post('/api-keys', ah(async (req, res) => {
  adminOnly(req);
  const d = parse(z.object({ name: z.string().min(2, 'Give the key a name'), scopes: z.array(z.enum(API_SCOPES)).min(1, 'Choose at least one permission'), expiresInDays: z.number().int().positive().max(1095).optional() }), req.body);
  const raw = `ps_${crypto.randomBytes(24).toString('hex')}`;
  const key = await ApiKey.create({ name: d.name, scopes: d.scopes, prefix: raw.slice(0, 11), keyHash: sha256(raw), expiresAt: d.expiresInDays ? new Date(Date.now() + d.expiresInDays * 864e5) : undefined });
  await audit('create', 'ApiKey', { _id: key._id, propertyId: key.propertyId, name: key.name, scopes: key.scopes });
  const out = key.toObject();
  delete out.keyHash;
  ok(res.status(201), { ...out, key: raw });
}));
r.delete('/api-keys/:id', ah(async (req, res) => {
  adminOnly(req);
  const key = await ApiKey.findOneAndUpdate({ _id: req.params.id }, { active: false }, { new: true });
  if (!key) throw notFound('API key');
  await audit('revoke', 'ApiKey', { _id: key._id, propertyId: key.propertyId });
  ok(res, { revoked: true });
}));

// ── Email-to-ticket (FR-5.1): inbound webhook from Mailgun, SendGrid Inbound Parse, Postmark or similar ──
const KEYWORDS = [['LIFT', /\b(lift|elevator|escalator)\b/i], ['HVAC', /\b(ac|a\/c|aircon|air ?con|cool|cooling|hot|warm|ahu|hvac|temperature)\b/i], ['PLUMB', /\b(leak|leaking|water|tap|flush|drain|plumb|toilet|pipe)\b/i], ['ELEC', /\b(light|lights|power|socket|electric|switch|trip|tripping)\b/i], ['HK', /\b(clean|cleaning|garbage|dust|pest|smell|dirty|housekeeping)\b/i], ['SEC', /\b(security|parking|access card|guard|theft)\b/i], ['IT', /\b(wifi|wi-fi|signage|network|screen)\b/i]];

export const inboundEmail = ah(async (req, res) => {
  const token = req.query.token || req.get('x-inbound-token');
  if (!env.inboundEmailToken || token !== env.inboundEmailToken) throw new ApiError(401, 'INVALID_TOKEN', 'Inbound email token is missing or wrong');
  const b = req.body || {};
  const email = (String(b.from || b.sender || b.From || b.FromFull?.Email || '').match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [])[0]?.toLowerCase();
  const subject = String(b.subject || b.Subject || '').trim();
  const text = String(b['stripped-text'] || b['body-plain'] || b.text || b.TextBody || '').trim();
  if (!email || (!subject && !text)) return ok(res.status(202), { accepted: false, reason: 'Missing sender or content' });
  const user = await User.findOne({ email, status: 'active' }).populate('roleIds', 'key name permissions layout').lean();
  if (!user) {
    logger.warn({ email }, 'inbound email from unknown sender ignored');
    return ok(res.status(202), { accepted: false, reason: 'Unknown sender' });
  }
  const property = await Property.findById(user.propertyIds[0]).lean();
  return als.run({ propertyId: property._id, orgId: property.orgId, userId: user._id, userName: user.name }, async () => {
    const tenant = user.tenantId ? await Tenant.findById(user.tenantId).lean() : null;
    const code = KEYWORDS.find(([, rx]) => rx.test(`${subject} ${text}`))?.[0] || 'CIVIL';
    const category = (await TicketCategory.findOne({ code }).lean()) || (await TicketCategory.findOne().lean());
    const locationId = tenant?.units?.[0] || (await Location.findOne({ type: 'tower' }).lean())?._id;
    const t = await createTicket({
      property, user: toAuthUser(user), source: 'email',
      data: { categoryId: category._id, locationId, tenantId: tenant?._id, description: `${subject}${text ? ` — ${text}` : ''}`.slice(0, 2000) },
    });
    await sendEmail(email, `Re: ${subject} [${t.number}]`, `Thank you. We have logged your request as ${t.number} (${category.name}, priority ${t.priority}).\n\nTrack it here: ${env.clientUrls[0]}/tickets/${t._id}`);
    ok(res.status(201), { accepted: true, number: t.number, category: category.code });
  });
});
