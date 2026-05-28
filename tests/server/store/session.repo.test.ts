import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';
import { SessionRepo } from '@server/store/session.repo.js';
import { UserRepo } from '@server/store/user.repo.js';

describe('SessionRepo', () => {
  let sessions: SessionRepo;
  let users: UserRepo;
  let userId: string;

  beforeEach(() => {
    const db = makeTestDb();
    sessions = new SessionRepo(db);
    users = new UserRepo(db);
    userId = users.create({ username: 'u', passwordHash: 'h', displayName: 'U' }).id;
  });

  it('creates and looks up a session', () => {
    const expiresAt = Date.now() + 60_000;
    sessions.create('tok-1', userId, expiresAt);
    const found = sessions.findValid('tok-1', Date.now());
    expect(found?.userId).toBe(userId);
  });

  it('returns null for expired session', () => {
    sessions.create('tok-1', userId, Date.now() - 1);
    expect(sessions.findValid('tok-1', Date.now())).toBeNull();
  });

  it('delete removes session', () => {
    sessions.create('tok-1', userId, Date.now() + 60_000);
    sessions.delete('tok-1');
    expect(sessions.findValid('tok-1', Date.now())).toBeNull();
  });
});
