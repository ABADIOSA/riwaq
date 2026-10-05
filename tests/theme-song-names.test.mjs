import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fromSpotify, themeNames } from "../core/theme-song.mjs";
import { Client } from "../core/client.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
const PREVIEW = "https://audio-ssl.itunes.apple.com/a/mzaf_1.plus.aac.p.m4a";
const ITUNES = {
  results: [
    {
      trackName: "Main Title",
      artistName: "Ramin Djawadi",
      collectionName: "Game of Thrones (Music from the HBO Series)",
      releaseDate: "2011-01-01",
      previewUrl: PREVIEW,
    },
  ],
};

test("music is searched by the addon's or original name before a translated one", () => {
  assert.deepEqual(
    themeNames({
      name: "صراع العروش",
      addonName: "Game of Thrones",
      originalName: "Game of Thrones",
    }),
    ["Game of Thrones", "صراع العروش"],
  );
  assert.deepEqual(
    themeNames({
      name: "هجوم العمالقة",
      addonName: "Attack on Titan",
      originalName: "進撃の巨人",
    }),
    ["Attack on Titan", "進撃の巨人"],
  );
  // An Arabic work keeps its Arabic name.
  assert.deepEqual(themeNames({ name: "باب الحارة" }), ["باب الحارة"]);
  assert.deepEqual(themeNames({}), []);
});

test("regression: an Arabic-named title (TMDB in Arabic) still finds its theme", async () => {
  const terms = [];
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async (url) => {
      const u = new URL(url);
      if (u.hostname === "itunes.apple.com")
        terms.push(u.searchParams.get("term"));
      return u.hostname === "itunes.apple.com" ? ITUNES : { data: [] };
    },
  });
  // What metadataOf stores with an Arabic metadata language.
  c.metas.set("series:tt0944947", {
    type: "series",
    id: "tt0944947",
    name: "صراع العروش",
    addonName: "Game of Thrones",
  });
  const song = await c.themeSong({ type: "series", id: "tt0944947" });
  assert.equal(song?.track, "Main Title");
  assert.match(terms[0], /^Game of Thrones/);
  assert.match(
    source("core/client.mjs"),
    /addonName: String\(result\.meta\.name \|\| ""\)/,
  );
  assert.match(
    source("core/data-hub.mjs"),
    /detail\.original_title \|\| detail\.original_name/,
  );
});

test("with Spotify linked, the full track is found through it as well", async () => {
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async (url) =>
      new URL(url).hostname === "itunes.apple.com" ? ITUNES : { data: [] },
  });
  c.spotify.publicState = () => ({ connected: true });
  const asked = [];
  c.spotify.searchTracks = async (q) => {
    asked.push(q);
    return {
      tracks: {
        items: [
          {
            uri: "spotify:track:4uLU6hMCjMI75M1A2tKUQC",
            name: "Main Title Theme",
            artists: [{ name: "Ramin Djawadi" }],
            album: {
              name: "Game of Thrones: Season 1 (Music from the HBO Series)",
              release_date: "2011-06-14",
              images: [{ url: "https://i.scdn.co/image/x" }],
            },
          },
        ],
      },
    };
  };
  c.metas.set("series:tt1", {
    type: "series",
    id: "tt1",
    name: "Game of Thrones",
  });
  const song = await c.themeSong({ type: "series", id: "tt1" });
  assert.equal(
    song.preview,
    PREVIEW,
    "the preview stays for when Spotify cannot play",
  );
  assert.equal(song.spotifyUri, "spotify:track:4uLU6hMCjMI75M1A2tKUQC");
  assert.equal(song.spotifyTrack, "Main Title Theme");
  assert.ok(asked.length >= 1);
  assert.equal(
    fromSpotify({ tracks: { items: [{ uri: "bad", name: "x" }] } }).length,
    0,
  );
});

test("Spotify themes never interrupt the viewer's own music, and only Riwaq's theme is paused", () => {
  const helper = source("src/lib/theme-spotify.js");
  assert.match(
    helper,
    /now\.playback\?\.playing && now\.playback\?\.track\?\.uri !== started/,
  );
  assert.match(helper, /if \(theirs\) return false;/);
  assert.match(helper, /if \(!uri \|\| started !== uri\) return;/);
  assert.match(helper, /now\.playback\.track\?\.uri === uri/);
  const details = source("src/components/Details.jsx");
  assert.match(
    details,
    /\(state\.settings\.themeSongSource \|\| "auto"\) === "auto" &&\s+!!state\.spotify\?\.connected &&\s+!!state\.spotify\?\.premium/,
  );
  assert.match(
    source("core/spotify.mjs"),
    /query: \{ q, type: "track", limit: "10" \}/,
  );
  assert.equal(DEFAULT_SETTINGS.themeSongSource, "auto");
  assert.equal(
    safeSettings({ themeSongSource: "previews" }).themeSongSource,
    "previews",
  );
  assert.equal(
    safeSettings({ themeSongSource: "radio" }).themeSongSource,
    "auto",
  );
});
