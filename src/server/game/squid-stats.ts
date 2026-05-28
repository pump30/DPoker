export type StatRow = {
  handsPlayed: number;
  handsWon: number;
  vpipCount: number;
  pfrCount: number;
  showdownWon: number;
  biggestPot: number;
};

export type StatsState = Map<string, StatRow>;

export type HandSummary = {
  participants: string[];
  vpipPlayers: string[];
  pfrPlayers: string[];
  winners: string[];
  showdownReached: boolean;
  potTotal: number;
};

function emptyRow(): StatRow {
  return {
    handsPlayed: 0,
    handsWon: 0,
    vpipCount: 0,
    pfrCount: 0,
    showdownWon: 0,
    biggestPot: 0,
  };
}

export function initStats(playerIds: readonly string[]): StatsState {
  const m: StatsState = new Map();
  for (const id of playerIds) {
    m.set(id, emptyRow());
  }
  return m;
}

export function applyHand(state: StatsState, hand: HandSummary): StatsState {
  const out: StatsState = new Map();
  for (const [id, row] of state) {
    out.set(id, { ...row });
  }
  for (const id of hand.participants) {
    if (!out.has(id)) out.set(id, emptyRow());
  }

  for (const id of hand.participants) {
    out.get(id)!.handsPlayed++;
  }
  for (const id of hand.vpipPlayers) {
    out.get(id)!.vpipCount++;
  }
  for (const id of hand.pfrPlayers) {
    out.get(id)!.pfrCount++;
  }
  for (const id of hand.winners) {
    const r = out.get(id)!;
    r.handsWon++;
    if (hand.showdownReached) r.showdownWon++;
    if (hand.potTotal > r.biggestPot) r.biggestPot = hand.potTotal;
  }
  return out;
}
