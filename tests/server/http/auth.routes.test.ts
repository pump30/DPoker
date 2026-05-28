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

  describe('zod boundary validation', () => {
    it('rejects username shorter than 3 chars', async () => {
      const app = createApp(deps);
      const res = await request(app).post('/api/auth/register').send({
        username: 'al',
        password: 'hunter22',
        displayName: 'A',
        inviteCode,
      });
      expect(res.status).toBe(400);
    });

    it('rejects username with space', async () => {
      const app = createApp(deps);
      const res = await request(app).post('/api/auth/register').send({
        username: 'alice jones',
        password: 'hunter22',
        displayName: 'A',
        inviteCode,
      });
      expect(res.status).toBe(400);
    });

    it('rejects password shorter than 8 chars', async () => {
      const app = createApp(deps);
      const res = await request(app).post('/api/auth/register').send({
        username: 'alice',
        password: '1234567',
        displayName: 'A',
        inviteCode,
      });
      expect(res.status).toBe(400);
    });

    it('accepts exactly 8-char password', async () => {
      const app = createApp(deps);
      const res = await request(app).post('/api/auth/register').send({
        username: 'alice',
        password: '12345678',
        displayName: 'A',
        inviteCode,
      });
      expect(res.status).toBe(201);
    });

    it('rejects inviteCode longer than 16 chars', async () => {
      const app = createApp(deps);
      const res = await request(app).post('/api/auth/register').send({
        username: 'alice',
        password: 'hunter22',
        displayName: 'A',
        inviteCode: 'A'.repeat(17),
      });
      expect(res.status).toBe(400);
    });
  });
});

describe('POST /api/auth/login', () => {
  let deps: AppDeps;
  let inviteCode: string;

  beforeEach(async () => {
    const fresh = makeDeps();
    deps = fresh.deps;
    inviteCode = fresh.inviteCode;
    const app = createApp(deps);
    await request(app)
      .post('/api/auth/register')
      .send({
        username: 'alice',
        password: 'hunter22',
        displayName: 'Alice',
        inviteCode,
      });
  });

  it('returns token for correct credentials', async () => {
    const app = createApp(deps);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'hunter22' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.username).toBe('alice');
  });

  it('rejects wrong password', async () => {
    const app = createApp(deps);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects unknown user', async () => {
    const app = createApp(deps);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('rejects malformed body', async () => {
    const app = createApp(deps);
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
  });
});
