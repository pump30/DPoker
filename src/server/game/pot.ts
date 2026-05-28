import type { Pot, Card } from '../../shared/game-types.js';
import { compareWinners, type PlayerCards } from './hand-evaluator.js';

export type Contribution = {
  id: string;
  amount: number;
  folded: boolean;
};

/**
 * Layered side-pot split.
 *
 * Algorithm:
 *  1. Collect distinct positive amounts in ascending order (level set).
 *  2. For each level L, the layer height is (L - prevL).
 *     Contribution to that pot = layerHeight * (#players whose total >= L).
 *     Eligible ids = active (not folded) players whose total >= L.
 *  3. Folded players' chips are still added (they were paid in) but they
 *     are not eligible to win. If at some level no eligible players
 *     remain at that band, the chips carry forward and attach to the
 *     next pot that does have eligibles. If no eligible-band ever exists,
 *     they attach to the previous pot.
 *
 * Invariant: sum of returned pot amounts equals sum of input contributions.
 * If every contributor is folded (degenerate input), throws — the caller
 * should have ended the hand before invoking pot split.
 */
export function splitIntoPots(contribs: readonly Contribution[]): Pot[] {
  const positive = contribs.filter((c) => c.amount > 0);
  if (positive.length === 0) return [];

  if (positive.every((c) => c.folded)) {
    throw new Error('cannot split pot: all contributors folded');
  }

  const levels = [...new Set(positive.map((c) => c.amount))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prev = 0;
  let carry = 0;

  for (const level of levels) {
    const layerHeight = level - prev;
    const contribsAtOrAbove = positive.filter((c) => c.amount >= level);
    const amount = layerHeight * contribsAtOrAbove.length;
    const eligibleIds = contribsAtOrAbove
      .filter((c) => !c.folded)
      .map((c) => c.id);

    if (amount > 0) {
      if (eligibleIds.length > 0) {
        pots.push({ amount: amount + carry, eligibleIds });
        carry = 0;
      } else {
        // No eligibles at this band — defer.
        carry += amount;
      }
    }
    prev = level;
  }

  if (carry > 0) {
    if (pots.length > 0) {
      pots[pots.length - 1].amount += carry;
    } else {
      // Unreachable given the all-folded guard above.
      throw new Error('pot split internal error: chips orphaned');
    }
  }

  return pots;
}

export type PotAward = {
  potIndex: number;
  amount: number;
  winnerIds: string[];
  share: number;         // amount / winnerIds.length, rounded down
  remainder: number;     // any leftover chips (odd-chip rule)
};

/**
 * Award all pots to winners based on each pot's eligibleIds.
 *
 * For each pot in main→side order, run compareWinners over only the
 * players whose ids appear in eligibleIds. Distribute the pot's amount
 * equally among those winners; report any indivisible remainder.
 *
 * Caller is responsible for assigning the remainder per house convention
 * (typically: first active player to dealer's left).
 */
export function awardPots(
  pots: readonly Pot[],
  players: readonly PlayerCards[],
  board: readonly Card[],
): PotAward[] {
  const awards: PotAward[] = [];
  for (let i = 0; i < pots.length; i++) {
    const pot = pots[i];
    const eligible = players.filter((p) => pot.eligibleIds.includes(p.id));
    if (eligible.length === 0) continue;
    if (eligible.length === 1) {
      awards.push({
        potIndex: i,
        amount: pot.amount,
        winnerIds: [eligible[0].id],
        share: pot.amount,
        remainder: 0,
      });
      continue;
    }
    const winners = compareWinners(eligible, board);
    const winnerIds = winners.map((w) => w.id);
    const share = Math.floor(pot.amount / winnerIds.length);
    const remainder = pot.amount - share * winnerIds.length;
    awards.push({
      potIndex: i,
      amount: pot.amount,
      winnerIds,
      share,
      remainder,
    });
  }
  return awards;
}
