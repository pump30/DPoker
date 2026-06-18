import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyToken, type AuthConfig } from '../runtime/auth.js';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

export function requireAuth(authConfig: AuthConfig): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const token = header.slice('Bearer '.length);
    const payload = verifyToken(token, authConfig);
    if (!payload) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    req.userId = payload.userId;
    next();
  };
}

export function openAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const playerId = req.headers['x-player-id'] as string | undefined;
    if (!playerId || playerId.trim().length === 0) {
      return res.status(400).json({ error: 'X-Player-Id header required' });
    }
    req.userId = playerId.trim();
    next();
  };
}
