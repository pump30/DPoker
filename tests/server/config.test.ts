import { describe, it, expect } from 'vitest';
import { loadConfig } from '@server/config.js';

const validBase = {
  JWT_SECRET: 'a'.repeat(32),
  PORT: '3001',
  DB_PATH: '/tmp/foo.db',
  JWT_EXPIRES_IN: '7d',
  NODE_ENV: 'test' as const,
};

describe('loadConfig', () => {
  it('parses a valid environment', () => {
    const cfg = loadConfig(validBase as any);
    expect(cfg.port).toBe(3001);
    expect(cfg.dbPath).toBe('/tmp/foo.db');
    expect(cfg.jwtSecret).toBe(validBase.JWT_SECRET);
    expect(cfg.jwtExpiresInSec).toBe(7 * 86400);
    expect(cfg.nodeEnv).toBe('test');
  });

  it('applies defaults', () => {
    const cfg = loadConfig({ JWT_SECRET: 'a'.repeat(32) } as any);
    expect(cfg.port).toBe(3000);
    expect(cfg.dbPath).toBe('./data/dpoker.db');
    expect(cfg.jwtExpiresInSec).toBe(30 * 86400);
    expect(cfg.nodeEnv).toBe('development');
  });

  it('rejects short JWT_SECRET', () => {
    expect(() => loadConfig({ JWT_SECRET: 'a'.repeat(31) } as any)).toThrow();
  });

  it('rejects missing JWT_SECRET', () => {
    expect(() => loadConfig({} as any)).toThrow();
  });

  it('rejects zero or negative duration', () => {
    expect(() =>
      loadConfig({ JWT_SECRET: 'a'.repeat(32), JWT_EXPIRES_IN: '0d' } as any),
    ).toThrow(/Invalid duration/);
  });

  it('rejects malformed duration', () => {
    expect(() =>
      loadConfig({ JWT_SECRET: 'a'.repeat(32), JWT_EXPIRES_IN: '1.5h' } as any),
    ).toThrow(/Invalid duration/);
    expect(() =>
      loadConfig({ JWT_SECRET: 'a'.repeat(32), JWT_EXPIRES_IN: '30D' } as any),
    ).toThrow(/Invalid duration/);
  });

  it('parses each unit suffix', () => {
    const make = (suffix: string) =>
      loadConfig({ JWT_SECRET: 'a'.repeat(32), JWT_EXPIRES_IN: suffix } as any).jwtExpiresInSec;
    expect(make('30s')).toBe(30);
    expect(make('30m')).toBe(30 * 60);
    expect(make('2h')).toBe(2 * 3600);
    expect(make('1d')).toBe(86400);
  });
});
