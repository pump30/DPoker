import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import type { User, CreateUserInput } from '../domain/user.js';

type Row = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: number;
};

function rowToUser(row: Row): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: row.created_at,
  };
}

export class UserRepo {
  constructor(private db: DB) {}

  create(input: CreateUserInput): User {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, display_name, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.username, input.passwordHash, input.displayName, createdAt);
    return {
      id,
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      createdAt,
    };
  }

  findByUsername(username: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as Row | undefined;
    return row ? rowToUser(row) : null;
  }

  findById(id: string): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToUser(row) : null;
  }
}
