CREATE TABLE IF NOT EXISTS usage_devices (
  token_hash TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  version TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS usage_seen ON usage_devices(seen_at);
