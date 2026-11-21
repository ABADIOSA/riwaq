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

# Fourth pass — after Codex's third review (2026-11-18)

Codex marked CF3 and CF5 fixed, CF1 and CF2 partial, found N9 (a pull
returning an old revision with no data while another device uploaded) and
judged the deploy workflow unsafe to merge. This pass closes them in code
and tests. **Production was not changed**: the live account was only read
(below); no migration, deploy, secret, session or row was touched. Sections
G and H above describe the previous plan and are **superseded** by J–L.

## J. What changed

- **Migration `0003_account_instances.sql` (additive).** `users.account_id`
  (random, never reused; unique index) and `users.auth_gen` (credential
  generation, default 0); `sessions.account_id` and `sessions.auth_gen`.
  Every existing account gets an instance; every session not older than its
  account takes that instance at generation 0, so every device stays signed
  in; a session older than its account (a lost race of old) gets none and
  stays refused. No table is rebuilt, no row deleted.
- **CF1, sessions.** A session is issued only while the account is still the
  instance and generation whose secret was just checked, inside the same
  transaction (sign-up, sign-in, recovery). It is valid only for that
  instance and generation, never by username or by comparing clocks (edge
  clocks may differ, so a re-created account could look "older"). A password
  change or a recovery is one transaction bound to the instance, the
  generation and the salt it writes (two changes racing from one generation
  would otherwise both reach the same next number); it signs every other
  device out and moves this one to the new generation.
