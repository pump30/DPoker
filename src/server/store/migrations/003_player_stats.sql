CREATE TABLE IF NOT EXISTS player_stats (
  player_id    TEXT PRIMARY KEY,
  hands_played INTEGER NOT NULL DEFAULT 0,
  hands_won    INTEGER NOT NULL DEFAULT 0,
  total_profit BIGINT NOT NULL DEFAULT 0,
  biggest_pot  BIGINT NOT NULL DEFAULT 0,
  buy_in_count INTEGER NOT NULL DEFAULT 0,
  updated_at   BIGINT NOT NULL DEFAULT 0
);
