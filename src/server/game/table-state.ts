/**
 * Table state machine — pure reducer.
 *
 * `reduce(state, event) → newState` is the single entry point. All side
 * effects (random seed generation, current time, persistence) are injected
 * via the event payload, so the reducer is fully replayable from an event
 * log (spec §12.12).
 *
 * State machine (spec §5.1):
 *
 *   LOBBY           → host calls START_GAME
 *   WAITING         → enough players → next hand auto-starts
 *   HAND_STARTING   → blinds posted, hole cards dealt
 *   PREFLOP/FLOP/TURN/RIVER → players act
 *   ALL_IN_VOTE     → multi-board vote
 *   RUNOUT          → boards revealed
 *   SHOWDOWN        → award pots
 *   SQUID_DISTRIBUTE → squid mode hook
 *   HAND_CLEANUP    → settle pots, advance button, persist
 *   PAUSED / CLOSED → terminal-ish
 *
 * Stage 3 implements LOBBY → ... → HAND_CLEANUP for a single hand. The
 * state machine itself doesn't draw cards — it accepts a deal event with
 * pre-shuffled deck, since that's reproducibility-critical.
 */

import type {
  TableState,
  TableConfig,
  SeatedPlayer,
  Hand,
  AllInVote,
} from '../../shared/table-types.js';
import type { Card, Stage, Action } from '../../shared/game-types.js';
import { commitOf, deriveDeck } from './deck-commit.js';
import { rotateButton, eligibleSeats, firstToAct } from './seat.js';
import { postBlinds, collectBets } from './blinds.js';
import {
  validateAction,
  applyAction,
  getNextActor,
  isBettingRoundClosed,
  startNewStreet,
  type BettingState,
  type PlayerBet,
} from './betting.js';
import { splitIntoPots, awardPots, type Contribution } from './pot.js';
import { runRemainder } from './runout.js';
import { resolveRunoutVotes, type Vote } from './runout-vote.js';
import {
  newSquidRound,
  distributeSquid,
  isRoundComplete as squidRoundComplete,
  settleRound as settleSquid,
  resetForRoster,
  type HandOutcome,
  type SquidRoundState,
} from './squid-round.js';
import { applyHand as applyHandStats, initStats, type HandSummary } from './squid-stats.js';
import type { PlayerCards } from './hand-evaluator.js';

// ===== Events =====

export type TableEvent =
  | { type: 'CREATE_TABLE'; tableId: string; shortCode: string; hostId: string; config: TableConfig; nowMs: number }
  | { type: 'JOIN_TABLE'; userId: string; displayName: string; nowMs: number }
  | { type: 'SIT_DOWN'; userId: string; seat: number; buyIn: number; nowMs: number }
  | { type: 'STAND_UP'; userId: string; nowMs: number }
  | { type: 'START_GAME'; hostId: string; nowMs: number }
  | { type: 'PAUSE_GAME'; hostId: string; nowMs: number }
  | { type: 'RESUME_GAME'; hostId: string; nowMs: number }
  | { type: 'CLOSE_TABLE'; hostId: string; nowMs: number }
  | {
      type: 'BEGIN_HAND';
      serverSeed: string;     // hex string of 32 bytes — caller generates and persists
      nowMs: number;
    }
  | { type: 'PLAYER_ACTION'; userId: string; action: Action; nowMs: number }
  | { type: 'TIMEOUT'; nowMs: number }
  | { type: 'RUNOUT_VOTE'; userId: string; choice: 1 | 2; nowMs: number }
  | { type: 'RUNOUT_VOTE_TIMEOUT'; nowMs: number };

// ===== Initial state =====

export function initialState(): TableState | null {
  return null;
}

// ===== Reducer =====

export function reduce(state: TableState | null, event: TableEvent): TableState {
  switch (event.type) {
    case 'CREATE_TABLE':
      return createTable(event);
    default: {
      if (!state) throw new Error(`event ${event.type} requires existing state`);
      return reduceExisting(state, event);
    }
  }
}

