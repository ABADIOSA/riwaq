import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SOURCE_RUN_TTL,
  gatherSources,
  reusableRun,
} from "../core/source-wait.mjs";
import {
  TMDB_GENRES,
  tmdbGenreNames,
  tmdbItems,
} from "../core/collection-sources.mjs";
import { matchesMood } from "../core/session.mjs";
import { arabicCount, READY_SOURCES, SOURCES } from "../core/arabic.mjs";
import { Client } from "../core/client.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const addon = (key, ms, streams, fail = false) => ({ key, ms, streams, fail });
const ask = async (a) => {
  await wait(a.ms);
  if (a.fail) throw new Error("down");
  return a.streams;
};
const timing = { soft: 60, grace: 25 };

test("the list shows as soon as every addon has answered", async () => {
  const started = Date.now();
  const { ready } = gatherSources(
    [addon("a", 5, [1]), addon("b", 10, [], true)],
    ask,
    timing,
  );
  const { answers, late } = await ready;
  assert.ok(Date.now() - started < 50);
  assert.deepEqual(late, []);
  assert.deepEqual(answers.get("a"), [1]);
  assert.equal(answers.get("b"), null);
});

test("a slow addon does not hold the list once another has sources", async () => {
  const slow = addon("slow", 250, [9, 9]);
  const started = Date.now();
  const { ready, done } = gatherSources(
    [addon("fast", 5, [1, 2]), slow],
    ask,
    timing,
  );
  const first = await ready;
  const took = Date.now() - started;
  assert.ok(took >= 55 && took < 200, `shown after ${took} ms`);
  assert.deepEqual(
    first.late.map((a) => a.key),
    ["slow"],
  );
  assert.ok(!first.answers.has("slow"));
  // The late answer fills the same run.
  const all = await done;
  assert.deepEqual(all.get("slow"), [9, 9]);
  assert.equal(first.answers.get("slow").length, 2);
});

test("with nothing found by the soft limit, the first source plus a grace decides", async () => {
  const started = Date.now();
  const { ready } = gatherSources(
    [
      addon("empty", 5, []),
      addon("late-first", 100, [1]),
      addon("close-behind", 115, [2]),
      addon("very-slow", 400, [3]),
    ],
    ask,
    timing,
  );
  const { answers, late } = await ready;
  const took = Date.now() - started;
  assert.ok(took >= 120 && took < 300, `shown after ${took} ms`);
  assert.deepEqual(answers.get("close-behind"), [2]);
  assert.deepEqual(
    late.map((a) => a.key),
    ["very-slow"],
  );
});

test("when no addon finds anything, the list waits for all of them", async () => {
  const { ready } = gatherSources(
    [addon("a", 5, []), addon("b", 120, [], true)],
    ask,
    timing,
  );
  const { late, answers } = await ready;
  assert.deepEqual(late, []);
  assert.equal(answers.size, 2);
  const none = gatherSources([], ask, timing);
  assert.deepEqual((await none.ready).late, []);
});

test("a run is reused for five minutes only", () => {
  const runs = new Map([["movie:tt1", { at: 1000 }]]);
  assert.ok(reusableRun(runs, "movie:tt1", 1000 + SOURCE_RUN_TTL - 1));
  assert.equal(reusableRun(runs, "movie:tt1", 1000 + SOURCE_RUN_TTL), null);
  assert.equal(reusableRun(runs, "movie:tt2", 1000), null);
});

function sourcesClient(delays) {
  const asked = [];
  const make = (id, name) => ({
    transportUrl: `https://${id}.example/manifest.json`,
    manifest: {
      id,
      name,
      version: "1",
      resources: ["stream"],
      types: ["movie"],
      catalogs: [],
    },
  });
  const c = new Client({
    load: () => ({
      addons: [
        make("fast", "Fast"),
        make("slow", "Slow"),
        make("dead", "Dead"),
      ],
    }),
    save: () => {},
    request: async (url) => {
      const id = new URL(url).hostname.split(".")[0];
      asked.push(id);
      await wait(delays[id]);
      if (id === "dead") throw new Error("HTTP 521");
      return {
        streams: [
          {
            name: `${id} 1080p`,
            title: `Film.2024.1080p.WEB-DL.x264-${id.toUpperCase()}`,
            url: `https://cdn.example/${id}?token=private`,
          },
        ],
      };
    },
  });
  c.sourceWait = { soft: 40, grace: 10 };
  return { c, asked };
}

