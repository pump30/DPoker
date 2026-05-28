import pkg from 'pokersolver';
const { Hand } = pkg;
import type { Card } from '../../shared/game-types.js';

export type HandResult = {
  rankName: string;
  description: string;
};

export type PlayerCards = {
  id: string;
  hole: [Card, Card];
};

export function evaluateHand(hole: [Card, Card], board: Card[]): HandResult {
  const all = [...hole, ...board];
  const h = Hand.solve(all);
  return { rankName: h.name, description: h.descr };
}

/**
 * Given player hole cards and a 5-card board, return the winning player records.
 * Multiple results = split pot.
 */
export function compareWinners(
  players: readonly PlayerCards[],
  board: readonly Card[],
): PlayerCards[] {
  if (board.length !== 5) {
    throw new Error('board must contain exactly 5 cards');
  }
  const hands = players.map((p) => ({
    player: p,
    hand: Hand.solve([...p.hole, ...board]),
  }));
  const winningHands = Hand.winners(hands.map((h) => h.hand));
  return hands.filter((h) => winningHands.includes(h.hand)).map((h) => h.player);
}
