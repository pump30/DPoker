import { describe, it, expect } from 'vitest';
import {
  validateAction,
  applyAction,
  getNextActor,
  isBettingRoundClosed,
  activePlayers,
  startNewStreet,
  type BettingState,
} from '@server/game/betting.js';

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

describe('betting.getNextActor', () => {
  it('returns next seat in order', () => {
    const s = makeState({ actorId: 'a' });
    expect(getNextActor(s)).toBe('b');
  });

  it('wraps around the table', () => {
    const s = makeState({ actorId: 'c' });
    expect(getNextActor(s)).toBe('a');
  });

  it('skips folded and all-in players, wraps back to current if alone', () => {
    // a is actor, b folded, c all-in. Next actor wraps back to a (a is the only
    // one able to act). isBettingRoundClosed handles termination separately.
    const s = makeState({ actorId: 'a' });
    s.players[1].folded = true;
    s.players[2].allIn = true;
    expect(getNextActor(s)).toBe('a');
  });

  it('returns null when nobody can act anymore', () => {
    const s = makeState({ actorId: 'a' });
    for (const p of s.players) p.folded = true; // unreachable in real game but exercise the branch
    expect(getNextActor(s)).toBe(null);
  });

  it('returns null when everyone has acted and matched currentBet', () => {
    const s = makeState({ actorId: 'c', currentBet: 50 });
    for (const p of s.players) {
      p.hasActed = true;
      p.bet = 50;
    }
    expect(getNextActor(s)).toBe(null);
  });

  it('finds player who has not acted yet', () => {
    const s = makeState({ actorId: 'a', currentBet: 50 });
    s.players[1].hasActed = true;
    s.players[1].bet = 50;
    s.players[2].hasActed = false;
    expect(getNextActor(s)).toBe('c');
  });

  it('finds player who has acted but bet is below currentBet', () => {
    // Triggered when raise reopens action — others were marked hasActed=false earlier
    // but here we test the bet < currentBet branch directly.
    const s = makeState({ actorId: 'a', currentBet: 100 });
    s.players[1].hasActed = true;
    s.players[1].bet = 50; // hasn't matched currentBet
    s.players[2].hasActed = true;
    s.players[2].bet = 100;
    expect(getNextActor(s)).toBe('b');
  });
});

describe('betting.isBettingRoundClosed', () => {
  it('false when actor has not acted yet', () => {
    expect(isBettingRoundClosed(makeState())).toBe(false);
  });

  it('true when all active players have acted and matched currentBet', () => {
    const s = makeState({ currentBet: 50 });
    for (const p of s.players) {
      p.hasActed = true;
      p.bet = 50;
    }
    expect(isBettingRoundClosed(s)).toBe(true);
  });

  it('false when one active player has not matched currentBet', () => {
    const s = makeState({ currentBet: 50 });
    for (const p of s.players) {
      p.hasActed = true;
      p.bet = 50;
    }
    s.players[1].bet = 30;
    s.players[1].hasActed = false; // raise reopened
    expect(isBettingRoundClosed(s)).toBe(false);
  });

  it('true when all but one folded', () => {
    const s = makeState();
    s.players[0].folded = true;
    s.players[1].folded = true;
    expect(isBettingRoundClosed(s)).toBe(true);
  });

  it('true when all remaining are all-in', () => {
    const s = makeState();
    for (const p of s.players) p.allIn = true;
    expect(isBettingRoundClosed(s)).toBe(true);
  });
});

describe('betting.activePlayers', () => {
  it('returns non-folded players (including all-in)', () => {
    const s = makeState();
    s.players[0].folded = true;
    s.players[2].allIn = true;
    const ids = activePlayers(s).map((p) => p.id);
    expect(ids).toEqual(['b', 'c']);
  });
});

describe('betting.startNewStreet', () => {
  it('resets bets and currentBet, keeps stacks, sets new actor', () => {
    const s = makeState({ currentBet: 50, minRaise: 50 });
    for (const p of s.players) {
      p.bet = 50;
      p.hasActed = true;
      p.stack = 950;
    }
    const ns = startNewStreet(s, 'b');
    expect(ns.currentBet).toBe(0);
    expect(ns.minRaise).toBe(20);
    expect(ns.lastRaiseAmount).toBe(0);
    expect(ns.actorId).toBe('b');
    for (const p of ns.players) {
      expect(p.bet).toBe(0);
      expect(p.hasActed).toBe(false);
      expect(p.stack).toBe(950);
    }
  });

  it('keeps folded and all-in players marked hasActed (skip them)', () => {
    const s = makeState();
    s.players[0].folded = true;
    s.players[1].allIn = true;
    const ns = startNewStreet(s, 'c');
    expect(ns.players[0].hasActed).toBe(true);
    expect(ns.players[1].hasActed).toBe(true);
    expect(ns.players[2].hasActed).toBe(false);
  });
});
