export type RegisterRequest = {
  username: string;
  password: string;
  displayName: string;
  inviteCode: string;
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type AuthResponse = {
  token: string;
  user: {
    id: string;
    username: string;
    displayName: string;
  };
};

export type CreateInviteResponse = {
  code: string;
};

export type ErrorResponse = {
  error: string;
  reason?: string;
};

export type TableListItem = {
  tableId: string;
  name: string;
  status: 'lobby' | 'running' | 'paused' | 'closed';
  seats: number;
  maxSeats: number;
};

export type PublicSeat = {
  seat: number;
  playerId: string;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  profit: number;
};

export type TableResponse = {
  tableId: string;
  name: string;
  shortCode: string;
  hostId: string;
  status: TableListItem['status'];
  config: { smallBlind: number; bigBlind: number; minBuyIn: number; maxBuyIn: number; maxSeats: number };
  hand: null | {
    handNo: number;
    stage: 'preflop' | 'flop' | 'turn' | 'river';
    board: string[];
    pots: Array<{ amount: number; eligibleIds: string[] }>;
    currentBet: number;
    minRaise: number;
    actorId: string | null;
    actionDeadlineMs: number | null;
  };
  seats: Array<PublicSeat | null>;
  myCards?: string[];
  myProfit?: number;
  validActions?: Array<'fold' | 'check' | 'call' | 'raise' | 'all-in'>;
};
