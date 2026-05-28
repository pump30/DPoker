import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';
import { UserRepo } from '@server/store/user.repo.js';

describe('UserRepo', () => {
  let repo: UserRepo;

  beforeEach(() => {
    repo = new UserRepo(makeTestDb());
  });

  it('creates a user and finds by username', () => {
    const user = repo.create({
      username: 'alice',
      passwordHash: 'hashed',
      displayName: 'Alice',
    });
    expect(user.id).toBeTruthy();
    expect(user.username).toBe('alice');
    expect(user.createdAt).toBeGreaterThan(0);

    const found = repo.findByUsername('alice');
    expect(found?.id).toBe(user.id);
  });

  it('returns null when username not found', () => {
    expect(repo.findByUsername('ghost')).toBeNull();
  });

  it('rejects duplicate username', () => {
    repo.create({ username: 'alice', passwordHash: 'h', displayName: 'A' });
    expect(() =>
      repo.create({ username: 'alice', passwordHash: 'h', displayName: 'A2' }),
    ).toThrow();
  });

  it('finds by id', () => {
    const user = repo.create({ username: 'bob', passwordHash: 'h', displayName: 'Bob' });
    expect(repo.findById(user.id)?.username).toBe('bob');
    expect(repo.findById('missing')).toBeNull();
  });
});
