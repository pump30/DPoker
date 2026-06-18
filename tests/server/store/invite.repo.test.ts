import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';
import { InviteRepo } from '@server/store/invite.repo.js';
import { UserRepo } from '@server/store/user.repo.js';
import type { DB } from '@server/store/db.js';

describe('InviteRepo', () => {
  let db: DB;
  let inviteRepo: InviteRepo;
  let userRepo: UserRepo;

  beforeEach(() => {
    db = makeTestDb();
    inviteRepo = new InviteRepo(db);
    userRepo = new UserRepo(db);
  });

  it('creates an unused invite', () => {
    const inv = inviteRepo.create(null);
    expect(inv.code).toMatch(/^[A-Z0-9]{8}$/);
    expect(inv.usedBy).toBeNull();
    expect(inv.usedAt).toBeNull();
  });

  it('claim marks invite as used and is idempotent failure on second claim', () => {
    const user = userRepo.create({ username: 'a', passwordHash: 'h', displayName: 'A' });
    const inv = inviteRepo.create(null);
    const claimed = inviteRepo.claim(inv.code, user.id);
    expect(claimed).toBe(true);
    expect(inviteRepo.findByCode(inv.code)?.usedBy).toBe(user.id);

    const user2 = userRepo.create({ username: 'b', passwordHash: 'h', displayName: 'B' });
    expect(inviteRepo.claim(inv.code, user2.id)).toBe(false);
  });

  it('claim returns false for missing code', () => {
    const user = userRepo.create({ username: 'a', passwordHash: 'h', displayName: 'A' });
    expect(inviteRepo.claim('NOPE0000', user.id)).toBe(false);
  });
});
