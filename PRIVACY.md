# Riwaq Privacy Policy

**Version 1.0 · Effective 1 November 2026** · [النسخة العربية](PRIVACY.ar.md)

This policy explains what information the Riwaq app handles, where it goes and what you can do about it. It describes the Riwaq desktop app for Windows, the Riwaq web edition and the optional Riwaq account service, as they exist in the version of the code published alongside this file.

Riwaq is free, open-source software under the MIT license. Everything this policy says can be checked in the source code at <https://github.com/ABADIOSA/riwaq>.

## 1. Who is responsible

Riwaq is maintained by the owner of the GitHub account **ABADIOSA** ("the maintainer", "we"). The maintainer operates two things on which information about you can arrive:

- the optional **Riwaq account service** (a Cloudflare Worker with a Cloudflare D1 database at `riwaq-accounts.abadiosa2007.workers.dev`), and
- the optional **usage statistics** endpoint on the same service.

The web edition is published on GitHub Pages (`abadiosa.github.io`). Every other service mentioned below is run by someone else, and Riwaq only talks to it because you use a feature that needs it.

## 2. The short version

- Riwaq works fully **without an account**. Your library, progress, profiles, settings and keys are stored **on your own device, encrypted**.
- Riwaq shows **no ads**, runs **no analytics or tracking**, and sends **no crash reports**.
- A **Riwaq account** is optional and **end-to-end encrypted**: the service stores your data in a form it cannot read.
- **Usage statistics are off until you turn them on**, and contain only a random device token, the platform and the app version.
- **Addons and services you choose** (Stremio addons, TMDB, Trakt, Simkl, AniList, debrid services and others) are contacted directly from your device and follow their own privacy policies.
- **Torrent sources** share your network (IP) address with other peers while they play.

## 3. Information stored only on your device

Unless you turn on a feature that sends it somewhere (sections 4 and 5), the following never leaves your device:

| What | Where it is kept |
| --- | --- |
| Profiles, their names and avatars, and profile PINs (stored as scrypt hashes, never as the PIN) | Riwaq's encrypted state file |
| Your library, favourites, collections, watch queue, watch history and playback positions | Encrypted state, per profile |
| Settings and appearance choices | Encrypted state, per profile |
| Installed addon addresses (which can contain your own configuration or tokens) | Encrypted state |
| Keys and sign-ins you add: TMDB, OMDb, MDBList, Fanart.tv, TheIntroDB, debrid services, AI providers, Trakt, Simkl, AniList, Spotify, Stremio, Jellyfin/Emby, live TV sources, Discord and Telegram notification targets | Encrypted state |
| Downloads for offline viewing, their posters and the torrent cache | Riwaq's private folder in your user profile (`AppData\Roaming\Riwaq` on Windows) |
| Local music library paths, screenshots, MPV's last log | Riwaq's folder on your device |
| Error log for the diagnostic report | Memory only, cleared when the app closes |

**Encryption on the device.** On Windows, Riwaq's state is encrypted with Electron `safeStorage`, which uses Windows DPAPI tied to your Windows account; Riwaq refuses to store it unencrypted. In the web edition, state is sealed with AES-256-GCM under a non-extractable WebCrypto key kept in your browser's IndexedDB; a browser that cannot do this keeps nothing. Downloads, screenshots and caches are ordinary files protected by your operating system's file permissions, not by Riwaq's encryption.

**Backups** are files you export yourself. They are always encrypted with a passphrase you choose, exclude keys and sign-ins unless you tick the option to include them, and never include downloads, local music paths or machine-specific paths.

**Diagnostic report.** Settings → System & diagnostics can build a report about the app's health. It is generated on your device, has addresses reduced to host names and keys, tokens and e-mail addresses removed, and is only shared if you copy or save it yourself.

## 4. Information sent to Riwaq's own service (optional)

### 4.1 Riwaq account

Creating an account is optional. If you create one:

- **What the service stores:** your username; a salted, peppered hash of a proof derived from your password on your device (your password itself is never sent); your data key wrapped (encrypted) by keys only your password or recovery code can produce; a recovery proof hash and wrapped key; your encrypted data and its size and revision number; and session records (a hash of each session token with its creation and last-used times).
- **Your data is end-to-end encrypted.** It is the same content as a backup (profiles, library, progress, collections, settings, plain addon addresses) and is encrypted on your device with AES-256-GCM before upload. Keys and linked sign-ins are included only if you turn on "Sync my keys and linked accounts". The maintainer cannot read your data, reset your password or recover your data if you lose both your password and your recovery code.
- **What the service can see:** your username, when you sign in and sync, how large your encrypted data is, and the network address of each request (see section 4.3).
- **Retention:** your data stays until you delete the account. Sessions end after 180 days without use. Older revisions of your encrypted data are replaced on each upload.
- **Deletion:** Settings → Accounts & linking → Riwaq account → delete account removes your user record, all your encrypted data and all your sessions from the database immediately. Data already on your devices is not touched.

