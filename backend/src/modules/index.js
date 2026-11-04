import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import authRoutes from './auth.js';
import ticketRoutes from './tickets.js';
import workOrderRoutes from './workorders.js';
import reportRoutes from './reports.js';
import resourceRoutes from './resources.js';
import { stockRouter, materialIssues, grns } from './inventory.js';
import { attendanceRouter, attendanceList, devicePunchHandler } from './attendance.js';
import { dashboardRouter } from './dashboard.js';
import { miscRouter } from './misc.js';
import { integrationsRouter, inboundEmail } from './integrations.js';
import { publicRouter } from './public.js';
import { authenticate } from '../middleware/auth.js';
import { propertyScope } from '../middleware/scope.js';
import { dbState } from '../config/db.js';

const r = Router();

r.get('/health', (req, res) => res.json({ success: true, data: { status: 'ok', db: mongoose.connection.readyState === 1 ? 'up' : 'down', transactions: dbState.transactions, time: new Date() } }));
r.use('/auth', authRoutes);
r.post('/attendance/device-punches', devicePunchHandler);
r.post('/inbound/email', multer().none(), inboundEmail);
r.use('/public', publicRouter);

r.use(authenticate, propertyScope);
r.use('/tickets', ticketRoutes);
r.use('/work-orders', workOrderRoutes);
r.use('/attendance', attendanceRouter, attendanceList);
r.use('/stock', stockRouter);
r.use('/material-issues', materialIssues);
r.use('/grns', grns);
r.use('/reports', reportRoutes);
r.use('/dashboard', dashboardRouter);
r.use(integrationsRouter);
r.use(miscRouter);
r.use(resourceRoutes);

export default r;
