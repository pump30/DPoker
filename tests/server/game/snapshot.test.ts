import { describe, it, expect } from 'vitest';
import { serialize, deserialize, SnapshotRepo } from '@server/game/snapshot.js';
import { reduce } from '@server/game/table-state.js';
import type { TableConfig } from '@shared/table-types.js';
import { makeTestDb } from '../../helpers/test-db.js';

const baseConfig: TableConfig = {
  name: 'Test', smallBlind: 5, bigBlind: 10,
  minBuyIn: 100, maxBuyIn: 1000, reloadPolicy: 'between-hands',
  maxSeats: 6, allowSpectators: true, actionTimeoutSec: 30,
  timeBankSec: 60, defaultRunoutCount: 2, squidMode: false, squidPointsPerCatch: 10,
};

function createTable(): any {
  return reduce(null, {
    type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC',
    hostId: 'host', config: baseConfig, nowMs: 1000,
  });
}

describe('snapshot — serialize/deserialize', () => {
  it('round-trips a lobby state', () => {
    const state = createTable();
    const json = serialize(state);
    const restored = deserialize(json);
    expect(restored.id).toBe('t1');
    expect(restored.status).toBe('lobby');
    expect(restored.config).toEqual(baseConfig);
  });

  it('round-trips state with squidStats Map', () => {
    const state = createTable();
    state.squidStats = new Map([['alice', {
      handsPlayed: 5, handsWon: 2, vpipCount: 3, pfrCount: 1,
      showdownWon: 1, biggestPot: 200, squidPoints: 10,
    }]]);
    const json = serialize(state);
    const restored = deserialize(json);
    expect(restored.squidStats).toBeInstanceOf(Map);
    expect(restored.squidStats.get('alice')?.handsPlayed).toBe(5);
  });

  it('preserves private _-prefixed fields', () => {
    const state = createTable() as any;
    state._serverSeed = 'a'.repeat(64);
    state._holeCards = new Map([['alice', ['Ah', 'Kd']]]);
    const json = serialize(state);
    const restored = deserialize(json) as any;
    expect(restored._serverSeed).toBe('a'.repeat(64));
    expect(restored._holeCards).toBeInstanceOf(Map);
    expect(restored._holeCards.get('alice')).toEqual(['Ah', 'Kd']);
  });
});

describe('SnapshotRepo', () => {
  it('upserts and loads a snapshot', async () => {
    const db = makeTestDb();
    const repo = new SnapshotRepo(db);
    const state = createTable();
    await repo.upsert('t1', state);
    const loaded = await repo.loadActive();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tableId).toBe('t1');
    expect(loaded[0].state.id).toBe('t1');
  });

  it('filters out closed tables on load', async () => {
    const db = makeTestDb();
    const repo = new SnapshotRepo(db);
    const state = createTable();
    const closed = { ...state, status: 'closed' as const, closedAt: 9999 };
    await repo.upsert('t1', state);
    await repo.upsert('t2', closed);
    const loaded = await repo.loadActive();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].tableId).toBe('t1');
  });

  it('removes a snapshot', async () => {
    const db = makeTestDb();
    const repo = new SnapshotRepo(db);
    await repo.upsert('t1', createTable());
    await repo.remove('t1');
    expect(await repo.loadActive()).toHaveLength(0);
  });
});
