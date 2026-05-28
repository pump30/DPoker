import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../../src/server/app.js';
import { openDb } from '../../../src/server/store/db.js';
import { hashPassword, signToken } from '../../../src/server/runtime/auth.js';
import type { AuthConfig } from '../../../src/server/runtime/auth.js';
import type { DB } from '../../../src/server/store/db.js';

const AUTH_CONFIG: AuthConfig = { jwtSecret: 'test-secret-that-is-at-least-32-chars-long!', jwtExpiresInSec: 3600 };

describe('Table routes', () => {
  let db: DB;
  let app: ReturnType<typeof createApp>;
  let token: string;

  beforeAll(async () => {
    db = openDb(':memory:');
    app = createApp({ db, authConfig: AUTH_CONFIG });

    const hash = await hashPassword('password123');
    db.prepare('INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)').run('user-1', 'alice', hash, 'Alice', Date.now());
    token = signToken({ userId: 'user-1' }, AUTH_CONFIG);
  });

  afterAll(() => db.close());

  it('POST /api/tables creates a table', async () => {
    const res = await request(app)
      .post('/api/tables')
      .set('Authorization', `Bearer ${token}`)
      .send({
        config: {
          name: 'Test Game',
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
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.shortCode).toHaveLength(6);
  });

  it('GET /api/tables lists user tables', async () => {
    const res = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tables).toBeInstanceOf(Array);
    expect(res.body.tables.length).toBeGreaterThan(0);
    expect(res.body.tables[0].name).toBe('Test Game');
  });

  it('POST /api/tables/join finds table by short code', async () => {
    // Get the table we just created
    const list = await request(app)
      .get('/api/tables')
      .set('Authorization', `Bearer ${token}`);
    const shortCode = list.body.tables[0].shortCode;

    const res = await request(app)
      .post('/api/tables/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ shortCode });

    expect(res.status).toBe(200);
    expect(res.body.tableId).toBeTruthy();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/tables');
    expect(res.status).toBe(401);
  });

  it('rejects invalid table config', async () => {
    const res = await request(app)
      .post('/api/tables')
      .set('Authorization', `Bearer ${token}`)
      .send({ config: { name: '' } });

    expect(res.status).toBe(400);
  });
});