function createTable(event: Extract<TableEvent, { type: 'CREATE_TABLE' }>): TableState {
  const seats: Array<SeatedPlayer | null> = Array(event.config.maxSeats).fill(null);
  return {
    id: event.tableId,
    shortCode: event.shortCode,
    hostId: event.hostId,
    config: event.config,
    status: 'lobby',
    seats,
    hand: null,
    allInVote: null,
    runoutBoards: null,
    squid: null,
    squidStats: new Map(),
    eventSeq: 1,
    revealedSeeds: [],
    createdAt: event.nowMs,
    closedAt: null,
  };
}

function reduceExisting(state: TableState, event: TableEvent): TableState {
  const next = { ...state, eventSeq: state.eventSeq + 1 };

  switch (event.type) {
    case 'JOIN_TABLE':
      // Spectators join implicitly; for Stage 3 we treat join as no-op since
      // SIT_DOWN is the real seating event. We could track spectators but YAGNI.
      return next;

    case 'SIT_DOWN':
      return sitDown(next, event);

    case 'STAND_UP':
      return standUp(next, event);

    case 'START_GAME':
      assertHost(state, event.hostId);
      if (state.status !== 'lobby') return next;
      return { ...next, status: 'running' };

    case 'PAUSE_GAME':
      assertHost(state, event.hostId);
      // Soft pause: takes effect at HAND_CLEANUP. For Stage 3 we just flip status if no hand.
      if (!state.hand) return { ...next, status: 'paused' };
      return next;

    case 'RESUME_GAME':
      assertHost(state, event.hostId);
      if (state.status === 'paused') return { ...next, status: 'running' };
      return next;

    case 'CLOSE_TABLE':
      assertHost(state, event.hostId);
      return { ...next, status: 'closed', hand: null, allInVote: null, closedAt: event.nowMs };

    case 'BEGIN_HAND':
      return beginHand(next, event);

    case 'PLAYER_ACTION':
      return playerAction(next, event);

    case 'TIMEOUT':
      return timeoutAction(next, event);

    case 'RUNOUT_VOTE':
      return runoutVote(next, event);

    case 'RUNOUT_VOTE_TIMEOUT':
      return runoutVoteTimeout(next, event);

    default:
      return next;
  }
}

function assertHost(state: TableState, hostId: string): void {
  if (state.hostId !== hostId) {
    throw new Error(`only host can issue this event (got ${hostId}, expected ${state.hostId})`);
  }
}

// ===== SIT_DOWN / STAND_UP =====

function sitDown(state: TableState, event: Extract<TableEvent, { type: 'SIT_DOWN' }>): TableState {
  if (event.seat < 0 || event.seat >= state.seats.length) {
    throw new Error(`invalid seat ${event.seat}`);
  }
  if (state.seats[event.seat]) {
    throw new Error(`seat ${event.seat} already taken`);
  }
  if (event.buyIn < state.config.minBuyIn || event.buyIn > state.config.maxBuyIn) {
    throw new Error(`buy-in out of range`);
  }

  // Joined-at-hand = next hand if a hand is in progress, else current hand 0.
  const joinedAtHand = state.hand ? state.hand.handNo + 1 : 0;
  const player: SeatedPlayer = {
    userId: event.userId,
    displayName: event.userId, // upgraded on JOIN_TABLE
    seat: event.seat,
    stack: event.buyIn,
    bet: 0,
    folded: false,
    allIn: false,
    hasActed: false,
    sittingOut: false,
    joinedAtHand,
  };
  const seats = [...state.seats];
  seats[event.seat] = player;

  // Squid mode: roster change — reset round
  let squid = state.squid;
  if (state.config.squidMode) {
    const roster = seats.filter((s): s is SeatedPlayer => !!s).map((s) => s.userId);
    squid = roster.length >= 2
      ? squidStateFor(state.squid, roster, state.config.squidPointsPerCatch)
      : null;
  }

  return { ...state, seats, squid };
}

function standUp(state: TableState, event: Extract<TableEvent, { type: 'STAND_UP' }>): TableState {
  const seats = state.seats.map((s) =>
    s && s.userId === event.userId ? null : s,
  );
  let squid = state.squid;
  if (state.config.squidMode) {
    const roster = seats.filter((s): s is SeatedPlayer => !!s).map((s) => s.userId);
    squid = roster.length >= 2
      ? squidStateFor(null, roster, state.config.squidPointsPerCatch) // reset on leave
      : null;
  }
  return { ...state, seats, squid };
}

