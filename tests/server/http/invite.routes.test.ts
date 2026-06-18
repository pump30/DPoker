import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, type AppDeps } from '@server/app.js';
import { makeTestDb } from '../../helpers/test-db.js';
import { InviteRepo } from '@server/store/invite.repo.js';

const authConfig = { jwtSecret: 'test-secret-aaaaaaaa', jwtExpiresInSec: 60 };

async function registerUser(app: ReturnType<typeof createApp>, db: any) {
  const inv = new InviteRepo(db).create(null);
  const res = await request(app).post('/api/auth/register').send({
    username: 'alice',
    password: 'hunter22',
    displayName: 'A',
    inviteCode: inv.code,
  });
  return res.body.token as string;
}

describe('POST /api/invites', () => {
  let deps: AppDeps;

  beforeEach(() => {
    deps = { db: makeTestDb(), authConfig };
  });

  it('rejects without auth', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/invites');
    expect(res.status).toBe(401);
  });

  it('creates invite when authenticated', async () => {
    const app = createApp(deps);
    const token = await registerUser(app, deps.db);
    const res = await request(app)
      .post('/api/invites')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Z0-9]{8}$/);
  });

  it('rejects bogus token', async () => {
    const app = createApp(deps);
    const res = await request(app)
      .post('/api/invites')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
