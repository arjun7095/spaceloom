import http from 'node:http';
import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { initSocket } from './lib/socket.js';
import { logger } from './lib/logger.js';
import { startScheduler } from './jobs/scheduler.js';

await connectDb();
const server = http.createServer(createApp());
initSocket(server);
server.listen(env.port, () => logger.info(`PrimeSpace IPFM API on http://localhost:${env.port}/api/v1`));
if (env.runJobs) startScheduler();

const shutdown = (signal) => {
  logger.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