function squidStateFor(
  prev: TableState['squid'],
  roster: string[],
  pointsPerSquid: number,
): TableState['squid'] {
  // Roster-changed reset (spec §6.1)
  void prev;
  const squidRound = newSquidRound(roster, pointsPerSquid);
  return roundToPanel(squidRound);
}

function roundToPanel(round: SquidRoundState): TableState['squid'] {
  return {
    totalSquids: round.totalSquids,
    pointsPerSquid: round.pointsPerSquid,
    holders: round.roster.map((id) => ({ userId: id, squids: round.holders.get(id) ?? 0 })),
    pendingCarryOver: round.pendingCarryOver,
  };
}

function panelToRound(panel: NonNullable<TableState['squid']>, roster: string[]): SquidRoundState {
  const holders = new Map<string, number>();
  for (const h of panel.holders) {
    if (h.squids > 0 && roster.includes(h.userId)) holders.set(h.userId, h.squids);
  }
  return {
    roster: [...roster],
    totalSquids: panel.totalSquids,
    pointsPerSquid: panel.pointsPerSquid,
    holders,
    pendingCarryOver: panel.pendingCarryOver,
  };
}

// ===== BEGIN_HAND =====

function beginHand(state: TableState, event: Extract<TableEvent, { type: 'BEGIN_HAND' }>): TableState {
  if (state.status !== 'running') throw new Error('cannot begin hand: status not running');
  if (state.hand) throw new Error('cannot begin hand: already in progress');

  const handNo = state.revealedSeeds.length + 1;
  const eligible = eligibleSeats(state.seats, handNo);
  if (eligible.length < 2) throw new Error('cannot begin hand: < 2 eligible players');

  // Determine button rotation
  const prevButton = ((state as any)._prevButton as number | undefined) ?? -1;
  const prevSb = ((state as any)._prevSb as number | undefined) ?? -1;
  const prevBb = ((state as any)._prevBb as number | undefined) ?? -1;
  const { buttonSeat, sbSeat, bbSeat } = rotateButton(state.seats, prevButton, prevSb, prevBb, handNo);
  if (bbSeat === null) throw new Error('cannot begin hand: no BB seat');

  // Reset per-hand player state (folded/allIn/hasActed/bet) for eligibles
  const seats = state.seats.map((s) => {
    if (!s) return s;
    if (!eligible.includes(s.seat)) return s;
    return { ...s, folded: false, allIn: false, hasActed: false, bet: 0 };
  });

  // Derive deck from seed
  const seedBuf = Buffer.from(event.serverSeed, 'hex');
  if (seedBuf.length !== 32) throw new Error('serverSeed must be 32 hex bytes');
  const commitHash = commitOf(seedBuf);
  const deck = deriveDeck(seedBuf);

  // Deal 2 hole cards to each eligible player in seat order, starting after button
  const holeCards = new Map<string, [Card, Card]>();
  let cursor = 0;
  // Two passes: one card per player per pass, conventional dealing order
  for (let pass = 0; pass < 2; pass++) {
    for (const seat of orderFromButton(seats, buttonSeat ?? eligible[0])) {
      if (!eligible.includes(seat)) continue;
      const player = seats[seat]!;
      const card = deck[cursor++];
      const existing = holeCards.get(player.userId);
      if (existing) {
        holeCards.set(player.userId, [existing[0], card]);
      } else {
        holeCards.set(player.userId, [card, '2c' as Card]); // placeholder, replaced next pass
      }
    }
  }
  // Fix placeholders from the loop: actually re-do cleanly.
  holeCards.clear();
  cursor = 0;
  const dealOrder = orderFromButton(seats, buttonSeat ?? eligible[0]).filter((s) => eligible.includes(s));
  for (let pass = 0; pass < 2; pass++) {
    for (const seat of dealOrder) {
      const userId = seats[seat]!.userId;
      const card = deck[cursor++];
      if (pass === 0) holeCards.set(userId, [card, card]); // temporary
      else holeCards.set(userId, [holeCards.get(userId)![0], card]);
    }
  }

  // Remaining deck for the board
  const boardDeck = deck.slice(cursor);

  // Post blinds
  const playerBets: PlayerBet[] = dealOrder.map((seat) => {
    const p = seats[seat]!;
    return { id: p.userId, stack: p.stack, bet: 0, folded: false, allIn: false, hasActed: false };
  });
  const sbId = sbSeat !== null ? seats[sbSeat]!.userId : null;
  const bbId = seats[bbSeat]!.userId;
  const firstActSeat = firstToAct(seats, buttonSeat ?? eligible[0], bbSeat, 'preflop', handNo)!;
  const firstActorId = seats[firstActSeat]!.userId;

  const betting = postBlinds({
    players: playerBets,
    smallBlind: state.config.smallBlind,
    bigBlind: state.config.bigBlind,
    sbId,
    bbId,
    firstActorId,
  });

  // Sync stacks + bets back to seats
  const seatsAfterBlinds = seats.map((s) => {
    if (!s) return s;
    const pb = betting.players.find((p) => p.id === s.userId);
    return pb ? { ...s, stack: pb.stack, bet: pb.bet, allIn: pb.allIn } : s;
  });

  const hand: Hand = {
    handNo,
    buttonSeat: buttonSeat ?? -1,
    stage: 'preflop',
    board: [],
    pots: [],
    currentBet: betting.currentBet,
    minRaise: betting.minRaise,
    lastRaiseAmount: betting.lastRaiseAmount,
    actorSeat: firstActSeat,
    actionDeadlineMs: event.nowMs + state.config.actionTimeoutSec * 1000,
    commitHash,
  };

  const newState: TableState = {
    ...state,
    seats: seatsAfterBlinds,
    hand,
  };

  // Stash internal context that the next reducer step needs.
  // We use a non-enumerable holder via attached fields.
  (newState as any)._holeCards = holeCards;
  (newState as any)._boardDeck = boardDeck;
  (newState as any)._serverSeed = event.serverSeed;
  (newState as any)._sbSeat = sbSeat;
  (newState as any)._bbSeat = bbSeat;
  (newState as any)._betting = betting;
  // Per-street collected contributions (for split pots)
  (newState as any)._contribs = [] as Contribution[];
  // Hand summary fields for stats
  (newState as any)._vpipPlayers = new Set<string>();
  (newState as any)._pfrPlayers = new Set<string>();

  return newState;
}

