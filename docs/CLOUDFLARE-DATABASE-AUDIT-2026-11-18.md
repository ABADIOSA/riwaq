# Riwaq accounts on Cloudflare — database audit, 2026-11-18

The optional Riwaq accounts service (docs/ACCOUNTS.md) as it runs on Cloudflare, read through the connected Cloudflare tools and compared with `server/accounts/`. Everything on the live account was **read-only**: listings, `sqlite_master`, `d1_migrations`, aggregate counts and `EXPLAIN QUERY PLAN`. No production table, row, secret, route, binding or deployment was changed, and no migration was applied. The fixes below are in this PR only; they reach production when the owner deploys them (section G).

## A. What is there

| Resource | Found | Relation to Riwaq |
| --- | --- | --- |
| Worker `riwaq-accounts` | created 2026-10-11, last modified 2026-10-18 | The whole service: `/v1/signup`, `login`, `recover/*`, `data`, `password`, `logout`, `account`, `usage`, `admin/usage`; daily cron (`17 2 * * *`). Its deployed source is the repository's `worker.mjs` + `usage.mjs` at the PR's base, unchanged. |
| D1 `riwaq-accounts` | created 2026-10-11, version `production`, primary in WNAM, read replication off, under 300 KB | Binding `DB`. The only database. |
| D1 migrations | `0001_accounts.sql` (2026-10-11), `0002_usage.sql` (2026-10-18) | Same files as `server/accounts/migrations/`; nothing pending, nothing extra. |
| KV | none | — |
| R2 | not enabled on the account (the API answers 10042) | — |
| Durable Objects, Queues, Hyperdrive | none bound (`wrangler.toml` binds only D1) | — |
| Environments | production only, on `workers.dev` (`workers_dev = true`, no route in the config) | No staging. |
| Secrets (by name, from the code) | `AUTH_PEPPER`, `METRICS_ADMIN_KEY` | The tools cannot list secrets; their presence was not checked. |
| Vars | `ALLOWED_ORIGINS = https://abadiosa.github.io` | The web edition's origin; the desktop sends no Origin. |
| Deployment | `.github/workflows/accounts.yml`: on a push to `main` touching `server/accounts/**` (or by hand) it runs the account tests, applies migrations to the remote D1, deploys with Wrangler 4.141.0, creates `AUTH_PEPPER` once, and runs a throwaway live account (`scripts/test-account-live.mjs`) | **Merging this PR deploys the Worker** (it changes `server/accounts/**`). |
| Recovery | D1 Time Travel (point-in-time restore; its window depends on the plan, not readable here) | No exported backups exist or are needed for this audit. |

