import crypto from 'node:crypto';
import type { TableState, SeatedPlayer } from '../../shared/table-types.js';
import type { TableEvent } from './table-state.js';

export type DispatchFn = (tableId: string, event: TableEvent) => TableState;

export class AutoDealer {
  private startTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private nextHandTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private actionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private dispatch: DispatchFn) {}

  onStateChange(tableId: string, prev: TableState | null, next: TableState): void {
    // Auto-start: 2+ seated in lobby → start after 3s
    if (next.status === 'lobby' && this.seatedCount(next) >= 2 && !this.startTimers.has(tableId)) {
      this.startTimers.set(tableId, setTimeout(() => {
        this.startTimers.delete(tableId);
        this.startGame(tableId);
      }, 3000));
    }

    // Cancel start timer if players leave below 2
    if (next.status === 'lobby' && this.seatedCount(next) < 2 && this.startTimers.has(tableId)) {
      clearTimeout(this.startTimers.get(tableId)!);
      this.startTimers.delete(tableId);
    }

    // Auto-deal next hand: hand just ended (prev had hand, next doesn't)
    if (prev?.hand && !next.hand && next.status === 'running' && this.seatedCount(next) >= 2) {
      this.scheduleNextHand(tableId);
    }

    // Action timeout: new actor
    if (next.hand?.actorSeat !== null && next.hand?.actorSeat !== undefined) {
      const prevActor = prev?.hand?.actorSeat;
      if (prevActor !== next.hand.actorSeat || !prev?.hand) {
        this.scheduleActionTimeout(tableId, next);
      }
    } else {
      // No actor — clear action timer
      this.clearActionTimer(tableId);
    }

    // Table closed — clear all
    if (next.status === 'closed') {
      this.clearTimers(tableId);
    }
  }

  resume(tableId: string, state: TableState): void {
    if (state.status === 'running' && !state.hand && this.seatedCount(state) >= 2) {
      this.scheduleNextHand(tableId);
    }
    if (state.hand?.actorSeat !== null && state.hand?.actorSeat !== undefined) {
      this.scheduleActionTimeout(tableId, state);
    }
  }

  clearTimers(tableId: string): void {
    if (this.startTimers.has(tableId)) {
      clearTimeout(this.startTimers.get(tableId)!);
      this.startTimers.delete(tableId);
    }
    if (this.nextHandTimers.has(tableId)) {
      clearTimeout(this.nextHandTimers.get(tableId)!);
      this.nextHandTimers.delete(tableId);
    }
    this.clearActionTimer(tableId);
  }

  destroy(): void {
    for (const t of this.startTimers.values()) clearTimeout(t);
    for (const t of this.nextHandTimers.values()) clearTimeout(t);
    for (const t of this.actionTimers.values()) clearTimeout(t);
    this.startTimers.clear();
    this.nextHandTimers.clear();
    this.actionTimers.clear();
  }

  private startGame(tableId: string): void {
    try {
      // Use '__dealer__' marker — TableRegistry intercepts and replaces with real hostId
      this.dispatch(tableId, { type: 'START_GAME', hostId: '__dealer__', nowMs: Date.now() });
    } catch { /* table might have been removed */ }
    try {
      this.dispatch(tableId, {
        type: 'BEGIN_HAND',
        serverSeed: crypto.randomBytes(32).toString('hex'),
        nowMs: Date.now(),
      });
    } catch { /* ignore */ }
  }

  private scheduleNextHand(tableId: string): void {
    if (this.nextHandTimers.has(tableId)) {
      clearTimeout(this.nextHandTimers.get(tableId)!);
    }
    this.nextHandTimers.set(tableId, setTimeout(() => {
      this.nextHandTimers.delete(tableId);
      try {
        this.dispatch(tableId, {
          type: 'BEGIN_HAND',
          serverSeed: crypto.randomBytes(32).toString('hex'),
          nowMs: Date.now(),
        });
      } catch { /* not enough players, etc */ }
    }, 2000));
  }

  private scheduleActionTimeout(tableId: string, state: TableState): void {
    this.clearActionTimer(tableId);
    const timeoutMs = (state.config.actionTimeoutSec ?? 10) * 1000;
    this.actionTimers.set(tableId, setTimeout(() => {
      this.actionTimers.delete(tableId);
      try {
        this.dispatch(tableId, { type: 'TIMEOUT', nowMs: Date.now() });
      } catch { /* ignore */ }
    }, timeoutMs));
  }

  private clearActionTimer(tableId: string): void {
    if (this.actionTimers.has(tableId)) {
      clearTimeout(this.actionTimers.get(tableId)!);
      this.actionTimers.delete(tableId);
    }
  }

  private seatedCount(state: TableState): number {
    return state.seats.filter((s): s is SeatedPlayer => s !== null).length;
  }
}
