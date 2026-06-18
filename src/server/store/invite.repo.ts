import { randomBytes } from 'node:crypto';
import type { DB } from './db.js';

export type Invite = {
  code: string;
  createdBy: string | null;
  usedBy: string | null;
  createdAt: number;
  usedAt: number | null;
};

type Row = {
  code: string;
  created_by: string | null;
  used_by: string | null;
  created_at: string;
  used_at: string | null;
};

function rowToInvite(row: Row): Invite {
  return {
    code: row.code,
    createdBy: row.created_by,
    usedBy: row.used_by,
    createdAt: Number(row.created_at),
    usedAt: row.used_at ? Number(row.used_at) : null,
  };
}

function generateCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export class InviteRepo {
  constructor(private db: DB) {}

  async create(createdBy: string | null): Promise<Invite> {
    const code = generateCode();
    const createdAt = Date.now();
    await this.db.query(
      `INSERT INTO invites (code, created_by, used_by, created_at, used_at)
       VALUES ($1, $2, NULL, $3, NULL)`,
      [code, createdBy, createdAt],
    );
    return { code, createdBy, usedBy: null, createdAt, usedAt: null };
  }

  async findByCode(code: string): Promise<Invite | null> {
    const { rows } = await this.db.query('SELECT * FROM invites WHERE code = $1', [code]);
    const row = rows[0] as Row | undefined;
    return row ? rowToInvite(row) : null;
  }

  /**
   * Atomically claim invite for userId. Returns true if successful, false if
   * code does not exist or is already used.
   */
  async claim(code: string, userId: string): Promise<boolean> {
    const result = await this.db.query(
      `UPDATE invites SET used_by = $1, used_at = $2
       WHERE code = $3 AND used_by IS NULL`,
      [userId, Date.now(), code],
    );
    return result.rowCount === 1;
  }
}