function orderFromButton(seats: SeatedPlayer | null[] | (SeatedPlayer | null)[], buttonSeat: number): number[] {
  const arr = seats as (SeatedPlayer | null)[];
  const n = arr.length;
  const out: number[] = [];
  for (let off = 1; off <= n; off++) {
    out.push((buttonSeat + off) % n);
  }
  return out;
}

// ===== PLAYER_ACTION =====

function playerAction(
  state: TableState,
  event: Extract<TableEvent, { type: 'PLAYER_ACTION' }>,
): TableState {
  if (!state.hand) throw new Error('no hand in progress');
  const betting = (state as any)._betting as BettingState | undefined;
  if (!betting) throw new Error('hand state missing _betting');
  if (betting.actorId !== event.userId) {
    throw new Error(`not your turn (actor: ${betting.actorId}, you: ${event.userId})`);
  }
  const result = validateAction(betting, event.action);
  if (!result.ok) throw new Error(`invalid action: ${result.reason}`);

  // Track VPIP / PFR for preflop voluntary contributions
  if (state.hand.stage === 'preflop') {
    const isVoluntary =
      event.action.type === 'call' ||
      event.action.type === 'raise' ||
      event.action.type === 'all-in';
    if (isVoluntary) (state as any)._vpipPlayers.add(event.userId);
    if (event.action.type === 'raise') (state as any)._pfrPlayers.add(event.userId);
  }

  const newBetting = applyAction(betting, event.action);

  // Check round close
  if (isBettingRoundClosed(newBetting)) {
    return advanceStreet(state, newBetting, event.nowMs);
  }

  // Find next actor
  const nextActorId = getNextActor(newBetting);
  if (!nextActorId) {
    return advanceStreet(state, newBetting, event.nowMs);
  }

  const newBettingWithActor = { ...newBetting, actorId: nextActorId };
  const seatIdx = state.seats.findIndex((s) => s?.userId === nextActorId);

  return updateSeatStateFromBetting(state, newBettingWithActor, {
    actorSeat: seatIdx,
    actionDeadlineMs: event.nowMs + state.config.actionTimeoutSec * 1000,
  });
}

