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

export function runRemainder(input: RunoutInput): RunoutResult {
  const seq = STAGES_TO_DEAL[input.currentBoard.length];
  if (!seq) throw new Error(`unsupported board length ${input.currentBoard.length}`);

  const boards: Card[][] = [];
  let cursor = 0;
  const n = seq.length;

  for (let r = 0; r < input.runs; r++) {
    const board = [...input.currentBoard];
    for (let i = 0; i < n; i++) {
      const step = seq[i];
      // Middle stages (indices 1..n-2) accumulate one extra burn per additional run
      // to maintain deck separation between concurrent run streams.
      const extraBurn = i >= 1 && i <= n - 2 ? r : 0;
      cursor += step.burn + extraBurn;
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
