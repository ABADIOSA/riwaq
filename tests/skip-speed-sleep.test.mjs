import test from "node:test";
import assert from "node:assert/strict";
import {
  animeEpisode,
  aniskipUrl,
  armUrl,
  onlineSegments,
  parseAniskip,
  parseArm,
} from "../core/skip-online.mjs";
import {
  activeSegment,
  mergeSegments,
  skipMode,
  skipPreferences,
} from "../core/skip-segments.mjs";
import {
  BANDWIDTH_CAPS,
  analyzeStreams,
  neededMbps,
  parseStream,
  scoreStream,
} from "../core/stream-engine.mjs";
import { measureDownload, suggestCap } from "../core/speed-test.mjs";
import { Player } from "../electron/player.mjs";

test("only MyAnimeList and Kitsu episode IDs reach AniSkip", () => {
  assert.deepEqual(animeEpisode("kitsu:7442:3"), {
    source: "kitsu",
    id: 7442,
    episode: 3,
  });
  assert.deepEqual(animeEpisode("mal:16498:12"), {
    source: "mal",
    id: 16498,
    episode: 12,
  });
  for (const id of [
    "tt0944947:1:1",
    "kitsu:7442",
    "kitsu:0:1",
    "mal:1:0",
    "kitsu:1:1/x",
  ])
    assert.equal(animeEpisode(id), null, id);
  assert.equal(
    armUrl(7442),
    "https://arm.haglund.dev/api/v2/ids?source=kitsu&id=7442",
  );
  assert.match(
    aniskipUrl(16498, 3),
    /^https:\/\/api\.aniskip\.com\/v2\/skip-times\/16498\/3\?types\[\]=op/,
  );
  assert.equal(parseArm({ myanimelist: 16498 }), 16498);
  assert.equal(parseArm({ myanimelist: "x" }), 0);
  assert.equal(parseArm(null), 0);
});

test("AniSkip answers become segments, checked number by number", () => {
  const segments = parseAniskip({
    found: true,
    results: [
      { skipType: "ed", interval: { startTime: 1290.4, endTime: 1380 } },
      { skipType: "op", interval: { startTime: 85.123, endTime: 175 } },
      { skipType: "recap", interval: { startTime: 0, endTime: 40 } },
      { skipType: "op", interval: { startTime: 10, endTime: 12 } },
      { skipType: "unknown", interval: { startTime: 1, endTime: 90 } },
      { skipType: "op", interval: { startTime: "x", endTime: 90 } },
      { skipType: "ed", interval: { startTime: 1, endTime: 99999 } },
    ],
  });
  assert.deepEqual(segments, [
    { kind: "recap", start: 0, end: 40, source: "aniskip" },
    { kind: "intro", start: 85.1, end: 175, source: "aniskip" },
    { kind: "outro", start: 1290.4, end: 1380, source: "aniskip" },
  ]);
  assert.deepEqual(parseAniskip({ found: false, results: [] }), []);
  assert.deepEqual(parseAniskip(null), []);
});

test("a Kitsu episode is mapped to MyAnimeList first; a failure is silence", async () => {
  const asked = [];
  const fetchJson = async (url) => {
    asked.push(url);
    if (url.includes("arm.haglund.dev")) return { myanimelist: 16498 };
    return {
      found: true,
      results: [{ skipType: "op", interval: { startTime: 60, endTime: 150 } }],
    };
  };
  const segments = await onlineSegments("kitsu:7442:3", { fetchJson });
  assert.equal(segments.length, 1);
  assert.equal(asked.length, 2);
  assert.match(asked[1], /skip-times\/16498\/3/);
  asked.length = 0;
  await onlineSegments("mal:16498:4", { fetchJson });
  assert.equal(asked.length, 1, "a MyAnimeList ID needs no mapping");
  assert.deepEqual(await onlineSegments("tt1:1:1", { fetchJson }), []);
  assert.deepEqual(
    await onlineSegments("mal:1:1", {
      fetchJson: async () => {
        throw new Error("HTTP 404");
      },
    }),
    [],
  );
});

