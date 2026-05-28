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
