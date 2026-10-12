# Riwaq on the web

Riwaq's web edition is for viewers who cannot or do not want to install the Windows app. It is **the same program**: the interface in `src/` and everything in `core/` are compiled for a browser, and only the parts that touch Windows are replaced. Every release publishes both editions from the same commit, so a change to the app is a change to the site.

- Build: `npm run build:web` (output in `dist-web/`). Develop: `npm run dev:web`.
- Smoke test in a real Chromium: `npm run build:web && node scripts/test-web.mjs` (needs Playwright; see the script's header).
- Published by `.github/workflows/web.yml` to GitHub Pages. `release.yml` calls it after every published release; it can also be run by hand from the Actions tab. Pull-request CI builds the site and runs the smoke test, so a change that breaks the web fails before it merges.
- One-time repository setting: **Settings → Pages → Build and deployment → Source: GitHub Actions**. Releases cut by `workflow_dispatch` on `main` deploy as they are. A release started by pushing a `v*` tag runs on the tag's ref, which the `github-pages` environment refuses by default; allow `v*` tags under **Settings → Environments → github-pages** if you release that way.

## How it fits together

| Desktop                                          | Web (`web/`)                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `electron/preload.cjs` exposes `window.riwaq`    | `web/bridge.js` installs the same `window.riwaq` (`call`, `on`, plus `platform: "web"`)                                                                            |
| `electron/main.mjs` `methods` table              | `web/bridge.js` `methods` table, built on the same `core/Client`                                                                                                   |
| `profile.bin` sealed with DPAPI (`safeStorage`)  | `web/store.js`: AES-256-GCM under a **non-extractable** WebCrypto key kept in IndexedDB; no plaintext fallback                                                     |
| MPV embedded with `--wid`                        | `web/player.js`: an HTML5 `<video>` (with hls.js) placed inside the theater's `.video-surface`, with the same state shape and commands                             |
| Native file dialogs                              | `web/files.js`: the browser's file picker and downloads                                                                                                            |
| Loopback servers for Stremio and Spotify sign-in | A popup that returns to the site; the answer reaches the tab over a same-origin `BroadcastChannel` and is taken only with that attempt's nonce (`web/callback.js`) |
| `DesktopUpdates` (signed NSIS packages)          | `web/updates.js`: the open page checks `version.json` and offers a reload                                                                                          |
| `node:crypto`, `node:zlib`, `node:net`           | `web/shims/` (aliased in `vite.web.config.mjs`), byte-for-byte compatible: a backup made on one edition opens on the other                                         |

The interface checks `isWeb` (`src/lib/api.js`) in two places only: Settings leaves out the MPV picture and sound pages, the window page and MPV's key map (links to them land on a sensible page), and the updates card explains that the site updates itself.

## Rules that keep the editions together

- **Every method in `electron/preload.cjs` is answered by `web/bridge.js` or listed in `web/desktop-only.js`** with the Arabic sentence the viewer sees. `tests/web-edition.test.mjs` fails otherwise, and also fails when an event, a `node:` import in `core/`, or the release hook is missing. Adding a desktop feature therefore means deciding what the web does with it.
- Calls and events cross the web bridge as copies (`structuredClone`), as they cross Electron's IPC, and errors reach the interface through the same `cleanError` rules: Arabic, never an address.
- Keys, tokens and addon URLs stay on the bridge's side exactly as they stay in main: subtitles, channels and sources are opaque keys, addresses are opened only after main's own checks (`musicLink`, `artworkHost`, `trailerOf`, the fixed service list).
- One tab owns the store at a time (Web Locks), as the desktop runs one instance.
- `web/` holds only what differs. Behaviour belongs in `core/` so both editions run it.
- The interface language (0.42) is the same setting in both editions. Web text drawn outside the interface follows it too: the pill (its own React root) renders again when the page's `lang` changes, and boot messages shown before the interface loads use the language this device last used. Sentences in `web/desktop-only.js` are written in Arabic and translated like every other string.

## What the browser cannot do (said, not pretended)

- `web/desktop-only.js`: choosing MPV or a GLSL shader, choosing the audio device, scanning Nuvio Desktop's folder (a Nuvio backup zip works), and Discord Rich Presence.
- Playback is the browser's: no MPV filters, RTX, true HDR, audio delay, or volume above 100%; no seek previews; MKV files' embedded subtitle tracks are not listed. Brightness, contrast, saturation, zoom, pan, shape and fill are applied with CSS.
- Formats a browser does not decode (often MKV with HEVC, AC-3 or DTS) and plain-HTTP addresses on the HTTPS site are handed to the viewer's own **Stremio Service** on `127.0.0.1:11470` when it runs: the service converts them to HLS on the viewer's machine (`/hlsv2/…/master.m3u8?mediaURL=…`, the conversion Stremio's own web player asks of it). Torrents need the service too. Without it the viewer is told why and failover tries the next source.
- Sources whose addon asks for special request headers may fail: a browser does not let a page set them on media.
- Hosts that do not send CORS headers cannot be read by a page. Stremio addons, Cinemeta, TMDB, Trakt's API and Wikidata do; IPTV playlists and some subtitle hosts often do not (subtitles then go through the Stremio Service when it runs).
- Local music works for the visit only: a page cannot keep a path to a file, so picked songs are held in memory and forgotten on reload. Nothing is uploaded.
- The site needs no account and is static files; everything the viewer adds stays encrypted in their browser. An optional Riwaq account (0.40, docs/ACCOUNTS.md) syncs it, still encrypted on the device first.
- `Buffer` is the npm polyfill plus `base64url` (`web/shims/buffer.js`). 0.39.0 lacked the encoding, so Spotify linking and the Letterboxd bridge failed on the web; the tests now load the same polyfill.

## Verified here

- `tests/web-edition.test.mjs` (Node): bridge parity, events, shim byte-equality with Node (SHA-256, scrypt, AES-256-GCM, gzip, raw inflate), a backup sealed by the web build opened by the desktop's `core/backup.mjs` and the other way round, the playback plan, sign-in callbacks, the fetch wrapper, local music limits and the release hook.
- `scripts/test-web.mjs` (headless Chromium, local addon, no internet): the site starts with the bridge; an addon installs; the stored profile is ciphertext; a second tab is refused; a reload reopens the store; Discover shows the addon's titles; a stream plays in the theater; an addon subtitle shows; pause and stop work and the position is saved; a web backup decrypts with Node.
- Not verified here: sign-in with a real Stremio or Spotify account (the Stremio callback depends on how stremio.com appends the key to `appCallback`), Trakt from a browser, a real Stremio Service's HLS conversion, and Safari/Firefox. Record such checks in VERIFICATION.md when they are run.
