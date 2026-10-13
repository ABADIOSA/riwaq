# Sources and acknowledgments

Riwaq is an independent implementation of a desktop client for the Stremio HTTP addon protocol. It is not an official Stremio application and is not a merged build of the projects below.

## Design and behavior references

- Harbor: https://github.com/harborstremio/harbor (MIT), source reviewed at commit 0117755. Reference for configured addon transport preservation, native-player behavior, the shape of a source-ranking pipeline, IPTV catchup conventions, profiles with a parental PIN, and optional presence and webhooks. No Harbor code is included; Riwaq is JavaScript on Electron and Harbor is Rust and TypeScript on Tauri.
- NuvioDesktop: https://github.com/NuvioMedia/NuvioDesktop (GPL-3.0), source reviewed at commit 48e1ca3 (0.1.24-alpha). Reference for discovery, library organization, and resume flows. No Nuvio code is included.
- Stremio Community v5: https://github.com/Zaarrg/stremio-community-v5 (GPL-3.0), source reviewed at commit 3e96a6f ("Bump to version 5.0.22"); the newest tagged release at review time was 5.0.0-beta.22. Reference for native MPV surface area, language priorities, HDR and upscaling settings, Discord Rich Presence, and floating playback. No Community shell code is included.
- Stremio addon protocol: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
- Stremio resource schemas: https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api/responses
- MPV IPC documentation: https://mpv.io/manual/stable/#json-ipc
- XMLTV DTD (guide format): https://github.com/XMLTV/xmltv/blob/master/xmltv.dtd
- Discord RPC / IPC documentation: https://discord.com/developers/docs/topics/rpc
- Riwaq bundles no Anime4K files and no third-party shaders; its picture profiles are built from MPV's own scaler, deband and sigmoid options. Since 0.41 a viewer may press Download to fetch, into their own Riwaq data folder, these upstream releases, pinned by URL, size and SHA-256 in `core/shaders.mjs`. They keep their own licenses, and nothing from them is redistributed with Riwaq:
  - Anime4K 4.0.1 by bloc97, MIT: https://github.com/bloc97/Anime4K (release asset `Anime4K_v4.0.zip`)
  - FSRCNNX 1.1 by igv, LGPL-3.0 shader files: https://github.com/igv/FSRCNN-TensorFlow (`FSRCNNX_x2_8-0-4-1.glsl`, `FSRCNNX_x2_16-0-4-1.glsl`)

## Bundled runtimes

- Electron (MIT and Chromium third-party licenses): https://github.com/electron/electron. Electron's LICENSE.electron.txt and LICENSES.chromium.html are retained in the unpacked distribution.
- React / React DOM (MIT): https://github.com/facebook/react
- Lucide (ISC): https://github.com/lucide-icons/lucide
- WebTorrent 3.0.21 (MIT): https://github.com/webtorrent/webtorrent — the built-in torrent engine (core/torrent-engine.mjs, electron/torrent-engine.mjs), run only when the viewer chooses it. Its dependency tree (about 150 packages) is MIT, ISC, BSD, Apache-2.0 and BlueOak-1.0.0, with one exception: node-datachannel (below). `npm ls --omit=dev --all` lists the exact tree and each package keeps its license file in `node_modules`.
- node-datachannel 0.32 (MPL-2.0): https://github.com/murat-dogan/node-datachannel — native WebRTC (libdatachannel, MPL-2.0) that WebTorrent loads for browser peers. It ships unmodified as a prebuilt N-API binary in `app.asar.unpacked`; its source is at that address, and its LICENSE file is retained.
- Native helpers of that tree, unmodified prebuilt N-API binaries in `app.asar.unpacked`: utp-native (MIT), bufferutil and utf-8-validate (MIT), fs-native-extensions (Apache-2.0).
- Riwaq does not bundle or download Stremio's streaming server (`server.js`): Stremio states it "includes proprietary code and is not meant to be used / distributed outside of an official Stremio app" (https://github.com/Stremio/stremio-shell/issues/435). Viewers who prefer it run their own Stremio Service (GPL-2.0, https://github.com/Stremio/stremio-service), which Riwaq only connects to.
- MPV is a separate executable distributed in resources/mpv, with its FFmpeg, libplacebo and other DLLs. Build: MPV's own stable release v0.41.0 (mpv git 41f6a64), x86_64 MinGW, from the mpv-player/mpv GitHub release. MPV and its dependencies retain their own licenses, including GPL/LGPL; the Riwaq MIT license does not relicense those binaries.
  - Release: https://github.com/mpv-player/mpv/releases/tag/v0.41.0
  - MPV corresponding revision: https://github.com/mpv-player/mpv/commit/41f6a64
  - MPV license and dependency information: https://github.com/mpv-player/mpv/blob/master/Copyright
  - Exact downloaded archive: mpv-v0.41.0-x86_64-w64-mingw32.zip (it holds the CI build mpv-git-2025-12-21-41f6a64-x86_64.zip)
  - SHA-256: a49811c0752c108b8260636f9c6f6fcb97406641c98b30f1e7b500dfb20177de
  - Earlier builds came from shinchiro/mpv-winbuild-cmake daily releases (20260610, then 20261007), which that project removes after a few weeks.

## Web edition only

Bundled into the web edition (`npm run build:web`, docs/WEB.md); none of these ship in the Windows app.

- hls.js 1.7.3 (Apache-2.0): https://github.com/video-dev/hls.js — HLS playback through Media Source Extensions.
- @noble/hashes 2.4.0 and @noble/ciphers 2.4.0 (MIT): https://github.com/paulmillr/noble-hashes, https://github.com/paulmillr/noble-ciphers — SHA-1/SHA-256/SHA-512, scrypt and AES-256-GCM with Node's results, so backups and PIN hashes match the desktop's.
- fflate 0.8.3 (MIT): https://github.com/101arrowz/fflate — gzip and raw inflate for backups and Nuvio backup zips.
- buffer 6.0.3 (MIT): https://github.com/feross/buffer — Node's Buffer for core/ in the browser.

## Account service

The optional account service (server/accounts, docs/ACCOUNTS.md) runs on Cloudflare Workers and D1. It ships no third-party code; Wrangler (MIT/Apache-2.0, https://github.com/cloudflare/workers-sdk) is installed only in the deployment workflow.

Poster images, descriptions, and catalogs are retrieved at runtime from the user's addons and Cinemeta. They are not shipped as Riwaq artwork. No stream provider is installed by default.

Dependency versions and integrity hashes are recorded in package-lock.json. Rebuilding uses those locked versions with npm ci.

Koffi 3.3.0 (MIT): https://koffi.dev/ — native Windows child-surface bindings. API service references and the precise beta/release review are in docs/REFERENCE-REVIEW.md. TMDB data is used without endorsement or certification; streaming availability data is supplied by TMDB/JustWatch. Other ratings and artwork remain the property of their providers.
