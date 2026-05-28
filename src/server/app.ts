import express, { type Express } from 'express';
import path from 'node:path';
import type { DB } from './store/db.js';
import type { AuthConfig } from './runtime/auth.js';
import { authRoutes } from './http/auth.routes.js';
import { inviteRoutes } from './http/invite.routes.js';

export type AppDeps = {
  db: DB;
  authConfig: AuthConfig;
  staticDir?: string;
};

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes(deps.db, deps.authConfig));
  app.use('/api/invites', inviteRoutes(deps.db, deps.authConfig));

  if (deps.staticDir) {
    const dir = path.resolve(deps.staticDir);
    app.use(express.static(dir));
    // SPA fallback: any non-API GET goes to index.html
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  return app;
}
