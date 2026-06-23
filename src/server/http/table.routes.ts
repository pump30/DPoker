import { Router } from 'express';
import { z } from 'zod';
import { openAuth } from './middleware.js';
import { getHoleCards } from '../game/table-state.js';
import type { TableRegistry } from '../game/table-registry.js';
import type { WaitPool } from '../game/wait-pool.js';
import type { TableState } from '../../shared/table-types.js';
import type { Action } from '../../shared/game-types.js';

const CreateTableSchema = z.object({
  name: z.string().min(1).max(64),
  smallBlind: z.number().int().positive(),
  bigBlind: z.number().int().positive(),
  minBuyIn: z.number().int().positive(),
  maxBuyIn: z.number().int().positive(),
  maxSeats: z.number().int().min(2).max(9),
  actionTimeoutSec: z.number().int().min(5).max(120).optional(),
});

const SitSchema = z.object({
  seat: z.number().int().min(0).max(8).optional(),
  buyIn: z.number().int().positive(),
});

const ActionSchema = z.object({
  type: z.enum(['fold', 'check', 'call', 'raise', 'all-in']),
  amount: z.number().int().positive().optional(),
});

export function tableRoutes(registry: TableRegistry, waitPool: WaitPool): Router {
  const router = Router();
  router.use(openAuth());

  // POST /api/tables — create
  router.post('/', (req, res) => {
    const parsed = CreateTableSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });
    const state = registry.create(parsed.data, req.userId!);
    return res.status(201).json(formatTableResponse(state, req.userId!, registry));
  });

  // GET /api/tables — list
  router.get('/', (_req, res) => {
    const tables = registry.list().map(s => ({
      tableId: s.id,
      name: s.config.name,
      status: s.status,
      seats: s.seats.filter(Boolean).length,
      maxSeats: s.config.maxSeats,
    }));
    return res.json(tables);
  });

  // GET /api/tables/:id — state
  router.get('/:id', (req, res) => {
    const state = registry.get(req.params.id);
    if (!state) return res.status(404).json({ error: 'table_not_found' });
    return res.json(formatTableResponse(state, req.userId!, registry));
  });

  // POST /api/tables/:id/sit
  router.post('/:id/sit', (req, res) => {
    const state = registry.get(req.params.id);
    if (!state) return res.status(404).json({ error: 'table_not_found' });
    const parsed = SitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });

    const { buyIn } = parsed.data;
    let seat = parsed.data.seat;

    // Auto-assign seat if not specified
    if (seat === undefined) {
      seat = state.seats.findIndex(s => s === null);
      if (seat === -1) return res.status(400).json({ error: 'table_full' });
    }

    try {
      const next = registry.dispatch(req.params.id, {
        type: 'SIT_DOWN', userId: req.userId!, seat, buyIn, nowMs: Date.now(),
      });
      return res.json(formatTableResponse(next, req.userId!, registry));
    } catch (e: any) {
      const msg = e.message ?? '';
      if (msg.includes('already taken')) return res.status(400).json({ error: 'seat_taken' });
      if (msg.includes('out of range')) return res.status(400).json({ error: 'invalid_buy_in' });
      return res.status(400).json({ error: 'invalid_request', reason: msg });
    }
  });

  // DELETE /api/tables/:id — close table (host only)
  router.delete('/:id', (req, res) => {
    const state = registry.get(req.params.id);
    if (!state) return res.status(404).json({ error: 'table_not_found' });
    try {
      const next = registry.dispatch(req.params.id, {
        type: 'CLOSE_TABLE', hostId: req.userId!, nowMs: Date.now(),
      });
      return res.json({ tableId: next.id, status: next.status });
    } catch (e: any) {
      if (e.message?.includes('only host')) {
        return res.status(403).json({ error: 'forbidden', reason: 'only the host can close this table' });
      }
      return res.status(400).json({ error: 'invalid_request', reason: e.message });
    }
  });

  // POST /api/tables/:id/leave
  router.post('/:id/leave', (req, res) => {
    const state = registry.get(req.params.id);
    if (!state) return res.status(404).json({ error: 'table_not_found' });
    try {
      const next = registry.dispatch(req.params.id, {
        type: 'STAND_UP', userId: req.userId!, nowMs: Date.now(),
      });
      return res.json(formatTableResponse(next, req.userId!, registry));
    } catch (e: any) {
      return res.status(400).json({ error: 'invalid_request', reason: e.message });
    }
  });

  // GET /api/tables/:id/act — long-poll
  router.get('/:id/act', async (req, res) => {
    const tableId = req.params.id;
    const playerId = req.userId!;
    const timeout = Math.min(parseInt(req.query.timeout as string) || 10000, 30000);

    const state = registry.get(tableId);
    if (!state) return res.status(404).json({ error: 'table_not_found' });

    // Check immediately
    if (isMyTurn(state, playerId)) {
      return res.json(formatActResponse(state, playerId, registry));
    }

    // Track client disconnect
    let aborted = false;
    req.on('close', () => { aborted = true; });

    // Long-poll loop
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && !aborted) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const result = await waitPool.wait(tableId, playerId, Math.min(remaining, 5000));
      if (aborted) break;
      if (result === 'timeout') {
        // Check if overall deadline passed
        if (Date.now() >= deadline) break;
        continue;
      }
      // Woken up — check if it's our turn now
      const current = registry.get(tableId);
      if (!current) return res.status(404).json({ error: 'table_not_found' });
      if (current.status === 'closed') return res.json(formatTableResponse(current, playerId, registry));
      if (isMyTurn(current, playerId)) {
        return res.json(formatActResponse(current, playerId, registry));
      }
    }
    if (!aborted) return res.status(204).end();
  });

  // POST /api/tables/:id/act — submit action
  router.post('/:id/act', (req, res) => {
    const tableId = req.params.id;
    const playerId = req.userId!;
    const state = registry.get(tableId);
    if (!state) return res.status(404).json({ error: 'table_not_found' });

    if (!isMyTurn(state, playerId)) {
      return res.status(400).json({ error: 'not_your_turn' });
    }

    const parsed = ActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'invalid_request' });

    if (parsed.data.type === 'raise' && !parsed.data.amount) {
      return res.status(400).json({ error: 'invalid_request', reason: 'raise requires amount' });
    }

    const action: Action = parsed.data.type === 'raise'
      ? { type: 'raise', amount: parsed.data.amount! }
      : { type: parsed.data.type } as Action;

    try {
      const next = registry.dispatch(tableId, {
        type: 'PLAYER_ACTION', userId: playerId, action, nowMs: Date.now(),
      });
      return res.json(formatTableResponse(next, playerId, registry));
    } catch (e: any) {
      return res.status(400).json({ error: 'invalid_action', reason: e.message });
    }
  });

  return router;
}

