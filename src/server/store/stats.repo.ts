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
  private getAllStmt: any;
  private getByPlayerStmt: any;
  private upsertBuyInStmt: any;
  private upsertHandStmt: any;

  constructor(db: DB) {
    this.getAllStmt = db.prepare(
      `SELECT player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at
       FROM player_stats ORDER BY total_profit DESC`
    );
    this.getByPlayerStmt = db.prepare(
      `SELECT player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at
       FROM player_stats WHERE player_id = ?`
    );
    this.upsertBuyInStmt = db.prepare(
      `INSERT INTO player_stats (player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at)
       VALUES (?, 0, 0, 0, 0, 1, ?)
       ON CONFLICT(player_id) DO UPDATE SET buy_in_count = buy_in_count + 1, updated_at = excluded.updated_at`
    );
    this.upsertHandStmt = db.prepare(
      `INSERT INTO player_stats (player_id, hands_played, hands_won, total_profit, biggest_pot, buy_in_count, updated_at)
       VALUES (?, 1, ?, ?, ?, 0, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         hands_played = hands_played + 1,
         hands_won = hands_won + excluded.hands_won,
         total_profit = total_profit + excluded.total_profit,
         biggest_pot = MAX(biggest_pot, excluded.biggest_pot),
         updated_at = excluded.updated_at`
    );
  }

  getAll(): PlayerStats[] {
    return (this.getAllStmt.all() as any[]).map(this.rowToStats);
  }

  getByPlayer(playerId: string): PlayerStats | null {
    const row = this.getByPlayerStmt.get(playerId) as any;
    return row ? this.rowToStats(row) : null;
  }

  recordBuyIn(playerId: string): void {
    this.upsertBuyInStmt.run(playerId, Date.now());
  }

  recordHandResult(params: {
    playerId: string;
    won: boolean;
    profitDelta: number;
    potSize: number;
  }): void {
    this.upsertHandStmt.run(
      params.playerId,
      params.won ? 1 : 0,
      params.profitDelta,
      params.potSize,
      Date.now(),
    );
  }

  private rowToStats(row: any): PlayerStats {
    return {
      playerId: row.player_id,
      handsPlayed: row.hands_played,
      handsWon: row.hands_won,
      totalProfit: row.total_profit,
      biggestPot: row.biggest_pot,
      buyInCount: row.buy_in_count,
      updatedAt: row.updated_at,
    };
  }
}
