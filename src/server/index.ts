import 'dotenv/config';
import http from 'node:http';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { createApp } from './app.js';
import { createSocketGateway } from './ws/socket.gateway.js';
import { TableRegistry } from './runtime/table-registry.js';
import { EventRepo } from './store/event.repo.js';
import { TableRepo } from './store/table.repo.js';

const config = loadConfig();
const db = openDb(config.dbPath);

const eventRepo = new EventRepo(db);
const tableRepo = new TableRepo(db);
const registry = new TableRegistry({ eventRepo, tableRepo });

registry.replayAll();
console.log(`Replayed ${registry.getAllTableIds().length} active table(s)`);

const app = createApp({
  db,
  authConfig: { jwtSecret: config.jwtSecret, jwtExpiresInSec: config.jwtExpiresInSec },
  staticDir: 'dist/client',
  registry,
});

const httpServer = http.createServer(app);

const io = createSocketGateway(httpServer, {
  authConfig: { jwtSecret: config.jwtSecret, jwtExpiresInSec: config.jwtExpiresInSec },
  registry,
});

httpServer.listen(config.port, () => {
  console.log(`DPoker listening on http://localhost:${config.port}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

  const forceExit = setTimeout(() => {
    console.error('Shutdown timeout, forcing exit.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  io.close();
  httpServer.close(() => {
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