function timeoutAction(
  state: TableState,
  event: Extract<TableEvent, { type: 'TIMEOUT' }>,
): TableState {
  const betting = (state as any)._betting as BettingState | undefined;
  if (!betting) throw new Error('no hand for timeout');
  // Auto-action: check if possible, else fold.
  const owed = betting.currentBet - betting.players.find((p) => p.id === betting.actorId)!.bet;
  const action: Action = owed === 0 ? { type: 'check' } : { type: 'fold' };
  return playerAction(state, {
    type: 'PLAYER_ACTION',
    userId: betting.actorId,
    action,
    nowMs: event.nowMs,
  });
}

function updateSeatStateFromBetting(
  state: TableState,
  betting: BettingState,
  patch: { actorSeat: number | null; actionDeadlineMs: number | null },
): TableState {
  const seats = state.seats.map((s) => {
    if (!s) return s;
    const pb = betting.players.find((p) => p.id === s.userId);
    if (!pb) return s;
    return { ...s, stack: pb.stack, bet: pb.bet, folded: pb.folded, allIn: pb.allIn };
  });
  const hand: Hand = {
    ...state.hand!,
    currentBet: betting.currentBet,
    minRaise: betting.minRaise,
    lastRaiseAmount: betting.lastRaiseAmount,
    actorSeat: patch.actorSeat,
    actionDeadlineMs: patch.actionDeadlineMs,
  };
  const out = { ...state, seats, hand };
  (out as any)._betting = betting;
  return out;
}

// ===== Street advancement =====

function advanceStreet(state: TableState, betting: BettingState, nowMs: number): TableState {
  // 1. Collect per-street bets into running contributions.
  const collected = collectBets(betting);
  const existing = ((state as any)._contribs as Contribution[]) ?? [];
  const merged = mergeContribs(existing, collected.collected);

  // 2. Sync bets cleared back to seats.
  const _seats = state.seats.map((s) => {
    if (!s) return s;
    const pb = collected.players.find((p) => p.id === s.userId);
    return pb ? { ...s, bet: 0 } : s;
  });
  void _seats;

  // Detect end-of-hand: only one non-folded player → award without showdown.
  const stillIn = collected.players.filter((p) => !p.folded);
  if (stillIn.length === 1) {
    return endHandSingleWinner(state, merged, stillIn[0].id, nowMs);
  }

  // Detect all-in showdown: ≤1 active (non-allIn) player remains → trigger runout flow.
  const stillCanAct = collected.players.filter((p) => !p.folded && !p.allIn);
  if (stillCanAct.length <= 1 && state.hand!.stage !== 'river') {
    return enterAllInVote(state, merged, collected.players, nowMs);
  }

  // Normal street advance
  const nextStage = nextStageOf(state.hand!.stage);
  if (nextStage === null) {
    // River done — go showdown
    return resolveShowdown(state, merged, [state.hand!.board], nowMs);
  }
  return openNextStreet(state, betting, collected.players, merged, nextStage, nowMs);
}

function nextStageOf(stage: Stage): Stage | null {
  if (stage === 'preflop') return 'flop';
  if (stage === 'flop') return 'turn';
  if (stage === 'turn') return 'river';
  return null;
}

