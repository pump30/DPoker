import type { Pot } from '../../shared/game-types.js';

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
 *     are not eligible to win. If at some level NO eligible players
 *     remain (all in that band folded), attach those chips to the
 *     previous pot to avoid orphaning.
 */
export function splitIntoPots(contribs: readonly Contribution[]): Pot[] {
  const positive = contribs.filter((c) => c.amount > 0);
  if (positive.length === 0) return [];

  const levels = [...new Set(positive.map((c) => c.amount))].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const layerHeight = level - prev;
    const contribsAtOrAbove = positive.filter((c) => c.amount >= level);
    const amount = layerHeight * contribsAtOrAbove.length;
    const eligibleIds = contribsAtOrAbove
      .filter((c) => !c.folded)
      .map((c) => c.id);
    if (amount > 0 && eligibleIds.length > 0) {
      pots.push({ amount, eligibleIds });
    } else if (amount > 0 && eligibleIds.length === 0) {
      if (pots.length > 0) {
        pots[pots.length - 1].amount += amount;
      }
    }
    prev = level;
  }
  return pots;
}
