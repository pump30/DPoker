/**
 * Seat / button rotation logic.
 *
 * Implements casino-standard "dead button" rotation (spec §12.5):
 * when the small blind or big blind seat departs, the button still
 * advances normally, possibly leaving the button on an empty seat
 * for one hand. SB/BB still get posted by whichever seats land in
 * those roles.
 *
 * Heads-up special-case (spec §12.3): when only 2 seated players,
 * button = small blind, opponent = big blind. Button acts FIRST preflop.
 */

import type { SeatedPlayer } from '../../shared/table-types.js';

export type SeatRing = Array<SeatedPlayer | null>;

/**
 * Indices of seats with a player who is eligible to play this hand
 * (sat down, not sittingOut, joinedAtHand <= currentHandNo).
 */
export function eligibleSeats(seats: SeatRing, handNo: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < seats.length; i++) {
    const p = seats[i];
    if (p && !p.sittingOut && p.joinedAtHand <= handNo) out.push(i);
  }
  return out;
}

/**
 * Find the next seat (clockwise) holding an eligible player, starting
 * the search at `from + 1` (wrap around). Returns the seat index or null
 * if no eligible seats exist.
 */
export function nextEligibleSeat(
  seats: SeatRing,
  from: number,
  handNo: number,
): number | null {
  const n = seats.length;
  for (let off = 1; off <= n; off++) {
    const seat = (from + off) % n;
    const p = seats[seat];
    if (p && !p.sittingOut && p.joinedAtHand <= handNo) return seat;
  }
  return null;
}

/**
 * Compute the button seat for the next hand using dead-button rules.
 *
 * Inputs:
 *   - seats: current seat ring
 *   - prevButtonSeat: button position in the previous hand
 *   - prevSbSeat / prevBbSeat: SB/BB seat positions in the previous hand
 *   - handNo: the new hand number
 *
 * Returns:
 *   { buttonSeat, sbSeat, bbSeat } where any may be null when an empty
 *   seat is occupied by a "dead" button/blind.
 *
 * Algorithm (cash-game dead button):
 *   - The button always advances by 1 to the next position that previously
 *     had the SB role (i.e., the prevSbSeat). In effect, the player who
 *     was SB last hand is button this hand.
 *   - SB advances similarly to the seat that was BB last hand.
 *   - BB always advances to the next eligible seat after the prev BB seat.
 *   This means if a player who was at SB or BB leaves, the corresponding
 *   button/SB role lands on an empty seat (dead).
 *
 * For the very first hand (prevButton = -1), choose the lowest eligible
 * seat as button; if heads-up, that seat is also SB.
 */
export function rotateButton(
  seats: SeatRing,
  prevButtonSeat: number,
  prevSbSeat: number,
  prevBbSeat: number,
  handNo: number,
): { buttonSeat: number | null; sbSeat: number | null; bbSeat: number | null } {
  const eligible = eligibleSeats(seats, handNo);
  if (eligible.length < 2) {
    return { buttonSeat: null, sbSeat: null, bbSeat: null };
  }

  // First hand: button = first eligible.
  if (prevButtonSeat < 0) {
    const buttonSeat = eligible[0];
    if (eligible.length === 2) {
      // Heads-up: button is SB.
      return {
        buttonSeat,
        sbSeat: buttonSeat,
        bbSeat: eligible[1],
      };
    }
    const sbSeat = eligible[1];
    const bbSeat = eligible[2 % eligible.length];
    return { buttonSeat, sbSeat, bbSeat };
  }

  // Heads-up: just swap the two players.
  if (eligible.length === 2) {
    const newButton = eligible[0] === prevButtonSeat ? eligible[1] : eligible[0];
    return {
      buttonSeat: newButton,
      sbSeat: newButton,
      bbSeat: eligible[0] === newButton ? eligible[1] : eligible[0],
    };
  }

  // Multi-way dead button: button advances to whoever was SB; SB advances
  // to whoever was BB; BB advances to the next eligible after prev BB.
  // If prev SB seat is now empty, the button is "dead" (on an empty seat).
  const buttonSeat = isSeatEligible(seats, prevSbSeat, handNo) ? prevSbSeat : null;
  const sbSeat = isSeatEligible(seats, prevBbSeat, handNo) ? prevBbSeat : null;
  const bbSeat = nextEligibleSeat(seats, prevBbSeat, handNo);
  return { buttonSeat, sbSeat, bbSeat };
}

function isSeatEligible(seats: SeatRing, seat: number, handNo: number): boolean {
  if (seat < 0 || seat >= seats.length) return false;
  const p = seats[seat];
  return !!p && !p.sittingOut && p.joinedAtHand <= handNo;
}

/**
 * Determine first-to-act preflop and post-flop using current button + heads-up rules.
 *
 * Preflop (multi-way): UTG = next eligible seat after BB.
 * Preflop (heads-up): button = SB, acts first.
 * Post-flop (multi-way): first eligible seat after button.
 * Post-flop (heads-up): BB acts first (i.e., non-button).
 */
export function firstToAct(
  seats: SeatRing,
  buttonSeat: number,
  bbSeat: number,
  street: 'preflop' | 'postflop',
  handNo: number,
): number | null {
  const eligible = eligibleSeats(seats, handNo);
  if (eligible.length < 2) return null;

  if (eligible.length === 2) {
    // Heads-up
    if (street === 'preflop') return buttonSeat;
    return eligible[0] === buttonSeat ? eligible[1] : eligible[0];
  }

  if (street === 'preflop') return nextEligibleSeat(seats, bbSeat, handNo);
  return nextEligibleSeat(seats, buttonSeat, handNo);
}
