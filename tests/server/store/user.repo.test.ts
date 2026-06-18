import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';
import { UserRepo } from '@server/store/user.repo.js';
import type { DB } from '@server/store/db.js';

describe('UserRepo', () => {
  let repo: UserRepo;
  let db: DB;

  beforeEach(() => {
    db = makeTestDb();
    repo = new UserRepo(db);
  });

  it('creates a user and finds by username', async () => {
    const user = await repo.create({
      username: 'alice',
      passwordHash: 'hashed',
      displayName: 'Alice',
    });
    expect(user.id).toBeTruthy();
    expect(user.username).toBe('alice');
    expect(user.createdAt).toBeGreaterThan(0);

    const found = await repo.findByUsername('alice');
    expect(found?.id).toBe(user.id);
  });

  it('returns null when username not found', async () => {
    expect(await repo.findByUsername('ghost')).toBeNull();
  });

  it('rejects duplicate username', async () => {
    await repo.create({ username: 'alice', passwordHash: 'h', displayName: 'A' });
    await expect(
      repo.create({ username: 'alice', passwordHash: 'h', displayName: 'A2' }),
    ).rejects.toThrow();
  });

  it('finds by id', async () => {
    const user = await repo.create({ username: 'bob', passwordHash: 'h', displayName: 'Bob' });
    expect((await repo.findById(user.id))?.username).toBe('bob');
    expect(await repo.findById('missing')).toBeNull();
  });
});
