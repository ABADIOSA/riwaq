# Reference review — 2026-09-17

## Harbor

- GitHub stable: [V0.9.21](https://github.com/harborstremio/harbor/releases/tag/V0.9.21), 2026-07-11.
- Actual current beta feed: [latest-beta.json](https://harbor.site/updates/latest-beta.json) and [versions-beta.json](https://harbor.site/updates/versions-beta.json): **0.9.127**, published 2026-09-15 22:34 UTC. Stable GitHub releases do not show the current beta number.
- 0.9.127 focuses on embedded HDR startup, maximized-window artifacts and delayed embedded subtitle track selection. 0.9.126 includes settings layout/search, session renewal, per-profile offline tracking queues and credential-safe redirect handling. 0.9.125 improves Arabic/English subtitle identity, RTL navigation and browsing details.
- Reviewed current public source commit `0117755855d3f43960bad3f9f62b69ef851d5991`: settings library panel, navigation, theme presets/previews, Letterboxd/Stremboxd integration, Trakt and Simkl client flows. Public main source is a separate reference from the beta binaries; we did not claim it is the exact 0.9.127 source snapshot.
- Applied: wide cinematic imagery, rounded primary actions, subdued navigation, seven palettes, three layouts, a searchable settings studio, optional API providers, service lists and original Arabic typography/layout.

## Nuvio Desktop

- [0.1.24-alpha](https://github.com/NuvioMedia/NuvioDesktop/releases/tag/0.1.24-alpha), 2026-09-16 18:11 UTC.
- Reviewed Dev source commit `48e1ca3a8eb21708031d6dc9c690d6098e07133a`, README, settings routing, native player organization, desktop jelly-navigation references and tracking/library tests.
- Current release adds a jelly top bar and native PiP, plus desktop scaling/volume and navigation fixes. Applied the useful separation between browse/library/player/settings and a persistent mini playback experience. Riwaq's mini player is embedded; Nuvio's OS PiP is not claimed as implemented.

## Stremio Community

- [5.0.0-beta.22](https://github.com/Zaarrg/stremio-community-v5/releases/tag/5.0.0-beta.22), 2026-08-01; still the latest release checked. This release is a small security patch, not a new UI release.
- Reviewed the release history and documented MPV settings: hardware decoding, HDR, multiple preferred audio/subtitle languages, external subtitle styling, keyboard playback and source handling.
- Applied: bundled MPV, IPC controls, explicit subtitle/audio track selection, external SRT/ASS, delay/size, aspect/speed/picture controls, pause-on-minimize and native rendering.

## API references

- [TMDB application auth](https://developer.themoviedb.org/docs/authentication-application): API key or Read Access Token.
- [OMDb](https://www.omdbapi.com/), [MDBList](https://api.mdblist.com/), [Fanart API](https://fanart.tv/api-docs/api-v3/).
- [Trakt auth](https://docs.trakt.tv/reference/auth), [device code](https://docs.trakt.tv/reference/postoauthdevicecode), [device polling](https://docs.trakt.tv/reference/postoauthdevicetoken). Current token endpoints use `auth.trakt.tv`; refresh tokens rotate and are single-use.
- [Letterboxd API availability](https://letterboxd.com/api-beta/): access requires approval. Public lists use the explicitly disclosed [Stremboxd](https://stremboxd.com) bridge; CSV uses the user's official export and TMDB matching.
- [MPV embedding and IPC](https://mpv.io/manual/stable/), [Koffi Win32 pointer handling](https://koffi.dev/pointers).

This is an original implementation, not a merge of these codebases or a promise of complete feature parity. The tests and hardware/account limitations are documented separately.
