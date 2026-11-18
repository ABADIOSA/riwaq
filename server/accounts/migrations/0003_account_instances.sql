-- Account instances and credential generations (PR #155 third review,
-- CF1/CF2; docs/CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md, "Fourth pass").
--
-- A username can be deleted and taken again, so it cannot be the identity a
-- session or a write is bound to. Each account gets a random instance ID,
-- never reused, and a credential generation that a password change or a
-- recovery moves on. A session records both when it is issued; every
-- authenticated request and every write checks them in the same
-- statement or batch that acts.
--
-- Additive only: no table is rebuilt and no row is deleted. The Worker
-- that came before this migration keeps working on it (it names its
-- columns), and rows it writes before the new Worker is deployed (NULL
-- instance) are filled in by the new Worker and the daily clean-up.
ALTER TABLE users ADD COLUMN account_id TEXT;
ALTER TABLE users ADD COLUMN auth_gen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN account_id TEXT;
ALTER TABLE sessions ADD COLUMN auth_gen INTEGER;

-- Every existing account becomes its own instance.
UPDATE users SET account_id = lower(hex(randomblob(16)))
WHERE account_id IS NULL;

-- A session issued to the account as it exists now (not older than it)
-- belongs to that instance at generation 0, so every device stays signed
-- in. A session older than its account (left by a deleted account of the
-- same name) gets none and stays refused.
UPDATE sessions SET
  account_id = (
    SELECT u.account_id FROM users u
    WHERE u.username = sessions.username AND u.created_at <= sessions.created_at
  ),
  auth_gen = 0
WHERE account_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_by_instance ON users (account_id);
