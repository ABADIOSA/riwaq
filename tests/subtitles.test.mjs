import test from "node:test";
import assert from "node:assert/strict";
import {
  languageOf,
  preferredLanguages,
  subtitleKind,
  kindRank,
  rankSubtitles,
  languageGroups,
  automaticSubtitle,
  parseCues,
  cuesAround,
  syncDelay,
  safeSubtitleStyle,
  styleProperties,
  styleArgs,
  audioLabel,
  controlsCover,
  subtitleLift,
  DEFAULT_SUBTITLE_STYLE,
  SUBTITLE_CLEARANCE,
} from "../core/subtitles.mjs";
import { Client } from "../core/client.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Player, playerArgs } from "../electron/player.mjs";
import { HOTKEY_ACTIONS, inputConf } from "../core/hotkeys.mjs";
import { createServer } from "node:http";

test("subtitle addons receive the selected release filename, with per-source caching", async (t) => {
  const received = [];
  const server = createServer((req, res) => {
    received.push(
      new URLSearchParams(
        req.url
          .split("/")
          .at(-1)
          .replace(/\.json$/, ""),
      ),
    );
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ subtitles: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const c = new Client({ load: () => ({}), save() {} });
  c.state.addons = [
    {
      enabled: true,
      transportUrl: `http://127.0.0.1:${server.address().port}/manifest.json`,
      manifest: {
        id: "fixture",
        name: "Subtitle fixture",
        resources: ["subtitles"],
        types: ["movie"],
      },
    },
  ];
  c.streams.set("first", {
    url: "https://video.test/private?token=hidden",
    behaviorHints: {
      filename: "D:\\Private\\فيلم & Friends.2026.Extended.mkv",
      videoHash: "0123456789abcdef",
      videoSize: 12345678,
    },
  });
  c.streams.set("second", {
    behaviorHints: { filename: "Film.Theatrical.mkv" },
  });
  const request = (streamKey) =>
    c.getSubtitles({ type: "movie", id: "tt123", streamKey });
  await request("first");
  await request("first");
  await request("second");
  assert.equal(received.length, 2);
  assert.equal(received[0].get("filename"), "فيلم & Friends.2026.Extended.mkv");
  assert.equal(received[0].get("videoHash"), "0123456789abcdef");
  assert.equal(received[0].get("videoSize"), "12345678");
  assert.equal(received[1].get("filename"), "Film.Theatrical.mkv");
  for (const [i, filename] of [
    undefined,
    "https://video.test/file.mkv?token=hidden",
    "bad\nname.mkv",
    "x".repeat(513),
  ].entries()) {
    c.streams.set(`invalid-${i}`, {
      url: "https://video.test/file.mkv?token=hidden",
      behaviorHints: { filename },
    });
    await request(`invalid-${i}`);
    assert.equal(received.at(-1).has("filename"), false);
  }
  assert.ok(
    received.every((params) => !/Private|token|hidden/.test(params.toString())),
  );
});

test("language tags of every common shape become one code with an Arabic name", () => {
  for (const tag of ["ar", "ara", "Arabic", "ar-SA", "AR"])
    assert.deepEqual(languageOf(tag), { code: "ar", name: "العربية" });
  assert.equal(languageOf("fre").code, "fr");
  assert.equal(languageOf("fra").code, "fr");
  assert.equal(languageOf("pob").name, "البرتغالية");
  assert.equal(languageOf("").code, "und");
  assert.equal(languageOf("xyz").code, "xyz");
  assert.deepEqual(preferredLanguages("ara,ar,eng,en"), ["ar", "en"]);
  assert.deepEqual(preferredLanguages(""), []);
});

test("forced and SDH tracks are told apart from a plain translation", () => {
  assert.equal(subtitleKind({ forced: true }), "forced");
  assert.equal(subtitleKind({ title: "English (Forced)" }), "forced");
  assert.equal(subtitleKind({ title: "English SDH" }), "sdh");
  assert.equal(subtitleKind({ label: "Movie.2019.HI.srt" }), "sdh");
  assert.equal(subtitleKind({ hearingImpaired: true }), "sdh");
  assert.equal(subtitleKind({ title: "Arabic" }), "standard");
  // Words that merely contain the letters are not captions.
  assert.equal(subtitleKind({ title: "Chinese Hindi" }), "standard");
  assert.equal(kindRank("sdh", "sdh"), 0);
  assert.ok(kindRank("standard", "sdh") < kindRank("forced", "sdh"));
});

test("language decides first, kind breaks ties, and order is otherwise kept", () => {
  const items = [
    { id: 1, lang: "eng", title: "English" },
    { id: 2, lang: "ara", title: "Arabic Forced" },
    { id: 3, lang: "fre" },
    { id: 4, lang: "ar", title: "Arabic" },
    { id: 5, lang: "ara", title: "Arabic SDH" },
  ];
  const ranked = rankSubtitles(items, { languages: ["ar", "en"] });
  assert.deepEqual(
    ranked.map((i) => i.id),
    [4, 5, 2, 1, 3],
  );
  const sdh = rankSubtitles(items, { languages: ["ar", "en"], kind: "sdh" });
  assert.deepEqual(
    sdh.map((i) => i.id),
    [5, 4, 2, 1, 3],
  );
  // A preferred kind never pulls in another language.
  const forced = rankSubtitles(
    [
      { id: "a", lang: "ara" },
      { id: "e", lang: "eng", forced: true },
    ],
    { languages: ["ar", "en"], kind: "forced" },
  );
  assert.equal(forced[0].id, "a");
});

test("language groups list preferred languages first with counts", () => {
  const groups = languageGroups(
    [{ lang: "eng" }, { lang: "eng" }, { lang: "ara" }, { lang: "fre" }],
    ["ar", "en"],
  );
  assert.deepEqual(
    groups.map((g) => [g.code, g.count]),
    [
      ["ar", 1],
      ["en", 2],
      ["fr", 1],
    ],
  );
});

test("an addon subtitle is loaded on its own only when the file has none in the first language", () => {
  const addons = [
    { key: "e", lang: "eng" },
    { key: "a-sdh", lang: "ara", label: "Film SDH" },
    { key: "a", lang: "ara", label: "Film" },
  ];
  const languages = ["ar", "en"];
  assert.equal(
    automaticSubtitle({
      tracks: [{ type: "sub", lang: "eng" }],
      addons,
      languages,
    }).key,
    "a",
  );
  assert.equal(
    automaticSubtitle({
      tracks: [{ type: "sub", lang: "ara" }],
      addons,
      languages,
    }),
    null,
    "an embedded Arabic track is left to MPV",
  );
  assert.equal(
    automaticSubtitle({
      tracks: [],
      addons: [{ key: "e", lang: "eng" }],
      languages,
    }),
    null,
    "a fallback language is the viewer's choice, never forced",
  );
  assert.equal(
    automaticSubtitle({ tracks: [], addons, languages, kind: "sdh" }).key,
    "a-sdh",
  );
  assert.equal(automaticSubtitle({ tracks: [], addons, languages: [] }), null);
});

test("SRT and WebVTT cues are read without markup, in time order", () => {
  const srt =
    "﻿2\r\n00:00:05,500 --> 00:00:07,000\r\n{\\an8}<b>ثانية</b>\r\n\r\n1\r\n00:00:01,000 --> 00:00:02,000\r\nأولى\r\nسطر\r\n\r\nbroken block\r\n";
  assert.deepEqual(parseCues(srt), [
    { start: 1, end: 2, text: "أولى سطر" },
    { start: 5.5, end: 7, text: "ثانية" },
  ]);
  const vtt =
    "WEBVTT\n\nNOTE comment\n\n00:01.250 --> 00:02.000 align:start\n<v Tony>I am</v>\n\n01:02:03.4 --> 01:02:04.000\nlater\n";
  const cues = parseCues(vtt);
  assert.equal(cues[0].start, 1.25);
  assert.equal(cues[0].text, "I am");
  assert.equal(cues[1].start, 3723.4);
  assert.deepEqual(parseCues("not a subtitle"), []);
});

test("quick sync lists the lines around now and turns a pick into a delay", () => {
  const cues = Array.from({ length: 30 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 2,
    text: `line ${i}`,
  }));
  const around = cuesAround(cues, 101, 0, { before: 2, after: 2 });
  assert.deepEqual(
    around.map((c) => c.start),
    [90, 100, 110, 120],
  );
  // With a delay already applied, subtitle time is position minus delay.
  const shifted = cuesAround(cues, 101, 20, { before: 1, after: 1 });
  assert.deepEqual(
    shifted.map((c) => c.start),
    [80, 90],
  );
  // Heard at 105.3 a line that starts at 100: show it 5 s later.
  assert.equal(syncDelay(100, 105.3), 5);
  assert.equal(syncDelay(100, 90), -10.3);
  assert.equal(syncDelay(0, 500), 60, "clamped to MPV's range");
});

test("subtitle style is validated and becomes MPV properties and options", () => {
  const style = safeSubtitleStyle({
    color: "#ffe45c",
    outline: 20,
    backgroundOpacity: 50,
    bold: "yes",
    assOverride: "rm -rf",
    shadow: -3,
    extra: "ignored",
  });
  assert.equal(style.color, "#FFE45C");
  assert.equal(style.outline, 8);
  assert.equal(style.shadow, 0);
  assert.equal(style.bold, false);
  assert.equal(style.assOverride, "scale");
  assert.ok(!("extra" in style));
  assert.deepEqual(safeSubtitleStyle(null), DEFAULT_SUBTITLE_STYLE);
  const props = Object.fromEntries(styleProperties(style));
  assert.equal(props["sub-color"], "#FFFFE45C");
  assert.equal(props["sub-back-color"], "#80000000");
  assert.equal(props["sub-border-style"], "background-box");
  const plain = Object.fromEntries(styleProperties(DEFAULT_SUBTITLE_STYLE));
  assert.equal(plain["sub-border-style"], "outline-and-shadow");
  assert.ok(styleArgs(style).every((arg) => /^--sub-[a-z-]+=\S+$/.test(arg)));
});

test("settings accept the subtitle preferences and reject anything else", () => {
  assert.equal(DEFAULT_SETTINGS.autoSubtitles, "preferred");
  assert.equal(DEFAULT_SETTINGS.subtitleKind, "standard");
  const next = safeSettings(
    {
      subtitleKind: "sdh",
      autoSubtitles: "off",
      subtitleStyle: { color: "#00FF00", outline: 3 },
      subtitlePosition: 72.4,
    },
    DEFAULT_SETTINGS,
  );
  assert.equal(next.subtitleKind, "sdh");
  assert.equal(next.autoSubtitles, "off");
  assert.equal(next.subtitleStyle.color, "#00FF00");
  assert.equal(next.subtitleStyle.outline, 3);
  assert.equal(next.subtitlePosition, 72);
  const bad = safeSettings(
    { subtitleKind: "all", autoSubtitles: "always", subtitlePosition: 400 },
    DEFAULT_SETTINGS,
  );
  assert.equal(bad.subtitleKind, "standard");
  assert.equal(bad.autoSubtitles, "preferred");
  assert.equal(bad.subtitlePosition, 100);
});

test("MPV starts with the viewer's subtitle style", () => {
  const args = playerArgs({
    pipe: "p",
    settings: {
      ...DEFAULT_SETTINGS,
      subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, color: "#FFE45C" },
    },
    url: "https://a.test/v",
    title: "t",
  });
  assert.ok(args.includes("--sub-color=#FFFFE45C"));
  assert.ok(args.includes("--sub-ass-override=scale"));
  assert.deepEqual(args.slice(-2), ["--", "https://a.test/v"]);
});

