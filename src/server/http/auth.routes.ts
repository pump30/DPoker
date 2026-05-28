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
  inviteCode: z.string().min(1).max(16),
});

function isUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE';
}

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

    // Fail fast on invalid invite (cheap lookup, before hashing)
    const invite = invites.findByCode(inviteCode);
    if (!invite || invite.usedBy !== null) {
      const err: ErrorResponse = { error: 'invalid_invite' };
      return res.status(403).json(err);
    }

    // Pre-check duplicate username (cheap)
    if (users.findByUsername(username)) {
      const err: ErrorResponse = { error: 'username_taken' };
      return res.status(409).json(err);
    }

    const passwordHash = await hashPassword(password);

    // Atomic: create user + claim invite. If either fails, both roll back.
    let user;
    try {
      user = db.transaction(() => {
        const created = users.create({ username, passwordHash, displayName });
        const claimed = invites.claim(inviteCode, created.id);
        if (!claimed) {
          // Race: invite was claimed by a concurrent request between our findByCode and now.
          // Throw to roll back the user insert.
          throw new InviteRaceError();
        }
        return created;
      })();
    } catch (e) {
      if (e instanceof InviteRaceError) {
        const err: ErrorResponse = { error: 'invalid_invite' };
        return res.status(403).json(err);
      }
      if (isUniqueConstraintError(e)) {
        const err: ErrorResponse = { error: 'username_taken' };
        return res.status(409).json(err);
      }
      // Real infrastructure error — surface 500 rather than silently misclassify
      console.error('register failed', e);
      const err: ErrorResponse = { error: 'internal_error' };
      return res.status(500).json(err);
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

class InviteRaceError extends Error {
  constructor() {
    super('invite_claim_race');
  }
}
