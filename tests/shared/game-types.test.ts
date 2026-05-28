import { describe, it, expect } from 'vitest';
import { ALL_RANKS, ALL_SUITS, type Card } from '@shared/game-types.js';

describe('game-types', () => {
  it('has 13 ranks and 4 suits', () => {
    expect(ALL_RANKS).toHaveLength(13);
    expect(ALL_SUITS).toHaveLength(4);
  });

  it('Card type is Rank+Suit', () => {
    const card: Card = 'Ah';
    expect(card).toBe('Ah');
  });
});
