import { describe, it, expect } from 'vitest';
import {
  newSquidRound,
  distributeSquid,
  isRoundComplete,
  settleRound,
  resetForRoster,
  type SquidRoundState,
  type HandOutcome,
} from '@server/game/squid-round.js';

const POINTS = 10;

function freshRound(playerIds: string[]): SquidRoundState {
  return newSquidRound(playerIds, POINTS);
}

const win = (id: string): HandOutcome => ({ kind: 'single-winner', winnerId: id });
const split = (ids: string[]): HandOutcome => ({ kind: 'split', winnerIds: ids });

describe('squid-round', () => {
  it('newSquidRound: totalSquids = N - 1', () => {
    const r = freshRound(['a', 'b', 'c', 'd']);
    expect(r.totalSquids).toBe(3);
    expect(r.holders.size).toBe(0);
    expect(r.pendingCarryOver).toBe(0);
  });

  it('single winner with no held squids gets one squid', () => {
    let r = freshRound(['a', 'b', 'c']); // total 2 squids
    r = distributeSquid(r, win('a'));
    expect(r.holders.get('a')).toBe(1);
    expect(r.pendingCarryOver).toBe(0);
  });

  it('split pot carries over the squid to next hand', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, split(['a', 'b']));
    expect(r.holders.size).toBe(0);
    expect(r.pendingCarryOver).toBe(1);
  });

  it('next hand after split awards 1 squid to single winner; carryover decrements', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, split(['a', 'b'])); // pending=1
    r = distributeSquid(r, win('c'));
    expect(r.holders.get('c')).toBe(1);
    expect(r.pendingCarryOver).toBe(1); // toAward=2 minus 1 awarded = 1 carried
  });

  it('winner who already holds a squid → squid carried over', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, win('a'));     // a holds 1
    r = distributeSquid(r, win('a'));     // a already has, carry
    expect(r.holders.get('a')).toBe(1);
    expect(r.pendingCarryOver).toBe(1);
  });

  it('isRoundComplete when N-1 unique holders', () => {
    let r = freshRound(['a', 'b', 'c']);
    expect(isRoundComplete(r)).toBe(false);
    r = distributeSquid(r, win('a'));
    expect(isRoundComplete(r)).toBe(false);
    r = distributeSquid(r, win('b'));
    expect(isRoundComplete(r)).toBe(true); // 2 squids = N-1
  });

  it('settleRound: loser pays POINTS to each holder', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, win('a'));
    r = distributeSquid(r, win('b'));
    const settlement = settleRound(r);
    expect(settlement.loserId).toBe('c');
    expect(settlement.payouts).toEqual([
      { playerId: 'a', delta: POINTS },
      { playerId: 'b', delta: POINTS },
      { playerId: 'c', delta: -POINTS * 2 },
    ]);
  });

  it('settleRound throws if round not complete', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, win('a'));
    expect(() => settleRound(r)).toThrow();
  });

  it('resetForRoster recomputes totalSquids and clears state', () => {
    let r = freshRound(['a', 'b', 'c']);
    r = distributeSquid(r, win('a'));
    const reset = resetForRoster(r, ['a', 'b', 'c', 'd', 'e']);
    expect(reset.totalSquids).toBe(4);
    expect(reset.holders.size).toBe(0);
    expect(reset.pendingCarryOver).toBe(0);
  });
});
