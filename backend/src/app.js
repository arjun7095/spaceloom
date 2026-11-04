import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import routes from './modules/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { serveFile, signUrl, stripDeep } from './lib/storage.js';
import { ah } from './lib/http.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // Every file reference in a JSON response becomes a short-lived signed link.
  app.set('json replacer', (key, value) => (typeof value === 'string' && value.startsWith('/uploads/') ? signUrl(value) : value));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: env.clientUrls, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '2mb' }));
  app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object') req.body = stripDeep(req.body);
    next();
  });
  app.use(cookieParser());
  app.use(mongoSanitize());
  app.use(pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = req.headers['x-request-id'] || crypto.randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url.startsWith('/api/v1/health') || req.url.startsWith('/uploads') },
    customLogLevel: (req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url.split('?')[0] }), res: (res) => ({ status: res.statusCode }) },
  }));
  app.get('/uploads/:name', ah(serveFile));
  app.use('/api/v1', routes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
