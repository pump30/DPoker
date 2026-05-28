// Table-level shared types: visible to both server and client.

import type { Card, Stage, Pot } from './game-types.js';

export type TableConfig = {
  name: string;
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  reloadPolicy: 'anytime' | 'between-hands' | 'never';
  maxSeats: number;
  allowSpectators: boolean;
  actionTimeoutSec: number;
  timeBankSec: number;
  defaultRunoutCount: 1 | 2;
  squidMode: boolean;
  squidPointsPerCatch: number;
};

export type TableStatus = 'lobby' | 'running' | 'paused' | 'closed';

export type SeatedPlayer = {
  userId: string;
  displayName: string;
  seat: number;            // 0..maxSeats-1
  stack: number;
  bet: number;             // current street bet
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  sittingOut: boolean;     // long disconnect or voluntary
  joinedAtHand: number;    // first hand they're eligible for (BB-rule)
};

export type Hand = {
  handNo: number;
  buttonSeat: number;
  stage: Stage;
  board: Card[];           // visible community cards
  pots: Pot[];             // computed at showdown / between streets
  currentBet: number;
  minRaise: number;
  lastRaiseAmount: number;
  actorSeat: number | null;
  actionDeadlineMs: number | null;
  commitHash: string | null;     // sha256(serverSeed)
  // serverSeed is NOT broadcast; held server-side until SHOWDOWN reveal
};

export type AllInVote = {
  voterIds: string[];
  votes: Array<{ userId: string; choice: 1 | 2 }>;
  deadlineMs: number;
  defaultCount: 1 | 2;
};

export type SquidPanel = {
  totalSquids: number;
  pointsPerSquid: number;
  holders: Array<{ userId: string; squids: number }>;
  pendingCarryOver: number;
};

export type TableState = {
  id: string;
  shortCode: string;
  hostId: string;
  config: TableConfig;
  status: TableStatus;

  // Roster (sat or spectator)
  seats: Array<SeatedPlayer | null>;   // index = seat number

  // Current hand (null when LOBBY/WAITING/PAUSED/CLOSED)
  hand: Hand | null;

  // All-in vote in progress
  allInVote: AllInVote | null;

  // Multi-board runout (after vote): 1..2 boards
  runoutBoards: Card[][] | null;

  squid: SquidPanel | null;     // null if squidMode=false
  squidStats: Map<string, {
    handsPlayed: number;
    handsWon: number;
    vpipCount: number;
    pfrCount: number;
    showdownWon: number;
    biggestPot: number;
    squidPoints: number;
  }>;

  // For ordering: monotonic event seq
  eventSeq: number;

  // Audit log of revealed seeds (after showdown). One entry per completed hand.
  revealedSeeds: Array<{ handNo: number; commitHash: string; serverSeed: string }>;

  createdAt: number;
  closedAt: number | null;
};

// Public-facing state (for non-self players): hides hole cards and serverSeed.
// We compute this at broadcast time; the type is identical to TableState
// but the server attaches per-recipient hole card payloads separately.
