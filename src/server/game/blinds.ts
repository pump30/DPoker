/**
 * Blind posting + per-hand setup helpers.
 *
 * Posting blinds is intentionally NOT modeled as a `raise` or `bet` action
 * because the betting validator's min-raise rules don't apply: the BB sets
 * the initial currentBet but is allowed to act last preflop without having
 * "called" itself.
 *
 * After posting blinds, the resulting BettingState has:
 *   - SB has put in `min(smallBlind, stack)`, bet=that amount
 *   - BB has put in `min(bigBlind, stack)`, bet=that amount, hasActed=false
 *   - currentBet = bigBlind
 *   - minRaise = bigBlind (a min-raise opens to 2×BB)
 *   - lastRaiseAmount = bigBlind
 *   - actorId = first to act (UTG multi-way, button heads-up)
 *
 * Short-stack edge case: if a player can't cover the full blind amount,
 * they post their entire stack and become all-in.
 */

import type { BettingState, PlayerBet } from './betting.js';

export type BlindPostingInput = {
  /** Players in seat order, with stacks but no bets yet. */
  players: PlayerBet[];
  smallBlind: number;
  bigBlind: number;
  sbId: string | null;       // null if dead button rolled past SB seat
  bbId: string;
  firstActorId: string;
};

/**
 * Apply small + big blinds to the player array. Returns a new BettingState
 * suitable as input to the preflop reducer.
 *
 * Mutates nothing — fully immutable.
 */
export function postBlinds(input: BlindPostingInput): BettingState {
  const players = input.players.map((p) => ({ ...p, bet: 0, hasActed: false }));

  // Small blind (skip if dead button)
  if (input.sbId !== null) {
    const sb = players.find((p) => p.id === input.sbId);
    if (!sb) throw new Error(`SB player ${input.sbId} not found`);
    const post = Math.min(input.smallBlind, sb.stack);
    sb.stack -= post;
    sb.bet = post;
    if (sb.stack === 0) sb.allIn = true;
  }

  // Big blind
  const bb = players.find((p) => p.id === input.bbId);
  if (!bb) throw new Error(`BB player ${input.bbId} not found`);
  const bbPost = Math.min(input.bigBlind, bb.stack);
  bb.stack -= bbPost;
  bb.bet = bbPost;
  if (bb.stack === 0) bb.allIn = true;

  return {
    players,
    bigBlind: input.bigBlind,
    currentBet: input.bigBlind,
    minRaise: input.bigBlind,
    lastRaiseAmount: input.bigBlind,
    actorId: input.firstActorId,
  };
}

/**
 * Given a BettingState mid-hand and an outcome event (street advance),
 * collect each player's per-street `bet` into total contributions used
 * by pot.splitIntoPots. Caller invokes between streets to "rake" bets.
 *
 * Returns:
 *   - cleared players (bet reset to 0)
 *   - per-player contribution to add to running totals
 */
export function collectBets(state: BettingState): {
  players: PlayerBet[];
  collected: Array<{ id: string; amount: number; folded: boolean }>;
} {
  const collected = state.players
    .filter((p) => p.bet > 0)
    .map((p) => ({ id: p.id, amount: p.bet, folded: p.folded }));
  const players = state.players.map((p) => ({ ...p, bet: 0 }));
  return { players, collected };
}