test("sources: the slow addon is late, reported later and added on request without a new search", async () => {
  const { c, asked } = sourcesClient({ fast: 5, slow: 200, dead: 10 });
  const events = [];
  c.onLateSources = (info) => events.push(info);
  const first = await c.getStreams({ type: "movie", id: "tt1" });
  assert.deepEqual(first.late, ["Slow"]);
  assert.deepEqual(first.failures, ["Dead"]);
  assert.equal(first.providers, 3);
  assert.equal(first.streams.length, 1);
  await wait(260);
  assert.deepEqual(events, [
    { type: "movie", id: "tt1", found: 1, failed: [] },
  ]);
  // Neither the event nor the result carries an addon address.
  assert.doesNotMatch(JSON.stringify(events), /example|token/);
  const again = await c.getStreams({ type: "movie", id: "tt1", again: true });
  assert.deepEqual(again.late, []);
  assert.equal(again.streams.length, 2);
  // The keys already shown stay valid.
  assert.ok(again.streams.some((s) => s.key === first.streams[0].key));
  assert.equal(asked.length, 3, "asking again made no new request");
  // Without `again`, a new search starts.
  await c.getStreams({ type: "movie", id: "tt1" });
  assert.equal(asked.length, 6);
});

test("sources: a late addon that fails is reported as failed, and a replaced run stays quiet", async () => {
  const { c } = sourcesClient({ fast: 5, slow: 10, dead: 150 });
  const events = [];
  c.onLateSources = (info) => events.push(info);
  const first = await c.getStreams({ type: "movie", id: "tt2" });
  assert.deepEqual(first.late, ["Dead"]);
  await wait(200);
  assert.deepEqual(events, [
    { type: "movie", id: "tt2", found: 0, failed: ["Dead"] },
  ]);
  // A newer search for the same title silences the older run's report.
  events.length = 0;
  await c.getStreams({ type: "movie", id: "tt2" });
  await c.getStreams({ type: "movie", id: "tt2" });
  await wait(200);
  assert.equal(events.length, 1);
});

test("main forwards late sources to the main window only and accepts `again` strictly", () => {
  const main = source("electron/main.mjs");
  assert.match(
    main,
    /client\.onLateSources = \(info\) => emit\("sources", info\)/,
  );
  assert.match(main, /again: a\?\.again === true/);
  assert.match(main.slice(main.indexOf("playerSources: async")), /again: true/);
  assert.match(
    source("electron/preload.cjs"),
    /"sources",\s+"window",\s+\]\.includes\(name\)/,
  );
  assert.doesNotMatch(
    main.match(/const HUD_EVENTS = new Set\(\[[^\]]*\]\)/)[0],
    /sources/,
  );
  const details = source("src/components/Details.jsx");
  assert.match(details, /api\.on\("sources"/);
  assert.match(details, /again: true/);
  assert.equal(arabicCount(2, SOURCES), "مصدران");
  assert.equal(arabicCount(5, SOURCES), "5 مصادر");
  assert.equal(arabicCount(1, READY_SOURCES), "مصدر واحد جاهز");
  assert.equal(arabicCount(12, READY_SOURCES), "12 مصدراً جاهزاً");
});

test("Riwaq's TMDB rows carry genre names, so moods and tastes can match them", () => {
  const items = tmdbItems(
    {
      results: [
        { id: 1, title: "A", genre_ids: [28, 878, 99999, "x"] },
        { id: 2, title: "B" },
      ],
    },
    { kind: "discover", media: "movie" },
  );
  assert.deepEqual(items[0].genres, [28, 878]);
  assert.deepEqual(items[1].genres, []);
  assert.deepEqual(tmdbGenreNames([28, 878], "ar-SA"), ["أكشن", "خيال علمي"]);
  assert.deepEqual(tmdbGenreNames([28, 878], "en-US"), [
    "Action",
    "Science Fiction",
  ]);
  // Series' combined genres become both halves, without repeats.
  assert.deepEqual(tmdbGenreNames([10759, 28], "ar"), ["أكشن", "مغامرة"]);
  assert.deepEqual(tmdbGenreNames([10765], "en"), [
    "Science Fiction",
    "Fantasy",
  ]);
  for (const pairs of Object.values(TMDB_GENRES))
    for (const [ar, en] of pairs) assert.ok(ar && en);
  // Session moods understand both languages.
  assert.ok(matchesMood({ genres: tmdbGenreNames([14], "ar") }, "wonder"));
  assert.ok(matchesMood({ genres: tmdbGenreNames([35], "ar") }, "light"));
  assert.ok(matchesMood({ genres: tmdbGenreNames([53], "en") }, "thrill"));
  assert.ok(!matchesMood({ genres: tmdbGenreNames([27], "ar") }, "light"));
  assert.match(
    source("core/client.mjs"),
    /genres: tmdbGenreNames\(item\.genres, genreLanguage\)/,
  );
});
