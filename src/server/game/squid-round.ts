export type HandOutcome =
  | { kind: 'single-winner'; winnerId: string }
  | { kind: 'split'; winnerIds: string[] };

export type SquidRoundState = {
  roster: string[];
  totalSquids: number;
  pointsPerSquid: number;
  holders: Map<string, number>;
  pendingCarryOver: number;
};

export type SquidSettlement = {
  loserId: string;
  payouts: Array<{ playerId: string; delta: number }>;
};

export function newSquidRound(playerIds: readonly string[], pointsPerSquid: number): SquidRoundState {
  return {
    roster: [...playerIds],
    totalSquids: Math.max(0, playerIds.length - 1),
    pointsPerSquid,
    holders: new Map(),
    pendingCarryOver: 0,
  };
}

export function distributeSquid(round: SquidRoundState, outcome: HandOutcome): SquidRoundState {
  const toAward = 1 + round.pendingCarryOver;

  if (outcome.kind === 'split') {
    return { ...round, holders: new Map(round.holders), pendingCarryOver: toAward };
  }

  const winner = outcome.winnerId;
  const holders = new Map(round.holders);
  const has = holders.get(winner) ?? 0;
  if (has >= 1) {
    return { ...round, holders, pendingCarryOver: toAward };
  }
  holders.set(winner, 1);
  return { ...round, holders, pendingCarryOver: Math.max(0, toAward - 1) };
}

export function isRoundComplete(round: SquidRoundState): boolean {
  let held = 0;
  for (const v of round.holders.values()) held += v;
  return held === round.totalSquids && round.totalSquids > 0;
}

export function settleRound(round: SquidRoundState): SquidSettlement {
  if (!isRoundComplete(round)) {
    throw new Error('round not complete');
  }
  const losers = round.roster.filter((id) => (round.holders.get(id) ?? 0) === 0);
  if (losers.length !== 1) {
    throw new Error(`expected exactly one loser, got ${losers.length}`);
  }
  const loserId = losers[0];
  const payouts = round.roster.map((id) => {
    if (id === loserId) {
      return { playerId: id, delta: -round.pointsPerSquid * round.totalSquids };
    }
    return { playerId: id, delta: round.pointsPerSquid };
  });
  return { loserId, payouts };
}

export function resetForRoster(round: SquidRoundState, playerIds: readonly string[]): SquidRoundState {
  return newSquidRound(playerIds, round.pointsPerSquid);
}
