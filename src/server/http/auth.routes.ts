import { Router } from 'express';
import { z } from 'zod';
import { UserRepo } from '../store/user.repo.js';
import { InviteRepo } from '../store/invite.repo.js';
import { hashPassword, signToken, type AuthConfig } from '../runtime/auth.js';
import type { DB } from '../store/db.js';
import type { AuthResponse, ErrorResponse } from '../../shared/api-types.js';

const RegisterSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(32),
  inviteCode: z.string().min(1),
});

export function authRoutes(db: DB, authConfig: AuthConfig): Router {
  const router = Router();
  const users = new UserRepo(db);
  const invites = new InviteRepo(db);

  router.post('/register', async (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      const err: ErrorResponse = { error: 'invalid_request' };
      return res.status(400).json(err);
    }
    const { username, password, displayName, inviteCode } = parsed.data;

    if (users.findByUsername(username)) {
      const err: ErrorResponse = { error: 'username_taken' };
      return res.status(409).json(err);
    }

    const passwordHash = await hashPassword(password);
    let user;
    try {
      user = users.create({ username, passwordHash, displayName });
    } catch {
      const err: ErrorResponse = { error: 'username_taken' };
      return res.status(409).json(err);
    }

    const claimed = invites.claim(inviteCode, user.id);
    if (!claimed) {
      // best-effort: delete the just-created user since invite is invalid
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      const err: ErrorResponse = { error: 'invalid_invite' };
      return res.status(403).json(err);
    }

    const token = signToken({ userId: user.id }, authConfig);
    const response: AuthResponse = {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName },
    };
    res.status(201).json(response);
  });

  return router;
}
