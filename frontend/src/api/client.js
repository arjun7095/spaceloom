import axios from 'axios';
import { useAuth } from '../store/auth';
import { enqueue, resolveFiles } from '../offline/queue';

export const http = axios.create({ baseURL: '/api/v1', withCredentials: true });

http.interceptors.request.use((cfg) => {
  const { token, propertyId } = useAuth.getState();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  if (propertyId) cfg.headers['X-Property-Id'] = propertyId;
  return cfg;
});

let refreshing = null;
export function refreshSession() {
  refreshing ||= axios
    .post('/api/v1/auth/refresh', {}, { withCredentials: true })
    .then((r) => {
      useAuth.getState().setSession(r.data.data);
      return r.data.data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function toError(err) {
  let body = err.response?.data;
  if (body instanceof Blob) {
    try { body = JSON.parse(await body.text()); } catch { body = null; }
  }
  const e = new Error(body?.error?.message || (err.code === 'ERR_NETWORK' ? 'Cannot reach the server. Check your connection.' : err.message));
  e.network = !err.response;
  e.status = err.response?.status;
  e.code = body?.error?.code;
  e.details = body?.error?.details;
  return e;
}

http.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config || {};
    if (err.response?.status === 401 && !cfg._retry && !String(cfg.url).includes('/auth/')) {
      cfg._retry = true;
      try {
        await refreshSession();
        return http(cfg);
      } catch (refreshErr) {
        // Only a rejected session signs the user out; a lost connection keeps them signed in.
        if (refreshErr?.response) useAuth.getState().logout();
      }
    }
    return Promise.reject(await toError(err));
  },
);

export const api = {
  list: (url, params) => http.get(url, { params }).then((r) => r.data),
  get: (url, params) => http.get(url, { params }).then((r) => r.data.data),
  post: (url, body) => http.post(url, body).then((r) => r.data.data),
  patch: (url, body) => http.patch(url, body).then((r) => r.data.data),
  put: (url, body) => http.put(url, body).then((r) => r.data.data),
  del: (url) => http.delete(url).then((r) => r.data.data),
};

// Field actions that must work without signal: queued locally when offline, sent later in order.
// Resolves to the server response, or { queued: true } when stored for later.
api.offline = async (method, url, body = {}, label = 'Saved action') => {
  const payload = { ...body, clientTime: body.clientTime || new Date().toISOString() };
  if (navigator.onLine) {
    try {
      const resolved = await resolveFiles(payload, uploadFiles);
      return (await http.request({ method, url, data: resolved })).data.data;
    } catch (err) {
      if (!err.network) throw err;
    }
  }
  await enqueue({ method, url, body: payload, label });
  return { queued: true };
};

export async function download(url, params, filename) {
  const r = await http.get(url, { params, responseType: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(r.data);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function uploadFiles(files) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  return http.post('/uploads', fd).then((r) => r.data.data);
}

export async function uploadForm(url, file, params) {
  const fd = new FormData();
  fd.append('file', file);
  return http.post(url, fd, { params }).then((r) => r.data.data);
}
