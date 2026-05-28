import { createHash, randomBytes } from 'node:crypto';
import type { Card } from '../../shared/game-types.js';
import { freshDeck, shuffle } from './deck.js';

export function generateSeed(): Buffer {
  return randomBytes(32);
}

export function commitOf(seed: Buffer): string {
  return createHash('sha256').update(seed).digest('hex');
}

export function verifyCommit(seed: Buffer, expectedCommit: string): boolean {
  return commitOf(seed) === expectedCommit;
}

export function deriveDeck(seed: Buffer): Card[] {
  return shuffle(freshDeck(), seed);
}
