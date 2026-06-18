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
  created_at: number;
  used_at: number | null;
};

function rowToInvite(row: Row): Invite {
  return {
    code: row.code,
    createdBy: row.created_by,
    usedBy: row.used_by,
    createdAt: row.created_at,
    usedAt: row.used_at,
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

  create(createdBy: string | null): Invite {
    const code = generateCode();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO invites (code, created_by, used_by, created_at, used_at)
         VALUES (?, ?, NULL, ?, NULL)`,
      )
      .run(code, createdBy, createdAt);
    return { code, createdBy, usedBy: null, createdAt, usedAt: null };
  }

  findByCode(code: string): Invite | null {
    const row = this.db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as
      | Row
      | undefined;
    return row ? rowToInvite(row) : null;
  }

  /**
   * Atomically claim invite for userId. Returns true if successful, false if
   * code does not exist or is already used.
   */
  claim(code: string, userId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE invites SET used_by = ?, used_at = ?
         WHERE code = ? AND used_by IS NULL`,
      )
      .run(userId, Date.now(), code);
    return result.changes === 1;
  }
}
