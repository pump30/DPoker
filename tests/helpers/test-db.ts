import { newDb } from 'pg-mem';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from '@server/store/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, '../../src/server/store/migrations');

export function makeTestDb(): DB {
  const mem = newDb();

  // Run migrations
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    mem.public.none(sql);
  }

  // Create migrations tracking table
  mem.public.none(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at BIGINT NOT NULL
  )`);

  // Return a Pool-like adapter
  const pool = mem.adapters.createPg().Pool;
  return new pool() as unknown as DB;
}
