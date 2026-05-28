import { Server as IOServer, Socket } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { verifyToken, type AuthConfig } from '../runtime/auth.js';
import {
  TableRegistry,
  toPublicState,
  getHoleCardsForPlayer,
} from '../runtime/table-registry.js';
import type { TableState } from '../../shared/table-types.js';
import type { TableEvent } from '../game/table-state.js';
import type { ClientEvent, ServerEvent } from '../../shared/protocol.js';

type AuthenticatedSocket = Socket & { userId: string; displayName: string };

export type GatewayDeps = {
  authConfig: AuthConfig;
  registry: TableRegistry;
};

export function createSocketGateway(httpServer: HttpServer, deps: GatewayDeps): IOServer {
  const io = new IOServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  const { registry, authConfig } = deps;
  const userSockets = new Map<string, Set<Socket>>();

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('authentication required'));
    const payload = verifyToken(token, authConfig);
    if (!payload) return next(new Error('invalid token'));
    (socket as AuthenticatedSocket).userId = payload.userId;
    (socket as AuthenticatedSocket).displayName =
      (socket.handshake.auth?.displayName as string) || payload.userId;
    next();
  });

  registry.setEventCallback((tableId, state, event) => {
    broadcastStateToRoom(io, tableId, state, registry);
    handlePostEventSideEffects(io, tableId, state, event, registry);
  });

  io.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const userId = socket.userId;

    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(socket);

    socket.on('table:event', (data: ClientEvent) => {
      try {
        handleClientEvent(socket, data, registry, io);
      } catch (err: any) {
        const ev: ServerEvent = { type: 'ACTION_REJECTED', reason: err.message ?? 'unknown error' };
        socket.emit('server:event', ev);
      }
    });

    socket.on('table:join', (tableId: string) => {
      socket.join(`table:${tableId}`);
      const state = registry.getState(tableId);
      if (state) {
        const pub = toPublicState(state);
        const ev: ServerEvent = { type: 'TABLE_STATE', state: pub };
        socket.emit('server:event', ev);
        const holeCards = getHoleCardsForPlayer(state, userId);
        if (holeCards && state.hand) {
          socket.emit('server:event', { type: 'HOLE_CARDS', cards: holeCards } satisfies ServerEvent);
        }
      }
    });

    socket.on('table:leave', (tableId: string) => {
      socket.leave(`table:${tableId}`);
    });

    socket.on('disconnect', () => {
      const set = userSockets.get(userId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) userSockets.delete(userId);
      }
    });
  });

  return io;
}

function handleClientEvent(
  socket: AuthenticatedSocket,
  data: ClientEvent,
  registry: TableRegistry,
  io: IOServer,
): void {
  const { userId } = socket;
  const { tableId } = data;
  const nowMs = Date.now();

  let event: TableEvent;

  switch (data.type) {
    case 'PLAYER_ACTION':
      event = { type: 'PLAYER_ACTION', userId, action: data.action, nowMs };
      break;
    case 'START_GAME':
      event = { type: 'START_GAME', hostId: userId, nowMs };
      break;
    case 'PAUSE_GAME':
      event = { type: 'PAUSE_GAME', hostId: userId, nowMs };
      break;
    case 'RESUME_GAME':
      event = { type: 'RESUME_GAME', hostId: userId, nowMs };
      break;
    case 'CLOSE_TABLE':
      event = { type: 'CLOSE_TABLE', hostId: userId, nowMs };
      break;
    case 'RUNOUT_VOTE':
      event = { type: 'RUNOUT_VOTE', userId, choice: data.choice, nowMs };
      break;
    case 'BUY_IN':
      event = { type: 'SIT_DOWN', userId, seat: -1, buyIn: data.amount, nowMs };
      return;
    case 'SIT_DOWN': {
      const state = registry.getState(tableId);
      const buyIn = data.buyIn ?? state?.config.minBuyIn ?? 100;
      event = { type: 'SIT_DOWN', userId, seat: data.seatIdx, buyIn, nowMs };
      break;
    }
    case 'STAND_UP':
      event = { type: 'STAND_UP', userId, nowMs };
      break;
    case 'RESYNC': {
      const state = registry.getState(tableId);
      if (state) {
        const pub = toPublicState(state);
        socket.emit('server:event', { type: 'TABLE_STATE', state: pub } satisfies ServerEvent);
        const holeCards = getHoleCardsForPlayer(state, userId);
        if (holeCards && state.hand) {
          socket.emit('server:event', { type: 'HOLE_CARDS', cards: holeCards } satisfies ServerEvent);
        }
      }
      return;
    }
    default:
      return;
  }

  const newState = registry.dispatchEvent(tableId, event);

  // After START_GAME, auto-begin first hand
  if (data.type === 'START_GAME' && newState.status === 'running' && !newState.hand) {
    scheduleNextHand(registry, tableId, io);
  }
}

