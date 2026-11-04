import multer from 'multer';
import { ApiError } from '../lib/http.js';
import { logger } from '../lib/logger.js';

const nice = (k) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Id$/, '').toLowerCase();

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'SERVER_ERROR';
  let message = 'Something went wrong. Please try again.';
  let details;

  if (err instanceof ApiError) ({ status, code, message, details } = err);
  else if (err.name === 'ValidationError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Please check the highlighted fields';
    details = Object.fromEntries(Object.entries(err.errors).map(([k, e]) => [k, [e.kind === 'required' ? `${nice(k)} is required` : e.message]]));
  } else if (err.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = `Invalid value for ${nice(err.path)}`;
  } else if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    const keys = Object.keys(err.keyValue || {}).filter((k) => !['propertyId', 'orgId'].includes(k));
    message = `A record with this ${keys.map(nice).join(' and ') || 'value'} already exists`;
  } else if (err instanceof multer.MulterError) {
    status = 400;
    code = 'UPLOAD_ERROR';
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 10 MB)' : err.message;
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'TOO_LARGE';
    message = 'Request is too large';
  }

  if (status >= 500) logger.error({ err, reqId: req.id }, 'Unhandled error');
  res.status(status).json({ success: false, error: { code, message, details } });
}
