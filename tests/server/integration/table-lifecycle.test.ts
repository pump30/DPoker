import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { createApp } from '../../../src/server/app.js';
import { openDb } from '../../../src/server/store/db.js';
import { TableRegistry } from '../../../src/server/runtime/table-registry.js';
import { EventRepo } from '../../../src/server/store/event.repo.js';
import { TableRepo } from '../../../src/server/store/table.repo.js';
import { createSocketGateway } from '../../../src/server/ws/socket.gateway.js';
import { hashPassword } from '../../../src/server/runtime/auth.js';
import type { AuthConfig } from '../../../src/server/runtime/auth.js';
import type { TableConfig } from '../../../src/shared/table-types.js';
import type { DB } from '../../../src/server/store/db.js';

const AUTH_CONFIG: AuthConfig = { jwtSecret: 'test-secret-that-is-at-least-32-chars-long!', jwtExpiresInSec: 3600 };

function makeConfig(overrides?: Partial<TableConfig>): TableConfig {
  return {
    name: 'Test Table',
    smallBlind: 1,
    bigBlind: 2,
    minBuyIn: 100,
    maxBuyIn: 400,
    reloadPolicy: 'between-hands',
    maxSeats: 6,
    allowSpectators: true,
    actionTimeoutSec: 30,
    timeBankSec: 60,
    defaultRunoutCount: 1,
    squidMode: false,
    squidPointsPerCatch: 0,
    ...overrides,
  };
}

