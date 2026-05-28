import { createHash } from 'node:crypto';
import { ALL_RANKS, ALL_SUITS, type Card } from '../../shared/game-types.js';

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of ALL_RANKS) {
    for (const s of ALL_SUITS) {
      deck.push(`${r}${s}` as Card);
    }
  }
  return deck;
}

/**
 * Shuffle using Fisher-Yates with a deterministic stream of integers
 * derived from the given seed via SHA-256(seed || counter). Returns a
 * NEW array; does not mutate input.
 *
 * The seed is exactly 32 bytes (the serverSeed of commit-reveal).
 */
export function shuffle(deck: readonly Card[], seed: Buffer): Card[] {
  if (seed.length !== 32) {
    throw new Error('seed must be 32 bytes');
  }
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const r = nextInt(seed, i, i + 1); // [0, i]
    const tmp = out[i];
    out[i] = out[r];
    out[r] = tmp;
  }
  return out;
}

/**
 * Return an integer in [0, max) sampled deterministically from
 * sha256(seed || counter).
 *
 * Uses rejection sampling to avoid modulo bias:
 *   threshold = 2^32 - (2^32 % max)
 *   keep first 4-byte chunk < threshold, mod max
 */
function nextInt(seed: Buffer, counter: number, max: number): number {
  if (max <= 0) throw new Error('max must be > 0');
  if (max === 1) return 0;
  const threshold = Math.floor(0x100000000 / max) * max;
  let attempt = 0;
  while (true) {
    const h = createHash('sha256');
    h.update(seed);
    h.update(Buffer.from(`${counter}-${attempt}`, 'utf8'));
    const digest = h.digest();
    // Each digest is 32 bytes = 8 4-byte chunks
    for (let off = 0; off + 4 <= digest.length; off += 4) {
      const v = digest.readUInt32BE(off);
      if (v < threshold) return v % max;
    }
    attempt++;
  }
}

/**
 * Deal N cards off the top of the deck. Returns dealt + remaining.
 */
export function deal(deck: readonly Card[], n: number): { dealt: Card[]; remaining: Card[] } {
  if (n > deck.length) throw new Error('not enough cards to deal');
  return {
    dealt: deck.slice(0, n),
    remaining: deck.slice(n),
  };
}