test("addon subtitles are labelled, deduplicated, cached and never expose URLs", async () => {
  let requests = 0;
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async () => {
      requests++;
      return {
        subtitles: [
          {
            id: "Avengers.Endgame.2019.2160p.BluRay.REMUX",
            url: "https://subs.test/secret/a.srt?token=1",
            lang: "ara",
          },
          { id: "12345", url: "https://subs.test/b.vtt", lang: "eng" },
          {
            id: "dup",
            url: "https://subs.test/secret/a.srt?token=1",
            lang: "ara",
          },
          { id: "x", url: "javascript:alert(1)", lang: "ara" },
        ],
      };
    },
  });
  c.state.addons = [
    {
      transportUrl: "https://subaddon.test/manifest.json",
      enabled: true,
      manifest: {
        id: "s",
        name: "SubSource",
        version: "1.0.0",
        resources: ["subtitles"],
        types: ["movie"],
        catalogs: [],
      },
    },
  ];
  const list = await c.getSubtitles({ type: "movie", id: "tt4154796" });
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map(({ lang, label, provider, format }) => ({
      lang,
      label,
      provider,
      format,
    })),
    [
      {
        lang: "ara",
        label: "Avengers.Endgame.2019.2160p.BluRay.REMUX",
        provider: "SubSource",
        format: "SRT",
      },
      { lang: "eng", label: "", provider: "SubSource", format: "VTT" },
    ],
    "numeric ids are not names",
  );
  assert.ok(!JSON.stringify(list).includes("subs.test"));
  assert.equal(
    c.subtitles.get(list[0].key),
    "https://subs.test/secret/a.srt?token=1",
  );
  await c.getSubtitles({ type: "movie", id: "tt4154796" });
  assert.equal(requests, 1, "reopening the panel does not ask again");
});

