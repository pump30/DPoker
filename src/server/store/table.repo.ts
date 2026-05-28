import type { DB } from './db.js';
import type { TableConfig, TableStatus } from '../../shared/table-types.js';

export type TableRow = {
  id: string;
  short_code: string;
  host_id: string;
  config_json: string;
  status: string;
  created_at: number;
  closed_at: number | null;
};

export class TableRepo {
  constructor(private db: DB) {}

  create(id: string, shortCode: string, hostId: string, config: TableConfig, nowMs: number): void {
    this.db
      .prepare(
        `INSERT INTO tables (id, short_code, host_id, config_json, status, created_at)
         VALUES (?, ?, ?, ?, 'lobby', ?)`,
      )
      .run(id, shortCode, hostId, JSON.stringify(config), nowMs);
  }

  findById(id: string): TableRow | null {
    const row = this.db
      .prepare('SELECT * FROM tables WHERE id = ?')
      .get(id) as TableRow | undefined;
    return row ?? null;
  }

  findByShortCode(code: string): TableRow | null {
    const row = this.db
      .prepare('SELECT * FROM tables WHERE short_code = ?')
      .get(code) as TableRow | undefined;
    return row ?? null;
  }

  listActive(): TableRow[] {
    return this.db
      .prepare("SELECT * FROM tables WHERE status IN ('lobby', 'running', 'paused')")
      .all() as TableRow[];
  }

  listByHost(hostId: string): TableRow[] {
    return this.db
      .prepare('SELECT * FROM tables WHERE host_id = ?')
      .all(hostId) as TableRow[];
  }

  updateStatus(id: string, status: TableStatus, closedAt?: number): void {
    this.db
      .prepare('UPDATE tables SET status = ?, closed_at = ? WHERE id = ?')
      .run(status, closedAt ?? null, id);
  }
}
