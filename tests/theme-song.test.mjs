import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  artUrl,
  cleanThemeSkip,
  deezerUrl,
  fromDeezer,
  fromItunes,
  itunesUrl,
  pickThemeSong,
  previewUrl,
  themeQueries,
  themeScore,
} from "../core/theme-song.mjs";
import { Client } from "../core/client.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
const PREVIEW =
  "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/x/mzaf_1.plus.aac.p.m4a";

test("only Apple's and Deezer's preview hosts play, over HTTPS", () => {
  assert.equal(previewUrl(PREVIEW), PREVIEW);
  assert.ok(previewUrl("https://cdnt-preview.dzcdn.net/api/1/1/a.mp3"));
  for (const bad of [
    "http://audio-ssl.itunes.apple.com/a.m4a",
    "https://audio-ssl.itunes.apple.com.evil.example/a.m4a",
    "https://evil.example/dzcdn.net/a.mp3",
    "https://user:x@cdnt-preview.dzcdn.net/a.mp3",
    "javascript:alert(1)",
    "",
  ])
    assert.equal(previewUrl(bad), "", bad);
  assert.ok(artUrl("https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg"));
  assert.equal(artUrl("https://evil.example/a.jpg"), "");
  // The CSP lets exactly these hosts be media.
  assert.match(
    source("index.html"),
    /media-src 'self' riwaq-audio: https:\/\/audio-ssl\.itunes\.apple\.com https:\/\/\*\.dzcdn\.net;/,
  );
});

test("searches ask for the theme first, keyless, on the two public APIs", () => {
  assert.deepEqual(themeQueries({ type: "series", name: "Shōgun" }), [
    "Shōgun main title theme",
    "Shōgun soundtrack",
  ]);
  assert.deepEqual(themeQueries({}), []);
  const it = new URL(itunesUrl("Dune main theme"));
  assert.equal(it.hostname, "itunes.apple.com");
  assert.equal(it.searchParams.get("entity"), "song");
  assert.equal(new URL(deezerUrl("x")).hostname, "api.deezer.com");
});

const got = {
  track: "Main Title",
  artist: "Ramin Djawadi",
  album: "Game of Thrones (Music from the HBO Series)",
  year: 2011,
  preview: PREVIEW,
  source: "itunes",
};
test("the song is chosen only when it clearly belongs to the title", () => {
  const meta = { type: "series", name: "Game of Thrones" };
  assert.ok(themeScore(got, meta) >= 7);
  const cover = {
    ...got,
    track: "Game of Thrones Theme (Piano Cover)",
    album: "TV Covers",
  };
  const other = { ...got, album: "Thrones of Glass", track: "Intro" };
  assert.deepEqual(pickThemeSong([cover, other, got], meta), {
    ...got,
    official: false,
  });
  assert.equal(
    pickThemeSong([cover, other], meta),
    null,
    "silence over a guess",
  );
  // A film's year must be close.
  const film = { type: "movie", name: "Dune", releaseInfo: "2021" };
  const dune = {
    ...got,
    track: "Dune Main Theme",
    album: "Dune (Original Motion Picture Soundtrack)",
    year: 2021,
  };
  assert.ok(pickThemeSong([dune], film));
  assert.equal(
    pickThemeSong([{ ...dune, year: 1984, album: "Dune" }], film),
    null,
  );
  assert.equal(pickThemeSong([got], { type: "series", name: "" }), null);
});

test("API answers are read into candidates with checked addresses", () => {
  const it = fromItunes({
    results: [
      {
        trackName: "Main Title",
        artistName: "A",
        collectionName: "B",
        releaseDate: "2011-04-01T00:00:00Z",
        previewUrl: PREVIEW,
        artworkUrl100: "https://is1-ssl.mzstatic.com/x/100x100bb.jpg",
        trackViewUrl: "https://music.apple.com/us/album/x",
      },
      { trackName: "Bad", previewUrl: "https://evil.example/a.m4a" },
    ],
  });
  assert.equal(it.length, 1);
  assert.equal(it[0].year, 2011);
  assert.match(it[0].image, /300x300/);
  const dz = fromDeezer({
    data: [
      {
        title: "Theme",
        artist: { name: "C" },
        album: {
          title: "D",
          cover_medium: "https://e-cdns-images.dzcdn.net/x.jpg",
        },
        preview: "https://cdnt-preview.dzcdn.net/a.mp3",
        link: "https://www.deezer.com/track/1",
      },
    ],
  });
  assert.equal(dz[0].source, "deezer");
  assert.equal(fromDeezer(null).length, 0);
});