Who touches the database: only this Worker. Who calls the Worker: the desktop app and the web edition (`core/account.mjs`, `core/usage.mjs`), and the owner's Admin for `/v1/admin/usage`. Profiles, collections, settings and everything else a viewer keeps travel inside one sealed blob per account (AES-256-GCM, key never on the server), so **profile isolation cannot be and is not a server concern**: the server sees accounts, sessions and ciphertext. Profile isolation is the client's (PR #155 F2), and the server's part is account ownership and ordering of writes.

## B. The schema

`users(username PK, auth_salt, auth_hash, wrapped_key, recovery_salt, recovery_hash, recovery_key, revision, size, created_at, updated_at)` · `sessions(token_hash PK, username, created_at, seen_at)` + index `sessions_by_user(username, seen_at)` · `chunks(username, revision, idx, data, PK(username, revision, idx))` · `attempts(key PK, count, reset_at)` · `usage_devices(token_hash PK, platform, version, seen_at, revoked)` + index `usage_seen(seen_at)` · D1's own `d1_migrations` and `_cf_KV`.

No foreign keys: `sessions` and `chunks` refer to `users` by name, and deletions remove the three together in one batch. Timestamps are milliseconds from `Date.now()` in the Worker. Live state (aggregates only): no session without its account, no data piece without its account, no piece of a revision other than the account's current one, no account with a revision but no data, no session older than 180 days, no expired rate-limit counter. The database is consistent today; the findings below are ways it could stop being so.

Query plans on the live database: the device cap's delete and the usage clean-up use their indexes; data reads use the `chunks` primary key; the sweep of expired counters (`DELETE FROM attempts WHERE reset_at < ?`) is a full scan.

## C. Findings

| ID | Severity | What | Evidence |
| --- | --- | --- | --- |
| **CF1** | P2 | **A session could outlive its account and open a later account of the same name.** `login` checks the proof, then writes the session in a separate step; an account deleted in between (its batch removes users, sessions, pieces) left that session behind. `session()` looked only at the `sessions` row. If the name was registered again, the old device's token read the new owner's ciphertext and could overwrite it (it cannot decrypt it: E2E). | `tests/accounts-integrity.test.mjs` "CF1" fails on the previous Worker, passes now; also checked under workerd + local D1. Not observed in production (no orphan sessions). |
| **CF2** | P2 | **An upload racing the account's deletion left its data behind, and blocked the name for good.** The upload's final `DELETE … revision <> (SELECT revision FROM users …)` compares with NULL when the account is gone and deletes nothing, so a deleted account's ciphertext stayed; a new account of that name then hit the leftover pieces' primary key on every upload: a permanent 409. On every ordinary conflict the upload also wrote all its pieces (up to ~7 MB) and deleted them again. | "CF2" tests fail on the previous Worker; measured 6 → 0 rows written by a conflicting 4.5 MB upload. Not observed in production (no orphan or stale pieces). |
| **CF3** | P3 | Bodies were read whole before their size was checked when no `Content-Length` came (chunked): the Worker could hold up to its platform limit for a 16 KB JSON endpoint. | `readBounded`; tested with a stream body, locally and under workerd. |
| **CF4** | P3 | 2% of all requests scanned the whole `attempts` table to sweep expired counters; sessions unused for 180 days were removed only if presented again; nothing removed rows left by CF1/CF2. | Synthetic, 20,000 counters: p99 of an authenticated sync read 0.862 → 0.334 ms (p50 0.136 → 0.140). |
| **CF5** | P3 | The Worker's main module exported non-handler values (`API_VERSION`, `MAX_DATA`, `handle`). The pinned Wrangler 4.141.0 runtime (workerd) refuses to start it: "Incorrect type for map entry 'API_VERSION'". Production runs it today, so this blocked local `wrangler dev` testing and is a risk for a future runtime update. | Reproduced with the previous and new code under `wrangler dev --local`. |

Checked and not a finding: every statement is parameterized (the one interpolated SQL fragment is a constant); every signed-in route reads by the session's own username; proofs are scrypt-derived on the device and stored peppered and salted, tokens as SHA-256 of 256 random bits; deletion needs the password proof; a new password ends the other sessions, a recovery ends all; uploads are ordered by revision (`X-Riwaq-Base`), so a stale device or a replayed upload gets 409, never a lost update; bodies and secrets are never logged; CORS is an allowlist; addresses are kept only as peppered hashes in counters.

Recommendations, not implemented here:
- **R-a** Sign-in limits are check-then-count: a burst of parallel guesses can exceed the 10/15-minute limit by the burst's size. Counting first (`… RETURNING count`) closes it at the cost of a write per sign-in.
- **R-b** There is no staging environment; a second Worker and database (`[env.staging]`) would let changes run against a real D1 before production.
- **R-c** Record a Time Travel bookmark before every deploy that ships a migration (the workflow could do it).
- **R-d** Deploy-on-merge means a code review of `server/accounts/**` is also a production change; consider `workflow_dispatch` only, or an environment with required reviewers.

## D. Changes in this PR

- `server/accounts/worker.mjs` is now only the entry (`export default { fetch, scheduled }`, CF5); the service moved to `server/accounts/service.mjs` (tests and `local.mjs` import it).
- Sessions are written only while their account exists, in the same transaction (`INSERT … SELECT … WHERE EXISTS`), and a session older than its account, or without one, is refused and removed on use (CF1).
- Uploads: stale pieces at the next revision are cleared, pieces are written only while the account exists at the device's base, the revision moves only from that base, and the final delete removes everything when the account is gone (`COALESCE(…, -1)`) (CF2).
- `readBounded` reads bodies piece by piece and stops at the limit (CF3).
- The daily cron runs `cleanup()`: usage past 31 days, expired counters, sessions idle past 180 days, sessions and pieces without their account; the per-request 2% sweep is gone (CF4).
- No schema change and no migration: none was needed. No index was added: the only scan left runs once a day, and an index on `attempts(reset_at)` would add a write to every usage pulse and failed sign-in.
- Tests: `tests/accounts-integrity.test.mjs` (14: races, conflicts, healing, bounded bodies, clean-up, isolation, revocation, duplicates, replays, migrations twice, query plans, the entry's exports); the deploy workflow now runs it before deploying.

## E. Performance

Synthetic database on Node's SQLite (the same Worker code, previous vs new): a stale device's 4.5 MB upload writes **6 rows → 0**; authenticated sync reads with 20,000 counter rows, 2,000 requests: **p50 0.136 → 0.140 ms, p95 0.273 → 0.206 ms, p99 0.862 → 0.334 ms**. The session check now joins `users` by primary key; its cost is within the noise above. Every per-request statement is checked to use an index (`EXPLAIN QUERY PLAN` in the test). Not measured: the edge's own latency, which this database size will not show.

## F. Data safety and compatibility

- The API, its paths, statuses and bodies are unchanged; the released apps (0.55.0 and earlier) work with the new Worker. A device whose session the new checks refuse sees 401, which it already treats as "signed out", keeping its own data.
- The new code writes the same rows as the old, so rolling the Worker back is safe at any time; the old code can read everything the new one wrote.
- Nothing in today's data violates the new rules (the read-only checks above), so the first cron run deletes nothing that is in use.
- Local verification: Node's SQLite (`npm test`), and **Wrangler 4.141.0 `--local` (workerd + local D1)**: migrations applied to an empty database, `scripts/test-account-live.mjs` passed end to end, and a D1 check covered healing, a three-piece upload, a conflict writing nothing, older sessions refused and removed, the scheduled clean-up, and a bounded chunked body.

## G. Deploying it (for the owner's approval)

1. Approve the change. Note that merging PR #155 into `main` triggers `accounts.yml` and deploys at once; to deploy separately, run the workflow by hand from this branch's merge instead.
2. Before deploying: `wrangler d1 time-travel info riwaq-accounts` and note the bookmark (read-only).
3. Read-only pre-check (expect zeros): orphan sessions, orphan pieces, pieces of a non-current revision.
4. `wrangler d1 migrations list riwaq-accounts --remote`: expect none pending (none are added).
5. Deploy through the workflow (it runs `accounts-server`, `accounts-integrity` and `account` tests first, then the live throwaway account).
6. After: `/v1/health`, the workflow's live test, Workers logs for errors over a day, and after the first 02:17 UTC run the same read-only counts.
7. Rollback: `wrangler rollback` to the previous Worker version (code only; safe, see F). A Time Travel restore only if data were damaged; it returns the whole database to the bookmark and loses later writes, so it is a last resort.

## H. Waiting for approval

- Deploying the new Worker to production (by merging or by dispatching the workflow).
- The first scheduled clean-up that follows (it deletes only expired counters, idle sessions past 180 days and rows without an account; today none of the last two exist).
- Optional: a staging environment (R-b), a Time Travel step in the workflow (R-c), a reviewed deploy (R-d), atomic sign-in limits (R-a).
- Nothing else: no secret rotation, no session revocation, no route change.

## I. Limits

- The Cloudflare tools available here (the Workers Bindings server, marked deprecated) list and query D1, list Workers, KV and R2 and read a Worker's code. They do not show secrets, routes, cron state, Worker versions, deployments, the plan, analytics or Time Travel; those were not checked.
- The D1 query tool can write; only `SELECT`, `PRAGMA`-free schema reads and `EXPLAIN QUERY PLAN` were sent. One aggregate that touched `_cf_KV` was refused by D1 (`SQLITE_AUTH`) and re-run without it.
- No staging exists, so nothing ran against a remote D1; the local workerd runtime stood in. Real edge latency and D1's remote behaviour under concurrent requests were not measured.
