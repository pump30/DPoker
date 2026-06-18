CREATE TABLE IF NOT EXISTS table_snapshots (
  table_id   TEXT PRIMARY KEY,
  state_json TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);
