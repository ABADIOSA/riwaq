# Riwaq accounts

An optional Riwaq account carries a viewer's data between the Windows app on several PCs and the web edition. Nothing changes for a viewer who never makes one. Accounts are end-to-end encrypted: the service stores data it cannot read.

- Client: `core/account.mjs` (`AccountHub`, on `client.account`), `core/sync-merge.mjs`, the Settings page `src/components/settings/AccountPage.jsx` (Settings → الحسابات والربط → حساب رِواق).
- Service: `server/accounts/` — a Cloudflare Worker (`worker.mjs`) with a D1 database (`migrations/`), deployed by `.github/workflows/accounts.yml`.
- Address: `core/account-server.mjs` (`ACCOUNT_SERVER`): `https://riwaq-accounts.abadiosa2007.workers.dev`, the Worker's name on the project's workers.dev subdomain. An empty value turns accounts off (the page then says they are coming and nothing is sent). Tests and development set `RIWAQ_ACCOUNT_SERVER` (main's environment, or the web build's).

## What syncs

Exactly what a backup carries (`collectBackup` in `core/backup.mjs`): profiles with their library, progress, queue, collections, connected lists and settings (PIN hashes included), hotkeys and plain addons. It is applied through the backup's own `restoreState`, so every field is validated as on a restore, machine paths (MPV, shaders, audio device) stay per device, and keys the data does not carry are kept from the device.

Keys and connected accounts (provider keys, Stremio sign-in, Trakt/Simkl/Spotify sessions, configured addon addresses, live sources, notification targets) join only when the viewer turns "مزامنة مفاتيحي وحساباتي المربوطة" on. The choice belongs to the account and applies to every device. Trakt's refresh tokens are single-use: two devices refreshing at once can disconnect one of them, which is why this stays off by default.

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
- When: after signing in; every five minutes; when the window or tab comes back; within 30 s of a change (two minutes while a viewing saves its position); and before the app closes.
- An expired or revoked session signs the device out and leaves its data as it was.

## The service

`server/accounts/worker.mjs`, `/v1/…`:

| | |
| --- | --- |
| `POST signup` | username, proofs and both wrapped keys → session |
| `POST login` | proof → session, wrapped key, revision |
| `POST recover/start`, `recover/finish` | recovery proof → recovery-wrapped key; then a new password (every session ends) |
| `GET data` / `PUT data` | the sealed data as text; `If-None-Match` → 304; conditional on `X-Riwaq-Base` |
| `POST password` | old and new proofs; other sessions end |
| `POST logout`, `DELETE account` | |

Limits: usernames `^[a-z0-9][a-z0-9_.-]{2,31}$`; about 5 MB of sealed data (stored in 1.5 MB text pieces, since a D1 row holds 2 MB and returns BLOBs as arrays); 20 devices per account; sessions end after 180 days unused; 10 failed sign-ins per account and 30 per address in 15 minutes; 5 sign-ups per address an hour. Addresses are kept only as peppered hashes, and only in the attempt counters. Browsers may call it only from `ALLOWED_ORIGINS`; the desktop sends no Origin. Bodies are never logged.

Cloudflare's free plan (100k requests and 100k database row writes a day) suits a small audience; each upload writes a few rows. Watch the dashboard and move to the paid Workers plan before that becomes tight.

## Setting it up (once)

1. Make a free Cloudflare account. Open **Workers & Pages** once and choose a `workers.dev` subdomain.
2. **My Profile → API Tokens → Create Token**, template **Edit Cloudflare Workers**, then add the permission **Account → D1 → Edit**. Copy the token.
3. Put the **Account ID** shown in the dashboard's address bar in `server/accounts/wrangler.toml` (`account_id`); it is not a secret. This repository already carries its own.
4. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**: `CLOUDFLARE_API_TOKEN`, with nothing but the token in it.
5. Run **Actions → Account service → Run workflow** (it also runs when `server/accounts` changes on `main`). The first run creates the D1 database, applies the migrations, deploys the Worker and generates `AUTH_PEPPER` as a Worker secret. Its summary prints the address.
6. Check that the printed address matches `core/account-server.mjs` (a different subdomain or Worker name means changing it there), then release: the app and the site offer accounts.

Locally: `node server/accounts/local.mjs` runs the same Worker over Node's SQLite.

## Verified here

- `tests/account.test.mjs`: the merge, names and recovery codes, the sealed format, and the real Worker in-process over SQLite with two and three clients (sign-up, wrong password, sign-in on a second device, changes both ways, keys off and then on, recovery signing other devices out, password change, deletion, two devices changing at once, the Settings lock, no server configured). The service's tables never contain titles, IDs, passwords, setting names or keys.
- `tests/accounts-server.test.mjs`: rate limits, origins, size limits, revisions, piece clean-up, session expiry and the device cap.
- `scripts/test-web.mjs`: in Chromium, an account is made through the interface on one device and its recovery code shown; another device signs in through the interface and receives the library, settings and addons; a change on one reaches the other.
- Not run: the Worker on Cloudflare itself (needs the account above), the desktop app on Windows signing in, and real-world timing of the merge with several active devices.
