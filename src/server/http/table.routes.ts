import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from './middleware.js';
import { TableRepo } from '../store/table.repo.js';
import type { TableRegistry } from '../runtime/table-registry.js';
import type { DB } from '../store/db.js';
import type { AuthConfig } from '../runtime/auth.js';
import type { TableConfig } from '../../shared/table-types.js';

const TableConfigSchema = z.object({
  name: z.string().min(1).max(64),
  smallBlind: z.number().positive(),
  bigBlind: z.number().positive(),
  minBuyIn: z.number().positive(),
  maxBuyIn: z.number().positive(),
  reloadPolicy: z.enum(['anytime', 'between-hands', 'never']),
  maxSeats: z.number().int().min(2).max(9),
  allowSpectators: z.boolean(),
  actionTimeoutSec: z.number().positive(),
  timeBankSec: z.number().nonnegative(),
  defaultRunoutCount: z.union([z.literal(1), z.literal(2)]),
  squidMode: z.boolean(),
  squidPointsPerCatch: z.number().nonnegative(),
});

const CreateTableSchema = z.object({
  config: TableConfigSchema,
});

const JoinTableSchema = z.object({
  shortCode: z.string().min(1).max(6),
});

function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

export function tableRoutes(db: DB, authConfig: AuthConfig, registry?: TableRegistry): Router {
  const router = Router();
  const repo = new TableRepo(db);
  const auth = requireAuth(authConfig);

  router.post('/', auth, (req, res) => {
    const parsed = CreateTableSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const config: TableConfig = parsed.data.config;

    if (registry) {
      const state = registry.createTable(req.userId!, config);
      return res.status(201).json({ id: state.id, shortCode: state.shortCode });
    }

    const id = crypto.randomUUID();
    const shortCode = generateShortCode();
    repo.create(id, shortCode, req.userId!, config, Date.now());
    res.status(201).json({ id, shortCode });
  });

  router.get('/', auth, (req, res) => {
    const rows = repo.listByHost(req.userId!);
    const tables = rows.map((r) => {
      const config = JSON.parse(r.config_json) as TableConfig;
      return {
        id: r.id,
        shortCode: r.short_code,
        name: config.name,
        status: r.status,
        createdAt: r.created_at,
      };
    });
    res.json({ tables });
  });

  router.get('/:id', auth, (req, res) => {
    const row = repo.findById(req.params.id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    const config = JSON.parse(row.config_json) as TableConfig;
    res.json({
      id: row.id,
      shortCode: row.short_code,
      hostId: row.host_id,
      config,
      status: row.status,
      createdAt: row.created_at,
    });
  });

  router.post('/join', auth, (req, res) => {
    const parsed = JoinTableSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request' });
    }

    const row = repo.findByShortCode(parsed.data.shortCode.toUpperCase());
    if (!row) return res.status(404).json({ error: 'table_not_found' });
    if (row.status !== 'lobby' && row.status !== 'running') {
      return res.status(400).json({ error: 'table_not_joinable' });
    }

    res.json({ tableId: row.id });
  });

  return router;
}
