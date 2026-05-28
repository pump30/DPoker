import 'dotenv/config';
import { loadConfig } from './config.js';
import { openDb } from './store/db.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const app = createApp({
  db,
  authConfig: { jwtSecret: config.jwtSecret, jwtExpiresInSec: config.jwtExpiresInSec },
  staticDir: 'dist/client',
});

const server = app.listen(config.port, () => {
  console.log(`DPoker listening on http://localhost:${config.port}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down...`);

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
