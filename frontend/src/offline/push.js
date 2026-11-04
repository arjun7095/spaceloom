import { api } from '../api/client';

const toKey = (base64) => {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const registration = async () => ('serviceWorker' in navigator ? navigator.serviceWorker.getRegistration() : null);

// 'unsupported' | 'needs-install' (no service worker, e.g. dev server) | 'blocked' | 'off' | 'on'
export async function pushState() {
  if (!('Notification' in window) || !('PushManager' in window)) return 'unsupported';
  const reg = await registration();
  if (!reg) return 'needs-install';
  if (Notification.permission === 'denied') return 'blocked';
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

export async function enablePush() {
  const reg = await registration();
  if (!reg) throw new Error('Phone notifications need the installed app (production build).');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed. Turn them on in the browser settings for this site.');
  const { publicKey } = await api.get('/push/key');
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
  await api.post('/push/subscribe', sub.toJSON());
  return 'on';
}

export async function disablePush() {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
  return 'off';
}