function openNextStreet(
  state: TableState,
  betting: BettingState,
  clearedPlayers: PlayerBet[],
  contribs: Contribution[],
  nextStage: Stage,
  nowMs: number,
): TableState {
  // Reveal next community card(s) from boardDeck — burn 1, reveal 3 (flop) or 1 (turn/river)
  const boardDeck = (state as any)._boardDeck as Card[];
  const cursor = (state as any)._boardCursor ?? 0;
  let burn = 1;
  let reveal = nextStage === 'flop' ? 3 : 1;
  const newBoard = [
    ...state.hand!.board,
    ...boardDeck.slice(cursor + burn, cursor + burn + reveal),
  ];

  // First-to-act post-flop: see seat.firstToAct
  const firstActSeat = firstToAct(state.seats, state.hand!.buttonSeat, (state as any)._bbSeat, 'postflop', state.hand!.handNo);
  if (firstActSeat === null) {
    // Shouldn't happen — fallback to nobody.
    return state;
  }
  const firstActor = state.seats[firstActSeat]!.userId;

  const newBetting = startNewStreet(
    { ...betting, players: clearedPlayers },
    firstActor,
  );

  const hand: Hand = {
    ...state.hand!,
    stage: nextStage,
    board: newBoard,
    currentBet: 0,
    minRaise: state.config.bigBlind,
    lastRaiseAmount: 0,
    actorSeat: firstActSeat,
    actionDeadlineMs: nowMs + state.config.actionTimeoutSec * 1000,
  };

  const out = { ...state, hand };
  (out as any)._betting = newBetting;
  (out as any)._contribs = contribs;
  (out as any)._boardCursor = cursor + burn + reveal;
  return out;
}

function mergeContribs(existing: Contribution[], add: Array<{ id: string; amount: number; folded: boolean }>): Contribution[] {
  const map = new Map<string, Contribution>();
  for (const c of existing) map.set(c.id, { ...c });
  for (const a of add) {
    const cur = map.get(a.id);
    if (cur) {
      cur.amount += a.amount;
      cur.folded = a.folded || cur.folded;
    } else {
      map.set(a.id, { id: a.id, amount: a.amount, folded: a.folded });
    }
  }
  return [...map.values()];
}

// ===== End-of-hand paths =====

function endHandSingleWinner(
  state: TableState,
  contribs: Contribution[],
  winnerId: string,
  nowMs: number,
): TableState {
  const pots = splitIntoPots(contribs.map((c) => ({ ...c, folded: c.id === winnerId ? false : c.folded })));
  // Award all to winner
  const totalAmount = pots.reduce((s, p) => s + p.amount, 0);
  const seatsAfter = applyChipChanges(state.seats, [{ userId: winnerId, delta: totalAmount }]);

  return finalizeHand(state, seatsAfter, contribs, [], totalAmount, [winnerId], false, nowMs);
}

function applyChipChanges(
  seats: TableState['seats'],
  changes: Array<{ userId: string; delta: number }>,
): TableState['seats'] {
  return seats.map((s) => {
    if (!s) return s;
    const c = changes.find((ch) => ch.userId === s.userId);
    return c ? { ...s, stack: s.stack + c.delta } : s;
  });
}

