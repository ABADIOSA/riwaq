# Riwaq accounts

An optional Riwaq account carries a viewer's data between the Windows app on several PCs and the web edition. Nothing changes for a viewer who never makes one. Accounts are end-to-end encrypted: the service stores data it cannot read.

- Client: `core/account.mjs` (`AccountHub`, on `client.account`), `core/sync-merge.mjs`, the Settings page `src/components/settings/AccountPage.jsx` (Settings → الحسابات والربط → حساب رِواق).
- Service: `server/accounts/` — a Cloudflare Worker (entry `worker.mjs`, which exports only its handlers; the service is `service.mjs`) with a D1 database (`migrations/`). `.github/workflows/accounts.yml` only tests it; production is changed only by the owner through `.github/workflows/accounts-deploy.yml` (manual, fail-closed; see "Deploying"). Audit of the live resources and their integrity: [CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md](CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md).
- Address: `core/account-server.mjs` (`ACCOUNT_SERVER`): `https://riwaq-accounts.abadiosa2007.workers.dev`, the Worker's name on the project's workers.dev subdomain. An empty value turns accounts off (the page then says they are coming and nothing is sent). Tests and development set `RIWAQ_ACCOUNT_SERVER` (main's environment, or the web build's).

## What syncs

Exactly what a backup carries (`collectBackup` in `core/backup.mjs`): profiles with their library, progress, queue, collections, connected lists and settings (PIN hashes included), hotkeys and plain addons. It is applied through the backup's own `restoreState`, so every field is validated as on a restore, machine paths (MPV, shaders, audio device) stay per device, and keys the data does not carry are kept from the device.

Keys and connected accounts (provider keys, Stremio sign-in, Trakt/Simkl/Spotify sessions, configured addon addresses, live sources, notification targets) join only when the viewer turns "مزامنة مفاتيحي وحساباتي المربوطة" on. The choice belongs to the account and applies to every device. Trakt's refresh tokens are single-use: two devices refreshing at once can disconnect one of them, which is why this stays off by default.

