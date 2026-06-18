import { describe, it, expect } from 'vitest';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '@server/store/db.js';
import { makeTestDb } from '../../helpers/test-db.js';

describe('db migrations', () => {
  it('creates users, invites, sessions tables', () => {
    const db = makeTestDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain('users');
    expect(tables).toContain('invites');
    expect(tables).toContain('sessions');
  });

  it('runMigrations is idempotent across reopens', () => {
    const tmpFile = path.join(tmpdir(), `dpoker-test-${Date.now()}-${Math.random()}.db`);
    try {
      const db1 = openDb(tmpFile);
      const before = db1.prepare('SELECT COUNT(*) as c FROM _migrations').get() as { c: number };
      db1.close();

      // Re-open: should not re-apply or throw
      expect(() => openDb(tmpFile)).not.toThrow();

      const db2 = openDb(tmpFile);
      const after = db2.prepare('SELECT COUNT(*) as c FROM _migrations').get() as { c: number };
      db2.close();

      expect(before.c).toBe(after.c);
      expect(before.c).toBeGreaterThan(0);
    } finally {
      try { unlinkSync(tmpFile); } catch {}
      try { unlinkSync(tmpFile + '-wal'); } catch {}
      try { unlinkSync(tmpFile + '-shm'); } catch {}
    }
  });
});
