import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signToken, verifyToken } from '@server/runtime/auth.js';

const cfg = { jwtSecret: 'test-secret-1234567890', jwtExpiresInSec: 60 };

describe('auth runtime', () => {
  it('hashes and verifies password', async () => {
    const hash = await hashPassword('s3cret');
    expect(hash).not.toBe('s3cret');
    expect(await verifyPassword('s3cret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('signs and verifies a JWT', () => {
    const token = signToken({ userId: 'u-1' }, cfg);
    const decoded = verifyToken(token, cfg);
    expect(decoded?.userId).toBe('u-1');
  });

  it('rejects tampered JWT', () => {
    const token = signToken({ userId: 'u-1' }, cfg);
    const tampered = token.slice(0, -2) + 'xx';
    expect(verifyToken(tampered, cfg)).toBeNull();
  });

  it('rejects expired JWT', () => {
    const token = signToken({ userId: 'u-1' }, { ...cfg, jwtExpiresInSec: -1 });
    expect(verifyToken(token, cfg)).toBeNull();
  });
});