function playerRig() {
  const sent = [];
  const events = [];
  const player = new Player({
    onState: () => {},
    onEvent: (e) => events.push(e),
  });
  player.send = (command) => sent.push(command);
  player.state = { active: true, tracks: [] };
  return { player, sent, events };
}

test("tracks carry what the panel shows, and an addon track only its key", () => {
  const { player } = playerRig();
  player.externalSubs.set("https://subs.test/secret/a.srt", { key: "k1" });
  const tracks = player.mapTracks([
    {
      id: 1,
      type: "audio",
      lang: "eng",
      codec: "eac3",
      "demux-channel-count": 6,
      default: true,
      selected: true,
    },
    { id: 2, type: "sub", lang: "eng", forced: true, title: "Forced" },
    {
      id: 3,
      type: "sub",
      lang: "ara",
      external: true,
      "external-filename": "https://subs.test/secret/a.srt",
      title: "https://subs.test/secret/a.srt",
      selected: true,
      "main-selection": 0,
    },
    {
      id: 4,
      type: "sub",
      lang: "eng",
      "hearing-impaired": true,
      "main-selection": 1,
    },
  ]);
  assert.equal(tracks[0].channels, 6);
  assert.equal(tracks[1].forced, true);
  assert.equal(tracks[2].addonKey, "k1");
  assert.equal(tracks[2].title, undefined, "a URL title is dropped");
  assert.ok(!JSON.stringify(tracks).includes("subs.test"));
  assert.equal(tracks[3].secondary, true);
  assert.equal(tracks[3].hearingImpaired, true);
});