test("a file's chapters win; AniSkip replaces guesses and fills gaps", () => {
  const local = [
    { kind: "intro", start: 30, end: 90, source: "chapter" },
    { kind: "outro", start: 1300, end: 1400, source: "shape" },
  ];
  const online = [
    { kind: "intro", start: 30, end: 120, source: "aniskip" },
    { kind: "outro", start: 1290, end: 1380, source: "aniskip" },
    { kind: "recap", start: 0, end: 25, source: "aniskip" },
  ];
  const merged = mergeSegments(local, online);
  assert.deepEqual(
    merged.map((s) => `${s.kind}:${s.source}`),
    ["recap:aniskip", "intro:chapter", "outro:aniskip"],
  );
  assert.deepEqual(mergeSegments(local, []), local);
});

test("recaps have their own choice and follow the intro when it is unset", () => {
  assert.equal(skipMode({ skipIntro: "auto" }, "recap"), "auto");
  assert.equal(
    skipMode({ skipIntro: "auto", skipRecap: "off" }, "recap"),
    "off",
  );
  assert.equal(skipMode({ skipOutro: "button" }, "preview"), "button");
  const segments = [{ kind: "recap", start: 0, end: 60 }];
  assert.equal(activeSegment(segments, 10, { skipRecap: "off" }), null);
  assert.equal(
    activeSegment(segments, 10, { skipRecap: "button" }).kind,
    "recap",
  );
  // A series excluded from automatic skipping shows the button for recaps too.
  const prefs = skipPreferences(
    { skipIntro: "auto", skipRecap: "auto", skipExcept: ["tt1"] },
    "tt1",
  );
  assert.equal(prefs.skipRecap, "button");
  assert.equal(prefs.skipIntro, "button");
});

test("the skip button steps aside after the chosen seconds", () => {
  const segments = [{ kind: "intro", start: 100, end: 190 }];
  assert.equal(
    activeSegment(segments, 104, { skipHideAfter: 5 }).hidden,
    false,
  );
  assert.equal(activeSegment(segments, 106, { skipHideAfter: 5 }).hidden, true);
  assert.equal(activeSegment(segments, 180, {}).hidden, false);
});

test("auto skip covers recaps with their own choice, once per entry", () => {
  const sent = [];
  const player = new Player({
    onState: () => {},
    skipPrefs: () => ({ skipIntro: "button", skipRecap: "auto" }),
  });
  player.send = (c) => sent.push(c);
  player.state = {
    active: true,
    abLoop: null,
    position: 5,
    segments: [
      { kind: "recap", start: 0, end: 40 },
      { kind: "intro", start: 60, end: 150 },
    ],
  };
  player.refreshSkip();
  player.refreshSkip();
  assert.deepEqual(sent, [["seek", 40, "absolute"]]);
  player.state.position = 70;
  player.refreshSkip();
  assert.equal(sent.length, 1, "the intro is a button here");
});

test("online segments join only the viewing they were asked for", () => {
  const states = [];
  const player = new Player({ onState: (s) => states.push(s) });
  player.send = () => {};
  player.videoId = "kitsu:1:2";
  player.state = { active: true, chapters: [], duration: 1400, position: 0 };
  player.setOnlineSegments("kitsu:1:3", [
    { kind: "intro", start: 60, end: 150, source: "aniskip" },
  ]);
  assert.equal(player.state.segments, undefined);
  player.setOnlineSegments("kitsu:1:2", [
    { kind: "intro", start: 60, end: 150, source: "aniskip" },
  ]);
  assert.equal(player.state.segments.length, 1);
});

test("a stream's need: its size over the runtime, or its label's typical rate", () => {
  const sized = neededMbps({ size: 9e9, resolution: 2160 }, 120);
  assert.equal(sized.measured, true);
  assert.equal(Math.round(sized.mbps), 13);
  const guessed = neededMbps(
    { size: 0, resolution: 2160, source: "REMUX" },
    120,
  );
  assert.equal(guessed.measured, false);
  assert.ok(guessed.mbps > 80);
  // A season pack's size covers many episodes.
  assert.equal(
    neededMbps({ size: 60e9, resolution: 1080, pack: true }, 45).measured,
    false,
  );
  assert.equal(neededMbps({ size: 0 }, 0), null);
  assert.deepEqual(BANDWIDTH_CAPS, [0, 25, 50, 100, 300, 500, 1000]);
});