- **CF2, writes.** Every statement of an upload and of an account deletion
  requires the account's instance and generation **and the session itself**
  at commit time. A revoked session (another device's sign-out of it), a
  password change, a deletion or a new account of the same name during the
  upload writes nothing and is answered 401; a newer revision of the same
  account is still 409 with the revision. D1 runs a batch as one SQL
  transaction (Cloudflare D1 docs, "batch"), which `local.mjs` mirrors.
- **N9, reads.** The pull first reads the revision alone (204 at 0, 304 when
  unchanged: one row), then revision, size and pieces in **one** statement
  bound to the instance; a single statement reads one committed state. The
  result is checked whole (consecutive indices, length = stored size) and
  read again up to three times; otherwise 503 `try_again`, never a 200 with
  an old revision or no data. Released apps treat 503 as a failed sync and
  try again later.
- **The window between migration and deploy.** The previous Worker names its
  columns, so it keeps working on the migrated schema; rows it writes then
  (NULL instance) are adopted by the new Worker on their next request and by
  the daily clean-up, which also removes sessions whose instance or
  generation no longer matches.
- `local.mjs` applies each migration once, recorded in `d1_migrations` as
  Wrangler does, so a file database from an earlier run takes only 0003.

## K. Verified here

- `tests/accounts-instances.test.mjs` (19), each race landed exactly where it
  falls: sign-in racing deletion + re-registration, a password change, a
  recovery; recovery racing a password change; a session from a deleted
  account against a new one created with an earlier clock; two sign-ins; an
  old-generation session; uploads racing sign-out, a password change from
  another device, deletion + re-registration; deletion racing recovery;
  concurrent uploads; a failed batch; the pull racing an upload (Codex's
  pause point) → 200 with revision 2 and its whole data; missing pieces →
  503; deletion during a pull → 401; a 7 MB envelope; migration 0003 on rows
  written by the previous Worker, before and after migrating. With
  `accounts-integrity` (16), `accounts-server`, `account` and the workflow
  test: **65/65**.
- `scripts/test-accounts-released.mjs`: the released apps' own `core/`
  (git archive of v0.40.0, v0.54.0, v0.55.0) sign up and sync against the
  v0.55.0 Worker on the 0001–0002 schema, migration 0003 is applied while
  that Worker still serves (a sign-in happens in the window), then this
  Worker takes over the same database: the established sessions survive;
  login, pull, push, 409 conflict, logout, password change (other devices
  signed out), recovery, deletion and a fresh sign-up all work: **3/3**,
  also with 72e2ffc's Worker as the previous one.
- `scripts/test-accounts-workerd.mjs`, Wrangler 4.141.0 + workerd 2026-09-25,
  local D1 only (throwaway config, random database ID, no Cloudflare
  variables): 0001–0002 applied, rows written as the previous Worker writes
  them, 0003 applied (its `randomblob`, `ALTER TABLE` and unique index run on
  D1's SQLite), a second apply applies nothing, the legacy session pulls and
  pushes, 409/304, sign-up, password change, deletion, the scheduled
  clean-up, and the deploy workflow's own live smoke against this local
  Worker, leaving no account behind: **16/16**.
- Codex's account sync contract, as a permanent test: the pull racing the
  upload no longer returns `200 / revision 1 / 0 bytes`.

## L. Production, read only

Through the Cloudflare tools (deprecated Workers Bindings server), only
`SELECT` and a schema read, `rows_written: 0`:

- D1 `riwaq-accounts` (`d5118240-a4d6-4abd-bcbd-ec9ce544c18a`): applied
  migrations `0001_accounts.sql`, `0002_usage.sql`; `users`, `sessions` and
  `chunks` have exactly the columns 0001 defines (no `account_id`), as 0003
  expects.
- One Worker, `riwaq-accounts`, last modified 2026-10-18 — before this PR;
  production runs neither 72e2ffc's Worker nor this one.

## M. Deployment gate

- `.github/workflows/accounts.yml` is **tests only** (push to `main`, pull
  requests, manual): the Node suites, the released apps across 0003, the
  Worker in workerd with a local D1. No token, no secret, no remote command:
  merging PR #155 deploys nothing.
- `.github/workflows/accounts-deploy.yml` is the only path to production:
  `workflow_dispatch` only, refused unless on `main` and started by the
  repository owner, `environment: accounts-production`, the typed
  confirmation `deploy <first 7 of the commit>`, the D1 ID and the expected
  pending migrations typed, `dry_run` on by default. Read-only preflight
  before any change (token's account; exactly one `riwaq-accounts` with that
  ID — never created; pending migrations exactly as typed; `AUTH_PEPPER`
  present — never generated; current deployments and the Time Travel
  bookmark into the run's summary), then a bundle (`--dry-run`). Only with
  `dry_run` off: migrations, deploy (`bash -e -o pipefail`, so a failing
  Wrangler fails the step even through `tee`), the reported address must be
  `https://riwaq-accounts.abadiosa2007.workers.dev`, health must answer
  `"ok":true` within a minute, then the live throwaway-account test.
- `tests/accounts-workflow.test.mjs` pins all of it (it fails on 72e2ffc's
  workflow); actionlint 1.7.12 reports nothing on every workflow.
- **Not verified:** whether the repository has an `accounts-production`
  environment with required reviewers, and whether `CLOUDFLARE_API_TOKEN` is
  an environment secret. Until the owner configures both (Settings →
  Environments → New environment `accounts-production` → Required reviewers:
  ABADIOSA; move the token into it), the environment approves nothing by
  itself; the manual trigger, the owner check and the typed confirmation
  still hold.

## N. Deploying it (each step needs the owner's explicit approval)

1. Merge PR #155 when its review allows (deploys nothing now).
2. Actions → *Account service (deploy to production)* → Run workflow on
   `main`: confirmation `deploy <sha7>`, database ID
   `d5118240-a4d6-4abd-bcbd-ec9ce544c18a`, migrations
   `0003_account_instances.sql`, **dry run on**. Read the summary: account,
   database, pending list, pepper present, current deployment, bookmark.
3. Run it again with dry run **off**. Order: migration 0003 (the previous
   Worker keeps working on it), deploy, health, live smoke.
4. After: `/v1/health`; Workers logs for a day; after the first 02:17 UTC
   run, read-only counts: `users WHERE account_id IS NULL` = 0, sessions
   without an instance only for sessions older than their account.
5. If the deploy step fails after the migration: production keeps the
   previous Worker on the migrated schema (it works there; §J). Fix and
   re-run; nothing to roll back in the data.
6. Rollback of the Worker: `wrangler rollback` to the version in the summary.
   The previous Worker reads and writes the migrated schema; sessions and
   accounts made by the new Worker keep working with it (it ignores the new
   columns), and the new Worker adopts anything it writes meanwhile. A
   Worker rollback does not undo what the clean-up deleted (expired counters,
   sessions idle 180 days, sessions of another instance or generation).
7. The columns of 0003 are never dropped as part of a rollback (D1 has no
   down migrations here, and dropping them would end the binding). D1 Time
   Travel to the bookmark is a last resort for damaged data: it restores the
   whole database and loses every later write, and needs writes stopped and
   a separate decision.

# Fifth pass — after Codex's fourth review (2026-11-18)

Codex marked CF3 and CF5 fixed and CF1, CF2 and CF4 partial, and found Q9
in the source: three places where the Worker checked a session and then
acted in statements that did not prove it again, and a storage failure
answered as a conflict. This pass closes Q9 in `server/accounts/service.mjs`
with no schema change (migration 0003 is unchanged) and leaves the
deployment gate (§M) as it was. **Production was not changed**: it was only
read (§R).

## O. What changed (Q9)

- **Legacy session binding (CF1).** A session issued before 0003 (or by the
  previous Worker in the window after it) was bound by reading its account
  a second time and updating the session by its token alone. Between the
  two reads the account could be deleted and its name taken again; the old
  session was then bound to the new account. Demonstrated on `215c3de` by a
  staged local race: the stale session read the new owner's sealed data
  (200) and overwrote it. Now one transaction gives an account the previous
  Worker left without an instance its instance, then binds the session to
  the instance and generation the account has **at that write**, only while
  that account is not newer than the session; the session is read again and
  only what was written decides. A password change or a recovery deletes
  the session in its own transaction (before or after this one, never half
  way), so neither can be crossed. A session older than its account stays
  refused, as before; a valid one keeps working.
- **Reads (N9 kept).** Both statements of a pull — the revision alone (204,
  304) and revision, size and pieces together — now also require the
  generation and the session itself, so a sign-out (even from another tab),
  a password change, a recovery or a deletion landing after the check
  answers 401, never 200, 204 or 304. The single-statement read of N9 is
  unchanged.
- **The upload's clean-up (CF2).** Its last statement deleted older pieces
  by name and revision whatever the upload's outcome. It now runs only when
  this transaction moved the account to the next revision (the size and time
  it wrote, the instance, the generation, the session still valid). A
  refused, conflicting or signed-out upload deletes nothing; current pieces
  were never at risk; anything a crash leaves behind is the daily clean-up's
  (unchanged).
- **Errors.** A batch that throws (D1 failed; the transaction rolled back)
  answers **503 `try_again`**, not 409: released apps and this one treat it
  as a failed sync and try later. A genuine conflict stays 409 with the
  revision; a session that ended stays 401.

## P. Verified here

- `tests/accounts-round5-boundaries.test.mjs` (22), each race landed between
  the session read and the statement that acts: legacy binding with nothing
  racing (migrated and unmigrated account); a legacy session older than its
  account; binding racing deletion + re-registration, a password change and
  a recovery; pulls of data, of nothing (204) and of an unchanged revision
  (304) racing a sign-out, a password change on another device, a recovery
  and a deletion; a pull racing another device's upload of the same account
  (still one committed state); uploads racing a sign-out and a password
  change; a conflicting upload; a failed batch. **16 fail on `215c3de`**,
  all pass here. The fourth-pass test of a failed batch now expects 503.
- All account suites (`accounts-instances`, `-integrity`, `-workflow`,
  `-server`, `account`, `-round5-boundaries`): **87/87**.
- `scripts/test-accounts-released.mjs` (v0.40.0, v0.54.0, v0.55.0 clients
  across the previous Worker, migration 0003 while it serves, and this
  Worker): **3/3**, and 3/3 with `72e2ffc` as the previous Worker.
- `scripts/test-accounts-workerd.mjs`, Wrangler 4.141.0, local D1 only:
  **16/16** (0003 on legacy rows, the legacy session pulls and pushes,
  409/304, password change, deletion, the scheduled clean-up, the deploy's
  live smoke against the local Worker).
- Codex's `workerd-independent.py` (Linux copy: its Windows `taskkill` and
  `CREATE_NO_WINDOW` replaced by a process group kill), `72e2ffc`'s Worker
  serving while 0003 is applied, then this Worker over the same local D1:
  **21/21** — earlier session and latest revision kept, the window's account
  and session adopted to their own instance, 200 and 409 for two writes at
  one base, eight overlapping reads during a 7 MiB upload all
  self-consistent, a missing piece answers 503.

## Q. Compatibility and the deployment gate

- No new migration. 0003 and the window behaviour of §J hold: the previous
  Worker keeps working on the migrated schema, and the rows it writes are
  bound by this Worker's new, atomic adoption or the daily clean-up.
- The cron (§J, CF4) is unchanged; Codex's capacity concern about full daily
  scans stands, and production's size today makes it moot (§R), not solved.
- `accounts.yml` stays tests only; `accounts-deploy.yml` stays the only,
  manual, owner-started path (§M). Nothing here runs either against
  Cloudflare.
- **Owner configuration still needed before any deployment** (not done or
  verified here): the `accounts-production` GitHub environment with
  required reviewers, the Cloudflare token as an environment-scoped secret
  (and any repository-level token removed or narrowed), and branch
  protection on `main` if wanted. Creating the environment is not an
  approval to deploy.

## R. Production, read only

Through the Cloudflare tools, `SELECT` only, `rows_written: 0`,
`changed_db: false`:

- D1 `riwaq-accounts`: applied migrations `0001_accounts.sql` and
  `0002_usage.sql` only (0003 not applied).
- Counts only: 2 accounts, 7 sessions; 0 sessions without an account, 0
  sessions older than their account. Migration 0003 would therefore bind
  every session; no ambiguous legacy session exists there today, and its
  backfill is a handful of rows.
- One Worker, `riwaq-accounts`, last modified 2026-10-18 — before this PR.
