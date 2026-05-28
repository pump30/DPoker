import crypto from 'node:crypto';
import type { TableState, TableConfig } from '../../shared/table-types.js';
import type { TableEvent } from '../game/table-state.js';
import { reduce, getHoleCards } from '../game/table-state.js';
import type { EventRepo } from '../store/event.repo.js';
import type { TableRepo } from '../store/table.repo.js';
import type { PublicTableState, PublicSeat } from '../../shared/protocol.js';
import type { Card } from '../../shared/game-types.js';

export type TableEntry = {
  state: TableState;
  actionTimer: ReturnType<typeof setTimeout> | null;
  voteTimer: ReturnType<typeof setTimeout> | null;
  autoStartTimer: ReturnType<typeof setTimeout> | null;
};

export type TableRegistryDeps = {
  eventRepo: EventRepo;
  tableRepo: TableRepo;
};

export type EventCallback = (tableId: string, state: TableState, event: TableEvent) => void;

export class TableRegistry {
  private tables = new Map<string, TableEntry>();
  private onEvent: EventCallback | null = null;

  constructor(private deps: TableRegistryDeps) {}

  setEventCallback(cb: EventCallback): void {
    this.onEvent = cb;
  }

  replayAll(): void {
    const activeTables = this.deps.tableRepo.listActive();
    for (const row of activeTables) {
      const events = this.deps.eventRepo.getAll(row.id);
      let state: TableState | null = null;
      try {
        for (const ev of events) {
          const parsed = JSON.parse(ev.payload) as TableEvent;
          state = reduce(state, parsed);
        }
        if (state) {
          this.tables.set(row.id, { state, actionTimer: null, voteTimer: null, autoStartTimer: null });
        }
      } catch (err) {
        console.error(`Replay failed for table ${row.id}, marking closed:`, err);
        this.deps.tableRepo.updateStatus(row.id, 'closed', Date.now());
      }
    }
  }

  createTable(hostId: string, config: TableConfig): TableState {
    const tableId = crypto.randomUUID();
    const shortCode = generateShortCode();
    const nowMs = Date.now();

    const event: TableEvent = {
      type: 'CREATE_TABLE',
      tableId,
      shortCode,
      hostId,
      config,
      nowMs,
    };

    const state = this.dispatch(null, event, tableId);
    this.deps.tableRepo.create(tableId, shortCode, hostId, config, nowMs);
    this.tables.set(tableId, { state, actionTimer: null, voteTimer: null, autoStartTimer: null });
    return state;
  }

  getState(tableId: string): TableState | null {
    return this.tables.get(tableId)?.state ?? null;
  }

  getEntry(tableId: string): TableEntry | null {
    return this.tables.get(tableId) ?? null;
  }

  getAllTableIds(): string[] {
    return [...this.tables.keys()];
  }

  dispatchEvent(tableId: string, event: TableEvent): TableState {
    const entry = this.tables.get(tableId);
    if (!entry) throw new Error(`table ${tableId} not found`);

    const newState = this.dispatch(entry.state, event, tableId);
    entry.state = newState;

    if (newState.status === 'closed') {
      this.clearTimers(entry);
    }

    return newState;
  }

  beginHand(tableId: string): TableState {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    return this.dispatchEvent(tableId, {
      type: 'BEGIN_HAND',
      serverSeed,
      nowMs: Date.now(),
    });
  }

  private dispatch(state: TableState | null, event: TableEvent, tableId: string): TableState {
    const newState = reduce(state, event);
    const seq = newState.eventSeq;
    this.deps.eventRepo.append(tableId, seq, event.type, event, Date.now());
    if (this.onEvent) this.onEvent(tableId, newState, event);
    return newState;
  }

  clearTimers(entry: TableEntry): void {
    if (entry.actionTimer) { clearTimeout(entry.actionTimer); entry.actionTimer = null; }
    if (entry.voteTimer) { clearTimeout(entry.voteTimer); entry.voteTimer = null; }
    if (entry.autoStartTimer) { clearTimeout(entry.autoStartTimer); entry.autoStartTimer = null; }
  }

  remove(tableId: string): void {
    const entry = this.tables.get(tableId);
    if (entry) this.clearTimers(entry);
    this.tables.delete(tableId);
  }
}

export function toPublicState(state: TableState): PublicTableState {
  return {
    id: state.id,
    shortCode: state.shortCode,
    hostId: state.hostId,
    config: state.config,
    status: state.status,
    seats: state.seats.map((s) =>
      s
        ? {
            userId: s.userId,
            displayName: s.displayName,
            seat: s.seat,
            stack: s.stack,
            bet: s.bet,
            folded: s.folded,
            allIn: s.allIn,
            sittingOut: s.sittingOut,
          } satisfies PublicSeat
        : null,
    ),
    hand: state.hand,
    allInVote: state.allInVote,
    squid: state.squid,
    eventSeq: state.eventSeq,
  };
}

export function getHoleCardsForPlayer(state: TableState, userId: string): [Card, Card] | null {
  return getHoleCards(state, userId);
}

function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}
