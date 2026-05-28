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

function shutdown() {
  console.log('Shutting down...');
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
