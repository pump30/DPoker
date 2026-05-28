import { describe, it, expect } from 'vitest';
import { reduce, type TableEvent } from '@server/game/table-state.js';
import type { TableConfig, TableState } from '@shared/table-types.js';

const baseConfig: TableConfig = {
  name: 'Test Table',
  smallBlind: 5,
  bigBlind: 10,
  minBuyIn: 100,
  maxBuyIn: 1000,
  reloadPolicy: 'between-hands',
  maxSeats: 6,
  allowSpectators: true,
  actionTimeoutSec: 30,
  timeBankSec: 60,
  defaultRunoutCount: 2,
  squidMode: false,
  squidPointsPerCatch: 10,
};

function apply(state: TableState | null, ...events: TableEvent[]): TableState {
  let s: TableState | null = state;
  for (const e of events) {
    s = reduce(s, e);
  }
  if (!s) throw new Error('reducer returned null');
  return s;
}

const SEED = 'a'.repeat(64); // 32 bytes
const SEED2 = 'b'.repeat(64);

describe('table-state — lobby and seating', () => {
  it('creates table in lobby state', () => {
    const s = reduce(null, {
      type: 'CREATE_TABLE',
      tableId: 't1',
      shortCode: 'ABC123',
      hostId: 'host',
      config: baseConfig,
      nowMs: 1000,
    });
    expect(s.id).toBe('t1');
    expect(s.status).toBe('lobby');
    expect(s.seats).toHaveLength(6);
    expect(s.seats.every((x) => x === null)).toBe(true);
  });

  it('seats players via SIT_DOWN', () => {
    const s = apply(null,
      { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'h', config: baseConfig, nowMs: 1 },
      { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: 2 },
      { type: 'SIT_DOWN', userId: 'bob', seat: 2, buyIn: 500, nowMs: 3 },
    );
    expect(s.seats[0]?.userId).toBe('alice');
    expect(s.seats[2]?.userId).toBe('bob');
    expect(s.seats[1]).toBe(null);
  });

  it('rejects buy-in below min', () => {
    const s = reduce(null, { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'h', config: baseConfig, nowMs: 1 });
    expect(() => reduce(s, { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 50, nowMs: 2 })).toThrow();
  });

  it('rejects sitting in occupied seat', () => {
    const s = apply(null,
      { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'h', config: baseConfig, nowMs: 1 },
      { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: 2 },
    );
    expect(() => reduce(s, { type: 'SIT_DOWN', userId: 'bob', seat: 0, buyIn: 500, nowMs: 3 })).toThrow();
  });
});

describe('table-state — host control', () => {
  it('only host can START_GAME', () => {
    const s = reduce(null, { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'h', config: baseConfig, nowMs: 1 });
    expect(() => reduce(s, { type: 'START_GAME', hostId: 'someone-else', nowMs: 2 })).toThrow();
  });

  it('START_GAME flips status to running', () => {
    const s = apply(null,
      { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'h', config: baseConfig, nowMs: 1 },
      { type: 'START_GAME', hostId: 'h', nowMs: 2 },
    );
    expect(s.status).toBe('running');
  });

  it('CLOSE_TABLE marks closed and clears hand', () => {
    const s = apply(null,
      { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'h', config: baseConfig, nowMs: 1 },
      { type: 'CLOSE_TABLE', hostId: 'h', nowMs: 2 },
    );
    expect(s.status).toBe('closed');
    expect(s.closedAt).toBe(2);
  });
});

