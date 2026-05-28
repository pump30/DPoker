import { describe, it, expect } from 'vitest';
import { evaluateHand, compareWinners, type HandResult } from '@server/game/hand-evaluator.js';
import type { Card } from '@shared/game-types.js';

describe('hand-evaluator', () => {
  it('evaluates a flush', () => {
    const hole: [Card, Card] = ['Ah', 'Kh'];
    const board: Card[] = ['2h', '7h', 'Th', '5d', '3c'];
    const r: HandResult = evaluateHand(hole, board);
    expect(r.rankName.toLowerCase()).toContain('flush');
  });

  it('evaluates a pair', () => {
    const r = evaluateHand(['Ah', 'As'], ['2c', '5d', '7h', 'Tc', 'Ks']);
    expect(r.rankName.toLowerCase()).toContain('pair');
  });

  it('compareWinners picks the better hand', () => {
    const board: Card[] = ['As', 'Kh', 'Qd', 'Jc', '2h'];
    const players = [
      { id: 'p1', hole: ['Td', '9c'] as [Card, Card] }, // straight A-T
      { id: 'p2', hole: ['9s', '9d'] as [Card, Card] }, // pair of 9s
    ];
    const winners = compareWinners(players, board);
    expect(winners.map((w) => w.id)).toEqual(['p1']);
  });

  it('compareWinners returns multiple ids for split pot', () => {
    const board: Card[] = ['Ah', 'Kd', 'Qc', 'Js', 'Th'];
    const players = [
      { id: 'p1', hole: ['2c', '3d'] as [Card, Card] },
      { id: 'p2', hole: ['4c', '5d'] as [Card, Card] },
    ];
    // Both play the board straight A-T → split
    const winners = compareWinners(players, board);
    expect(new Set(winners.map((w) => w.id))).toEqual(new Set(['p1', 'p2']));
  });
});
