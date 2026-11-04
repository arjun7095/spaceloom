import { io } from 'socket.io-client';
import { useAuth } from '../store/auth';

let socket = null;

export function connectSocket() {
  if (socket) return socket;
  socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], auth: (cb) => cb({ token: useAuth.getState().token }) });
  socket.on('connect', () => {
    const pid = useAuth.getState().propertyId;
    if (pid) socket.emit('property:join', pid);
  });
  return socket;
}

export function joinProperty(pid) {
  if (socket?.connected && pid) socket.emit('property:join', pid);
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
