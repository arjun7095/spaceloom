import webpush from 'web-push';
import { env } from '../config/env.js';
import { PushSubscription, SystemSetting } from '../models/index.js';

let ready = null;

// VAPID keys come from the environment, or are generated once and kept in the database.
export async function vapidKeys() {
  if (env.vapid.publicKey && env.vapid.privateKey) return { publicKey: env.vapid.publicKey, privateKey: env.vapid.privateKey };
  let s = await SystemSetting.findOne({ key: 'vapid' }).lean();
  if (!s) {
    const generated = webpush.generateVAPIDKeys();
    s = await SystemSetting.findOneAndUpdate({ key: 'vapid' }, { $setOnInsert: { value: generated } }, { upsert: true, new: true }).lean();
  }
  return s.value;
}

async function init() {
  ready ||= vapidKeys().then((k) => webpush.setVapidDetails(env.vapid.subject, k.publicKey, k.privateKey));
  return ready;
}
export const resetPush = () => { ready = null; };

export async function sendPush(userId, n) {
  const subs = await PushSubscription.find({ userId }).lean();
  if (!subs.length) return null;
  await init();
  const payload = JSON.stringify({ title: n.title, body: n.body || '', link: n.link || '/', tag: n.type });
  let sent = 0;
  let lastError;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 3600 });
      sent++;
    } catch (err) {
      lastError = err;
      if ([404, 410].includes(err.statusCode)) await PushSubscription.deleteOne({ _id: s._id });
    }
  }
  if (!sent && lastError) throw new Error(`Push failed: ${lastError.statusCode || ''} ${lastError.body || lastError.message}`.trim());
  return `pushed to ${sent} device(s)`;
}
