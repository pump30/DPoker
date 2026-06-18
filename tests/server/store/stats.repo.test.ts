import { describe, it, expect } from 'vitest';
import { StatsRepo } from '@server/store/stats.repo.js';
import { makeTestDb } from '../../helpers/test-db.js';

describe('StatsRepo', () => {
  it('getAll returns empty initially', () => {
    const repo = new StatsRepo(makeTestDb());
    expect(repo.getAll()).toEqual([]);
  });

  it('recordBuyIn creates player entry', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    const stats = repo.getByPlayer('alice');
    expect(stats).not.toBeNull();
    expect(stats!.buyInCount).toBe(1);
    expect(stats!.handsPlayed).toBe(0);
  });

  it('recordBuyIn increments for existing player', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    repo.recordBuyIn('alice');
    expect(repo.getByPlayer('alice')!.buyInCount).toBe(2);
  });

  it('recordHandResult updates stats for winner', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    repo.recordHandResult({ playerId: 'alice', won: true, profitDelta: 200, potSize: 400 });
    const stats = repo.getByPlayer('alice')!;
    expect(stats.handsPlayed).toBe(1);
    expect(stats.handsWon).toBe(1);
    expect(stats.totalProfit).toBe(200);
    expect(stats.biggestPot).toBe(400);
  });

  it('recordHandResult updates stats for loser', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('bob');
    repo.recordHandResult({ playerId: 'bob', won: false, profitDelta: -100, potSize: 200 });
    const stats = repo.getByPlayer('bob')!;
    expect(stats.handsPlayed).toBe(1);
    expect(stats.handsWon).toBe(0);
    expect(stats.totalProfit).toBe(-100);
  });

  it('biggestPot only increases', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    repo.recordHandResult({ playerId: 'alice', won: true, profitDelta: 100, potSize: 500 });
    repo.recordHandResult({ playerId: 'alice', won: true, profitDelta: 50, potSize: 200 });
    expect(repo.getByPlayer('alice')!.biggestPot).toBe(500);
  });

  it('getAll returns sorted by totalProfit desc', () => {
    const repo = new StatsRepo(makeTestDb());
    repo.recordBuyIn('alice');
    repo.recordBuyIn('bob');
    repo.recordHandResult({ playerId: 'alice', won: false, profitDelta: -100, potSize: 200 });
    repo.recordHandResult({ playerId: 'bob', won: true, profitDelta: 100, potSize: 200 });
    const all = repo.getAll();
    expect(all[0].playerId).toBe('bob');
    expect(all[1].playerId).toBe('alice');
  });
});
