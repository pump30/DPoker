import { Router } from 'express';
import type { StatsRepo } from '../store/stats.repo.js';

export function statsRoutes(statsRepo: StatsRepo): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    const all = (await statsRepo.getAll()).map(s => ({
      playerId: s.playerId,
      handsPlayed: s.handsPlayed,
      handsWon: s.handsWon,
      winRate: s.handsPlayed > 0 ? Math.round((s.handsWon / s.handsPlayed) * 1000) / 1000 : 0,
      totalProfit: s.totalProfit,
      biggestPot: s.biggestPot,
      buyInCount: s.buyInCount,
    }));
    return res.json(all);
  });

  router.get('/:playerId', async (req, res) => {
    const stats = await statsRepo.getByPlayer(req.params.playerId);
    if (!stats) return res.status(404).json({ error: 'player_not_found' });
    return res.json({
      playerId: stats.playerId,
      handsPlayed: stats.handsPlayed,
      handsWon: stats.handsWon,
      winRate: stats.handsPlayed > 0 ? Math.round((stats.handsWon / stats.handsPlayed) * 1000) / 1000 : 0,
      totalProfit: stats.totalProfit,
      biggestPot: stats.biggestPot,
      buyInCount: stats.buyInCount,
    });
  });

  return router;
}
