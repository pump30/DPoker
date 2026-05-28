import type { Action } from '../../shared/game-types.js';

export type PlayerBet = {
  id: string;
  stack: number;
  bet: number;        // current bet in this round
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
};

export type BettingState = {
  players: PlayerBet[];
  bigBlind: number;
  currentBet: number;     // highest bet this round
  minRaise: number;       // minimum legal raise INCREMENT (not total amount)
  lastRaiseAmount: number;
  actorId: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

export function validateAction(state: BettingState, action: Action): ValidationResult {
  const player = state.players.find((p) => p.id === state.actorId);
  if (!player) return { ok: false, reason: 'no_actor' };
  if (player.folded) return { ok: false, reason: 'folded' };
  if (player.allIn) return { ok: false, reason: 'all_in' };

  const owed = state.currentBet - player.bet;

  switch (action.type) {
    case 'fold':
      return { ok: true };
    case 'check':
      return owed === 0 ? { ok: true } : { ok: false, reason: 'must_call' };
    case 'call':
      if (owed === 0) return { ok: false, reason: 'nothing_to_call' };
      if (owed > player.stack) return { ok: false, reason: 'insufficient_stack' };
      return { ok: true };
    case 'raise': {
      const total = action.amount;
      if (total <= state.currentBet) return { ok: false, reason: 'raise_too_small' };
      if (total - state.currentBet < state.minRaise) {
        return { ok: false, reason: 'below_min_raise' };
      }
      const cost = total - player.bet;
      if (cost > player.stack) return { ok: false, reason: 'insufficient_stack' };
      return { ok: true };
    }
    case 'all-in':
      if (player.stack === 0) return { ok: false, reason: 'no_chips' };
      return { ok: true };
  }
}

export function applyAction(state: BettingState, action: Action): BettingState {
  const players = state.players.map((p) => ({ ...p }));
  const me = players.find((p) => p.id === state.actorId)!;

  let { currentBet, minRaise, lastRaiseAmount } = state;
  let reopened = false;

  switch (action.type) {
    case 'fold':
      me.folded = true;
      me.hasActed = true;
      break;
    case 'check':
      me.hasActed = true;
      break;
    case 'call': {
      const owed = currentBet - me.bet;
      const pay = Math.min(owed, me.stack);
      me.stack -= pay;
      me.bet += pay;
      if (me.stack === 0) me.allIn = true;
      me.hasActed = true;
      break;
    }
    case 'raise': {
      const total = action.amount;
      const cost = total - me.bet;
      me.stack -= cost;
      me.bet = total;
      const raiseIncrement = total - currentBet;
      currentBet = total;
      lastRaiseAmount = raiseIncrement;
      minRaise = raiseIncrement;
      if (me.stack === 0) me.allIn = true;
      me.hasActed = true;
      reopened = true;
      break;
    }
    case 'all-in': {
      const totalBet = me.bet + me.stack;
      const raiseIncrement = totalBet - currentBet;
      me.stack = 0;
      me.bet = totalBet;
      me.allIn = true;
      me.hasActed = true;
      if (totalBet > currentBet) {
        currentBet = totalBet;
        if (raiseIncrement >= minRaise) {
          minRaise = raiseIncrement;
          lastRaiseAmount = raiseIncrement;
          reopened = true;
        }
        // else partial: keep minRaise/lastRaiseAmount, do NOT reopen
      }
      break;
    }
  }

  if (reopened) {
    for (const p of players) {
      if (p.id !== me.id && !p.folded && !p.allIn) {
        p.hasActed = false;
      }
    }
  }

  return {
    ...state,
    players,
    currentBet,
    minRaise,
    lastRaiseAmount,
  };
}

/**
 * Returns the next player who must act, or null if the betting round is closed.
 * Walks players[] in seat order starting after the current actor.
 *
 * A player is "must act" when: !folded && !allIn && (!hasActed || bet < currentBet).
 */
export function getNextActor(state: BettingState): string | null {
  const idx = state.players.findIndex((p) => p.id === state.actorId);
  if (idx < 0) return null;
  const n = state.players.length;
  for (let off = 1; off <= n; off++) {
    const p = state.players[(idx + off) % n];
    if (!p.folded && !p.allIn && (!p.hasActed || p.bet < state.currentBet)) {
      return p.id;
    }
  }
  return null;
}

/**
 * Returns true when the betting round is finished:
 *   - 0 or 1 active (non-folded, non-all-in) players remain who can still
 *     respond, AND
 *   - all active players have either matched currentBet or are all-in.
 */
export function isBettingRoundClosed(state: BettingState): boolean {
  const active = state.players.filter((p) => !p.folded && !p.allIn);
  // If everyone folded except one, hand ends elsewhere — but the round is closed.
  if (state.players.filter((p) => !p.folded).length <= 1) return true;
  for (const p of active) {
    if (!p.hasActed) return false;
    if (p.bet < state.currentBet) return false;
  }
  return true;
}

/**
 * Returns the players who are still active in the betting round (not folded).
 * Includes all-in players because they remain in the hand for showdown.
 */
export function activePlayers(state: BettingState): PlayerBet[] {
  return state.players.filter((p) => !p.folded);
}

/**
 * Reset all hasActed flags and bets for the next betting street.
 * Returns a new BettingState with currentBet=0, minRaise=bigBlind, etc.
 * The first-to-act for the next street is the input firstActorId.
 */
export function startNewStreet(state: BettingState, firstActorId: string): BettingState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      bet: 0,
      hasActed: p.folded || p.allIn, // folded/all-in players don't need to act
    })),
    currentBet: 0,
    minRaise: state.bigBlind,
    lastRaiseAmount: 0,
    actorId: firstActorId,
  };
}
