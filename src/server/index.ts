import 'dotenv/config';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { createApp } from './app.js';
import { WaitPool } from './game/wait-pool.js';
import { SnapshotRepo } from './game/snapshot.js';
import { StatsRepo } from './store/stats.repo.js';
import { TableRegistry } from './game/table-registry.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await openDb(config.databaseUrl);

  const waitPool = new WaitPool();
  const snapshotRepo = new SnapshotRepo(db);
  const statsRepo = new StatsRepo(db);
  const registry = new TableRegistry({ snapshotRepo, statsRepo, waitPool });

  // Restore active tables from DB
  const snapshots = await snapshotRepo.loadActive();
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
      db.end()
        .catch((err: unknown) => console.error('Error closing db:', err))
        .finally(() => {
          clearTimeout(forceExit);
          process.exit(0);
        });
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
