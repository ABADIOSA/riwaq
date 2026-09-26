# Riwaq 0.5 — backups, up next, live Trakt and update checks

Built on the 0.4 queue work in pull request #3, with its commits included. Three defects found reviewing #3 are fixed first; everything from 0.3 and 0.4 is preserved.

## Review fixes to 0.4

- Manual completion counted as playback. A mark was stamped "now", and continue watching keeps each title's most recent record, so ticking off an earlier episode through the IPC method hid the episode in progress. The 0.4 screens only mark each title's latest record and did not reach it; the per-episode marks added in 0.5 would have. A mark now keeps the record's playback time and stores `markedAt` separately.
- Library search and Live TV search folded Arabic differently, so "القاهره" found a channel but not the film of the same name. Both use `core/arabic.mjs`.
- A wrong PIN stopped playback before the switch was refused. `Profiles.check()` answers without changing state and main runs it first.

## Backup and restore

`profile.bin` is sealed with DPAPI and cannot be opened on another Windows account or machine. A `.riwaq` backup carries profiles, libraries, queues, history, settings, hotkeys and addons to a reinstall or a new PC.

- Always encrypted: scrypt (N=32768, r=8, p=1) derives the key, AES-256-GCM seals a gzipped payload, and the readable header is authenticated data. KDF parameters are bounded before scrypt runs. Passphrases are NFKC-normalized and at least eight characters.
- Secrets stay out unless the viewer opts in: configured addon URLs, the Stremio sign-in, provider keys, platform tokens, live sources and notification targets. What was left out is counted and shown. PIN hashes always travel; machine paths never do.
- Restore is pick, preview, confirm. Every section is validated as if entered by hand. Secrets the backup does not carry are kept from the current installation, the restored profile starts locked, derived caches reset and the previous `profile.bin` is kept as `profile.before-restore.bin`.
- A locked Settings room gates export, preview and restore in core, not only in the interface.

## Up next, calendar and watched marks

- Followed series: saved, queued or watched at least once; the forty most recently touched.
- Up next: the first released regular episode after the furthest one finished, flagged "جديدة" if it aired within fourteen days. A title with an episode in progress stays in continue watching; specials never count as next.
- Calendar: aired and upcoming episodes for the past week and next month, grouped by day in the viewer's time zone; undated episodes are left out.
- Details: mark or unmark the selected episode, or mark everything up to it.

## Trakt scrobbling

Opt-in, and only while history tracking is on. Start, pause and stop follow the player; a stop at 80% or more records the play, earlier saves the position. In scrobble mode the completion queue stands down. A play is written ahead to the queue and held while its stop is in flight; success or 409 removes it, failure releases it, and a hold older than a minute is treated as abandoned. Replies are bound to the account that sent them. Quit waits up to three seconds for in-flight scrobbles.

## Update checks

One anonymous request a day to GitHub's release list, identified as `Riwaq/<version>`, turned off by a setting. Versions are compared with semantic-version precedence because every release so far is a prerelease, which `/releases/latest` skips. Only this repository's release pages can be opened, and only from a URL main validated. Nothing is downloaded or installed.

## Arabic

`arabicCount()` applies Arabic number agreement through `Intl.PluralRules("ar")`. Dates added in 0.5 are Gregorian with Latin digits, matching the episode calendar; `ar-SA` alone would render Umm al-Qura dates.

## Limits

No Windows desktop smoke run, packaged build or real Trakt account was exercised for 0.5; see VERIFICATION.md. A forgotten backup passphrase cannot be recovered. Unauthenticated GitHub API calls are limited to 60 per hour per IP, so an update check can fail quietly on shared networks and is retried the next day.
