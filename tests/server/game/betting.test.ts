import { describe, it, expect } from 'vitest';
import { validateAction, applyAction, type BettingState } from '@server/game/betting.js';

function makeState(overrides: Partial<BettingState> = {}): BettingState {
  return {
    players: [
      { id: 'a', stack: 1000, bet: 0, folded: false, allIn: false, hasActed: false },
      { id: 'b', stack: 1000, bet: 0, folded: false, allIn: false, hasActed: false },
      { id: 'c', stack: 1000, bet: 0, folded: false, allIn: false, hasActed: false },
    ],
    bigBlind: 20,
    currentBet: 0,
    minRaise: 20,
    lastRaiseAmount: 0,
    actorId: 'a',
    ...overrides,
  };
}

describe('betting.validateAction', () => {
  it('check is OK when no current bet', () => {
    const r = validateAction(makeState(), { type: 'check' });
    expect(r.ok).toBe(true);
  });

  it('check is illegal when there is a bet to call', () => {
    const r = validateAction(makeState({ currentBet: 50 }), { type: 'check' });
    expect(r.ok).toBe(false);
  });

  it('call is OK when there is a bet', () => {
    const r = validateAction(makeState({ currentBet: 50 }), { type: 'call' });
    expect(r.ok).toBe(true);
  });

  it('raise must be at least minRaise above currentBet', () => {
    const s = makeState({ currentBet: 50, minRaise: 50 });
    expect(validateAction(s, { type: 'raise', amount: 99 }).ok).toBe(false);
    expect(validateAction(s, { type: 'raise', amount: 100 }).ok).toBe(true);
  });

  it('raise above stack is rejected (must use all-in)', () => {
    const s = makeState();
    s.players[0].stack = 50;
    expect(validateAction(s, { type: 'raise', amount: 100 }).ok).toBe(false);
  });

  it('all-in is always legal if stack > 0', () => {
    expect(validateAction(makeState(), { type: 'all-in' }).ok).toBe(true);
  });

  it('fold is always legal', () => {
    expect(validateAction(makeState(), { type: 'fold' }).ok).toBe(true);
  });
});

describe('betting.applyAction', () => {
  it('fold marks player folded and ends their turn', () => {
    const s = makeState();
    const ns = applyAction(s, { type: 'fold' });
    const a = ns.players.find((p) => p.id === 'a')!;
    expect(a.folded).toBe(true);
    expect(a.hasActed).toBe(true);
  });

  it('call sets bet to currentBet', () => {
    const s = makeState({ currentBet: 50 });
    const ns = applyAction(s, { type: 'call' });
    const a = ns.players.find((p) => p.id === 'a')!;
    expect(a.bet).toBe(50);
    expect(a.stack).toBe(950);
    expect(a.hasActed).toBe(true);
  });

  it('raise updates currentBet and minRaise; resets others hasActed', () => {
    const s = makeState({ currentBet: 50, minRaise: 50, lastRaiseAmount: 50 });
    s.players[1].hasActed = true;
    const ns = applyAction(s, { type: 'raise', amount: 150 });
    expect(ns.currentBet).toBe(150);
    expect(ns.minRaise).toBe(100); // raise increment
    expect(ns.lastRaiseAmount).toBe(100);
    expect(ns.players.find((p) => p.id === 'b')!.hasActed).toBe(false);
  });

  it('partial all-in (less than min-raise) does NOT reopen action', () => {
    const s = makeState({ currentBet: 100, minRaise: 100, lastRaiseAmount: 100 });
    s.players[0].stack = 150;
    s.players[1].hasActed = true;
    const ns = applyAction(s, { type: 'all-in' });
    const a = ns.players.find((p) => p.id === 'a')!;
    expect(a.allIn).toBe(true);
    expect(a.bet).toBe(150);
    expect(a.stack).toBe(0);
    expect(ns.currentBet).toBe(150);
    expect(ns.lastRaiseAmount).toBe(100);
    expect(ns.players.find((p) => p.id === 'b')!.hasActed).toBe(true);
  });

  it('full all-in (>= min-raise) reopens action', () => {
    const s = makeState({ currentBet: 100, minRaise: 100, lastRaiseAmount: 100 });
    s.players[0].stack = 300;
    s.players[1].hasActed = true;
    const ns = applyAction(s, { type: 'all-in' });
    expect(ns.currentBet).toBe(300);
    expect(ns.lastRaiseAmount).toBe(200);
    expect(ns.minRaise).toBe(200);
    expect(ns.players.find((p) => p.id === 'b')!.hasActed).toBe(false);
  });
});