test("an addon subtitle loads once and is reselected, as main or second line", () => {
  const { player, sent } = playerRig();
  player.addSubtitle("https://s.test/a.srt", {
    key: "k",
    label: "Film",
    lang: "ara",
  });
  assert.deepEqual(sent.at(-1), [
    "sub-add",
    "https://s.test/a.srt",
    "select",
    "Film",
    "ara",
  ]);
  player.rawTracks = [
    { id: 5, type: "sub", "external-filename": "https://s.test/a.srt" },
  ];
  player.addSubtitle("https://s.test/a.srt", { key: "k" });
  assert.deepEqual(sent.at(-1), ["set_property", "sid", 5]);
  player.addSubtitle("https://s.test/a.srt", { key: "k", secondary: true });
  assert.deepEqual(sent.at(-1), ["set_property", "secondary-sid", 5]);
  // A new file as the second line becomes secondary once MPV lists it.
  player.addSubtitle("https://s.test/b.srt", { key: "b", secondary: true });
  assert.equal(sent.at(-1)[2], "auto");
  player.mapTracks([
    { id: 6, type: "sub", "external-filename": "https://s.test/b.srt" },
  ]);
  assert.deepEqual(sent.at(-1), ["set_property", "secondary-sid", 6]);
});

test("style changes apply live and the panel opens from MPV", () => {
  const { player, sent, events } = playerRig();
  player.command({
    action: "subtitleStyle",
    value: { color: "#FFE45C", outline: 99 },
  });
  const props = Object.fromEntries(
    sent.filter((c) => c[0] === "set_property").map((c) => [c[1], c[2]]),
  );
  assert.equal(props["sub-color"], "#FFFFE45C");
  assert.equal(props["sub-border-size"], 8);
  player.message("riwaq-panel");
  assert.deepEqual(events, [{ type: "panel" }]);
  player.message("riwaq-context");
  assert.deepEqual(events[1], { type: "context" });
  const conf = inputConf();
  assert.match(conf, /^c script-message riwaq-panel$/m);
  assert.match(conf, /^MBTN_RIGHT script-message riwaq-context$/m);
  assert.ok(HOTKEY_ACTIONS.some((a) => a.id === "panel"));
});