function finalizeHand(
  state: TableState,
  seatsAfter: TableState['seats'],
  contribs: Contribution[],
  boards: Card[][],
  potTotal: number,
  winnerIds: string[],
  showdownReached: boolean,
  nowMs: number,
): TableState {
  // Squid mode distribution + settlement
  let squidPanel = state.squid;
  let squidStats = state.squidStats;
  if (state.config.squidMode && state.squid && winnerIds.length >= 1) {
    const roster = seatsAfter.filter((s): s is SeatedPlayer => !!s).map((s) => s.userId);
    const round0 = panelToRound(state.squid, roster);
    const outcome: HandOutcome =
      winnerIds.length === 1
        ? { kind: 'single-winner', winnerId: winnerIds[0] }
        : { kind: 'split', winnerIds };
    const round1 = distributeSquid(round0, outcome);
    squidPanel = roundToPanel(round1);
    if (squidRoundComplete(round1)) {
      const settlement = settleSquid(round1);
      squidStats = applySquidPayouts(squidStats, settlement.payouts);
      // Reset round
      const round2 = resetForRoster(round1, roster);
      squidPanel = roundToPanel(round2);
    }
  }

  // Stats
  const participants = contribs.map((c) => c.id);
  if (squidStats.size === 0) squidStats = initStatsWithSquid(participants);
  const handSummary: HandSummary = {
    participants,
    vpipPlayers: [...((state as any)._vpipPlayers ?? new Set<string>())] as string[],
    pfrPlayers: [...((state as any)._pfrPlayers ?? new Set<string>())] as string[],
    winners: winnerIds,
    showdownReached,
    potTotal,
  };
  squidStats = applyHandToSquidStats(squidStats, handSummary);

  // Reveal seed
  const revealedSeeds = [
    ...state.revealedSeeds,
    {
      handNo: state.hand!.handNo,
      commitHash: state.hand!.commitHash!,
      serverSeed: (state as any)._serverSeed as string,
    },
  ];

  // Stash sbSeat / bbSeat for next button rotation
  const out: TableState = {
    ...state,
    seats: seatsAfter,
    hand: null,
    allInVote: null,
    runoutBoards: null,
    squid: squidPanel,
    squidStats,
    revealedSeeds,
  };
  (out as any)._prevButton = state.hand!.buttonSeat;
  (out as any)._prevSb = (state as any)._sbSeat;
  (out as any)._prevBb = (state as any)._bbSeat;
  void boards;
  void nowMs;
  return out;
}

// Squid stats interop
function initStatsWithSquid(playerIds: readonly string[]) {
  const base = initStats(playerIds);
  const out = new Map<string, any>();
  for (const [id, row] of base) {
    out.set(id, { ...row, squidPoints: 0 });
  }
  return out;
}

function applyHandToSquidStats(
  state: TableState['squidStats'],
  hand: HandSummary,
): TableState['squidStats'] {
  // Convert TableState shape (incl squidPoints) to plain stats, apply, merge back
  const plain = new Map<string, any>();
  for (const [id, row] of state) {
    plain.set(id, {
      handsPlayed: row.handsPlayed,
      handsWon: row.handsWon,
      vpipCount: row.vpipCount,
      pfrCount: row.pfrCount,
      showdownWon: row.showdownWon,
      biggestPot: row.biggestPot,
    });
  }
  const updated = applyHandStats(plain, hand);
  const out = new Map<string, any>();
  for (const [id, row] of updated) {
    const prev = state.get(id);
    out.set(id, { ...row, squidPoints: prev?.squidPoints ?? 0 });
  }
  return out;
}

function applySquidPayouts(
  stats: TableState['squidStats'],
  payouts: Array<{ playerId: string; delta: number }>,
): TableState['squidStats'] {
  const out = new Map(stats);
  for (const p of payouts) {
    const cur = out.get(p.playerId) ?? {
      handsPlayed: 0,
      handsWon: 0,
      vpipCount: 0,
      pfrCount: 0,
      showdownWon: 0,
      biggestPot: 0,
      squidPoints: 0,
    };
    out.set(p.playerId, { ...cur, squidPoints: cur.squidPoints + p.delta });
  }
  return out;
}

// ===== All-in vote / runout =====

function enterAllInVote(
  state: TableState,
  contribs: Contribution[],
  clearedPlayers: PlayerBet[],
  nowMs: number,
): TableState {
  // Voters = unfolded players (whether all-in or not)
  const voterIds = clearedPlayers.filter((p) => !p.folded).map((p) => p.id);
  const allInVote: AllInVote = {
    voterIds,
    votes: [],
    deadlineMs: nowMs + 5000, // 5s default vote window
    defaultCount: state.config.defaultRunoutCount,
  };
  const hand: Hand = { ...state.hand!, actorSeat: null, actionDeadlineMs: null };
  const out = { ...state, hand, allInVote };
  (out as any)._contribs = contribs;
  return out;
}

