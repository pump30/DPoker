import type { DB } from './db.js';

export type Session = {
  token: string;
  userId: string;
  expiresAt: number;
};

type Row = { token: string; user_id: string; expires_at: number };

export class SessionRepo {
  constructor(private db: DB) {}

  create(token: string, userId: string, expiresAt: number): void {
    this.db
      .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, userId, expiresAt);
  }

  findValid(token: string, now: number): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?')
      .get(token, now) as Row | undefined;
    if (!row) return null;
    return { token: row.token, userId: row.user_id, expiresAt: row.expires_at };
  }

  delete(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
}
