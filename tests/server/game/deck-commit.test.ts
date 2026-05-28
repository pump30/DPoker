import { describe, it, expect } from 'vitest';
import { generateSeed, commitOf, verifyCommit, deriveDeck } from '@server/game/deck-commit.js';
import { shuffle, freshDeck } from '@server/game/deck.js';

describe('deck-commit', () => {
  it('generateSeed returns 32-byte buffer', () => {
    const s = generateSeed();
    expect(s.length).toBe(32);
  });

  it('commitOf is deterministic', () => {
    const seed = Buffer.from('a'.repeat(64), 'hex');
    expect(commitOf(seed)).toBe(commitOf(seed));
  });

  it('commitOf produces 64-hex-char string (sha256)', () => {
    const seed = Buffer.from('a'.repeat(64), 'hex');
    expect(commitOf(seed)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyCommit accepts matching seed/commit', () => {
    const seed = generateSeed();
    const commit = commitOf(seed);
    expect(verifyCommit(seed, commit)).toBe(true);
  });

  it('verifyCommit rejects tampered seed', () => {
    const seed = generateSeed();
    const commit = commitOf(seed);
    const tampered = Buffer.from(seed);
    tampered[0] ^= 0xff;
    expect(verifyCommit(tampered, commit)).toBe(false);
  });

  it('deriveDeck shuffles using the seed (matches direct shuffle)', () => {
    const seed = Buffer.from('e'.repeat(64), 'hex');
    expect(deriveDeck(seed)).toEqual(shuffle(freshDeck(), seed));
  });
});
