import 'dotenv/config';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { createApp } from './app.js';
import { WaitPool } from './game/wait-pool.js';
import { SnapshotRepo } from './game/snapshot.js';
import { StatsRepo } from './store/stats.repo.js';
import { InviteRepo } from './store/invite.repo.js';
import { TableRegistry } from './game/table-registry.js';

const config = loadConfig();
const db = openDb(config.dbPath);

// Seed: ensure at least one invite code exists for first registration
const invites = new InviteRepo(db);
const existingInvites = db.prepare('SELECT COUNT(*) as c FROM invites WHERE used_by IS NULL').get() as { c: number };
if (existingInvites.c === 0) {
  const seed = invites.create(null);
  console.log(`Seed invite code created: ${seed.code}`);
}

const waitPool = new WaitPool();
const snapshotRepo = new SnapshotRepo(db);
const statsRepo = new StatsRepo(db);
const registry = new TableRegistry({ snapshotRepo, statsRepo, waitPool });

// Restore active tables from DB
const snapshots = snapshotRepo.loadActive();
for (const { tableId, state } of snapshots) {
  registry.restore(tableId, state);
}
if (snapshots.length > 0) {
  console.log(`Restored ${snapshots.length} active table(s) from snapshot`);
}

const app = createApp({
  db,
  authConfig: { jwtSecret: config.jwtSecret, jwtExpiresInSec: config.jwtExpiresInSec },
  staticDir: 'dist/client',
  registry,
  statsRepo,
  waitPool,
});

const server = app.listen(config.port, () => {
  console.log(`DPoker listening on http://localhost:${config.port}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);
  registry.destroy();

  // Safety timeout: if server.close hangs (e.g. keep-alive connections), force exit after 10s
  const forceExit = setTimeout(() => {
    console.error('Shutdown timeout, forcing exit.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(() => {
    try {
      db.close();
    } catch (err) {
      console.error('Error closing db:', err);
    }
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
