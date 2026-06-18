import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export type DB = pg.Pool;

export async function openDb(connectionString: string): Promise<DB> {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
  });

  // Test connection
  const client = await pool.connect();
  try {
    await runMigrations(client);
  } finally {
    client.release();
  }

  return pool;
}

async function runMigrations(client: pg.PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at BIGINT NOT NULL
  )`);

  const { rows } = await client.query('SELECT name FROM _migrations');
  const applied = new Set(rows.map((r: any) => r.name as string));

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name, applied_at) VALUES ($1, $2)', [file, Date.now()]);
      await client.query('COMMIT');
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch {}
      throw err;
    }
  }
}
