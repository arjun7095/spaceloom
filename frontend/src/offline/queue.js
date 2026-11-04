import { openDB } from 'idb';

// Offline queue (IndexedDB). Actions taken without signal are stored with the time they happened and
// replayed in order when the connection returns. Photos taken offline are stored as blobs and referenced
// as "offline-file:<id>" until they can be uploaded.
const dbp = openDB('ps-offline', 1, {
  upgrade(db) {
    db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    db.createObjectStore('files', { keyPath: 'id' });
  },
});
const PREFIX = 'offline-file:';
const listeners = new Set();

export const onQueueChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
async function emit() {
  const n = await count();
  listeners.forEach((fn) => fn(n));
}

export async function count() {
  return (await dbp).count('queue');
}

export async function enqueue(item) {
  await (await dbp).add('queue', { ...item, queuedAt: new Date().toISOString() });
  await emit();
}

export async function clearQueue() {
  const db = await dbp;
  await db.clear('queue');
  await db.clear('files');
  await emit();
}

export const isOfflineFile = (v) => typeof v === 'string' && v.startsWith(PREFIX);

export async function saveOfflineFile(file) {
  const id = crypto.randomUUID();
  await (await dbp).put('files', { id, blob: file, name: file.name, type: file.type });
  return `${PREFIX}${id}`;
}

export async function offlinePreview(ref) {
  const rec = await (await dbp).get('files', ref.slice(PREFIX.length));
  return rec ? URL.createObjectURL(rec.blob) : null;
}

// Replaces every offline-file reference in a request body with the uploaded file's URL.
export async function resolveFiles(value, upload) {
  if (isOfflineFile(value)) {
    const db = await dbp;
    const rec = await db.get('files', value.slice(PREFIX.length));
    if (!rec) return null;
    const [up] = await upload([new File([rec.blob], rec.name || 'photo.jpg', { type: rec.type || 'image/jpeg' })]);
    await db.delete('files', rec.id);
    return up.url;
  }
  if (Array.isArray(value)) return (await Promise.all(value.map((v) => resolveFiles(v, upload)))).filter((v) => v !== null);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await resolveFiles(v, upload);
    return out;
  }
  return value;
}

let flushing = false;

// Sends queued actions oldest first. A network or server error stops the run (retried later);
// a rejection from the server (4xx) drops that action and reports it.
export async function flush({ send, upload }) {
  if (flushing || !navigator.onLine) return { sent: 0, failed: [] };
  flushing = true;
  const db = await dbp;
  let sent = 0;
  const failed = [];
  try {
    for (const item of await db.getAll('queue')) {
      try {
        const body = await resolveFiles(item.body, upload);
        await send(item.method, item.url, body);
        await db.delete('queue', item.id);
        sent++;
      } catch (err) {
        if (err.status && err.status < 500 && err.status !== 401) {
          await db.delete('queue', item.id);
          failed.push({ label: item.label, message: err.message });
        } else break;
      }
    }
  } finally {
    flushing = false;
    await emit();
  }
  return { sent, failed };
}
