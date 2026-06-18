import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';
import { SessionRepo } from '@server/store/session.repo.js';
import { UserRepo } from '@server/store/user.repo.js';
import type { DB } from '@server/store/db.js';

describe('SessionRepo', () => {
  let sessions: SessionRepo;
  let userId: string;
  let db: DB;

  beforeEach(async () => {
    db = makeTestDb();
    sessions = new SessionRepo(db);
    const users = new UserRepo(db);
    userId = (await users.create({ username: 'u', passwordHash: 'h', displayName: 'U' })).id;
  });

  it('creates and looks up a session', async () => {
    const expiresAt = Date.now() + 60_000;
    await sessions.create('tok-1', userId, expiresAt);
    const found = await sessions.findValid('tok-1', Date.now());
    expect(found?.userId).toBe(userId);
  });

  it('returns null for expired session', async () => {
    await sessions.create('tok-1', userId, Date.now() - 1);
    expect(await sessions.findValid('tok-1', Date.now())).toBeNull();
  });

  it('delete removes session', async () => {
    await sessions.create('tok-1', userId, Date.now() + 60_000);
    await sessions.delete('tok-1');
    expect(await sessions.findValid('tok-1', Date.now())).toBeNull();
  });
});