test("audio tracks read as language, title, codec and layout", () => {
  assert.equal(
    audioLabel({ lang: "eng", title: "Atmos", codec: "eac3", channels: 8 }),
    "الإنجليزية · Atmos · EAC3 · 7.1",
  );
  assert.equal(audioLabel({ lang: "ara", channels: 2 }), "العربية · ستيريو");
  assert.equal(audioLabel({}), "غير محددة");
});

test("subtitles rise over the controls while they show, only as far as needed", () => {
  // The web theater in full screen at 1280×800: its timeline starts 90 px
  // above the picture's bottom edge.
  const picture = { top: 0, bottom: 800 };
  const cover = controlsCover(picture, 710);
  assert.equal(cover, (90 + SUBTITLE_CLEARANCE) / 800);
  assert.equal(subtitleLift(95, cover), 86);
  // A line the viewer already put higher stays; a line is never lowered.
  assert.equal(subtitleLift(70, cover), 70);
  // The theater's own row under the picture covers none of it.
  assert.equal(controlsCover(picture, 800), 0);
  assert.equal(controlsCover(picture, 836), 0);
  assert.equal(subtitleLift(95, 0), 95);
  // Nothing measured covers nothing; however they measure, half at most.
  assert.equal(controlsCover({ top: 0, bottom: 0 }, 10), 0);
  assert.equal(controlsCover(picture, Number.NaN), 0);
  assert.equal(controlsCover(picture, -300), 0.5);
  assert.equal(subtitleLift(95, "most"), 95);
  assert.equal(subtitleLift(95, 4), 50);
  assert.equal(subtitleLift(undefined), 95);
});

test("MPV's subtitles rise over the HUD's controls and return, on the viewer's line", () => {
  const sent = [];
  let open = false;
  const player = new Player({ onState: () => {} });
  player.send = (command) => open && sent.push(command[2]) > 0;
  player.state = { active: true, subtitlePosition: 95 };
  player.subtitleSent = 95;
  const mpv = (data) =>
    player.event({ event: "property-change", name: "sub-pos", data });
  // The HUD reports before MPV's pipe opens: nothing counts as sent yet.
  player.setSubtitleCover(0.1325);
  assert.deepEqual(sent, []);
  open = true;
  player.setSubtitleCover(0.1325);
  assert.deepEqual(sent, [86]);
  mpv(86);
  assert.equal(player.state.subtitlePosition, 95, "MPV's echo is not theirs");
  player.setSubtitleCover(0.1325);
  assert.deepEqual(sent, [86], "the same cover sends nothing again");
  // The panel moves the viewer's line: higher shows at once; lower waits
  // under the controls until they hide.
  player.command({ action: "subtitlePosition", value: 70 });
  assert.deepEqual(sent, [86, 70]);
  player.command({ action: "subtitlePosition", value: 92 });
  assert.equal(player.state.subtitlePosition, 92);
  assert.deepEqual(sent, [86, 70, 86]);
  player.setSubtitleCover(0);
  assert.deepEqual(sent, [86, 70, 86, 92]);
  // MPV reports only the last of the lines it was sent.
  mpv(92);
  assert.equal(player.state.subtitlePosition, 92);
  // One of MPV's own keys moves it: that is the viewer's line now.
  mpv(93);
  assert.equal(player.state.subtitlePosition, 93);
  player.setSubtitleCover(0.2);
  assert.deepEqual(sent, [86, 70, 86, 92, 80]);
  mpv(80);
  assert.equal(player.state.subtitlePosition, 93);
  player.setSubtitleCover("x");
  assert.deepEqual(sent, [86, 70, 86, 92, 80, 93]);
});
