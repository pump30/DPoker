import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';

describe('db migrations (via pg-mem)', () => {
  it('creates users, invites, sessions tables', async () => {
    const db = makeTestDb();
    const { rows } = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name"
    );
    const tables = rows.map((r: any) => r.table_name);
    expect(tables).toContain('users');
    expect(tables).toContain('invites');
    expect(tables).toContain('sessions');
    await db.end();
  });
});
