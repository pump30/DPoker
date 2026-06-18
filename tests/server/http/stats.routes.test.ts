import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@server/app.js';
import { TableRegistry } from '@server/game/table-registry.js';
import { WaitPool } from '@server/game/wait-pool.js';
import { SnapshotRepo } from '@server/game/snapshot.js';
import { StatsRepo } from '@server/store/stats.repo.js';
import { makeTestDb } from '../../helpers/test-db.js';

function makeApp() {
  const db = makeTestDb();
  const waitPool = new WaitPool();
  const snapshotRepo = new SnapshotRepo(db);
  const statsRepo = new StatsRepo(db);
  const registry = new TableRegistry({ snapshotRepo, statsRepo, waitPool });
  const app = createApp({
    db,
    authConfig: { jwtSecret: 'x'.repeat(32), jwtExpiresInSec: 60 },
    registry, statsRepo, waitPool,
  });
  return { app, statsRepo };
}

describe('GET /api/stats', () => {
  it('returns empty array initially', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns stats after buy-in', async () => {
    const { app, statsRepo } = makeApp();
    statsRepo.recordBuyIn('alice');
    const res = await request(app).get('/api/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].playerId).toBe('alice');
    expect(res.body[0].buyInCount).toBe(1);
  });
});

describe('GET /api/stats/:playerId', () => {
  it('returns 404 for unknown player', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/stats/nobody');
    expect(res.status).toBe(404);
  });

  it('returns player stats', async () => {
    const { app, statsRepo } = makeApp();
    statsRepo.recordBuyIn('bob');
    statsRepo.recordHandResult({ playerId: 'bob', won: true, profitDelta: 100, potSize: 200 });
    const res = await request(app).get('/api/stats/bob');
    expect(res.status).toBe(200);
    expect(res.body.handsPlayed).toBe(1);
    expect(res.body.handsWon).toBe(1);
    expect(res.body.winRate).toBe(1);
  });
});
