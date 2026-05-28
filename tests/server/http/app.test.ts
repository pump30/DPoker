import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '@server/app.js';
import { makeTestDb } from '../../helpers/test-db.js';

describe('app', () => {
  it('responds to GET /health', async () => {
    const app = createApp({
      db: makeTestDb(),
      authConfig: { jwtSecret: 'test-secret-aaaaaaaa', jwtExpiresInSec: 60 },
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
