import { describe, it, expect } from 'vitest';
import { initStats, applyHand, type HandSummary } from '@server/game/squid-stats.js';

const players = ['a', 'b', 'c'];

describe('squid-stats', () => {
  it('initStats yields zeros for each player', () => {
    const s = initStats(players);
    for (const id of players) {
      const row = s.get(id)!;
      expect(row.handsPlayed).toBe(0);
      expect(row.handsWon).toBe(0);
      expect(row.vpipCount).toBe(0);
      expect(row.pfrCount).toBe(0);
      expect(row.showdownWon).toBe(0);
      expect(row.biggestPot).toBe(0);
    }
  });

  it('applyHand: hands_played increments for everyone in the hand', () => {
    let s = initStats(players);
    const hand: HandSummary = {
      participants: ['a', 'b', 'c'],
      vpipPlayers: ['a', 'b'],
      pfrPlayers: ['a'],
      winners: ['a'],
      showdownReached: true,
      potTotal: 500,
    };
    s = applyHand(s, hand);
    for (const id of players) {
      expect(s.get(id)!.handsPlayed).toBe(1);
    }
    expect(s.get('a')!.handsWon).toBe(1);
    expect(s.get('b')!.handsWon).toBe(0);
    expect(s.get('a')!.vpipCount).toBe(1);
    expect(s.get('b')!.vpipCount).toBe(1);
    expect(s.get('c')!.vpipCount).toBe(0);
    expect(s.get('a')!.pfrCount).toBe(1);
    expect(s.get('b')!.pfrCount).toBe(0);
    expect(s.get('a')!.showdownWon).toBe(1);
    expect(s.get('a')!.biggestPot).toBe(500);
  });

  it('biggestPot tracks max across hands', () => {
    let s = initStats(players);
    const h1: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['a'], showdownReached: false, potTotal: 100 };
    const h2: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['b'], showdownReached: false, potTotal: 800 };
    const h3: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['a'], showdownReached: false, potTotal: 300 };
    s = applyHand(s, h1);
    s = applyHand(s, h2);
    s = applyHand(s, h3);
    expect(s.get('a')!.biggestPot).toBe(300);
    expect(s.get('b')!.biggestPot).toBe(800);
  });

  it('showdownWon only counts when showdownReached', () => {
    let s = initStats(players);
    const h: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['a'], showdownReached: false, potTotal: 100 };
    s = applyHand(s, h);
    expect(s.get('a')!.handsWon).toBe(1);
    expect(s.get('a')!.showdownWon).toBe(0);
  });

  it('split pot: each winner counts as a win', () => {
    let s = initStats(players);
    const h: HandSummary = { participants: players, vpipPlayers: [], pfrPlayers: [], winners: ['a', 'b'], showdownReached: true, potTotal: 200 };
    s = applyHand(s, h);
    expect(s.get('a')!.handsWon).toBe(1);
    expect(s.get('b')!.handsWon).toBe(1);
    expect(s.get('c')!.handsWon).toBe(0);
  });

  it('initStats is independent of stats history', () => {
    const s1 = initStats(['a']);
    const s2 = initStats(['a']);
    s1.get('a')!.handsPlayed = 99;
    expect(s2.get('a')!.handsPlayed).toBe(0);
  });
});
