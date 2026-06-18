import type { DB } from './db.js';

export type Session = {
  token: string;
  userId: string;
  expiresAt: number;
};

type Row = { token: string; user_id: string; expires_at: string };

export class SessionRepo {
  constructor(private db: DB) {}

  async create(token: string, userId: string, expiresAt: number): Promise<void> {
    await this.db.query(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [token, userId, expiresAt],
    );
  }

  async findValid(token: string, now: number): Promise<Session | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM sessions WHERE token = $1 AND expires_at > $2',
      [token, now],
    );
    const row = rows[0] as Row | undefined;
    if (!row) return null;
    return { token: row.token, userId: row.user_id, expiresAt: Number(row.expires_at) };
  }

  async delete(token: string): Promise<void> {
    await this.db.query('DELETE FROM sessions WHERE token = $1', [token]);
  }
}
