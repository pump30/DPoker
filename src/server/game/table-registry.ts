import crypto from 'node:crypto';
import { reduce, type TableEvent } from './table-state.js';
import { AutoDealer } from './auto-dealer.js';
import { WaitPool } from './wait-pool.js';
import { SnapshotRepo } from './snapshot.js';
import { StatsRepo } from '../store/stats.repo.js';
import type { TableState, TableConfig, SeatedPlayer } from '../../shared/table-types.js';

export type RegistryDeps = {
  snapshotRepo: SnapshotRepo;
  statsRepo: StatsRepo;
  waitPool: WaitPool;
};

const DEFAULT_CONFIG: TableConfig = {
  name: 'Unnamed',
  smallBlind: 10,
  bigBlind: 20,
  minBuyIn: 500,
  maxBuyIn: 2000,
  reloadPolicy: 'anytime',
  maxSeats: 9,
  allowSpectators: true,
  actionTimeoutSec: 10,
  timeBankSec: 0,
  defaultRunoutCount: 1,
  squidMode: false,
  squidPointsPerCatch: 10,
};

export class TableRegistry {
  private tables = new Map<string, TableState>();
  private autoDealer: AutoDealer;
  // Track buy-in totals per table per player: Map<tableId, Map<playerId, totalBoughtIn>>
  private buyInTracker = new Map<string, Map<string, number>>();

  constructor(private deps: RegistryDeps) {
    this.autoDealer = new AutoDealer((tableId, event) => this.dispatch(tableId, event));
  }

  create(config: Partial<TableConfig>, hostId: string): TableState {
    const tableId = crypto.randomUUID();
    const shortCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const fullConfig: TableConfig = { ...DEFAULT_CONFIG, ...config };
    const event: TableEvent = {
      type: 'CREATE_TABLE',
      tableId,
      shortCode,
      hostId,
      config: fullConfig,
      nowMs: Date.now(),
    };
    const state = reduce(null, event);
    this.tables.set(tableId, state);
    this.deps.snapshotRepo.upsert(tableId, state);
    this.buyInTracker.set(tableId, new Map());
    this.autoDealer.onStateChange(tableId, null, state);
    return state;
  }

  get(tableId: string): TableState | null {
    return this.tables.get(tableId) ?? null;
  }

  list(): TableState[] {
    return [...this.tables.values()];
  }

  dispatch(tableId: string, event: TableEvent): TableState {
    const prev = this.tables.get(tableId);
    if (!prev) throw new Error(`table not found: ${tableId}`);

    // AutoDealer uses '__dealer__' marker — replace with actual hostId
    if ('hostId' in event && (event as any).hostId === '__dealer__') {
      (event as any).hostId = prev.hostId;
    }

    // Track buy-in
    if (event.type === 'SIT_DOWN') {
      const tracker = this.buyInTracker.get(tableId) ?? new Map();
      const current = tracker.get(event.userId) ?? 0;
      tracker.set(event.userId, current + event.buyIn);
      this.buyInTracker.set(tableId, tracker);
      this.deps.statsRepo.recordBuyIn(event.userId);
    }

    const next = reduce(prev, event);
    this.tables.set(tableId, next);
    this.deps.snapshotRepo.upsert(tableId, next);
    this.deps.waitPool.notify(tableId);

    // Hand just ended — record stats
    if (prev.hand && !next.hand) {
      this.recordHandStats(tableId, prev, next);
      this.autoRebuy(tableId, next);
    }

    this.autoDealer.onStateChange(tableId, prev, next);
    return next;
  }

  restore(tableId: string, state: TableState): void {
    this.tables.set(tableId, state);
    // Rebuild buy-in tracker from state (approximate: use current stacks)
    const tracker = new Map<string, number>();
    for (const seat of state.seats) {
      if (seat) tracker.set(seat.userId, seat.stack);
    }
    this.buyInTracker.set(tableId, tracker);
    this.autoDealer.resume(tableId, state);
  }

  remove(tableId: string): void {
    this.tables.delete(tableId);
    this.buyInTracker.delete(tableId);
    this.deps.snapshotRepo.remove(tableId);
    this.deps.waitPool.cleanup(tableId);
    this.autoDealer.clearTimers(tableId);
  }

  getAutoDealer(): AutoDealer {
    return this.autoDealer;
  }

  getBuyInTracker(): Map<string, Map<string, number>> {
    return this.buyInTracker;
  }

  destroy(): void {
    this.autoDealer.destroy();
  }

  private recordHandStats(tableId: string, prev: TableState, next: TableState): void {
    const potTotal = prev.hand!.pots?.reduce((s, p) => s + p.amount, 0) ?? 0;

    for (const seat of prev.seats) {
      if (!seat) continue;
      const nextSeat = next.seats.find((s): s is SeatedPlayer => s?.userId === seat.userId);
      if (!nextSeat) continue;
      const profitDelta = nextSeat.stack - seat.stack;
      const won = profitDelta > 0;
      this.deps.statsRepo.recordHandResult({
        playerId: seat.userId,
        won,
        profitDelta,
        potSize: potTotal,
      });
    }
  }

  private autoRebuy(tableId: string, state: TableState): void {
    const tracker = this.buyInTracker.get(tableId) ?? new Map();
    let rebuyed = false;
    for (const seat of state.seats) {
      if (seat && seat.stack === 0) {
        // Directly add chips — mutate in place since we're between hands
        seat.stack = state.config.minBuyIn;
        const current = tracker.get(seat.userId) ?? 0;
        tracker.set(seat.userId, current + state.config.minBuyIn);
        this.deps.statsRepo.recordBuyIn(seat.userId);
        rebuyed = true;
      }
    }
    // Re-persist after rebuy
    if (rebuyed) {
      this.deps.snapshotRepo.upsert(tableId, state);
    }
  }
}
