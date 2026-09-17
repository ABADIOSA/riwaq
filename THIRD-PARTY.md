# Sources and acknowledgments

Riwaq is an independent implementation of a desktop client for the Stremio HTTP addon protocol. It is not an official Stremio application and is not a merged build of the projects below.

## Design and behavior references

- Harbor: https://github.com/harborstremio/harbor (MIT). Reference for configured addon transport preservation, native-player behavior, and source ranking ideas.
- NuvioDesktop: https://github.com/NuvioMedia/NuvioDesktop (GPL-3.0). Reference for discovery, library organization, and resume flows. No Nuvio code is included.
- Stremio Community 5.0.0-beta.22: https://github.com/Zaarrg/stremio-community-v5/releases/tag/5.0.0-beta.22 (GPL-3.0). Reference for native MPV, language priorities, HDR settings, and floating playback. No Community shell code is included.
- Stremio addon protocol: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
- Stremio resource schemas: https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api/responses
- MPV IPC documentation: https://mpv.io/manual/stable/#json-ipc

## Bundled runtimes

- Electron (MIT and Chromium third-party licenses): https://github.com/electron/electron. Electron's LICENSE.electron.txt and LICENSES.chromium.html are retained in the unpacked distribution.
- React / React DOM (MIT): https://github.com/facebook/react
- Lucide (ISC): https://github.com/lucide-icons/lucide
- MPV is a separate executable distributed in resources/mpv. Build: shinchiro 20260610, mpv git 304426c, x86_64. MPV and its dependencies retain their own licenses, including GPL/LGPL; the Riwaq MIT license does not relicense those binaries.
  - Binary/build recipe: https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260610
  - Build-system source: https://github.com/shinchiro/mpv-winbuild-cmake
  - MPV corresponding revision: https://github.com/mpv-player/mpv/commit/304426c
  - MPV license and dependency information: https://github.com/mpv-player/mpv/blob/master/Copyright
  - Exact downloaded archive: mpv-x86_64-20260610-git-304426c.7z
  - SHA-256: facac536baa73c7b925771af5e39a3c9cb16b8d75b59a6e9800de89799dffca7

Poster images, descriptions, and catalogs are retrieved at runtime from the user's addons and Cinemeta. They are not shipped as Riwaq artwork. No stream provider is installed by default.

Dependency versions and integrity hashes are recorded in package-lock.json. Rebuilding uses those locked versions with npm ci.

Koffi 3.3.0 (MIT): https://koffi.dev/ — native Windows child-surface bindings. API service references and the precise beta/release review are in docs/REFERENCE-REVIEW.md. TMDB data is used without endorsement or certification; streaming availability data is supplied by TMDB/JustWatch. Other ratings and artwork remain the property of their providers.