describe('table-state — full hand (heads-up, both check down)', () => {
  it('plays one hand to showdown with 2 players', () => {
    const s0 = apply(null,
      { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'alice', config: baseConfig, nowMs: 1 },
      { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: 2 },
      { type: 'SIT_DOWN', userId: 'bob', seat: 1, buyIn: 500, nowMs: 3 },
      { type: 'START_GAME', hostId: 'alice', nowMs: 4 },
      { type: 'BEGIN_HAND', serverSeed: SEED, nowMs: 5 },
    );
    expect(s0.hand).not.toBe(null);
    expect(s0.hand!.stage).toBe('preflop');
    // Heads-up: button=alice (seat 0), SB=alice, BB=bob, alice acts first preflop
    expect(s0.hand!.actorSeat).toBe(0);
    // Bets: alice=5 (SB), bob=10 (BB)
    expect(s0.seats[0]!.bet).toBe(5);
    expect(s0.seats[1]!.bet).toBe(10);
    expect(s0.hand!.currentBet).toBe(10);

    // alice calls (puts in 5 more), bob checks → flop
    const s1 = apply(s0,
      { type: 'PLAYER_ACTION', userId: 'alice', action: { type: 'call' }, nowMs: 6 },
      { type: 'PLAYER_ACTION', userId: 'bob', action: { type: 'check' }, nowMs: 7 },
    );
    expect(s1.hand!.stage).toBe('flop');
    expect(s1.hand!.board).toHaveLength(3);
    expect(s1.hand!.currentBet).toBe(0);
    // Heads-up postflop: BB acts first = bob (seat 1)
    expect(s1.hand!.actorSeat).toBe(1);

    // both check flop
    const s2 = apply(s1,
      { type: 'PLAYER_ACTION', userId: 'bob', action: { type: 'check' }, nowMs: 8 },
      { type: 'PLAYER_ACTION', userId: 'alice', action: { type: 'check' }, nowMs: 9 },
    );
    expect(s2.hand!.stage).toBe('turn');
    expect(s2.hand!.board).toHaveLength(4);

    // both check turn
    const s3 = apply(s2,
      { type: 'PLAYER_ACTION', userId: 'bob', action: { type: 'check' }, nowMs: 10 },
      { type: 'PLAYER_ACTION', userId: 'alice', action: { type: 'check' }, nowMs: 11 },
    );
    expect(s3.hand!.stage).toBe('river');
    expect(s3.hand!.board).toHaveLength(5);

    // both check river → showdown
    const s4 = apply(s3,
      { type: 'PLAYER_ACTION', userId: 'bob', action: { type: 'check' }, nowMs: 12 },
      { type: 'PLAYER_ACTION', userId: 'alice', action: { type: 'check' }, nowMs: 13 },
    );

    // After showdown: hand cleared, revealed seed pushed
    expect(s4.hand).toBe(null);
    expect(s4.revealedSeeds).toHaveLength(1);
    expect(s4.revealedSeeds[0].handNo).toBe(1);
    expect(s4.revealedSeeds[0].serverSeed).toBe(SEED);

    // Total chip conservation: started 1000, ends 1000
    const finalTotal = s4.seats.reduce((sum, p) => sum + (p?.stack ?? 0), 0);
    expect(finalTotal).toBe(1000);
  });

  it('one player folds preflop → other wins immediately', () => {
    const s = apply(null,
      { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'alice', config: baseConfig, nowMs: 1 },
      { type: 'SIT_DOWN', userId: 'alice', seat: 0, buyIn: 500, nowMs: 2 },
      { type: 'SIT_DOWN', userId: 'bob', seat: 1, buyIn: 500, nowMs: 3 },
      { type: 'START_GAME', hostId: 'alice', nowMs: 4 },
      { type: 'BEGIN_HAND', serverSeed: SEED, nowMs: 5 },
      { type: 'PLAYER_ACTION', userId: 'alice', action: { type: 'fold' }, nowMs: 6 },
    );
    expect(s.hand).toBe(null);
    expect(s.revealedSeeds).toHaveLength(1);
    // bob (BB) gets alice's SB (5). alice: 500-5=495, bob: 500+5=505. Wait, blinds: alice was SB=5, bob BB=10.
    // alice folded, bob wins the 5+10=15 pot. bob already paid 10 BB → net +5.
    // alice: 500 - 5 = 495. bob: 500 - 10 + 15 = 505. Total = 1000.
    const total = s.seats.reduce((sum, p) => sum + (p?.stack ?? 0), 0);
    expect(total).toBe(1000);
    expect(s.seats[0]!.stack).toBe(495);
    expect(s.seats[1]!.stack).toBe(505);
  });
});

describe('table-state — squid mode', () => {
  it('initializes squid panel when sitting down with squidMode=true', () => {
    const cfg = { ...baseConfig, squidMode: true };
    const s = apply(null,
      { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'h', config: cfg, nowMs: 1 },
      { type: 'SIT_DOWN', userId: 'a', seat: 0, buyIn: 500, nowMs: 2 },
      { type: 'SIT_DOWN', userId: 'b', seat: 1, buyIn: 500, nowMs: 3 },
      { type: 'SIT_DOWN', userId: 'c', seat: 2, buyIn: 500, nowMs: 4 },
    );
    expect(s.squid).not.toBe(null);
    expect(s.squid!.totalSquids).toBe(2); // N - 1
    expect(s.squid!.holders).toHaveLength(3);
  });

  it('null squid when only 1 player', () => {
    const cfg = { ...baseConfig, squidMode: true };
    const s = apply(null,
      { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'h', config: cfg, nowMs: 1 },
      { type: 'SIT_DOWN', userId: 'a', seat: 0, buyIn: 500, nowMs: 2 },
    );
    expect(s.squid).toBe(null);
  });

  it('player leaves → squid resets', () => {
    const cfg = { ...baseConfig, squidMode: true };
    const s = apply(null,
      { type: 'CREATE_TABLE', tableId: 't1', shortCode: 'ABC', hostId: 'h', config: cfg, nowMs: 1 },
      { type: 'SIT_DOWN', userId: 'a', seat: 0, buyIn: 500, nowMs: 2 },
      { type: 'SIT_DOWN', userId: 'b', seat: 1, buyIn: 500, nowMs: 3 },
      { type: 'SIT_DOWN', userId: 'c', seat: 2, buyIn: 500, nowMs: 4 },
      { type: 'STAND_UP', userId: 'b', nowMs: 5 },
    );
    expect(s.squid!.totalSquids).toBe(1); // 2 players → 1 squid
    expect(s.squid!.holders).toHaveLength(2);
    expect(s.squid!.pendingCarryOver).toBe(0); // reset
  });
});

void SEED2; // referenced for future hand-2 tests