function broadcastStateToRoom(io: IOServer, tableId: string, state: TableState, _registry: TableRegistry): void {
  const pub = toPublicState(state);
  const room = `table:${tableId}`;
  io.to(room).emit('server:event', { type: 'TABLE_STATE', state: pub } satisfies ServerEvent);

  if (state.hand) {
    const sockets = io.sockets.adapter.rooms.get(room);
    if (sockets) {
      for (const sid of sockets) {
        const s = io.sockets.sockets.get(sid) as AuthenticatedSocket | undefined;
        if (s) {
          const holeCards = getHoleCardsForPlayer(state, s.userId);
          if (holeCards) {
            s.emit('server:event', { type: 'HOLE_CARDS', cards: holeCards } satisfies ServerEvent);
          }
        }
      }
    }
  }
}

function handlePostEventSideEffects(
  io: IOServer,
  tableId: string,
  state: TableState,
  event: TableEvent,
  registry: TableRegistry,
): void {
  const entry = registry.getEntry(tableId);
  if (!entry) return;

  // Action timeout timer
  if (state.hand?.actionDeadlineMs && state.hand.actorSeat !== null) {
    if (entry.actionTimer) clearTimeout(entry.actionTimer);
    const delay = Math.max(0, state.hand.actionDeadlineMs - Date.now());
    entry.actionTimer = setTimeout(() => {
      try {
        registry.dispatchEvent(tableId, { type: 'TIMEOUT', nowMs: Date.now() });
      } catch {}
    }, delay);
  } else {
    if (entry.actionTimer) { clearTimeout(entry.actionTimer); entry.actionTimer = null; }
  }

  // All-in vote timeout timer
  if (state.allInVote && !entry.voteTimer) {
    const delay = Math.max(0, state.allInVote.deadlineMs - Date.now());
    entry.voteTimer = setTimeout(() => {
      try {
        registry.dispatchEvent(tableId, { type: 'RUNOUT_VOTE_TIMEOUT', nowMs: Date.now() });
      } catch {}
      entry.voteTimer = null;
    }, delay);
  }
  if (!state.allInVote && entry.voteTimer) {
    clearTimeout(entry.voteTimer); entry.voteTimer = null;
  }

  // Auto-start next hand after hand completion
  if (!state.hand && state.status === 'running' && event.type !== 'START_GAME') {
    const eligible = state.seats.filter((s) => s && !s.sittingOut && s.stack > 0);
    if (eligible.length >= 2) {
      scheduleNextHand(registry, tableId, io);
    }
  }
}

function scheduleNextHand(registry: TableRegistry, tableId: string, _io: IOServer): void {
  const entry = registry.getEntry(tableId);
  if (!entry) return;
  if (entry.autoStartTimer) clearTimeout(entry.autoStartTimer);
  entry.autoStartTimer = setTimeout(() => {
    try {
      registry.beginHand(tableId);
    } catch (err) {
      console.error(`Auto-begin hand failed for ${tableId}:`, err);
    }
    entry.autoStartTimer = null;
  }, 2000);
}
