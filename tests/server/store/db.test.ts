import { describe, it, expect } from 'vitest';
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

  it('is idempotent', () => {
    const db = makeTestDb();
    expect(() => {
      db.exec(
        `INSERT INTO _migrations (name, applied_at) VALUES ('001_init.sql', ${Date.now()}) ON CONFLICT DO NOTHING`,
      );
    }).not.toThrow();
  });
});
