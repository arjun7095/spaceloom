// Runs the scheduler as its own process (set RUN_JOBS=false on the API when using this).
import { connectDb } from '../config/db.js';
import { startScheduler } from './scheduler.js';

await connectDb();
startScheduler();
