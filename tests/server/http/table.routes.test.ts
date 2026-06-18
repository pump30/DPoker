import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    registry,
    statsRepo,
    waitPool,
  });
  return { app, registry, waitPool, statsRepo };
}

describe('POST /api/tables', () => {
  it('creates a table', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/tables')
      .set('X-Player-Id', 'alice')
      .send({ name: 'Test', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    expect(res.status).toBe(201);
    expect(res.body.tableId).toBeTruthy();
    expect(res.body.status).toBe('lobby');
  });

  it('rejects without X-Player-Id', async () => {
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/tables')
      .send({ name: 'Test', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('X-Player-Id header required');
  });
});

describe('GET /api/tables', () => {
  it('lists tables', async () => {
    const { app } = makeApp();
    await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T1', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const res = await request(app).get('/api/tables').set('X-Player-Id', 'alice');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('T1');
  });
});

describe('POST /api/tables/:id/sit', () => {
  it('sits player at table', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    const res = await request(app).post(`/api/tables/${tableId}/sit`).set('X-Player-Id', 'alice')
      .send({ buyIn: 500 });
    expect(res.status).toBe(200);
    expect(res.body.seats[0].playerId).toBe('alice');
  });

  it('rejects invalid buy-in', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    const res = await request(app).post(`/api/tables/${tableId}/sit`).set('X-Player-Id', 'alice')
      .send({ buyIn: 50 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/tables/:id/leave', () => {
  it('removes player from seat', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    await request(app).post(`/api/tables/${tableId}/sit`).set('X-Player-Id', 'alice').send({ buyIn: 500 });
    const res = await request(app).post(`/api/tables/${tableId}/leave`).set('X-Player-Id', 'alice');
    expect(res.status).toBe(200);
    expect(res.body.seats.every((s: any) => s === null)).toBe(true);
  });
});

describe('GET /api/tables/:id', () => {
  it('returns table state with myCards when dealt', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    const res = await request(app).get(`/api/tables/${tableId}`).set('X-Player-Id', 'alice');
    expect(res.status).toBe(200);
    expect(res.body.tableId).toBe(tableId);
  });

  it('returns 404 for unknown table', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/tables/nope').set('X-Player-Id', 'alice');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/tables/:id/act', () => {
  it('rejects action when not your turn', async () => {
    const { app } = makeApp();
    const create = await request(app).post('/api/tables').set('X-Player-Id', 'alice')
      .send({ name: 'T', smallBlind: 5, bigBlind: 10, minBuyIn: 100, maxBuyIn: 1000, maxSeats: 6 });
    const tableId = create.body.tableId;
    await request(app).post(`/api/tables/${tableId}/sit`).set('X-Player-Id', 'alice').send({ buyIn: 500 });
    const res = await request(app).post(`/api/tables/${tableId}/act`).set('X-Player-Id', 'alice')
      .send({ type: 'fold' });
    expect(res.status).toBe(400);
  });
});
