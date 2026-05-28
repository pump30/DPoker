import { io, Socket } from 'socket.io-client';
import type { ClientEvent } from '../../shared/protocol.js';
import { useAuth } from '../store/auth.js';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket && socket.connected) return socket;

  const token = useAuth.getState().token;
  if (!token) throw new Error('not authenticated');

  socket = io(window.location.origin, {
    path: '/socket.io/',
    auth: { token, displayName: useAuth.getState().user?.displayName },
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function sendEvent(event: ClientEvent): void {
  getSocket().emit('table:event', event);
}

export function joinTable(tableId: string): void {
  getSocket().emit('table:join', tableId);
}

export function leaveTable(tableId: string): void {
  getSocket().emit('table:leave', tableId);
}
