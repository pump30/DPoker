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
  private upsertStmt: any;
  private loadActiveStmt: any;
  private removeStmt: any;

  constructor(private db: DB) {
    this.upsertStmt = db.prepare(
      `INSERT INTO table_snapshots (table_id, state_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(table_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`
    );
    this.loadActiveStmt = db.prepare(
      `SELECT table_id, state_json FROM table_snapshots`
    );
    this.removeStmt = db.prepare(
      `DELETE FROM table_snapshots WHERE table_id = ?`
    );
  }

  upsert(tableId: string, state: TableState): void {
    this.upsertStmt.run(tableId, serialize(state), Date.now());
  }

  loadActive(): Array<{ tableId: string; state: TableState }> {
    const rows = this.loadActiveStmt.all() as Array<{ table_id: string; state_json: string }>;
    return rows
      .map(r => ({ tableId: r.table_id, state: deserialize(r.state_json) }))
      .filter(r => r.state.status !== 'closed');
  }

  remove(tableId: string): void {
    this.removeStmt.run(tableId);
  }
}