Clearing under that choice (PR #155 seventh pass, W4). While keys and accounts sync, a payload that carries them (it has `auth`, null when signed out; every Riwaq since 0.5 writes it exactly when secrets are included) is the whole truth for them: removing the last Live TV source, signing out of Stremio, removing a configured addon or clearing the Discord app ID on one device clears it on every device at their next sync, and no device that still had the value can push it back. Without that choice, a payload says nothing about them and each device keeps its own: nothing local is ever cleared by another device. When a device first signs in to an account (no common ancestor), a Stremio sign-in it already has is kept rather than replaced by the account's absent one, and goes up with its other secrets. Signing out of Stremio in Riwaq drops the key from this device and, with the choice on, from the account and the other devices; it does not end the session at Stremio (Riwaq has no Stremio sign-out request). Disconnecting Simkl also revokes its token at Simkl once the disconnect is written; Trakt and AniList tokens are not revoked remotely. Devices still on 0.55 or earlier read a carried clear the old way and can push the value back until they update.

Local music, the account's own session and data key, and the device's active profile do not sync.

## Keys

All derived on the device (`deriveAccountKeys`, `recoveryKeys`):

- `master = scrypt(password NFKC, SHA-256("riwaq-account-v1\0" + username), N=32768, r=8, p=1, 64 bytes)`.
- `authSecret = HMAC-SHA256(master, "auth")` is the only thing the password produces that leaves the device. The service stores `SHA-256(pepper ‖ salt ‖ authSecret)` with a per-user salt and a Worker-secret pepper; a stolen database still costs an attacker a scrypt per guess.
- `wrapKey = HMAC-SHA256(master, "wrap")` never leaves the device. It wraps (AES-256-GCM, bound to the username) the account's random 32-byte data key.
- A recovery code (24 Crockford base32 characters, 120 bits) is shown once at sign-up. It has its own proof and wrap key, so it can set a new password without the old one. Forgetting both loses the account's server copy; each device keeps its own data.
- Data: `"RWQ1" ‖ AES-256-GCM(dataKey, gzip(JSON envelope))`, bound to the username, sent as base64 text.

The session token (random, 32 bytes) and the data key live in the device's encrypted store (DPAPI on Windows, the non-extractable WebCrypto key on the web) and never reach the interface.

## Syncing

- Pull, then merge, then push (`AccountHub.sync`, serialized). A device remembers the version it last agreed with the service (`base`) and its revision.
- The merge is three-way (`merge3`): a value only one side changed takes that change; lists with identities (addons by address, queue by key, titles by type and ID, profiles and collections by ID, strings by value) keep both sides' additions and honour removals; a progress record (numeric `updated`) is replaced whole by the newer one; real conflicts take this device's value, or the account's right after signing in.
- Uploads are conditional on the revision (`X-Riwaq-Base`); a 409 means another device moved first, so the device pulls, merges and tries again.
- What goes up is committed state only (PR #155 fifth and sixth passes). The merge, the application of the account's data and the collection of what goes up run when no commit's write is still out (`Client.atRest`), and every reversible action is a commit (`Client.commit`, `Profiles.transact`, `Client.transact` with an undo of exactly what it changed): profiles, settings, favourites, collections, Live TV favourites and sources, integration preferences and disconnects, Stremio's import, sign-in and sign-out, notification targets, provider keys. A write the store refuses is undone before anything reads the state again, so it never goes up, never reaches another device and is never carried by a backup. A plain save is kept for what has already happened elsewhere: a position, a token a provider issued or rotated (its old refresh token is spent), a provider's list read by a sync. Those are never undone; they are written again with the next save and may sync.
- When: after signing in; every five minutes; when the window or tab comes back; within 30 s of a change (two minutes while a viewing saves its position); and before the app closes.
- An expired or revoked session signs the device out and leaves its data as it was.
- Session ownership: sign-out takes effect locally before its request finishes. Pending sign-in/recovery must still own their original attempt and unlocked Settings profile; old sync, password and deletion replies cannot disconnect a replacement session or overwrite its status. A completed sync returns its final status, so the interface's manual sync button becomes available again.
- Video: if a merge would replace local data while a video is active (including paused/mini playback), it waits. Windows also waits for MPV's child process to retire. The device keeps its base/revision until the merge can happen, then re-pulls and merges the progress saved during viewing. First sign-in keeps its remote conflict priority. Settings shows `account.deferred` as an Arabic waiting message; a network failure keeps the normal retry schedule rather than looping immediately. Local music and Spotify are not covered by this video deferral.
- A secrets choice changed while an upload is in flight remains dirty until the final choice is uploaded. It is not cleared by a reply carrying the previous choice.

## The service

`server/accounts/service.mjs` (through `worker.mjs`), `/v1/…`:

| | |
| --- | --- |
| `POST signup` | username, proofs and both wrapped keys → session |
| `POST login` | proof → session, wrapped key, revision |
| `POST recover/start`, `recover/finish` | recovery proof → recovery-wrapped key; then a new password (every session ends) |
| `GET data` / `PUT data` | the sealed data as text; `If-None-Match` → 304; conditional on `X-Riwaq-Base` |
| `POST password` | old and new proofs; other sessions end |
| `POST logout`, `DELETE account` | |

Limits: usernames `^[a-z0-9][a-z0-9_.-]{2,31}$`; about 5 MB of sealed data (stored in 1.5 MB text pieces, since a D1 row holds 2 MB and returns BLOBs as arrays); 20 devices per account; sessions end after 180 days unused; 10 failed sign-ins per account and 30 per address in 15 minutes; 5 sign-ups per address an hour. Addresses are kept only as peppered hashes, and only in the attempt counters. Browsers may call it only from `ALLOWED_ORIGINS`; the desktop sends no Origin. Bodies are never logged, and are read piece by piece up to their limit (`readBounded`).

Identity (fourth pass of the PR #155 review, migration 0003): an account is an *instance* (`account_id`, random, never reused) with a credential *generation* (`auth_gen`, moved on by a password change or a recovery). A session records both and is valid only while the account still has them; every write and deletion requires them, and the session itself, inside its own transaction. A username deleted and taken again, a password changed or a session signed out meanwhile therefore issues and writes nothing. A pull reads revision, size and pieces in one statement and sends them only when they add up (else 503 `try_again`).

Integrity (database audit 2026-11-18): a session is written only while its account exists, in the same transaction, and one older than its account (or without one) is refused and removed, so a deleted name registered again is never opened by an old device; an upload writes its pieces only while the account is still at the device's base, and its last step removes every piece not of the current revision, all of them once the account is gone; the daily cron (`cleanup`) removes usage past 31 days, expired counters, sessions idle past 180 days and rows without their account.

Cloudflare's free plan (100k requests and 100k database row writes a day) suits a small audience; each upload writes a few rows. Watch the dashboard and move to the paid Workers plan before that becomes tight.

## Setting it up (once)

1. Make a free Cloudflare account. Open **Workers & Pages** once and choose a `workers.dev` subdomain.
2. **My Profile → API Tokens → Create Token**, template **Edit Cloudflare Workers**, then add the permission **Account → D1 → Edit**. Copy the token.
3. Put the **Account ID** shown in the dashboard's address bar in `server/accounts/wrangler.toml` (`account_id`); it is not a secret. This repository already carries its own.
4. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**: `CLOUDFLARE_API_TOKEN`, with nothing but the token in it. The workflow removes what pasting adds (spaces, invisible marks, quotes, a `Bearer` prefix, a `CLOUDFLARE_API_TOKEN=` name in front) with `server/accounts/check-token.mjs`, refuses an ID, the Global API Key or a link in its place, and asks Cloudflare (`wrangler whoami`) first; when Cloudflare refuses, the error gives the value's shape (length and kinds of characters), never the value.
5. The first deployment (2026-10-11) created the D1 database and `AUTH_PEPPER`. Since the fourth pass the deploy workflow never creates either: it refuses when the database is missing or the pepper absent, so a new setup creates them by hand once (`wrangler d1 create riwaq-accounts`; `wrangler secret put AUTH_PEPPER` with 48 random bytes) before its first run.
6. Check that the printed address matches `core/account-server.mjs` (a different subdomain or Worker name means changing it there), then release: the app and the site offer accounts.

Locally: `node server/accounts/local.mjs` runs the same Worker over Node's SQLite (each migration applied once, recorded in `d1_migrations`).

## Deploying (the owner only)

Merging changes nothing in production. **Actions → Account service (deploy to production) → Run workflow**, on `main`, with: the confirmation `deploy <first 7 characters of the commit>`, the D1 database ID, the migrations expected to be pending (or `none`), and *dry run* (on by default: every read-only check and a bundle, nothing changed). The run refuses unless the owner started it; it checks the token's account, exactly one `riwaq-accounts` with that ID, the pending migrations exactly as typed and `AUTH_PEPPER` present before anything changes, records the current deployment and the Time Travel bookmark in its summary, then (dry run off) applies the migrations, deploys, requires the expected address and a healthy `/v1/health`, and runs the live throwaway-account test. Every step fails on any failure. To make the `accounts-production` environment an approval gate too, add it in **Settings → Environments** with the owner as required reviewer and move `CLOUDFLARE_API_TOKEN` into it as an environment secret. Steps, rollback and what a rollback cannot undo: [CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md](CLOUDFLARE-DATABASE-AUDIT-2026-11-18.md), "Fourth pass".

## Verified here

- `tests/account.test.mjs`: the merge, names and recovery codes, the sealed format, and the real Worker in-process over SQLite with two and three clients (sign-up, wrong password, sign-in on a second device, changes both ways, keys off and then on, recovery signing other devices out, password change, deletion, two devices changing at once, the Settings lock, no server configured). The service's tables never contain titles, IDs, passwords, setting names or keys.
- `tests/accounts-server.test.mjs`: rate limits, origins, size limits, revisions, piece clean-up, session expiry and the device cap.
- `scripts/test-web.mjs`: in Chromium, an account is made through the interface on one device and its recovery code shown; another device signs in through the interface and receives the library, settings and addons; a change on one reaches the other.
- `tests/accounts-instances.test.mjs` (fourth pass): every race on identity and writes landed where it falls, the one-statement pull, migration 0003 on data written by the previous Worker; `scripts/test-accounts-released.mjs`: v0.40.0, v0.54.0 and v0.55.0 clients across the previous Worker, migration 0003 and this Worker; `scripts/test-accounts-workerd.mjs`: Wrangler 4.141.0 + workerd with a local D1, 0003 on legacy rows and the live smoke.
- `scripts/test-account-live.mjs`, which the deploy workflow runs against the deployed Worker and D1 after every deploy: a throwaway account is made, a wrong password refused, a second client signs in and receives the data, changes on both merge both ways, and the account is deleted with its sessions ended. First passed on 2026-10-11 against `https://riwaq-accounts.abadiosa2007.workers.dev`.
- Not run: the desktop app on Windows signing in, and real-world timing of the merge with several active devices.
- Review after 0.40: `tests/account.test.mjs` now has 20 tests, including delayed real Worker replies, replacement sessions, Settings lock during auth, a choice changed mid-upload, a remote PIN change during viewing, preserved progress and conflict priority, idle status returned to IPC, and a failed deferred sync without an immediate retry loop. `scripts/test-web.mjs` also exercises manual sync through the button and defers remote settings during an actual video, shows the waiting message with the mini player, then applies the settings after Stop at 980×680. See [REVIEW-2026-10-11.md](REVIEW-2026-10-11.md).
