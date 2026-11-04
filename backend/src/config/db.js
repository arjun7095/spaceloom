import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

export const dbState = { transactions: false };

export async function connectDb(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  const hello = await mongoose.connection.db.admin().command({ hello: 1 });
  dbState.transactions = Boolean(hello.setName);
  logger.info({ db: mongoose.connection.name, transactions: dbState.transactions }, 'MongoDB connected');
}

// Runs fn inside a transaction on a replica set; on a standalone server it runs fn directly
// (stock updates stay safe because they use conditional atomic updates).
export async function withTransaction(fn) {
  if (!dbState.transactions) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