test("main picks from its own copy of the title, keeps a day, and retries failures", async () => {
  const asked = [];
  let fail = false;
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async (url) => {
      asked.push(new URL(url).hostname);
      if (fail) throw new Error("offline");
      return url.includes("itunes")
        ? {
            results: [
              {
                trackName: got.track,
                artistName: got.artist,
                collectionName: got.album,
                previewUrl: PREVIEW,
                releaseDate: "2011",
              },
            ],
          }
        : { data: [] };
    },
  });
  assert.equal(
    await c.themeSong({ type: "series", id: "tt1" }),
    null,
    "no meta, no search",
  );
  assert.equal(asked.length, 0);
  c.metas.set("series:tt1", {
    type: "series",
    id: "tt1",
    name: "Game of Thrones",
  });
  const song = await c.themeSong({ type: "series", id: "tt1" });
  assert.equal(song.track, "Main Title");
  assert.deepEqual(asked, ["itunes.apple.com", "api.deezer.com"]);
  await c.themeSong({ type: "series", id: "tt1" });
  assert.equal(asked.length, 2, "kept");
  fail = true;
  c.metas.set("series:tt2", { type: "series", id: "tt2", name: "Other" });
  assert.equal(await c.themeSong({ type: "series", id: "tt2" }), null);
  const before = asked.length;
  await c.themeSong({ type: "series", id: "tt2" });
  assert.ok(asked.length > before, "a failed search is asked again");
});

test("settings: auto by default, a volume, and refused titles", () => {
  assert.equal(DEFAULT_SETTINGS.themeSong, "auto");
  assert.equal(DEFAULT_SETTINGS.themeSongVolume, 35);
  assert.equal(safeSettings({ themeSong: "off" }).themeSong, "off");
  assert.equal(safeSettings({ themeSongVolume: 77 }).themeSongVolume, 35);
  assert.deepEqual(
    cleanThemeSkip(["series:tt1", "series:tt1", "bad key", "movie:tt2", 5]),
    ["series:tt1", "movie:tt2"],
  );
  assert.deepEqual(
    safeSettings({ themeSongSkip: ["movie:tt9", "x"] }).themeSongSkip,
    ["movie:tt9"],
  );
});

test("the page plays a theme only when nothing else is, and stops when it goes", () => {
  const details = source("src/components/Details.jsx");
  // Not in "button" mode, a hidden window or during a viewing.
  assert.match(
    details,
    /songMode !== "auto" \|\|\s+document\.visibilityState !== "visible" \|\|\s+videoIsPlaying\(\)/,
  );
  // Riwaq's own preview never plays over the viewer's music.
  assert.match(
    details,
    /if \(!live \|\| !found\.preview \|\| externalMusicPlaying\(\)\) return;/,
  );
  assert.match(
    details,
    /return \(\) => \{\s+live = false;\s+stopAudio\(songOwner\.current\);\s+stopSpotifyTheme\(spotifyUri\);/,
  );
  // Searched by the name the music is filed under, never a translated one.
  assert.match(details, /soundtrackQuery\(musicMeta\)/);
  assert.match(source("src/App.jsx"), /setVideoPlaying\(player\.active\)/);
  const main = source("electron/main.mjs");
  assert.match(main, /themeSong: \(a\) =>\s+client\.themeSong\(/);
  assert.match(
    main,
    /client\.onThemeError = \(message\) => logError\("themeSong", message\)/,
  );
  assert.match(source("electron/preload.cjs"), /"themeSong"/);
  assert.doesNotMatch(source("core/hud.mjs"), /themeSong|spotify/i);
});
