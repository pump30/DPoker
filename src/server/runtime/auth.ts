import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const BCRYPT_ROUNDS = 10;

export type AuthConfig = {
  jwtSecret: string;
  jwtExpiresInSec: number;
};

export type TokenPayload = {
  userId: string;
};

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(payload: TokenPayload, cfg: AuthConfig): string {
  return jwt.sign(payload, cfg.jwtSecret, { expiresIn: cfg.jwtExpiresInSec });
}

export function verifyToken(token: string, cfg: AuthConfig): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, cfg.jwtSecret) as { userId?: unknown };
    if (typeof decoded.userId !== 'string') return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}
