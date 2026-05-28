// WebSocket protocol type definitions shared between client and server.

import type { Action, Card, Pot } from './game-types.js';
import type {
  TableConfig,
  TableStatus,
  Hand,
  AllInVote,
  SquidPanel,
} from './table-types.js';

// ─── Public Seat (serializable, no internal fields) ─────────────────────────

export type PublicSeat = {
  userId: string;
  displayName: string;
  seat: number;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
};

// ─── Public Table State (serializable, no Map, no internal fields) ───────────

export type PublicTableState = {
  id: string;
  shortCode: string;
  hostId: string;
  config: TableConfig;
  status: TableStatus;
  seats: Array<PublicSeat | null>;
  hand: Hand | null;
  allInVote: AllInVote | null;
  squid: SquidPanel | null;
  eventSeq: number;
};

// ─── Client → Server Events ─────────────────────────────────────────────────

export type ClientEvent =
  | { type: 'PLAYER_ACTION'; tableId: string; action: Action }
  | { type: 'START_GAME'; tableId: string }
  | { type: 'PAUSE_GAME'; tableId: string }
  | { type: 'RESUME_GAME'; tableId: string }
  | { type: 'CLOSE_TABLE'; tableId: string }
  | { type: 'RUNOUT_VOTE'; tableId: string; choice: 1 | 2 }
  | { type: 'BUY_IN'; tableId: string; amount: number }
  | { type: 'SIT_DOWN'; tableId: string; seatIdx: number; buyIn?: number }
  | { type: 'STAND_UP'; tableId: string }
  | { type: 'RESYNC'; tableId: string; lastSeq: number };

// ─── Server → Client Events ─────────────────────────────────────────────────

export type ServerEvent =
  | { type: 'TABLE_STATE'; state: PublicTableState }
  | { type: 'HOLE_CARDS'; cards: [Card, Card] }
  | { type: 'RUNOUT_VOTE_REQUEST'; deadlineMs: number; defaultCount: 1 | 2 }
  | { type: 'RUNOUT_DECIDED'; count: 1 | 2 }
  | {
      type: 'HAND_RESULT';
      winners: string[];
      pots: Pot[];
      boards: Card[][];
      revealed: Record<string, [Card, Card]>;
    }
  | { type: 'SQUID_ROUND_UPDATE'; panel: SquidPanel }
  | {
      type: 'SQUID_ROUND_SETTLED';
      loserId: string;
      payouts: Array<{ playerId: string; delta: number }>;
    }
  | { type: 'ACTION_REJECTED'; reason: string }
  | { type: 'HAND_DEAL_COMMIT'; handNo: number; commitHash: string }
  | { type: 'HAND_DEAL_REVEAL'; handNo: number; serverSeed: string }
  | { type: 'ACTION_TIMEOUT_WARNING'; deadlineMs: number }
  | { type: 'PLAYER_DISCONNECTED'; userId: string }
  | { type: 'PLAYER_RECONNECTED'; userId: string };
