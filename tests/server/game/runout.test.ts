import { describe, it, expect } from 'vitest';
import { runRemainder } from '@server/game/runout.js';
import type { Card } from '@shared/game-types.js';

const deck: Card[] = [
  '2c', '3c', '4c', '5c', '6c', '7c', '8c', '9c', 'Tc', 'Jc',
  'Qc', 'Kc', 'Ac', '2d', '3d', '4d', '5d',
];

describe('runout.runRemainder', () => {
  it('preflop runs 5-card board with 1 burn before flop, 1 before turn, 1 before river when count=1', () => {
    const r = runRemainder({ deck, currentBoard: [], runs: 1 });
    // expected board: skip burn at 0, take 1..3 (flop), skip burn at 4, take 5 (turn), skip burn at 6, take 7 (river)
    expect(r.boards).toEqual([['3c', '4c', '5c', '7c', '9c']]);
  });

  it('flop already dealt: turn/river have one burn each', () => {
    const r = runRemainder({
      deck,
      currentBoard: ['Ah', 'Kh', 'Qh'] as Card[],
      runs: 1,
    });
    // turn: skip burn at 0, take deck[1]; river: skip burn at 2, take deck[3]
    expect(r.boards).toEqual([['Ah', 'Kh', 'Qh', '3c', '5c']]);
  });

  it('runs=2 produces two distinct boards from same deck (river time)', () => {
    const r = runRemainder({
      deck,
      currentBoard: ['Ah', 'Kh', 'Qh', 'Jh'] as Card[],
      runs: 2,
    });
    // first run: burn deck[0], river deck[1]; second run: burn deck[2], river deck[3]
    expect(r.boards).toEqual([
      ['Ah', 'Kh', 'Qh', 'Jh', '3c'],
      ['Ah', 'Kh', 'Qh', 'Jh', '5c'],
    ]);
  });

  it('runs=2 at flop time: each run burns + flops + burns + turns + burns + rivers (separate streams)', () => {
    const r = runRemainder({ deck, currentBoard: [], runs: 2 });
    // run 1: burn 0, flop 1-3, burn 4, turn 5, burn 6, river 7
    // run 2: burn 8, flop 9-11, burn 12, turn 13, burn 14, river 15
    expect(r.boards[0]).toEqual(['3c', '4c', '5c', '7c', '9c']);
    expect(r.boards[1]).toEqual(['Jc', 'Qc', 'Kc', '3d', '5d']);
  });

  it('throws when not enough cards', () => {
    expect(() =>
      runRemainder({ deck: deck.slice(0, 2), currentBoard: [], runs: 1 }),
    ).toThrow();
  });
});
