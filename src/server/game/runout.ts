import type { Card } from '../../shared/game-types.js';

export type RunoutInput = {
  deck: readonly Card[];   // remaining deck (after holes already dealt)
  currentBoard: readonly Card[]; // 0, 3, or 4 cards
  runs: 1 | 2;
};

export type RunoutResult = {
  boards: Card[][]; // length === runs; each is the full 5-card board
};

const STAGES_TO_DEAL: Record<number, { burn: number; reveal: number }[]> = {
  0: [
    { burn: 1, reveal: 3 }, // flop
    { burn: 1, reveal: 1 }, // turn
    { burn: 1, reveal: 1 }, // river
  ],
  3: [
    { burn: 1, reveal: 1 }, // turn
    { burn: 1, reveal: 1 }, // river
  ],
  4: [
    { burn: 1, reveal: 1 }, // river
  ],
};

/**
 * Run-it-twice strategy: sequential cursor — run 1 walks burn/reveal steps
 * starting at deck[0], run 2 continues from where run 1 left off (no shared
 * burns, no shared reveals). Each run gets its own fresh burn cards. This is
 * one of several casino conventions for RIT; we adopt it because it is
 * deterministic, fully replayable from the commit-reveal seed (spec §12.10),
 * and keeps the deck cursor monotonically increasing for audit clarity.
 *
 * Other conventions (shared burns, alternating reveals) would also be fair
 * given commit-reveal; this one was chosen for simplicity.
 */
export function runRemainder(input: RunoutInput): RunoutResult {
  const seq = STAGES_TO_DEAL[input.currentBoard.length];
  if (!seq) throw new Error(`unsupported board length ${input.currentBoard.length}`);

  const boards: Card[][] = [];
  let cursor = 0;

  for (let r = 0; r < input.runs; r++) {
    const board = [...input.currentBoard];
    for (const step of seq) {
      cursor += step.burn;
      if (cursor + step.reveal > input.deck.length) {
        throw new Error('not enough cards for runout');
      }
      board.push(...(input.deck.slice(cursor, cursor + step.reveal) as Card[]));
      cursor += step.reveal;
    }
    boards.push(board);
  }

  return { boards };
}
