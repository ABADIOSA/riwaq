import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  officialMusicQuery,
  parseOfficialMusic,
  pickOfficialTrack,
  pickThemeSong,
  themeScore,
} from "../core/theme-song.mjs";
import { Client } from "../core/client.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
const P = (n) => `https://audio-ssl.itunes.apple.com/a/${n}.m4a`;
const meta = { type: "series", name: "Game of Thrones" };
const real = {
  track: "Main Title",
  artist: "Ramin Djawadi",
  album: "Game of Thrones (Music from the HBO Series)",
  preview: P(1),
};
const fan = {
  track: "Game of Thrones Main Title Theme",
  artist: "TV Theme Orchestra",
  album: "Game of Thrones (Music from the Series)",
  preview: P(2),
};

test("with the composer known, only the composer's songs count in official trust", () => {
  const options = { composers: ["Ramin Djawadi"], trust: "official" };
  assert.equal(
    themeScore(fan, meta, options),
    -Infinity,
    "a fan orchestra is refused",
  );
  const picked = pickThemeSong([fan, real], meta, options);
  assert.equal(picked.artist, "Ramin Djawadi");
  assert.equal(picked.official, true);
  // Relaxed trust still prefers the composer but accepts others.
  const relaxed = pickThemeSong([fan], meta, {
    composers: ["Ramin Djawadi"],
    trust: "relaxed",
  });
  assert.equal(relaxed?.artist, "TV Theme Orchestra");
  assert.equal(relaxed.official, false);
});

test("without a composer, official trust needs a soundtrack or score album; fan words are refused", () => {
  const covers = {
    track: "Main Title",
    artist: "Piano Guys",
    album: "Game of Thrones Piano Covers",
    preview: P(3),
  };
  assert.equal(
    pickThemeSong([covers], meta),
    null,
    "plural 'Covers' is caught now",
  );
  const inspired = {
    track: "Game of Thrones Theme",
    artist: "X",
    album: "Music Inspired by Game of Thrones",
    preview: P(4),
  };
  assert.equal(pickThemeSong([inspired], meta), null);
  const lofi = {
    track: "Game of Thrones (Lo-Fi Remix)",
    artist: "Y",
    album: "Game of Thrones Soundtrack",
    preview: P(5),
  };
  assert.equal(pickThemeSong([lofi], meta), null);
  const plainAlbum = {
    track: "Game of Thrones Theme",
    artist: "Z",
    album: "Game of Thrones",
    preview: P(6),
  };
  assert.equal(
    pickThemeSong([plainAlbum], meta),
    null,
    "no soundtrack word, no composer",
  );
  assert.ok(pickThemeSong([plainAlbum], meta, { trust: "relaxed" }));
});

test("Wikidata's official soundtrack: a safe query and validated IDs", () => {
  assert.equal(officialMusicQuery('tt1" } DROP'), "");
  assert.match(officialMusicQuery("tt0944947"), /wdt:P345 "tt0944947"/);
  assert.match(officialMusicQuery("tt0944947"), /wdt:P406/);
  const parsed = parseOfficialMusic({
    results: {
      bindings: [
        {
          spotify: { value: "6HnMxRrTeWLdl1jrU6mUcU" },
          apple: { value: "433457853" },
          deezer: { value: "1069706" },
          composerLabel: { value: "Ramin Djawadi" },
        },
        {
          spotify: { value: "bad id!" },
          apple: { value: "12" },
          composerLabel: { value: "Ramin Djawadi" },
        },
      ],
    },
  });
  assert.deepEqual(parsed, {
    spotify: ["6HnMxRrTeWLdl1jrU6mUcU"],
    apple: ["433457853"],
    deezer: ["1069706"],
    composers: ["Ramin Djawadi"],
  });
});

test("on the official album, the theme-named track wins, else the first track", () => {
  const album = [
    { track: "Winterfell", artist: "Ramin Djawadi", preview: P(1) },
    { track: "Main Title", artist: "Ramin Djawadi", preview: P(2) },
    { track: "The King's Arrival", artist: "Ramin Djawadi", preview: P(3) },
  ];
  assert.equal(pickOfficialTrack(album, meta).track, "Main Title");
  assert.equal(pickOfficialTrack(album, meta).official, true);
  const plain = [{ track: "Cornfield Chase" }, { track: "Dust" }];
  assert.equal(
    pickOfficialTrack(plain, { name: "Interstellar" }).track,
    "Cornfield Chase",
  );
  assert.equal(pickOfficialTrack([], meta), null);
});

test("the client plays from the official album first, with the composer, and marks it", async () => {
  const hosts = [];
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async (url) => {
      const u = new URL(url);
      hosts.push(`${u.hostname}${u.pathname}`);
      if (u.hostname === "query.wikidata.org")
        return {
          results: {
            bindings: [
              {
                apple: { value: "433457853" },
                composerLabel: { value: "Ramin Djawadi" },
              },
            ],
          },
        };
      if (u.pathname === "/lookup")
        return {
          results: [
            {
              wrapperType: "collection",
              collectionName: "Game of Thrones (Music from the HBO Series)",
            },
            {
              trackName: "Main Title",
              artistName: "Ramin Djawadi",
              collectionName: "Game of Thrones (Music from the HBO Series)",
              previewUrl: P(9),
            },
          ],
        };
      throw new Error("searched when the album already answered");
    },
  });
  c.metas.set("series:tt0944947", {
    type: "series",
    id: "tt0944947",
    name: "صراع العروش",
    addonName: "Game of Thrones",
  });
  const song = await c.themeSong({ type: "series", id: "tt0944947" });
  assert.equal(song.track, "Main Title");
  assert.equal(song.official, true);
  assert.equal(song.composer, "Ramin Djawadi");
  assert.deepEqual(hosts, [
    "query.wikidata.org/sparql",
    "itunes.apple.com/lookup",
  ]);
  assert.match(
    source("core/data-hub.mjs"),
    /"Original Music Composer",\s+"Music",\s+"Main Title Theme Composer"/,
  );
  assert.match(source("core/spotify.mjs"), /\/albums\/\$\{id\}\/tracks/);
  assert.equal(DEFAULT_SETTINGS.themeSongTrust, "official");
  assert.equal(
    safeSettings({ themeSongTrust: "relaxed" }).themeSongTrust,
    "relaxed",
  );
  assert.equal(
    safeSettings({ themeSongTrust: "any" }).themeSongTrust,
    "official",
  );
  assert.match(source("src/components/Details.jsx"), /theme-song-official/);
});
