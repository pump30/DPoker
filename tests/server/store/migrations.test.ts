import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';

describe('migrations', () => {
  it('creates table_snapshots table', async () => {
    const db = makeTestDb();
    const { rows } = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'table_snapshots'"
    );
    expect(rows[0]?.table_name).toBe('table_snapshots');
    await db.end();
  });

  it('creates player_stats table', async () => {
    const db = makeTestDb();
    const { rows } = await db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'player_stats'"
    );
    expect(rows[0]?.table_name).toBe('player_stats');
    await db.end();
  });

  it('table_snapshots has correct columns', async () => {
    const db = makeTestDb();
    const { rows } = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'table_snapshots'"
    );
    const names = rows.map((r: any) => r.column_name);
    expect(names).toContain('table_id');
    expect(names).toContain('state_json');
    expect(names).toContain('updated_at');
    await db.end();
  });

  it('player_stats has correct columns', async () => {
    const db = makeTestDb();
    const { rows } = await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'player_stats'"
    );
    const names = rows.map((r: any) => r.column_name);
    expect(names).toContain('player_id');
    expect(names).toContain('hands_played');
    expect(names).toContain('hands_won');
    expect(names).toContain('total_profit');
    expect(names).toContain('biggest_pot');
    expect(names).toContain('buy_in_count');
    expect(names).toContain('updated_at');
    await db.end();
  });
});
