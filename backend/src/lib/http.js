export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const bad = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Please sign in to continue') => new ApiError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do this') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Record') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message) => new ApiError(409, 'CONFLICT', message);

export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const ok = (res, data, meta) => res.json({ success: true, data, ...(meta && { meta }) });

export function parse(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) throw bad('Please check the highlighted fields', result.error.flatten().fieldErrors);
  return result.data;
}

export const label = (s = '') => String(s).replace(/_/g, ' ');
export const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
