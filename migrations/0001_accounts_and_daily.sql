CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE COLLATE NOCASE,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  banned_at INTEGER
) STRICT;

CREATE TABLE identities (
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_id)
) STRICT;

CREATE INDEX identities_user ON identities (user_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE daily_runs (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  daily INTEGER NOT NULL,
  language TEXT NOT NULL,
  wpm REAL NOT NULL,
  accuracy REAL NOT NULL,
  duration_ms INTEGER NOT NULL,
  log_hash TEXT NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, daily, language)
) STRICT;

CREATE INDEX daily_runs_board ON daily_runs (daily, language, flagged, wpm DESC, accuracy DESC, created_at);
CREATE INDEX daily_runs_log ON daily_runs (daily, language, log_hash);
