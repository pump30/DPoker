import { Router } from 'express';
import type { DB } from '../store/db.js';
import { InviteRepo } from '../store/invite.repo.js';
import { requireAuth } from './middleware.js';
import type { AuthConfig } from '../runtime/auth.js';
import type { CreateInviteResponse } from '../../shared/api-types.js';

export function inviteRoutes(db: DB, authConfig: AuthConfig): Router {
  const router = Router();
  const invites = new InviteRepo(db);

  router.post('/', requireAuth(authConfig), async (req, res) => {
    const inv = await invites.create(req.userId ?? null);
    const response: CreateInviteResponse = { code: inv.code };
    res.status(201).json(response);
  });

  return router;
}
