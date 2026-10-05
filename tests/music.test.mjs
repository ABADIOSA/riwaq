import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MUSIC_ITEM_LIMIT,
  MUSIC_PLATFORMS,
  addMusicLink,
  cleanMusic,
  linkKind,
  musicLink,
  musicQuery,
  musicSearchUrl,
  platformOf,
  preferredPlatform,
  soundtrackQuery,
} from "../core/music.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { HIDEABLE_NAV } from "../core/appearance.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("only HTTPS links on a platform's own hosts are kept", () => {
  assert.equal(
    musicLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"),
    "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
  );
  for (const bad of [
    "http://open.spotify.com/playlist/x",
    "https://open.spotify.com.evil.example/playlist/x",
    "https://user:pass@open.spotify.com/x",
    "https://open.spotify.com:8443/x",
    "https://evil.example/?u=open.spotify.com",
    "javascript:alert(1)",
    "https://open.spotify.com/play list",
    "x".repeat(700),
    42,
  ])
    assert.equal(musicLink(bad), "", String(bad).slice(0, 60));
  assert.equal(platformOf("https://play.anghami.com/playlist/1"), "anghami");
  assert.equal(
    platformOf("https://music.youtube.com/playlist?list=PL1"),
    "youtubemusic",
  );
  assert.equal(platformOf("https://soundcloud.com/a/sets/b"), "soundcloud");
  assert.equal(platformOf("https://example.com"), "");
  assert.equal(MUSIC_PLATFORMS.length, 9);
});

test("a saved link says what it is", () => {
  assert.equal(linkKind("https://open.spotify.com/playlist/x"), "playlist");
  assert.equal(
    linkKind("https://music.youtube.com/playlist?list=PL1"),
    "playlist",
  );
  assert.equal(linkKind("https://soundcloud.com/a/sets/b"), "playlist");
  assert.equal(linkKind("https://music.apple.com/sa/album/x/1"), "album");
  assert.equal(linkKind("https://open.spotify.com/artist/x"), "artist");
  assert.equal(linkKind("https://play.anghami.com/song/1"), "track");
  assert.equal(linkKind("https://music.youtube.com/watch?v=abc"), "track");
  assert.equal(linkKind("https://open.spotify.com/show/x"), "podcast");
  assert.equal(linkKind("https://open.spotify.com/"), "link");
});

test("searches open the platform's own page, one encoded line", () => {
  assert.equal(
    musicSearchUrl("spotify", "محمد عبده"),
    `https://open.spotify.com/search/${encodeURIComponent("محمد عبده")}`,
  );
  assert.equal(
    musicSearchUrl("youtubemusic", "a&b=c\nd"),
    "https://music.youtube.com/search?q=a%26b%3Dc%20d",
  );
  assert.equal(musicSearchUrl("unknown", "x"), "");
  assert.equal(musicSearchUrl("spotify", "   "), "");
  assert.equal(musicQuery("x".repeat(300)).length, 120);
  // Every platform's search page is on one of its own hosts.
  for (const [id, , , hosts] of MUSIC_PLATFORMS)
    assert.ok(hosts.includes(new URL(musicSearchUrl(id, "x")).hostname), id);
});

test("a title's soundtrack phrase uses its name, a film's year, and the right word", () => {
  assert.equal(
    soundtrackQuery({
      type: "movie",
      name: "Dune: Part Two",
      releaseInfo: "2024",
    }),
    "Dune: Part Two 2024 soundtrack",
  );
  assert.equal(
    soundtrackQuery({ type: "series", name: "Shogun", releaseInfo: "2024–" }),
    "Shogun soundtrack theme",
  );
  assert.equal(soundtrackQuery({ type: "movie" }), "");
});

test("music settings are validated, de-duplicated and bounded", () => {
  const clean = cleanMusic({
    platforms: ["anghami", "nope", "spotify", "anghami"],
    items: [
      {
        url: "https://open.spotify.com/playlist/a",
        title: " Road\ntrip ",
        kind: "playlist",
      },
      { url: "https://open.spotify.com/playlist/a" },
      { url: "https://evil.example/x" },
      { url: "https://play.anghami.com/album/1", kind: "weird" },
      null,
    ],
  });
  assert.deepEqual(clean.platforms, ["anghami", "spotify"]);
  assert.equal(clean.items.length, 2);
  assert.equal(clean.items[0].title, "Road trip");
  assert.equal(clean.items[1].kind, "album");
  assert.match(clean.items[0].id, /^m[0-9a-z]+$/);
  const many = cleanMusic({
    items: Array.from({ length: 200 }, (_, i) => ({
      url: `https://open.spotify.com/track/${i}`,
    })),
  });
  assert.equal(many.items.length, MUSIC_ITEM_LIMIT);
  // Settings keep it, a backup restore re-validates it.
  assert.deepEqual(DEFAULT_SETTINGS.music, { platforms: [], items: [] });
  assert.equal(
    safeSettings({ music: { platforms: ["deezer", "bad"] } }).music
      .platforms[0],
    "deezer",
  );
  assert.equal(DEFAULT_SETTINGS.titleTheme, "artwork");
  assert.equal(safeSettings({ titleTheme: "genre" }).titleTheme, "genre");
  assert.equal(safeSettings({ titleTheme: "neon" }).titleTheme, "artwork");
});

test("adding a pasted link turns its platform on and refuses repeats and strangers", () => {
  const next = addMusicLink(
    { platforms: ["spotify"] },
    { url: " https://play.anghami.com/playlist/9 ", title: "طرب" },
    5,
  );
  assert.deepEqual(next.platforms, ["spotify", "anghami"]);
  assert.equal(next.items[0].title, "طرب");
  assert.equal(next.items[0].added, 5);
  assert.throws(
    () => addMusicLink(next, { url: "https://play.anghami.com/playlist/9" }),
    /محفوظ/,
  );
  assert.throws(
    () => addMusicLink(next, { url: "https://evil.example/x" }),
    /الصق رابطاً/,
  );
  assert.equal(preferredPlatform(next), "spotify");
  assert.equal(preferredPlatform({}), "youtubemusic");
});

test("main opens only re-checked music addresses, from the main window", () => {
  const main = source("electron/main.mjs");
  const handler = main.slice(
    main.indexOf("musicOpen: async"),
    main.indexOf("musicOpen: async") + 400,
  );
  assert.match(handler, /musicLink\(a\.url\)/);
  assert.match(handler, /musicSearchUrl\(a\?\.platform, a\?\.query\)/);
  assert.match(handler, /if \(!url\) throw/);
  assert.match(source("electron/preload.cjs"), /"musicOpen"/);
  assert.doesNotMatch(source("core/hud.mjs"), /musicOpen/);
  // The room is reachable in both interfaces and can be hidden.
  assert.ok(HIDEABLE_NAV.some(([id]) => id === "music"));
  assert.match(source("src/App.jsx"), /\[Music2, "music", "موسيقى"\]/);
  assert.match(source("src/components/RiwaqNav.jsx"), /go\("music"\)/);
  assert.match(source("src/components/Details.jsx"), /act\("musicOpen", \{/);
  // The room never offers a password field.
  assert.doesNotMatch(source("src/components/Music.jsx"), /type="password"/);
});