function runoutVote(
  state: TableState,
  event: Extract<TableEvent, { type: 'RUNOUT_VOTE' }>,
): TableState {
  if (!state.allInVote) throw new Error('no vote in progress');
  if (!state.allInVote.voterIds.includes(event.userId)) {
    throw new Error('not a voter');
  }
  const votes = state.allInVote.votes.filter((v) => v.userId !== event.userId).concat({
    userId: event.userId,
    choice: event.choice,
  });
  const newVote: AllInVote = { ...state.allInVote, votes };

  // Has everyone voted? Or did anyone vote 1?
  const allVoted = newVote.voterIds.every((id) => votes.some((v) => v.userId === id));
  const anyOne = votes.some((v) => v.choice === 1);
  if (anyOne || allVoted) {
    return resolveVoteAndRunout(state, newVote, event.nowMs);
  }
  return { ...state, allInVote: newVote };
}

function runoutVoteTimeout(state: TableState, event: Extract<TableEvent, { type: 'RUNOUT_VOTE_TIMEOUT' }>): TableState {
  if (!state.allInVote) return state;
  return resolveVoteAndRunout(state, state.allInVote, event.nowMs);
}

function resolveVoteAndRunout(state: TableState, vote: AllInVote, nowMs: number): TableState {
  const choice = resolveRunoutVotes(
    vote.votes.map((v) => ({ playerId: v.userId, choice: v.choice })) as Vote[],
    vote.defaultCount,
    vote.voterIds,
  );
  // Run remaining board(s)
  const boardDeck = (state as any)._boardDeck as Card[];
  const cursor = (state as any)._boardCursor ?? 0;
  const result = runRemainder({
    deck: boardDeck.slice(cursor),
    currentBoard: state.hand!.board,
    runs: choice,
  });
  const contribs = (state as any)._contribs as Contribution[];
  return resolveShowdown(state, contribs, result.boards, nowMs);
}

// ===== Showdown =====

function resolveShowdown(
  state: TableState,
  contribs: Contribution[],
  boards: Card[][],
  nowMs: number,
): TableState {
  const holeCards = (state as any)._holeCards as Map<string, [Card, Card]>;
  const stillIn = contribs.filter((c) => !c.folded);

  // For each board, split the contribution / boards.length and award per pot.
  // (Standard RIT: each board awards its share of every pot.)
  const totalPots = splitIntoPots(contribs);
  const totalAmount = totalPots.reduce((s, p) => s + p.amount, 0);

  // Track per-player chip delta accumulated across boards
  const chipChange = new Map<string, number>();
  let allWinners = new Set<string>();

  for (const board of boards) {
    const playerCards: PlayerCards[] = stillIn
      .map((c) => {
        const hc = holeCards.get(c.id);
        return hc ? { id: c.id, hole: hc } : null;
      })
      .filter((p): p is PlayerCards => p !== null);

    const pots = splitIntoPots(contribs);
    const awards = awardPots(pots, playerCards, board);
    const factor = 1 / boards.length;
    for (const a of awards) {
      for (const winner of a.winnerIds) {
        const cur = chipChange.get(winner) ?? 0;
        chipChange.set(winner, cur + Math.floor(a.share * factor));
        allWinners.add(winner);
      }
      // Distribute remainder to first winner of the pot (simplification)
      if (a.remainder > 0) {
        const first = a.winnerIds[0];
        chipChange.set(first, (chipChange.get(first) ?? 0) + Math.floor(a.remainder * factor));
      }
    }
  }

  // Subtract original contributions from each player's stack — already done
  // when bets were collected each street, except contributions that were
  // moved into the pot directly. Actually the chip flow is:
  //   1. player.stack -= bet (when betting.applyAction ran)
  //   2. bets accumulated into contribs
  //   3. winner's stack += award
  // So we only ADD the chip change here.
  const seatsAfter = applyChipChanges(
    state.seats,
    [...chipChange.entries()].map(([userId, delta]) => ({ userId, delta })),
  );

  return finalizeHand(
    state,
    seatsAfter,
    contribs,
    boards,
    totalAmount,
    [...allWinners],
    true,
    nowMs,
  );
}

// ===== Public selectors (used by Stage 4 + tests) =====

export function getHoleCards(state: TableState, userId: string): [Card, Card] | null {
  const map = (state as any)._holeCards as Map<string, [Card, Card]> | undefined;
  return map?.get(userId) ?? null;
}

export function getServerSeed(state: TableState): string | null {
  return ((state as any)._serverSeed as string) ?? null;
}

// Helpers

