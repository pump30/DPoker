import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import type { User, CreateUserInput } from '../domain/user.js';

type Row = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  created_at: string; // BIGINT comes as string from pg
};

function rowToUser(row: Row): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    createdAt: Number(row.created_at),
  };
}

export class UserRepo {
  constructor(private db: DB) {}

  async create(input: CreateUserInput): Promise<User> {
    const id = randomUUID();
    const createdAt = Date.now();
    await this.db.query(
      `INSERT INTO users (id, username, password_hash, display_name, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.username, input.passwordHash, input.displayName, createdAt],
    );
    return {
      id,
      username: input.username,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      createdAt,
    };
  }

  async findByUsername(username: string): Promise<User | null> {
    const { rows } = await this.db.query('SELECT * FROM users WHERE username = $1', [username]);
    const row = rows[0] as Row | undefined;
    return row ? rowToUser(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
    const row = rows[0] as Row | undefined;
    return row ? rowToUser(row) : null;
  }
}
