import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { Notification, Role, User } from '../models/index.js';
import { emitUser } from './socket.js';
import { logger } from './logger.js';
import { sendPush } from './push.js';

const transport = env.smtp.host
  ? nodemailer.createTransport({ host: env.smtp.host, port: env.smtp.port, auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined })
  : null;

const e164 = (mobile) => {
  const d = String(mobile || '').replace(/\D/g, '');
  if (!d) return null;
  return d.length === 10 ? `+${env.defaultCountryCode}${d}` : `+${d}`;
};
const messageText = (n) => `${n.title}${n.body ? ` — ${n.body}` : ''}${n.link ? ` ${env.clientUrls[0]}${n.link}` : ''}`.slice(0, 600);

async function twilio(to, body, whatsapp) {
  const { sid, token } = env.twilio;
  const from = whatsapp ? env.whatsapp.from : env.sms.from;
  if (!sid || !token || !from) throw new Error('Twilio is not fully configured (account SID, auth token and sender number)');
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: whatsapp ? `whatsapp:${to}` : to, From: whatsapp ? `whatsapp:${from}` : from, Body: body }),
  });
  if (!r.ok) throw new Error(`Twilio ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return `twilio ${(await r.json()).sid || 'accepted'}`;
}

// Generic relay: POST JSON to your own endpoint, which forwards to any Indian SMS/WhatsApp gateway.
async function webhook(channel, to, n) {
  if (!env.messageWebhook.url) throw new Error('MESSAGE_WEBHOOK_URL is not set');
  const r = await fetch(env.messageWebhook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(env.messageWebhook.token && { Authorization: `Bearer ${env.messageWebhook.token}` }) },
    body: JSON.stringify({ channel, to, text: messageText(n), title: n.title, body: n.body, link: n.link ? `${env.clientUrls[0]}${n.link}` : undefined, type: n.type }),
  });
  if (!r.ok) throw new Error(`Gateway ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return `gateway ${r.status}`;
}

async function phoneMessage(kind, user, n) {
  const to = e164(user.mobile);
  if (!to) throw new Error('No mobile number on this user');
  const provider = kind === 'whatsapp' ? env.whatsapp.provider : env.sms.provider;
  if (provider === 'twilio') return twilio(to, messageText(n), kind === 'whatsapp');
  if (provider === 'webhook') return webhook(kind, to, n);
  logger.info({ to, text: n.title }, `[${kind}:console]`);
  return 'console (no provider configured)';
}

export const channels = {
  async email(user, n) {
    if (!user.email) throw new Error('No email address');
    const text = `${n.body || ''}\n\nOpen: ${env.clientUrls[0]}${n.link || ''}`;
    if (!transport) {
      logger.info({ to: user.email, subject: n.title }, '[email:console]');
      return 'console (SMTP not configured)';
    }
    await transport.sendMail({ from: env.smtp.from, to: user.email, subject: n.title, text });
    return 'sent';
  },
  sms: (user, n) => phoneMessage('sms', user, n),
  whatsapp: (user, n) => phoneMessage('whatsapp', user, n),
  push: (user, n) => sendPush(user._id, n),
};

export function channelStatus() {
  return {
    email: transport ? `SMTP ${env.smtp.host}` : 'Console only (set SMTP_HOST)',
    sms: env.sms.provider === 'console' ? 'Console only (set SMS_PROVIDER)' : env.sms.provider,
    whatsapp: env.whatsapp.provider === 'console' ? 'Console only (set WHATSAPP_PROVIDER)' : env.whatsapp.provider,
    push: 'Web push (VAPID)',
  };
}

export async function sendEmail(to, subject, text, attachments) {
  if (transport) return transport.sendMail({ from: env.smtp.from, to, subject, text, attachments });
  logger.info({ to, subject, attachments: attachments?.map((a) => a.filename) }, '[email:console]');
}

// Delivers one notification on the extra channels and records the outcome on the notification.
export async function deliver(user, n, chs) {
  const deliveries = [];
  for (const c of chs) {
    if (c === 'in_app' || user.notificationPrefs?.[n.type]?.[c] === false) continue;
    try {
      const info = await channels[c]?.(user, n);
      if (info !== null && info !== undefined) deliveries.push({ channel: c, ok: true, info: String(info), at: new Date() });
    } catch (err) {
      deliveries.push({ channel: c, ok: false, info: err.message.slice(0, 300), at: new Date() });
      logger.warn({ err: err.message, channel: c }, 'delivery failed');
    }
  }
  if (deliveries.length) await Notification.updateOne({ _id: n._id }, { $push: { deliveries: { $each: deliveries } } });
  return deliveries;
}

export async function notify({ userIds = [], type, title, body, link, propertyId, channels: chs = ['in_app'], dedupeKey }) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return;
  const users = await User.find({ _id: { $in: ids }, status: 'active' }).select('email mobile notificationPrefs').lean();
  for (const u of users) {
    const key = dedupeKey ? `${dedupeKey}:${u._id}` : undefined;
    try {
      const n = await Notification.create({ userId: u._id, propertyId, type, title, body, link, channels: chs, dedupeKey: key });
      emitUser(String(u._id), 'notification:new', n);
      deliver(u, n, [...new Set([...chs, 'push'])]).catch((err) => logger.warn({ err }, 'deliver failed'));
    } catch (err) {
      if (err.code !== 11000) logger.warn({ err }, 'notify failed'); // 11000 = already sent (dedupe)
    }
  }
}

export async function usersWithRole(propertyId, roleKeys, departmentId) {
  const roles = await Role.find({ key: { $in: roleKeys } }).setOptions({ unscoped: true }).select('_id').lean();
  const q = { roleIds: { $in: roles.map((r) => r._id) }, status: 'active' };
  if (propertyId) q.propertyIds = propertyId;
  if (departmentId) q.departmentIds = departmentId;
  return User.find(q).select('_id name email').lean();
}
