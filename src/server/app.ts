import express, { type Express } from 'express';
import type { DB } from './store/db.js';
import type { AuthConfig } from './runtime/auth.js';

export type AppDeps = {
  db: DB;
  authConfig: AuthConfig;
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  // routes wired in later tasks (Task 9, Task 10)

  return app;
}
