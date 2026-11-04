import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

let io;
const kpiTimers = new Map();

// Rooms: user:<id> for personal events, property:<id> for the active property.
export function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: env.clientUrls, credentials: true } });
  io.use((socket, next) => {
    try {
      const p = jwt.verify(socket.handshake.auth?.token, env.jwtSecret);
      socket.data = { userId: p.sub, propertyIds: p.props || [], isSuper: Boolean(p.super) };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
    socket.on('property:join', (pid) => {
      if (!socket.data.isSuper && !socket.data.propertyIds.includes(pid)) return;
      for (const room of socket.rooms) if (room.startsWith('property:')) socket.leave(room);
      socket.join(`property:${pid}`);
    });
  });
  return io;
}

export const emitProperty = (pid, event, data) => io?.to(`property:${pid}`).emit(event, data);
export const emitUser = (uid, event, data) => io?.to(`user:${uid}`).emit(event, data);

// Debounced "dashboard changed" signal so KPI tiles refresh live.
export function bumpKpis(pid) {
  if (!pid || !io) return;
  const key = String(pid);
  clearTimeout(kpiTimers.get(key));
  kpiTimers.set(key, setTimeout(() => emitProperty(key, 'kpi:updated', { at: new Date() }), 1500));
}