describe('Table lifecycle (integration)', () => {
  let db: DB;
  let registry: TableRegistry;
  let server: http.Server;

  beforeAll(async () => {
    db = openDb(':memory:');
    const eventRepo = new EventRepo(db);
    const tableRepo = new TableRepo(db);
    registry = new TableRegistry({ eventRepo, tableRepo });

    const app = createApp({ db, authConfig: AUTH_CONFIG, registry });
    server = http.createServer(app);
    createSocketGateway(server, { authConfig: AUTH_CONFIG, registry });

    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });

    // Seed users
    const hash = await hashPassword('password123');
    db.prepare('INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)').run('user-1', 'alice', hash, 'Alice', Date.now());
    db.prepare('INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)').run('user-2', 'bob', hash, 'Bob', Date.now());
  });

  afterAll(() => {
    server.close();
    db.close();
  });

  it('creates a table via registry and seats players', () => {
    const config = makeConfig();
    const state = registry.createTable('user-1', config);

    expect(state.id).toBeTruthy();
    expect(state.shortCode).toHaveLength(6);
    expect(state.status).toBe('lobby');
    expect(state.hostId).toBe('user-1');

    // Sit players
    const s1 = registry.dispatchEvent(state.id, { type: 'SIT_DOWN', userId: 'user-1', seat: 0, buyIn: 200, nowMs: Date.now() });
    expect(s1.seats[0]?.userId).toBe('user-1');
    expect(s1.seats[0]?.stack).toBe(200);

    const s2 = registry.dispatchEvent(state.id, { type: 'SIT_DOWN', userId: 'user-2', seat: 1, buyIn: 200, nowMs: Date.now() });
    expect(s2.seats[1]?.userId).toBe('user-2');
  });

  it('starts a game and begins a hand', () => {
    const config = makeConfig();
    const tableState = registry.createTable('user-1', config);
    const tableId = tableState.id;

    registry.dispatchEvent(tableId, { type: 'SIT_DOWN', userId: 'user-1', seat: 0, buyIn: 200, nowMs: Date.now() });
    registry.dispatchEvent(tableId, { type: 'SIT_DOWN', userId: 'user-2', seat: 1, buyIn: 200, nowMs: Date.now() });
    registry.dispatchEvent(tableId, { type: 'START_GAME', hostId: 'user-1', nowMs: Date.now() });

    const afterStart = registry.getState(tableId)!;
    expect(afterStart.status).toBe('running');

    // Begin hand
    const afterHand = registry.beginHand(tableId);
    expect(afterHand.hand).not.toBeNull();
    expect(afterHand.hand!.stage).toBe('preflop');
    expect(afterHand.hand!.handNo).toBe(1);
  });

  it('plays a complete hand with fold', () => {
    const config = makeConfig();
    const tableState = registry.createTable('user-1', config);
    const tableId = tableState.id;

    registry.dispatchEvent(tableId, { type: 'SIT_DOWN', userId: 'user-1', seat: 0, buyIn: 200, nowMs: Date.now() });
    registry.dispatchEvent(tableId, { type: 'SIT_DOWN', userId: 'user-2', seat: 1, buyIn: 200, nowMs: Date.now() });
    registry.dispatchEvent(tableId, { type: 'START_GAME', hostId: 'user-1', nowMs: Date.now() });
    registry.beginHand(tableId);

    const state = registry.getState(tableId)!;
    expect(state.hand).not.toBeNull();

    // Find whose turn it is and fold
    const actorSeat = state.hand!.actorSeat!;
    const actor = state.seats[actorSeat]!;

    const afterFold = registry.dispatchEvent(tableId, {
      type: 'PLAYER_ACTION',
      userId: actor.userId,
      action: { type: 'fold' },
      nowMs: Date.now(),
    });

    // Hand should be over (only 2 players, one folded)
    expect(afterFold.hand).toBeNull();
  });

  it('plays a complete hand through showdown', () => {
    const config = makeConfig();
    const tableState = registry.createTable('user-1', config);
    const tableId = tableState.id;

    registry.dispatchEvent(tableId, { type: 'SIT_DOWN', userId: 'user-1', seat: 0, buyIn: 200, nowMs: Date.now() });
    registry.dispatchEvent(tableId, { type: 'SIT_DOWN', userId: 'user-2', seat: 1, buyIn: 200, nowMs: Date.now() });
    registry.dispatchEvent(tableId, { type: 'START_GAME', hostId: 'user-1', nowMs: Date.now() });
    registry.beginHand(tableId);

    // Play through all streets with calls/checks
    let state = registry.getState(tableId)!;
    let safety = 0;
    while (state.hand && safety < 20) {
      const actor = state.seats[state.hand.actorSeat!]!;
      const owed = state.hand.currentBet - actor.bet;
      const action = owed > 0 ? { type: 'call' as const } : { type: 'check' as const };
      state = registry.dispatchEvent(tableId, {
        type: 'PLAYER_ACTION',
        userId: actor.userId,
        action,
        nowMs: Date.now(),
      });
      safety++;
    }

    // Hand should complete
    expect(state.hand).toBeNull();
    // Total chips should be conserved (200 + 200 = 400)
    const totalChips = state.seats.reduce((sum, s) => sum + (s?.stack ?? 0), 0);
    expect(totalChips).toBe(400);
  });

  it('event log persists all events', () => {
    const config = makeConfig();
    const tableState = registry.createTable('user-1', config);
    const tableId = tableState.id;

    const eventRepo = new EventRepo(db);
    const events = eventRepo.getAll(tableId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe('CREATE_TABLE');
  });

  it('table repo tracks table status', () => {
    const tableRepo = new TableRepo(db);
    const active = tableRepo.listActive();
    expect(active.length).toBeGreaterThan(0);
  });

  it('squid mode integration', () => {
    const config = makeConfig({ squidMode: true, squidPointsPerCatch: 10 });
    const tableState = registry.createTable('user-1', config);
    const tableId = tableState.id;

    registry.dispatchEvent(tableId, { type: 'SIT_DOWN', userId: 'user-1', seat: 0, buyIn: 200, nowMs: Date.now() });
    registry.dispatchEvent(tableId, { type: 'SIT_DOWN', userId: 'user-2', seat: 1, buyIn: 200, nowMs: Date.now() });

    const afterSit = registry.getState(tableId)!;
    expect(afterSit.squid).not.toBeNull();
    expect(afterSit.squid!.totalSquids).toBe(1); // N-1 = 2-1 = 1
  });
});
