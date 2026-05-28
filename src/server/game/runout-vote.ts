export type Vote = {
  playerId: string;
  choice: 1 | 2;
};

/**
 * Resolve the all-in runout count vote.
 *
 * Rule: any explicit "1" vote forces 1. If voterIds is provided, abstainers
 * are treated as choosing defaultCount.
 *
 * If voterIds is omitted, only the supplied votes count; missing voters
 * are not implicitly counted (caller is responsible for collecting them).
 */
export function resolveRunoutVotes(
  votes: readonly Vote[],
  defaultCount: 1 | 2,
  voterIds?: readonly string[],
): 1 | 2 {
  // Latest vote per player wins
  const latest = new Map<string, 1 | 2>();
  for (const v of votes) {
    latest.set(v.playerId, v.choice);
  }

  if (voterIds) {
    for (const id of voterIds) {
      if (!latest.has(id)) latest.set(id, defaultCount);
    }
  }

  if (latest.size === 0) return defaultCount;

  for (const choice of latest.values()) {
    if (choice === 1) return 1;
  }
  return 2;
}
