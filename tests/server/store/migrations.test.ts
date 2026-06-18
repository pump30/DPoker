import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../../helpers/test-db.js';

describe('migrations', () => {
  it('creates table_snapshots table', () => {
    const db = makeTestDb();
    const info = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='table_snapshots'"
    ).get() as { name: string } | undefined;
    expect(info?.name).toBe('table_snapshots');
  });

  it('creates player_stats table', () => {
    const db = makeTestDb();
    const info = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='player_stats'"
    ).get() as { name: string } | undefined;
    expect(info?.name).toBe('player_stats');
  });

  it('table_snapshots has correct columns', () => {
    const db = makeTestDb();
    const cols = db.pragma('table_info(table_snapshots)') as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('table_id');
    expect(names).toContain('state_json');
    expect(names).toContain('updated_at');
  });

  it('player_stats has correct columns', () => {
    const db = makeTestDb();
    const cols = db.pragma('table_info(player_stats)') as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('player_id');
    expect(names).toContain('hands_played');
    expect(names).toContain('hands_won');
    expect(names).toContain('total_profit');
    expect(names).toContain('biggest_pot');
    expect(names).toContain('buy_in_count');
    expect(names).toContain('updated_at');
  });
});
