import type { TableState } from '../../shared/table-types.js';
import type { DB } from '../store/db.js';

export function serialize(state: TableState): string {
  return JSON.stringify(state, (_key, value) => {
    if (value instanceof Map) {
      return { __type: 'Map', entries: [...value.entries()] };
    }
    if (value instanceof Set) {
      return { __type: 'Set', values: [...value.values()] };
    }
    return value;
  });
}

export function deserialize(json: string): TableState {
  return JSON.parse(json, (_key, value) => {
    if (value && typeof value === 'object' && value.__type === 'Map') {
      return new Map(value.entries);
    }
    if (value && typeof value === 'object' && value.__type === 'Set') {
      return new Set(value.values);
    }
    return value;
  });
}

export class SnapshotRepo {
  constructor(private db: DB) {}

  async upsert(tableId: string, state: TableState): Promise<void> {
    await this.db.query(
      `INSERT INTO table_snapshots (table_id, state_json, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT(table_id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = EXCLUDED.updated_at`,
      [tableId, serialize(state), Date.now()],
    );
  }

  async loadActive(): Promise<Array<{ tableId: string; state: TableState }>> {
    const { rows } = await this.db.query('SELECT table_id, state_json FROM table_snapshots');
    return rows
      .map((r: any) => ({ tableId: r.table_id, state: deserialize(r.state_json) }))
      .filter((r: any) => r.state.status !== 'closed');
  }

  async remove(tableId: string): Promise<void> {
    await this.db.query('DELETE FROM table_snapshots WHERE table_id = $1', [tableId]);
  }
}
