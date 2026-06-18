import { Router } from 'express';
import { z } from 'zod';
import { UserRepo } from '../store/user.repo.js';
import { InviteRepo } from '../store/invite.repo.js';
import { hashPassword, verifyPassword, signToken, type AuthConfig } from '../runtime/auth.js';
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
  return code === '23505'; // PostgreSQL unique_violation
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
    const invite = await invites.findByCode(inviteCode);
    if (!invite || invite.usedBy !== null) {
      const err: ErrorResponse = { error: 'invalid_invite' };
      return res.status(403).json(err);
    }

    // Pre-check duplicate username (cheap)
    if (await users.findByUsername(username)) {
      const err: ErrorResponse = { error: 'username_taken' };
      return res.status(409).json(err);
    }

    const passwordHash = await hashPassword(password);

    // Atomic: create user + claim invite using PG transaction
    let user;
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const id = (await import('node:crypto')).randomUUID();
      const createdAt = Date.now();
      await client.query(
        `INSERT INTO users (id, username, password_hash, display_name, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, username, passwordHash, displayName, createdAt],
      );
      const claimResult = await client.query(
        `UPDATE invites SET used_by = $1, used_at = $2
         WHERE code = $3 AND used_by IS NULL`,
        [id, Date.now(), inviteCode],
      );
      if (claimResult.rowCount !== 1) {
        throw new InviteRaceError();
      }
      await client.query('COMMIT');
      user = { id, username, passwordHash, displayName, createdAt };
    } catch (e) {
      await client.query('ROLLBACK');
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
    } finally {
      client.release();
    }

    const token = signToken({ userId: user.id }, authConfig);
    const response: AuthResponse = {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName },
    };
    res.status(201).json(response);
  });

  const LoginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });

  router.post('/login', async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      const err: ErrorResponse = { error: 'invalid_request' };
      return res.status(400).json(err);
    }
    const { username, password } = parsed.data;
    const user = await users.findByUsername(username);
    if (!user) {
      const err: ErrorResponse = { error: 'invalid_credentials' };
      return res.status(401).json(err);
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const err: ErrorResponse = { error: 'invalid_credentials' };
      return res.status(401).json(err);
    }
    const token = signToken({ userId: user.id }, authConfig);
    const response: AuthResponse = {
      token,
      user: { id: user.id, username: user.username, displayName: user.displayName },
    };
    res.json(response);
  });

  return router;
}

class InviteRaceError extends Error {
  constructor() {
    super('invite_claim_race');
  }
}
