import express, { type Express } from 'express';
import type { DB } from './store/db.js';
import type { AuthConfig } from './runtime/auth.js';
import { authRoutes } from './http/auth.routes.js';
import { inviteRoutes } from './http/invite.routes.js';

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

  app.use('/api/auth', authRoutes(deps.db, deps.authConfig));
  app.use('/api/invites', inviteRoutes(deps.db, deps.authConfig));

  return app;
}
