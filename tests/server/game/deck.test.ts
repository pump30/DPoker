import { describe, it, expect } from 'vitest';
import { freshDeck, shuffle, deal } from '@server/game/deck.js';
import type { Card } from '@shared/game-types.js';

describe('deck', () => {
  it('freshDeck returns 52 unique cards', () => {
    const d = freshDeck();
    expect(d).toHaveLength(52);
    expect(new Set(d).size).toBe(52);
  });

  it('shuffle with same seed is deterministic', () => {
    const seed = Buffer.from('a'.repeat(64), 'hex'); // 32 bytes
    const a = shuffle(freshDeck(), seed);
    const b = shuffle(freshDeck(), seed);
    expect(a).toEqual(b);
  });

  it('shuffle with different seeds differs', () => {
    const a = shuffle(freshDeck(), Buffer.from('a'.repeat(64), 'hex'));
    const b = shuffle(freshDeck(), Buffer.from('b'.repeat(64), 'hex'));
    expect(a).not.toEqual(b);
  });

  it('shuffled deck is a permutation', () => {
    const original = freshDeck();
    const shuffled = shuffle(original, Buffer.from('c'.repeat(64), 'hex'));
    expect(new Set(shuffled)).toEqual(new Set(original));
    expect(shuffled).toHaveLength(52);
  });

  it('deal pops top N cards and returns updated remaining', () => {
    const d: Card[] = ['Ah', 'Kd', 'Qc', 'Js', 'Th'];
    const { dealt, remaining } = deal(d, 3);
    expect(dealt).toEqual(['Ah', 'Kd', 'Qc']);
    expect(remaining).toEqual(['Js', 'Th']);
  });

  it('deal throws if not enough cards', () => {
    expect(() => deal(['Ah' as Card], 2)).toThrow();
  });

  it('shuffle does not mutate input', () => {
    const original = freshDeck();
    const copy = [...original];
    shuffle(original, Buffer.from('d'.repeat(64), 'hex'));
    expect(original).toEqual(copy);
  });
});