### 4.2 Usage statistics

Off until you turn them on in Settings → System & diagnostics → Privacy (or during first-run setup). When on, the app sends, about every two minutes while it is in use, a random 64-character token created for this device, the platform (`desktop` or `web`) and the app version. It sends nothing else: no name, account, profile, title, viewing activity, addon or source address.

The service stores only a peppered hash of the token, the platform, the version and the time last seen, and uses them to count active devices by version. Records not seen for 31 days are deleted by a daily job. Turning statistics off sends a deletion request that marks the device's record as revoked and clears its platform and version. The choice belongs to the device and never travels in backups or accounts.

### 4.3 Network addresses and rate limiting

Like any internet service, Cloudflare receives the network (IP) address of each request to the account service. The Worker uses it only to limit repeated sign-in and sign-up attempts, and keeps it only as a peppered hash inside short-lived attempt counters (15 minutes to an hour). The Worker never logs request bodies. Cloudflare, as the hosting provider, processes request data under its own terms and privacy policy (<https://www.cloudflare.com/privacypolicy/>).

## 5. Information sent directly to third parties

Riwaq connects to the services below **from your device**. Their handling of your data is governed by their own policies; Riwaq does not control it.

### 5.1 Sent while you browse and watch

- **Stremio addons you install** (including Cinemeta, Stremio's own catalog addon, installed by default): receive requests for catalogs, titles, sources and subtitles (for example the IMDb ID of a title you open), along with your network address. Addons are run by independent operators.
- **Artwork and metadata:** images load from `images.metahub.space`, `image.tmdb.org`, `assets.fanart.tv` and addon-provided HTTPS addresses. Wikidata (`query.wikidata.org`, `www.wikidata.org`) and Wikimedia Commons are asked for credits, filming locations and portraits using the title's or person's public ID; OpenStreetMap tiles draw location maps. With your own TMDB, OMDb, MDBList or Fanart.tv key, those services receive the title IDs you open.
- **Theme songs** (on by default on title pages; can be turned off): Apple's iTunes Search and Deezer's public API receive the title's name to find its soundtrack, and previews stream from Apple and Deezer servers. With Spotify linked, Spotify is searched too.
- **Skip segments** (off by default): TheIntroDB and AniSkip receive the title's ID, season and episode numbers and its duration.
- **Torrents:** when a source is a torrent, the built-in engine (or your Stremio Service or TorrServer) joins the torrent's swarm. **Other peers, trackers and the DHT network see your network address and which torrent you are fetching and sharing.** The built-in engine also contacts public trackers and DHT bootstrap nodes, and, when "accept incoming connections" is on, asks your router to open a port through UPnP/NAT-PMP. If you install TorrServer, it independently contacts themoviedb.org, public IP-lookup services and public tracker lists. Torrent use may be subject to the laws where you live; Riwaq supplies no content.
- **Speed test** (only when you press "Measure"): downloads a test file from `speed.cloudflare.com`.
- **Trailers** open YouTube in your browser.

### 5.2 Sent only when you link or turn on a service

- **Trakt, Simkl, AniList:** sign-in tokens are stored on your device. Importing lists reads your lists. Watch history, scrobbling (Trakt, Simkl) and anime progress (AniList) are **sent only if you turn tracking on**, and then include the titles and episodes you watch and your progress.
- **Letterboxd:** Riwaq reads a CSV you export yourself, or uses the public Stremboxd bridge if you choose it. Riwaq never asks for your Letterboxd password.
- **Stremio account:** your Stremio sign-in imports your addons and library from Stremio's servers (one-way).
- **Spotify:** with your own Spotify Client ID, Riwaq controls playback through Spotify Connect and reads your devices and playlists.
- **Debrid services** (Real-Debrid, AllDebrid, Premiumize, TorBox, Debrid-Link): your key is used to read your account status. **Home servers** (Jellyfin, Emby): your sign-in is sent once to your server to obtain a token.
- **AI search** (Groq or OpenRouter, with your own key): only the sentence you type is sent, and only when you press the button.
- **Discord Rich Presence** (off by default): shares what you are watching (or a generic line, or nothing, as you choose) with your Discord app and contacts on Discord.
- **Discord or Telegram notifications** (off by default): send short messages about viewing events (such as a title you started or finished) to the webhook or bot you configure.
- **Live TV:** your own playlist or Xtream sources are contacted with the credentials you provide.

### 5.3 App updates and announcements

- **Update checks** (on by default; can be turned off in Settings → System & diagnostics → Updates): the desktop app reads release information from the GitHub API (`api.github.com`) or GitHub's release feed, and downloads update packages from GitHub. Packages are verified with an Ed25519 signature and SHA-512 checksum before they run.
- **Announcements** (can be turned off from the notification centre): the app reads a small public notice file from GitHub (`raw.githubusercontent.com`). Which notices you have read stays on your device.
- GitHub receives your network address and the usual request information for these requests, under GitHub's privacy statement.

## 6. The web edition

The web edition runs in your browser from GitHub Pages. GitHub, as host, receives the usual request information (such as your network address) when the site loads. Your Riwaq data stays in your browser's storage, encrypted as described in section 3, and only one tab owns it at a time. Torrents in the web edition play only through your own Stremio Service on your computer. Sign-in pop-ups for linked services return to the site and pass their answer within your browser.

## 7. How we protect information

- On-device encryption with Windows DPAPI or a non-extractable WebCrypto key, with no unencrypted fallback.
- End-to-end encryption for accounts (scrypt-derived keys, AES-256-GCM); the service holds only hashes and wrapped keys.
- Secrets (keys, tokens, addon addresses with credentials, live TV credentials) stay in the app's main process and are never shown to the interface or written to logs or diagnostics.
- Requests to sensitive services refuse redirects; local torrent servers listen only on your own computer and require a random path token.
- Update packages are signed and verified before they run.

No system is perfectly secure. If you find a security problem, please report it as described in section 12, without posting secrets or personal data publicly.

## 8. Retention

| Information | How long |
| --- | --- |
| Data on your device | Until you delete it, remove the profile, or uninstall Riwaq and delete its folder |
| Account data and sessions | Until you delete the account; unused sessions end after 180 days |
| Usage statistics records | Deleted 31 days after a device was last seen (checked daily) |
| Sign-in attempt counters | 15 minutes to 1 hour |
| Third-party services | As set by each service's own policy |

## 9. Your choices and rights

- **Use Riwaq without an account** and without linking any service.
- **Turn off** usage statistics, update checks, announcements, theme songs, Discord presence, notifications and tracker history at any time in Settings.
- **See and export** your data through an encrypted backup (Settings → System & diagnostics → Backup).
- **Delete** downloads, the torrent cache, profiles and their data inside the app. Uninstalling Riwaq does not remove its data folder automatically; delete `%APPDATA%\Riwaq` to remove everything from a Windows PC. In the web edition, clearing the site's data in your browser removes it.
- **Delete your Riwaq account** from the account page; this removes your data from the service.
- **Disconnect** any linked service; Riwaq deletes its stored token and pending writes. Data a service already received stays with that service, and you can ask it directly to delete it.

Depending on where you live, you may have further rights over personal data (such as access, correction, deletion or objection). Because the account service stores your data encrypted under keys only you hold, most requests are fulfilled directly from the app. For anything else, contact us as described in section 12.

## 10. Children

Riwaq is a general-purpose media app and is not directed at children. The account service does not ask for age, name, e-mail or any contact detail. Profiles can be locked with a PIN and can hide adult content; parents remain responsible for supervising use and for the addons and services they install.

## 11. International processing

Riwaq's account service runs on Cloudflare's global network, so requests may be processed in data centres outside your country. Third-party services you use may also process data in other countries under their own terms.

## 12. Contact

Riwaq does not yet have a dedicated privacy e-mail address. For privacy questions, requests or security reports, open an issue at <https://github.com/ABADIOSA/riwaq/issues>. Do not include passwords, keys, recovery codes, tokens or other personal data in a public issue; if a request needs private details, say so in the issue and the maintainer will arrange a private channel.

## 13. Changes to this policy

When Riwaq's handling of information changes, this file is updated in the same change, its version and effective date change, and the release notes say so. The app shows the version it was built with in Settings → System & diagnostics → Privacy. Earlier versions remain available in the repository's history.

---

This policy describes the software's actual behaviour and does not claim compliance with any particular law or certification.
