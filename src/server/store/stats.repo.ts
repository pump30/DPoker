import type { DB } from './db.js';

export type PlayerStats = {
  playerId: string;
  handsPlayed: number;
  handsWon: number;
  totalProfit: number;
  biggestPot: number;
  buyInCount: number;
  updatedAt: number;
};

export class StatsRepo {
  constructor(private db: DB) {}

  async getAll(): Promise<PlayerStats[]> {
    const { rows } = await this.db.query(
      `SELECT player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at
       FROM player_stats ORDER BY total_profit DESC`,
    );
    return rows.map(this.rowToStats);
  }

  async getByPlayer(playerId: string): Promise<PlayerStats | null> {
    const { rows } = await this.db.query(
      `SELECT player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at
       FROM player_stats WHERE player_id = $1`,
      [playerId],
    );
    const row = rows[0];
    return row ? this.rowToStats(row) : null;
  }

  async recordBuyIn(playerId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO player_stats (player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at)
       VALUES ($1, 0, 0, 0, 0, 1, $2)
       ON CONFLICT(player_id) DO UPDATE SET buy_in_count = player_stats.buy_in_count + 1, updated_at = EXCLUDED.updated_at`,
      [playerId, Date.now()],
    );
  }

  async recordHandResult(params: {
    playerId: string;
    won: boolean;
    profitDelta: number;
    potSize: number;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO player_stats (player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at)
       VALUES ($1, 1, $2, $3, $4, 0, $5)
       ON CONFLICT(player_id) DO UPDATE SET
         hands_played = player_stats.hands_played + 1,
         hands_won = player_stats.hands_won + EXCLUDED.hands_won,
         total_profit = player_stats.total_profit + EXCLUDED.total_profit,
         biggest_pot = GREATEST(player_stats.biggest_pot, EXCLUDED.biggest_pot),
         updated_at = EXCLUDED.updated_at`,
      [params.playerId, params.won ? 1 : 0, params.profitDelta, params.potSize, Date.now()],
    );
  }

  private rowToStats(row: any): PlayerStats {
    return {
      playerId: row.player_id,
      handsPlayed: Number(row.hands_played),
      handsWon: Number(row.hands_won),
      totalProfit: Number(row.total_profit),
      biggestPot: Number(row.biggest_pot),
      buyInCount: Number(row.buy_in_count),
      updatedAt: Number(row.updated_at),
    };
  }
}
