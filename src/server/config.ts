import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DB_PATH: z.string().default('./data/dpoker.db'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 chars'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Config = {
  port: number;
  dbPath: string;
  jwtSecret: string;
  jwtExpiresInSec: number;
  nodeEnv: 'development' | 'test' | 'production';
};

function parseDuration(input: string): number {
  const m = input.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`Invalid duration: ${input}`);
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit]!;
  return n * mult;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.parse(env);
  return {
    port: parsed.PORT,
    dbPath: parsed.DB_PATH,
    jwtSecret: parsed.JWT_SECRET,
    jwtExpiresInSec: parseDuration(parsed.JWT_EXPIRES_IN),
    nodeEnv: parsed.NODE_ENV,
  };
}