function isMyTurn(state: TableState, playerId: string): boolean {
  if (!state.hand || state.hand.actorSeat === null) return false;
  const actor = state.seats[state.hand.actorSeat];
  return actor?.userId === playerId;
}

function formatTableResponse(state: TableState, playerId: string, registry: TableRegistry): any {
  const buyInTracker = registry.getBuyInTracker().get(state.id);
  const myCards = getHoleCards(state, playerId);
  const mySeat = state.seats.find(s => s?.userId === playerId);
  const myBoughtIn = buyInTracker?.get(playerId) ?? mySeat?.stack ?? 0;

  return {
    tableId: state.id,
    status: state.status,
    hand: state.hand ? {
      handNo: state.hand.handNo,
      stage: state.hand.stage,
      board: state.hand.board,
      pots: state.hand.pots,
      currentBet: state.hand.currentBet,
      minRaise: state.hand.minRaise,
      actorId: state.hand.actorSeat !== null ? state.seats[state.hand.actorSeat]?.userId ?? null : null,
      actionDeadlineMs: state.hand.actionDeadlineMs,
    } : null,
    seats: state.seats.map(s => {
      if (!s) return null;
      const playerBuyIn = buyInTracker?.get(s.userId) ?? s.stack;
      return {
        seat: s.seat,
        playerId: s.userId,
        stack: s.stack,
        bet: s.bet,
        folded: s.folded,
        allIn: s.allIn,
        profit: s.stack - playerBuyIn,
      };
    }),
    myCards: myCards ?? undefined,
    myProfit: mySeat ? mySeat.stack - myBoughtIn : undefined,
  };
}

function formatActResponse(state: TableState, playerId: string, registry: TableRegistry): any {
  const base = formatTableResponse(state, playerId, registry);
  // Add validActions
  const validActions: string[] = [];
  if (state.hand && state.hand.actorSeat !== null) {
    const actor = state.seats[state.hand.actorSeat];
    if (actor?.userId === playerId) {
      const owed = state.hand.currentBet - actor.bet;
      if (owed === 0) validActions.push('check');
      validActions.push('fold');
      if (owed > 0 && owed <= actor.stack) validActions.push('call');
      if (actor.stack > owed) {
        const leftAfterCall = actor.stack - owed;
        if (leftAfterCall >= (state.hand.minRaise ?? state.hand.currentBet)) {
          validActions.push('raise');
        }
      }
      if (actor.stack > 0) validActions.push('all-in');
    }
  }
  return { ...base, validActions };
}
