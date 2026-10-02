import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MEMORY_LIMIT,
  cleanSeriesMemory,
  forgetSeries,
  isRememberedSource,
  matchTrack,
  preferRemembered,
  rememberSeries,
  seriesOf,
  sourceIdentity,
  trackIdentity,
} from "../core/series-memory.mjs";
import { HOTKEY_ACTIONS, inputConf, seekAmount } from "../core/hotkeys.mjs";
import { Client } from "../core/client.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Player } from "../electron/player.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("seek keys carry no fixed step: MPV asks main, which reads the settings now", () => {
  const conf = inputConf({});
  assert.doesNotMatch(conf, /\bseek -?\d/);
  for (const dir of ["back", "forward", "backLong", "forwardLong"])
    assert.match(conf, new RegExp(`riwaq-seek ${dir}\\n`));
  // The default file shipped for the first launch says the same.
  assert.equal(source("assets/player-input.conf"), conf);
  assert.ok(HOTKEY_ACTIONS.some((a) => a.id === "seekForwardLong"));

  const settings = { seekStep: 5, seekLongStep: 120 };
  assert.equal(seekAmount("forward", settings), 5);
  assert.equal(seekAmount("back", settings), -5);
  assert.equal(seekAmount("forwardLong", settings), 120);
  assert.equal(seekAmount("backLong", settings), -120);
  assert.equal(seekAmount("forward", {}), 10);
  assert.equal(seekAmount("backLong", { seekLongStep: 99999 }), -60);
  assert.equal(seekAmount("sideways", settings), 0);

  // The running player uses whatever the settings say at the press.
  const live = { seekStep: 10, seekLongStep: 60 };
  const p = new Player({ settingsNow: () => live });
  const sent = [];
  p.send = (c) => sent.push(c);
  p.state = { active: true };
  p.event({ event: "client-message", args: ["riwaq-seek", "forward"] });
  live.seekStep = 30;
  p.event({ event: "client-message", args: ["riwaq-seek", "back"] });
  p.event({ event: "client-message", args: ["riwaq-seek", "forwardLong"] });
  p.event({ event: "client-message", args: ["riwaq-seek", "nonsense"] });
  assert.deepEqual(sent, [
    ["seek", 10, "relative"],
    ["seek", -30, "relative"],
    ["seek", 60, "relative"],
  ]);
});

