// Cards
export type Suit = 'h' | 'd' | 'c' | 's'; // hearts, diamonds, clubs, spades
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export type Card = `${Rank}${Suit}`; // e.g. "Ah", "Td"

export const ALL_RANKS: Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A',
];
export const ALL_SUITS: Suit[] = ['h', 'd', 'c', 's'];

// Stages of a hand
export type Stage = 'preflop' | 'flop' | 'turn' | 'river';

// Player actions
export type Action =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; amount: number }     // total bet amount this round
  | { type: 'all-in' };

// A pot (main or side)
export type Pot = {
  amount: number;
  eligibleIds: string[]; // player ids that may win this pot
};
