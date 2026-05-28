import { describe, it, expect } from 'vitest';
import { resolveRunoutVotes, type Vote } from '@server/game/runout-vote.js';

describe('runout-vote.resolveRunoutVotes', () => {
  it('all vote 2 → 2', () => {
    const votes: Vote[] = [
      { playerId: 'a', choice: 2 },
      { playerId: 'b', choice: 2 },
    ];
    expect(resolveRunoutVotes(votes, 2)).toBe(2);
  });

  it('any vote of 1 → 1', () => {
    const votes: Vote[] = [
      { playerId: 'a', choice: 2 },
      { playerId: 'b', choice: 1 },
    ];
    expect(resolveRunoutVotes(votes, 2)).toBe(1);
  });

  it('no votes → defaultCount', () => {
    expect(resolveRunoutVotes([], 2)).toBe(2);
    expect(resolveRunoutVotes([], 1)).toBe(1);
  });

  it('partial votes (some abstain) → existing votes count, abstainers default', () => {
    const votes: Vote[] = [{ playerId: 'a', choice: 2 }];
    expect(resolveRunoutVotes(votes, 1, ['a', 'b'])).toBe(1);
    expect(resolveRunoutVotes(votes, 2, ['a', 'b'])).toBe(2);
  });

  it('duplicate votes from same player: latest wins', () => {
    const votes: Vote[] = [
      { playerId: 'a', choice: 2 },
      { playerId: 'a', choice: 1 },
    ];
    expect(resolveRunoutVotes(votes, 2)).toBe(1);
  });
});
