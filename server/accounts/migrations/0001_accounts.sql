-- Riwaq accounts (docs/ACCOUNTS.md). The server never sees a password or
-- any viewer data in the clear: it keeps hashes of secrets derived on the
-- device, the data key wrapped by those secrets, and the encrypted data.
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  auth_salt TEXT NOT NULL,
  auth_hash TEXT NOT NULL,
  wrapped_key TEXT NOT NULL,
  recovery_salt TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  recovery_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (username, seen_at);

-- The sealed data, as base64 text in pieces (a D1 row holds at most 2 MB).
CREATE TABLE IF NOT EXISTS chunks (
  username TEXT NOT NULL,
  revision INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (username, revision, idx)
);

-- Failed sign-ins and sign-ups per username or (hashed) address.
CREATE TABLE IF NOT EXISTS attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
