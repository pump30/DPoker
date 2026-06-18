import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableRegistry } from '@server/game/table-registry.js';
import { WaitPool } from '@server/game/wait-pool.js';
import { SnapshotRepo } from '@server/game/snapshot.js';
import { StatsRepo } from '@server/store/stats.repo.js';
import { makeTestDb } from '../../helpers/test-db.js';

function makeRegistry() {
  const db = makeTestDb();
  const waitPool = new WaitPool();
  const snapshotRepo = new SnapshotRepo(db);
  const statsRepo = new StatsRepo(db);
  const registry = new TableRegistry({ snapshotRepo, statsRepo, waitPool });
  return { registry, waitPool, snapshotRepo, statsRepo, db };
}

describe('TableRegistry', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('creates a table in lobby status', () => {
    const { registry } = makeRegistry();
    const state = registry.create({
      name: 'Test', smallBlind: 5, bigBlind: 10,
      minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6,
    }, 'host');
    expect(state.status).toBe('lobby');
    expect(state.config.name).toBe('Test');
    expect(state.id).toBeTruthy();
  });

  it('list returns all tables', () => {
    const { registry } = makeRegistry();
    registry.create({ name: 'A', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'h');
    registry.create({ name: 'B', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'h');
    expect(registry.list()).toHaveLength(2);
  });

  it('dispatch applies event and persists snapshot', () => {
    const { registry, snapshotRepo } = makeRegistry();
    const state = registry.create({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'host');
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: Date.now() });
    const loaded = snapshotRepo.loadActive();
    expect(loaded).toHaveLength(1);
    const restored = loaded[0].state;
    expect(restored.seats[0]?.userId).toBe('alice');
  });

  it('dispatch notifies waitPool', async () => {
    const { registry, waitPool } = makeRegistry();
    const state = registry.create({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'host');
    const promise = waitPool.wait(state.id, 'alice', 5000);
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: Date.now() });
    expect(await promise).toBe('ready');
  });

  it('get returns null for unknown table', () => {
    const { registry } = makeRegistry();
    expect(registry.get('nope')).toBeNull();
  });

  it('remove deletes table from memory and DB', () => {
    const { registry, snapshotRepo } = makeRegistry();
    const state = registry.create({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'host');
    registry.remove(state.id);
    expect(registry.get(state.id)).toBeNull();
    expect(snapshotRepo.loadActive()).toHaveLength(0);
  });
});

describe('TableRegistry — AutoDealer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('auto-starts game when 2 players sit down', () => {
    const { registry } = makeRegistry();
    const state = registry.create({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 }, 'host');
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: Date.now() });
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'bob', seat: 1, buyIn: 500, nowMs: Date.now() });
    // After 3s delay, game should auto-start
    vi.advanceTimersByTime(3100);
    const updated = registry.get(state.id)!;
    expect(updated.status).toBe('running');
    expect(updated.hand).not.toBeNull();
  });

  it('auto-folds on action timeout', () => {
    const { registry } = makeRegistry();
    const state = registry.create({
      name: 'T', smallBlind: 5, bigBlind: 10,
      minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6, actionTimeoutSec: 10,
    }, 'host');
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: Date.now() });
    registry.dispatch(state.id, { type: 'SIT_DOWN', userId: 'bob', seat: 1, buyIn: 500, nowMs: Date.now() });
    vi.advanceTimersByTime(3100); // auto-start + begin hand
    const started = registry.get(state.id)!;
    expect(started.hand).not.toBeNull();
    // Now the actor should timeout after 10s
    vi.advanceTimersByTime(10100);
    const afterTimeout = registry.get(state.id)!;
    // Hand should have progressed (actor changed or hand ended)
    expect(afterTimeout.eventSeq).toBeGreaterThan(started.eventSeq);
  });
});
