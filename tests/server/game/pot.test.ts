import { describe, it, expect } from 'vitest';
import { splitIntoPots, type Contribution } from '@server/game/pot.js';

describe('pot.splitIntoPots', () => {
  it('single pot when all bet equal and none folded', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 100, folded: false },
      { id: 'b', amount: 100, folded: false },
      { id: 'c', amount: 100, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(new Set(pots[0].eligibleIds)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('side pot for one all-in short', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 200, folded: false },
      { id: 'c', amount: 200, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toEqual([
      { amount: 150, eligibleIds: expect.arrayContaining(['a', 'b', 'c']) },
      { amount: 300, eligibleIds: expect.arrayContaining(['b', 'c']) },
    ]);
  });

  it('three layers when two all-ins of different sizes', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 100, folded: false },
      { id: 'c', amount: 200, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toHaveLength(3);
    expect(pots[0]).toEqual({ amount: 150, eligibleIds: expect.arrayContaining(['a', 'b', 'c']) });
    expect(pots[1]).toEqual({ amount: 100, eligibleIds: expect.arrayContaining(['b', 'c']) });
    expect(pots[2]).toEqual({ amount: 100, eligibleIds: ['c'] });
  });

  it('folded player chips contribute but they are not eligible', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 100, folded: true },
      { id: 'b', amount: 100, folded: false },
      { id: 'c', amount: 100, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toHaveLength(1);
    expect(pots[0].amount).toBe(300);
    expect(new Set(pots[0].eligibleIds)).toEqual(new Set(['b', 'c']));
  });

  it('multiple players same all-in amount merge', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 50, folded: false },
      { id: 'b', amount: 50, folded: false },
      { id: 'c', amount: 200, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toHaveLength(2);
    expect(pots[0]).toEqual({ amount: 150, eligibleIds: expect.arrayContaining(['a', 'b', 'c']) });
    expect(pots[1]).toEqual({ amount: 150, eligibleIds: ['c'] });
  });

  it('zero contribution is ignored', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 0, folded: false },
      { id: 'b', amount: 100, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    expect(pots).toEqual([{ amount: 100, eligibleIds: ['b'] }]);
  });

  it('top-band-only-folded: chips merge into the prior pot (chip conservation)', () => {
    // a folded all-in at 50; b active at 100. Top band (50..100) is funded
    // only by b but a is below it, so b alone occupies layer 2 with eligibles=[b].
    // Prior test already covers this flow. Verify chip conservation:
    const contribs: Contribution[] = [
      { id: 'a', amount: 50, folded: true },
      { id: 'b', amount: 100, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    const total = pots.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(150);
    // pot 0: 50*2=100, eligibleIds=[b only since a folded]
    // pot 1: 50*1=50, eligibleIds=[b]
    expect(pots).toEqual([
      { amount: 100, eligibleIds: ['b'] },
      { amount: 50, eligibleIds: ['b'] },
    ]);
  });

  it('throws when all contributors folded', () => {
    const contribs: Contribution[] = [
      { id: 'a', amount: 50, folded: true },
      { id: 'b', amount: 100, folded: true },
    ];
    expect(() => splitIntoPots(contribs)).toThrow(/all contributors folded/);
  });

  it('mid-layer all-folded chips carry to next eligible pot (chip conservation)', () => {
    // a folded at 50, b folded at 100, c active at 200.
    // Layer 50: 50*3=150, eligibleIds=[c]   → push pot 150 [c]
    // Layer 100: 50*2=100 (a,b,c at >=100? a's 50<100 no, only b and c). Wait: at level 100 contribsAtOrAbove are those with amount>=100, so b(100) and c(200) → 2. layerHeight 50. amount=100. eligible=[c only]. → push pot 100 [c]
    // Layer 200: 100*1=100, eligible=[c]   → push pot 100 [c]
    // Total = 350, sum of contribs = 50+100+200 = 350. ✓
    const contribs: Contribution[] = [
      { id: 'a', amount: 50, folded: true },
      { id: 'b', amount: 100, folded: true },
      { id: 'c', amount: 200, folded: false },
    ];
    const pots = splitIntoPots(contribs);
    const total = pots.reduce((s, p) => s + p.amount, 0);
    expect(total).toBe(350);
    pots.forEach((p) => expect(p.eligibleIds).toEqual(['c']));
  });
});
