CREATE TABLE IF NOT EXISTS tables (
  id            TEXT PRIMARY KEY,
  short_code    TEXT UNIQUE NOT NULL,
  host_id       TEXT NOT NULL,
  config_json   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'lobby',
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER,
  FOREIGN KEY (host_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS event_log (
  table_id    TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (table_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_event_log_table ON event_log(table_id, seq);

CREATE TABLE IF NOT EXISTS hand_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id      TEXT NOT NULL,
  hand_no       INTEGER NOT NULL,
  played_at     INTEGER NOT NULL,
  data_json     TEXT NOT NULL,
  FOREIGN KEY (table_id) REFERENCES tables(id)
);

CREATE TABLE IF NOT EXISTS table_stats (
  table_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  hands_played  INTEGER DEFAULT 0,
  hands_won     INTEGER DEFAULT 0,
  vpip_count    INTEGER DEFAULT 0,
  pfr_count     INTEGER DEFAULT 0,
  showdown_won  INTEGER DEFAULT 0,
  total_buyin   INTEGER DEFAULT 0,
  total_cashout INTEGER DEFAULT 0,
  biggest_pot   INTEGER DEFAULT 0,
  squid_points  INTEGER DEFAULT 0,
  PRIMARY KEY (table_id, user_id)
);