test("above the speed cap a stream sinks below those that fit, with a reason", () => {
  const remux = parseStream({
    title: "Film.2023.2160p.BluRay.REMUX.HEVC.TrueHD.7.1",
    behaviorHints: { videoSize: 70e9 },
    url: "https://a/1",
  });
  const web = parseStream({
    title: "Film.2023.1080p.WEB-DL.H264.DDP5.1",
    behaviorHints: { videoSize: 4e9 },
    url: "https://a/2",
  });
  const free = scoreStream(remux, { runtime: 120 });
  const capped = scoreStream(remux, { runtime: 120, bandwidthCap: 25 });
  assert.ok(capped.score < free.score);
  const reason = capped.reasons.find((r) => r.code === "bandwidth");
  assert.match(reason.label, /يحتاج نحو \d+ ميغابت\/ث وسرعتك 25/);
  assert.equal(
    scoreStream(web, { runtime: 120, bandwidthCap: 25 }).reasons.some(
      (r) => r.code === "bandwidth",
    ),
    false,
  );
  const ranked = analyzeStreams(
    [
      {
        title: remux.raw || "Film.2023.2160p.BluRay.REMUX.HEVC.TrueHD.7.1",
        behaviorHints: { videoSize: 70e9 },
        url: "https://a/1",
      },
      {
        title: "Film.2023.1080p.WEB-DL.H264.DDP5.1",
        behaviorHints: { videoSize: 4e9 },
        url: "https://a/2",
      },
    ],
    { bandwidthCap: 25, streamSafety: "off" },
    { requested: { runtime: 120 } },
  );
  assert.equal(ranked.kept[0].stream.url, "https://a/2");
  const open = analyzeStreams(
    [
      {
        title: "Film.2023.2160p.BluRay.REMUX.HEVC.TrueHD.7.1",
        behaviorHints: { videoSize: 70e9 },
        url: "https://a/1",
      },
      {
        title: "Film.2023.1080p.WEB-DL.H264.DDP5.1",
        behaviorHints: { videoSize: 4e9 },
        url: "https://a/2",
      },
    ],
    { streamSafety: "off" },
    { requested: { runtime: 120 } },
  );
  assert.equal(open.kept[0].stream.url, "https://a/1", "no cap, no change");
});

test("the speed test times from the first byte and suggests a cap with headroom", async () => {
  let clock = 0;
  const chunk = new Uint8Array(1_000_000);
  let reads = 0;
  const fakeFetch = async (url, init) => {
    assert.equal(init.redirect, "error");
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            reads++;
            clock += 100;
            return reads > 30 ? { done: true } : { done: false, value: chunk };
          },
        }),
      },
    };
  };
  const mbps = await measureDownload({ fetch: fakeFetch, now: () => clock });
  // 29 chunks after the first, in 2.9 s: 80 Mbps.
  assert.equal(mbps, 80);
  assert.equal(suggestCap(mbps), 50);
  assert.equal(suggestCap(1200), 1000);
  assert.equal(suggestCap(10), 25);
  await assert.rejects(
    measureDownload({
      fetch: async () => ({ ok: false, status: 503 }),
      now: () => 0,
    }),
    /تعذّر قياس السرعة/,
  );
});

test("'end after N episodes' counts each ending and stops autoplay at the last", () => {
  const ended = [];
  const player = new Player({
    onState: () => {},
    onEnded: (d) => ended.push(d),
  });
  player.send = () => {};
  player.save = () => {};
  player.state = { active: true };
  player.command({ action: "sleepEpisodes", value: 2 });
  assert.equal(player.state.sleepEpisodes, 2);
  player.event({ event: "end-file", reason: "eof" });
  assert.equal(ended.at(-1).sleep, false);
  // The next episode is a new start: the count survives it.
  player.state = { active: true, sleepEpisodes: player.sleepEpisodes };
  player.event({ event: "end-file", reason: "eof" });
  assert.equal(ended.at(-1).sleep, true);
  assert.equal(player.sleepEpisodes, 0);
  player.command({ action: "sleepEpisodes", value: 9 });
  assert.equal(player.sleepEpisodes, 5, "at most five");
  player.command({ action: "sleep", value: 0 });
  assert.equal(player.sleepEpisodes, 0, "cancelling clears both kinds");
});
