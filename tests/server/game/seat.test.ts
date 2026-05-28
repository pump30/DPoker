import { describe, it, expect } from 'vitest';
import {
  eligibleSeats,
  nextEligibleSeat,
  rotateButton,
  firstToAct,
  type SeatRing,
} from '@server/game/seat.js';
import type { SeatedPlayer } from '@shared/table-types.js';

function p(id: string, seat: number, joinedAtHand = 0, sittingOut = false): SeatedPlayer {
  return {
    userId: id,
    displayName: id,
    seat,
    stack: 1000,
    bet: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    sittingOut,
    joinedAtHand,
  };
}

function ring(n: number, players: Record<number, SeatedPlayer>): SeatRing {
  const r: SeatRing = Array(n).fill(null);
  for (const [seat, pl] of Object.entries(players)) r[+seat] = pl;
  return r;
}

describe('seat.eligibleSeats', () => {
  it('returns occupied seats with players not sitting out and joined', () => {
    const r = ring(6, { 0: p('a', 0), 2: p('b', 2), 5: p('c', 5, 0, true) });
    expect(eligibleSeats(r, 1)).toEqual([0, 2]);
  });

  it('excludes players who joined later than current hand', () => {
    const r = ring(4, { 0: p('a', 0, 0), 1: p('b', 1, 5) });
    expect(eligibleSeats(r, 3)).toEqual([0]);
    expect(eligibleSeats(r, 5)).toEqual([0, 1]);
  });
});

describe('seat.nextEligibleSeat', () => {
  it('wraps clockwise', () => {
    const r = ring(6, { 0: p('a', 0), 2: p('b', 2), 4: p('c', 4) });
    expect(nextEligibleSeat(r, 0, 1)).toBe(2);
    expect(nextEligibleSeat(r, 2, 1)).toBe(4);
    expect(nextEligibleSeat(r, 4, 1)).toBe(0);
  });
  it('returns null if no eligible', () => {
    const r = ring(4, { 0: p('a', 0, 0, true) });
    expect(nextEligibleSeat(r, 0, 1)).toBe(null);
  });
});

describe('seat.rotateButton — first hand', () => {
  it('multi-way: button=first, SB=second, BB=third', () => {
    const r = ring(6, { 0: p('a', 0), 2: p('b', 2), 4: p('c', 4) });
    const x = rotateButton(r, -1, -1, -1, 1);
    expect(x).toEqual({ buttonSeat: 0, sbSeat: 2, bbSeat: 4 });
  });
  it('heads-up first hand: button=first=SB; opponent=BB', () => {
    const r = ring(6, { 0: p('a', 0), 4: p('b', 4) });
    const x = rotateButton(r, -1, -1, -1, 1);
    expect(x).toEqual({ buttonSeat: 0, sbSeat: 0, bbSeat: 4 });
  });
});

describe('seat.rotateButton — multi-way dead button', () => {
  it('rotates clockwise when no one leaves', () => {
    const r = ring(6, { 0: p('a', 0), 2: p('b', 2), 4: p('c', 4) });
    // hand 1 had button=0, sb=2, bb=4. Hand 2:
    const x = rotateButton(r, 0, 2, 4, 2);
    expect(x).toEqual({ buttonSeat: 2, sbSeat: 4, bbSeat: 0 });
  });

  it('player left between hands → heads-up rules take over (no dead button)', () => {
    // Player at seat 2 left between hands. Now only 0 and 4 remain.
    const r = ring(6, { 0: p('a', 0), 4: p('c', 4) });
    const x = rotateButton(r, 0, 2, 4, 2);
    // With 2 players, heads-up rules: button rotates between the two.
    // Prev button was 0, so new button should be 4. SB=4 (button), BB=0.
    expect(x.buttonSeat).toBe(4);
    expect(x.sbSeat).toBe(4);
    expect(x.bbSeat).toBe(0);
  });

  it('dead button when 3+ remain and prev SB seat empty', () => {
    // Need 3 to stay multi-way. Hand1: a@0, b@2, c@4, d@5.
    // Hand1 button=0, sb=2, bb=4. Player at seat 2 leaves.
    const r = ring(6, { 0: p('a', 0), 4: p('c', 4), 5: p('d', 5) });
    const x = rotateButton(r, 0, 2, 4, 2);
    expect(x.buttonSeat).toBe(null); // dead button on empty seat 2
    expect(x.sbSeat).toBe(4);
    expect(x.bbSeat).toBe(5);
  });

  it('heads-up swaps button between two players', () => {
    const r = ring(6, { 0: p('a', 0), 4: p('b', 4) });
    const x = rotateButton(r, 0, 0, 4, 2); // hand 1 button=0
    expect(x.buttonSeat).toBe(4);
    expect(x.sbSeat).toBe(4);
    expect(x.bbSeat).toBe(0);
  });
});

describe('seat.firstToAct', () => {
  it('multi-way preflop: UTG = seat after BB', () => {
    const r = ring(6, { 0: p('a', 0), 2: p('b', 2), 4: p('c', 4) });
    expect(firstToAct(r, 0, 4, 'preflop', 1)).toBe(0); // BB at 4 → next is 0
  });
  it('multi-way postflop: first after button', () => {
    const r = ring(6, { 0: p('a', 0), 2: p('b', 2), 4: p('c', 4) });
    expect(firstToAct(r, 0, 4, 'postflop', 1)).toBe(2);
  });
  it('heads-up preflop: button (SB) acts first', () => {
    const r = ring(6, { 0: p('a', 0), 4: p('b', 4) });
    expect(firstToAct(r, 0, 4, 'preflop', 1)).toBe(0);
  });
  it('heads-up postflop: BB (non-button) acts first', () => {
    const r = ring(6, { 0: p('a', 0), 4: p('b', 4) });
    expect(firstToAct(r, 0, 4, 'postflop', 1)).toBe(4);
  });
});
