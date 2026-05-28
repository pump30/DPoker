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
});