test("the step settings are validated, and the interface keys share them", () => {
  assert.equal(DEFAULT_SETTINGS.seekLongStep, 60);
  assert.equal(safeSettings({ seekLongStep: 300 }).seekLongStep, 300);
  assert.equal(safeSettings({ seekLongStep: 7 }).seekLongStep, 60);
  assert.equal(safeSettings({ seekStep: 15 }).seekStep, 15);
  const view = source("src/components/PlayerView.jsx");
  assert.match(view, /seekAmount\(/);
  assert.match(view, /e\.shiftKey \? "Long" : ""/);
});

test("a source is remembered by addon, group and quality, never by its link", () => {
  const id = sourceIdentity({
    addonId: "com.example.torrentio",
    provider: "Torrentio",
    group: "FLUX",
    tier: "1080p",
    source: "WEB-DL",
    url: "https://secret.example/play?token=abc",
  });
  assert.deepEqual(id, {
    addonId: "com.example.torrentio",
    provider: "Torrentio",
    group: "FLUX",
    tier: "1080p",
    source: "WEB-DL",
  });
  assert.doesNotMatch(JSON.stringify(id), /secret|token/);
  assert.equal(sourceIdentity({ provider: "x" }), null);
  assert.equal(sourceIdentity({ addonId: "has space" }), null);
  assert.equal(sourceIdentity({ addonId: "home", home: true }), null);
  assert.equal(sourceIdentity({ addonId: "a", tier: "8K" }).tier, "");
});

test("a track is remembered by language, title and flags, and off is a choice", () => {
  assert.deepEqual(
    trackIdentity({
      id: 3,
      type: "sub",
      lang: "ara",
      title: "Arabic (Forced)",
      forced: true,
    }),
    { lang: "ar", title: "Arabic (Forced)", forced: true },
  );
  assert.deepEqual(trackIdentity("no"), { off: true });
  assert.equal(trackIdentity({ lang: "und" }), null);
  assert.deepEqual(trackIdentity({ lang: "en", channels: 6 }), {
    lang: "en",
    channels: 6,
  });
});

test("tracks are matched in a new file by language first, never by number", () => {
  const tracks = [
    { id: 1, type: "audio", lang: "jpn", title: "Japanese" },
    { id: 2, type: "audio", lang: "ara", title: "Arabic Dub" },
    { id: 1, type: "sub", lang: "eng", title: "English" },
    { id: 2, type: "sub", lang: "ara", title: "Signs", forced: true },
    { id: 3, type: "sub", lang: "ara", title: "Full" },
  ];
  assert.equal(matchTrack(tracks, "audio", { lang: "ja" }), 1);
  assert.equal(matchTrack(tracks, "sub", { lang: "ar" }), 3);
  assert.equal(matchTrack(tracks, "sub", { lang: "ar", forced: true }), 2);
  assert.equal(matchTrack(tracks, "sub", { off: true }), "no");
  assert.equal(matchTrack(tracks, "audio", { off: true }), null);
  assert.equal(matchTrack(tracks, "sub", { lang: "fr" }), null);
  assert.equal(matchTrack(tracks, "sub", null), null);
  // Full subtitles are never replaced by a forced-only track.
  const forcedOnly = tracks.filter((t) => t.id !== 3);
  assert.equal(matchTrack(forcedOnly, "sub", { lang: "ar" }), null);
  // Titles break ties inside the language.
  const two = [
    { id: 4, type: "audio", lang: "en", title: "Commentary" },
    { id: 5, type: "audio", lang: "en", title: "Main" },
  ];
  assert.equal(matchTrack(two, "audio", { lang: "en", title: "main" }), 5);
});

test("the stored memory is validated, capped, newest first, and forgettable", () => {
  let memory = {};
  for (let i = 0; i < MEMORY_LIMIT + 5; i++)
    memory = rememberSeries(
      memory,
      `tt${i}`,
      { audio: { lang: "ar" } },
      1000 + i,
    );
  assert.equal(Object.keys(memory).length, MEMORY_LIMIT);
  assert.ok(!memory.tt0 && memory[`tt${MEMORY_LIMIT + 4}`]);
  const merged = rememberSeries(
    memory,
    "tt9999",
    { subtitle: { off: true } },
    5000,
  );
  const again = rememberSeries(
    merged,
    "tt9999",
    { source: { addonId: "a", tier: "4K" } },
    6000,
  );
  assert.deepEqual(again.tt9999.subtitle, { off: true });
  assert.equal(again.tt9999.source.addonId, "a");
  assert.equal(again.tt9999.at, 6000);
  const dirty = cleanSeriesMemory({
    "bad id with spaces": { audio: { lang: "ar" } },
    tt1: { audio: { off: true }, at: "x" },
    tt2: { source: { addonId: "x", url: "https://leak" }, at: 3 },
    tt3: "nope",
  });
  assert.deepEqual(Object.keys(dirty), ["tt2"]);
  assert.doesNotMatch(JSON.stringify(dirty), /leak/);
  assert.equal(
    Object.keys(forgetSeries(again, "tt9999")).length,
    MEMORY_LIMIT - 1,
  );
  assert.ok(!forgetSeries(again, "tt9999").tt9999);
  assert.deepEqual(forgetSeries(again), {});
  assert.equal(seriesOf({ type: "series", id: "kitsu:123" }), "kitsu:123");
  assert.equal(seriesOf({ type: "movie", id: "tt1" }), "");
});

test("the remembered source moves first inside its filter band, labelled", () => {
  const streams = [
    { key: "a", addonId: "one", group: "NTb", tier: "1080p", matches: true },
    { key: "b", addonId: "two", group: "FLUX", tier: "1080p", matches: true },
    { key: "c", addonId: "two", group: "FLUX", tier: "4K", matches: false },
  ];
  const result = preferRemembered(streams, { addonId: "two", group: "flux" });
  assert.deepEqual(
    result.streams.map((s) => s.key),
    ["b", "a", "c"],
  );
  assert.equal(result.remembered, 2);
  assert.equal(result.streams[0].reasons[0].code, "remembered");
  assert.equal(result.streams[1].remembered, undefined);
  assert.equal(preferRemembered(streams, null).streams, streams);
  // Without a group, the same addon at the same quality and source.
  const plain = { addonId: "one", tier: "1080p", source: "WEB-DL" };
  assert.ok(
    isRememberedSource(
      { addonId: "one", tier: "1080p", source: "WEB-DL" },
      plain,
    ),
  );
  assert.ok(
    !isRememberedSource(
      { addonId: "one", tier: "4K", source: "WEB-DL" },
      plain,
    ),
  );
  assert.ok(!isRememberedSource({ addonId: "one" }, { addonId: "one" }));
});

function seriesClient() {
  const c = new Client({
    load: () => ({
      addons: [
        {
          transportUrl: "https://one.example/manifest.json",
          manifest: {
            id: "one",
            name: "One",
            version: "1",
            resources: ["stream"],
            types: ["series"],
            catalogs: [],
          },
        },
      ],
    }),
    save: () => {},
    request: async (url) => {
      const ep = decodeURIComponent(url).match(/:1:(\d+)\.json/)?.[1] || "1";
      const e = ep.padStart(2, "0");
      return {
        streams: [
          {
            name: "One 4K",
            title: `Show.S01E${e}.2160p.WEB-DL.HEVC-GRPA`,
            url: `https://cdn.example/${e}/a?token=private`,
          },
          {
            name: "One 1080p",
            title: `Show.S01E${e}.1080p.WEB-DL.x264-FLUX`,
            url: `https://cdn.example/${e}/b?token=private`,
          },
        ],
      };
    },
  });
  return c;
}

test("the next episode puts the series' last source first, and play order follows", async () => {
  const c = seriesClient();
  const first = await c.getStreams({ type: "series", id: "tt7:1:1" });
  assert.equal(first.remembered, 0);
  assert.match(first.streams[0].title, /2160p/);
  // The viewer played the 1080p FLUX copy of episode 1.
  const chosen = first.streams.find((s) => /FLUX/.test(s.title));
  const memory = c.streams.get(chosen.key).memory;
  assert.deepEqual(memory, {
    addonId: "one",
    provider: "One",
    group: "FLUX",
    tier: "1080p",
    source: "WEB-DL",
  });
  assert.ok(c.rememberSeries("tt7", { source: memory }));
  assert.doesNotMatch(
    JSON.stringify(c.state.settings.seriesMemory),
    /token|cdn\.example/,
  );
  const next = await c.getStreams({
    type: "series",
    id: "tt7:1:2",
    seriesId: "tt7",
  });
  assert.equal(next.remembered, 1);
  assert.match(next.streams[0].title, /S01E02.*FLUX/);
  assert.equal(next.streams[0].remembered, true);
  assert.equal(next.streams[0].reasons[0].label, "نفس مصدر الحلقة السابقة");
  // Autoplay takes the first supported stream: the same release.
  assert.equal(
    next.streams.find((s) => s.supported && !s.external).key,
    next.streams[0].key,
  );
  // Films are never affected, and switching the feature off stops it.
  c.state.settings = safeSettings({ rememberSeries: false }, c.state.settings);
  const off = await c.getStreams({ type: "series", id: "tt7:1:3" });
  assert.equal(off.remembered, 0);
  assert.equal(c.rememberSeries("tt7", { source: memory }), false);
  c.forgetSeries("tt7");
  assert.deepEqual(c.state.settings.seriesMemory, {});
});

test("series IDs come from the title the caller names, or IMDb episode IDs", () => {
  const c = seriesClient();
  assert.equal(c.seriesOf("series", "tt7:1:2"), "tt7");
  assert.equal(c.seriesOf("series", "kitsu:44:3", "kitsu:44"), "kitsu:44");
  assert.equal(c.seriesOf("series", "kitsu:44:3"), "");
  assert.equal(c.seriesOf("series", "tt7:1:2", "tt8"), "tt7");
  assert.equal(c.seriesOf("movie", "tt7"), "");
});

test("memory travels with settings, so profiles and backups keep it apart", () => {
  const s = safeSettings({
    seriesMemory: { tt1: { audio: { lang: "ar" }, at: 5 }, "x y": {} },
  });
  assert.deepEqual(s.seriesMemory, { tt1: { audio: { lang: "ar" }, at: 5 } });
  assert.deepEqual(DEFAULT_SETTINGS.seriesMemory, {});
  assert.equal(DEFAULT_SETTINGS.rememberSeries, true);
});

test("main applies late subtitle replies only to the viewing that asked", () => {
  const main = source("electron/main.mjs");
  const auto = main.slice(
    main.indexOf("function autoSubtitle("),
    main.indexOf("function rememberTrack("),
  );
  assert.match(auto, /const viewing = nowPlaying;/);
  assert.match(auto, /nowPlaying === viewing/);
  // Checked again after the addon request, before any track is added.
  const wait = auto.indexOf("await client.getSubtitles");
  assert.ok(wait > 0 && auto.indexOf("if (!current()) return;", wait) > wait);
  // Only the viewer's own picks are recorded, not Riwaq's automatic ones.
  assert.doesNotMatch(auto, /rememberTrack|rememberSeries/);
  const commands = main.slice(main.indexOf("  playerCommand: (a) => {"));
  assert.match(commands.slice(0, 400), /rememberTrack\("audio"/);
  // Each viewing is a new object, so identity tells them apart.
  assert.match(
    main,
    /nowPlaying = \{ key, type: meta\.type, id: videoId, series \}/,
  );
});

test("forgetting is a main-window call, never a HUD one", () => {
  assert.match(source("electron/preload.cjs"), /"forgetSeries"/);
  const hud = source("core/hud.mjs");
  assert.doesNotMatch(hud, /forgetSeries/);
});
