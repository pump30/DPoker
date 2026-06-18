import { z } from 'zod';

const Schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_EXPIRES_IN: z.string().default('30d'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VCAP_SERVICES: z.string().optional(),
});

export type Config = {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresInSec: number;
  nodeEnv: 'development' | 'test' | 'production';
};

function parseDuration(input: string): number {
  const m = input.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`Invalid duration: ${input}`);
  const n = parseInt(m[1], 10);
  if (n <= 0) throw new Error(`Invalid duration: ${input}`);
  const unit = m[2];
  const mult = { s: 1, m: 60, h: 3600, d: 86400 }[unit]!;
  return n * mult;
}

function extractPostgresUrl(vcapServicesJson: string): string | null {
  try {
    const services = JSON.parse(vcapServicesJson);
    const pgService = services['postgresql-db']?.[0] ?? services['postgresql']?.[0];
    if (!pgService) return null;
    const creds = pgService.credentials;
    // BTP provides a full URI in credentials
    if (creds.uri) return creds.uri;
    return `postgresql://${creds.username}:${creds.password}@${creds.hostname}:${creds.port}/${creds.dbname}`;
  } catch {
    return null;
  }
}

const FORBIDDEN_PLACEHOLDER = 'REPLACE_ME_RUN_OPENSSL_RAND_HEX_32_THIS_VALUE_IS_NOT_SECURE';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Schema.parse(env);
  if (parsed.NODE_ENV === 'production' && parsed.JWT_SECRET === FORBIDDEN_PLACEHOLDER) {
    throw new Error(
      'Refusing to start in production with placeholder JWT_SECRET. Generate one: openssl rand -hex 32',
    );
  }

  // Resolve database URL: VCAP_SERVICES (BTP CF) > DATABASE_URL env > error in production
  let databaseUrl: string | undefined;
  if (parsed.VCAP_SERVICES) {
    databaseUrl = extractPostgresUrl(parsed.VCAP_SERVICES) ?? undefined;
  }
  if (!databaseUrl && parsed.DATABASE_URL) {
    databaseUrl = parsed.DATABASE_URL;
  }
  if (!databaseUrl) {
    if (parsed.NODE_ENV === 'production') {
      throw new Error('No database URL found. Bind a postgresql-db service or set DATABASE_URL.');
    }
    // For local dev/test, default to local postgres
    databaseUrl = 'postgresql://localhost:5432/dpoker';
  }

  return {
    port: parsed.PORT,
    databaseUrl,
    jwtSecret: parsed.JWT_SECRET,
    jwtExpiresInSec: parseDuration(parsed.JWT_EXPIRES_IN),
    nodeEnv: parsed.NODE_ENV,
  };
}
