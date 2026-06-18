import { describe, it, expect } from 'vitest';
import { StatsRepo } from '@server/store/stats.repo.js';
import { makeTestDb } from '../../helpers/test-db.js';

describe('StatsRepo', () => {
  it('getAll returns empty initially', async () => {
    const repo = new StatsRepo(makeTestDb());
    expect(await repo.getAll()).toEqual([]);
  });

  it('recordBuyIn creates player entry', async () => {
    const repo = new StatsRepo(makeTestDb());
    await repo.recordBuyIn('alice');
    const stats = await repo.getByPlayer('alice');
    expect(stats).not.toBeNull();
    expect(stats!.buyInCount).toBe(1);
    expect(stats!.handsPlayed).toBe(0);
  });

  it('recordBuyIn increments for existing player', async () => {
    const repo = new StatsRepo(makeTestDb());
    await repo.recordBuyIn('alice');
    await repo.recordBuyIn('alice');
    expect((await repo.getByPlayer('alice'))!.buyInCount).toBe(2);
  });

  it('recordHandResult updates stats for winner', async () => {
    const repo = new StatsRepo(makeTestDb());
    await repo.recordBuyIn('alice');
    await repo.recordHandResult({ playerId: 'alice', won: true, profitDelta: 200, potSize: 400 });
    const stats = (await repo.getByPlayer('alice'))!;
    expect(stats.handsPlayed).toBe(1);
    expect(stats.handsWon).toBe(1);
    expect(stats.totalProfit).toBe(200);
    expect(stats.biggestPot).toBe(400);
  });

  it('recordHandResult updates stats for loser', async () => {
    const repo = new StatsRepo(makeTestDb());
    await repo.recordBuyIn('bob');
    await repo.recordHandResult({ playerId: 'bob', won: false, profitDelta: -100, potSize: 200 });
    const stats = (await repo.getByPlayer('bob'))!;
    expect(stats.handsPlayed).toBe(1);
    expect(stats.handsWon).toBe(0);
    expect(stats.totalProfit).toBe(-100);
  });

  it('biggestPot only increases', async () => {
    const repo = new StatsRepo(makeTestDb());
    await repo.recordBuyIn('alice');
    await repo.recordHandResult({ playerId: 'alice', won: true, profitDelta: 100, potSize: 500 });
    await repo.recordHandResult({ playerId: 'alice', won: true, profitDelta: 50, potSize: 200 });
    expect((await repo.getByPlayer('alice'))!.biggestPot).toBe(500);
  });

  it('getAll returns sorted by totalProfit desc', async () => {
    const repo = new StatsRepo(makeTestDb());
    await repo.recordBuyIn('alice');
    await repo.recordBuyIn('bob');
    await repo.recordHandResult({ playerId: 'alice', won: false, profitDelta: -100, potSize: 200 });
    await repo.recordHandResult({ playerId: 'bob', won: true, profitDelta: 100, potSize: 200 });
    const all = await repo.getAll();
    expect(all[0].playerId).toBe('bob');
    expect(all[1].playerId).toBe('alice');
  });
});
