import type { DB } from './db.js';

export type EventRow = {
  table_id: string;
  seq: number;
  type: string;
  payload: string; // JSON
  created_at: number;
};

export class EventRepo {
  constructor(private db: DB) {}

  append(tableId: string, seq: number, type: string, payload: object, nowMs: number): void {
    this.db
      .prepare(
        `INSERT INTO event_log (table_id, seq, type, payload, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tableId, seq, type, JSON.stringify(payload), nowMs);
  }

  getAll(tableId: string): EventRow[] {
    return this.db
      .prepare('SELECT * FROM event_log WHERE table_id = ? ORDER BY seq ASC')
      .all(tableId) as EventRow[];
  }

  getSince(tableId: string, afterSeq: number): EventRow[] {
    return this.db
      .prepare('SELECT * FROM event_log WHERE table_id = ? AND seq > ? ORDER BY seq ASC')
      .all(tableId, afterSeq) as EventRow[];
  }

  deleteForTable(tableId: string): void {
    this.db.prepare('DELETE FROM event_log WHERE table_id = ?').run(tableId);
  }
}
