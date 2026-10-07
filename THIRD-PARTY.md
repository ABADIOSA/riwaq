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
- Anime4K is referenced for context only. Riwaq bundles no Anime4K files and no third-party shaders; its picture profiles are built from MPV's own scaler, deband and sigmoid options.

## Bundled runtimes

- Electron (MIT and Chromium third-party licenses): https://github.com/electron/electron. Electron's LICENSE.electron.txt and LICENSES.chromium.html are retained in the unpacked distribution.
- React / React DOM (MIT): https://github.com/facebook/react
- Lucide (ISC): https://github.com/lucide-icons/lucide
- MPV is a separate executable distributed in resources/mpv. Build: shinchiro 20261007, mpv git eb0ee10315, x86_64. MPV and its dependencies retain their own licenses, including GPL/LGPL; the Riwaq MIT license does not relicense those binaries.
  - Binary/build recipe: https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261007
  - Build-system source: https://github.com/shinchiro/mpv-winbuild-cmake
  - MPV corresponding revision: https://github.com/mpv-player/mpv/commit/eb0ee10315
  - MPV license and dependency information: https://github.com/mpv-player/mpv/blob/master/Copyright
  - Exact downloaded archive: mpv-x86_64-20261007-git-eb0ee10315.7z
  - SHA-256: 6720298e1c32dc9ee60970db1c94c8170dbf33520e48eb9d3258584835c96f81

Poster images, descriptions, and catalogs are retrieved at runtime from the user's addons and Cinemeta. They are not shipped as Riwaq artwork. No stream provider is installed by default.

Dependency versions and integrity hashes are recorded in package-lock.json. Rebuilding uses those locked versions with npm ci.

Koffi 3.3.0 (MIT): https://koffi.dev/ — native Windows child-surface bindings. API service references and the precise beta/release review are in docs/REFERENCE-REVIEW.md. TMDB data is used without endorsement or certification; streaming availability data is supplied by TMDB/JustWatch. Other ratings and artwork remain the property of their providers.
