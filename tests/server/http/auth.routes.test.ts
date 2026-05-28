import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp, type AppDeps } from '@server/app.js';
import { makeTestDb } from '../../helpers/test-db.js';
import { InviteRepo } from '@server/store/invite.repo.js';

const authConfig = { jwtSecret: 'test-secret-aaaaaaaa', jwtExpiresInSec: 60 };

function makeDeps(): { deps: AppDeps; inviteCode: string } {
  const db = makeTestDb();
  const invites = new InviteRepo(db);
  const inv = invites.create(null);
  return { deps: { db, authConfig }, inviteCode: inv.code };
}

describe('POST /api/auth/register', () => {
  let deps: AppDeps;
  let inviteCode: string;

  beforeEach(() => {
    const fresh = makeDeps();
    deps = fresh.deps;
    inviteCode = fresh.inviteCode;
  });

  it('rejects when invite code is missing', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/auth/register').send({
      username: 'alice',
      password: 'hunter22',
      displayName: 'Alice',
    });
    expect(res.status).toBe(400);
  });

  it('rejects with bad invite code', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/auth/register').send({
      username: 'alice',
      password: 'hunter22',
      displayName: 'Alice',
      inviteCode: 'BADCODE0',
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/invite/i);
  });

  it('registers user with valid invite and returns token', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/auth/register').send({
      username: 'alice',
      password: 'hunter22',
      displayName: 'Alice',
      inviteCode,
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe('alice');
  });

  it('rejects duplicate username', async () => {
    const app = createApp(deps);
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'hunter22', displayName: 'A', inviteCode });
    // need a fresh invite for second attempt
    const invites = new InviteRepo(deps.db);
    const inv2 = invites.create(null);
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'hunter22', displayName: 'A', inviteCode: inv2.code });
    expect(res.status).toBe(409);
  });

  it('rejects reused invite code', async () => {
    const app = createApp(deps);
    await request(app)
      .post('/api/auth/register')
      .send({ username: 'alice', password: 'hunter22', displayName: 'A', inviteCode });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'bob', password: 'hunter22', displayName: 'B', inviteCode });
    expect(res.status).toBe(403);
  });
});
