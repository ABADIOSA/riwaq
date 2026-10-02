import test from "node:test";
import assert from "node:assert/strict";
import {
  runtimeMinutes,
  sessionSeeds,
  sessionCandidate,
  prepareSession,
  planSession,
} from "../core/session.mjs";
import { Client } from "../core/client.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const movie = (id, runtime, genres = ["Comedy"]) => ({
  id,
  type: "movie",
  name: id,
  runtime,
  genres,
});
const candidate = (m, origin = "library") =>
  sessionCandidate({ meta: m, origin }, m);

test("session runtimes accept minutes and hours but do not invent missing or ambiguous durations", () => {
  for (const [input, expected] of [
    [75, 75],
    ["92 min", 92],
    ["1h 30m", 90],
    ["2h", 120],
    ["45 دقيقة", 45],
    ["", null],
    ["90-120", null],
    [-1, null],
    [Infinity, null],
    ["2026", null],
    ["1:30", null],
  ])
    assert.equal(runtimeMinutes(input), expected);
});

test("a measured resume uses only the remaining minutes and excludes completed movies", () => {
  const meta = movie("film", "120 min");
  const progress = {
    p: { meta, videoId: meta.id, duration: 7200, position: 5400, updated: 1 },
  };
  const seed = sessionSeeds({ progress })[0];
  assert.equal(sessionCandidate(seed, meta).minutes, 30);
  progress.p.completed = true;
  assert.deepEqual(sessionSeeds({ progress, favorites: [meta] }), []);
});

test("series sessions choose an unwatched released regular episode, never a whole show or future episode", () => {
  const meta = {
    id: "show",
    type: "series",
    name: "Show",
    runtime: "45 min",
    videos: [
      { id: "special", season: 0, episode: 1 },
      { id: "ep1", season: 1, episode: 1, runtime: 41 },
      { id: "ep2", season: 1, episode: 2, runtime: 43 },
      { id: "future", season: 1, episode: 3, released: "2099-01-01" },
    ],
  };
  const progress = { ep1: { meta, videoId: "ep1", completed: true } };
  const result = sessionCandidate({ meta, origin: "library" }, meta, progress);
  assert.equal(result.videoId, "ep2");
  assert.equal(result.minutes, 43);
  assert.equal(result.estimated, false);
  progress.ep2 = { meta, videoId: "ep2", completed: true };
  assert.equal(sessionCandidate({ meta }, meta, progress), null);
  assert.equal(
    candidate({ ...movie("future", 90), released: "2099-01-01" }),
    null,
  );
  assert.equal(candidate(movie("unknown", "")), null);
});

test("planning fits the budget including breaks, explains origins and can exclude a pick", () => {
  const options = [
    candidate(movie("short", 35)),
    candidate(movie("medium", 50)),
    candidate(movie("long", 105)),
    candidate(movie("tense", 40, ["Thriller"])),
  ];
  const plan = planSession(options, { budget: 90, mood: "light" });
  assert.deepEqual(plan.items.map((i) => i.meta.id).sort(), [
    "medium",
    "short",
  ]);
  assert.equal(plan.minutes, 90);
  assert.equal(plan.remaining, 0);
  assert.ok(plan.items.every((i) => i.reason.includes("مكتبتك")));
  const next = planSession(options, {
    budget: 90,
    mood: "light",
    excluded: [plan.items[0].key],
  });
  assert.equal(
    next.items.some((i) => i.key === plan.items[0].key),
    false,
  );
  assert.equal(planSession(options, { budget: 30 }).items.length, 0);
  for (const budget of [30, 60, 90, 120, 180]) {
    const p = planSession(options, { budget });
    assert.ok(p.items.length <= 3 && p.minutes <= budget);
    assert.equal(
      p.minutes,
      p.items.reduce((n, i) => n + i.minutes, 0) +
        Math.max(0, p.items.length - 1) * 5,
    );
    assert.equal(new Set(p.items.map((i) => i.meta.id)).size, p.items.length);
  }
});

test("metadata work is bounded and stale session work stops scheduling", async () => {
  const seeds = sessionSeeds({
    rows: [
      { metas: Array.from({ length: 100 }, (_, i) => movie(String(i), 30)) },
    ],
  });
  assert.ok(seeds.length <= 18);
  const releases = [];
  let running = 0,
    max = 0,
    calls = 0,
    current = true;
  const preparing = prepareSession(
    seeds,
    (meta) => {
      calls++;
      max = Math.max(max, ++running);
      return new Promise((resolve) =>
        releases.push(() => {
          running--;
          resolve(meta);
        }),
      );
    },
    { current: () => current },
  );
  assert.equal(calls, 3);
  current = false;
  releases.forEach((resolve) => resolve());
  const result = await preparing;
  assert.equal(calls, 3);
  assert.equal(max, 3);
  assert.deepEqual(result.candidates, []);
});

test("a metadata failure can use known runtime but never an invented fallback", async () => {
  const seeds = [movie("known", 30), movie("missing", null)].map((meta) => ({
    meta,
    origin: "library",
  }));
  const result = await prepareSession(seeds, async () => {
    throw new Error("offline");
  });
  assert.equal(result.failures, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.candidates[0].meta.id, "known");
});

test("malformed addon episode data cannot break a session or change its requested identity", () => {
  const seed = { meta: { id: "show", type: "series", name: "Show" } };
  assert.equal(
    sessionCandidate(seed, {
      id: "wrong",
      name: {},
      videos: { id: "bad" },
      runtime: 40,
    }),
    null,
  );
  const result = sessionCandidate(seed, {
    id: "wrong",
    type: "movie",
    name: {},
    videos: [{ id: "episode", season: 1, episode: 1 }, null],
    runtime: 40,
  });
  assert.equal(result.meta.id, "show");
  assert.equal(result.meta.type, "series");
  assert.equal(result.meta.name, "Show");
  assert.equal(result.videoId, "episode");
});

test("session preferences are validated, profile scoped and late queue actions are refused", () => {
  const c = new Client({ load: () => ({}), save() {} });
  c.settings({ sessionBudget: 120, sessionMood: "wonder" });
  c.profiles.create({ name: "guest" });
  const guest = c.profiles.store.list.find((p) => p.id !== "default").id;
  c.profiles.switch({ id: guest });
  assert.equal(c.state.settings.sessionBudget, 90);
  assert.equal(c.state.settings.sessionMood, "any");
  assert.throws(
    () =>
      c.queueEdit({
        action: "add",
        profileId: "default",
        meta: movie("x", 40),
        videoId: "x",
      }),
    /تغير الملف/,
  );
  assert.deepEqual(c.state.queue, []);
  c.profiles.switch({ id: "default" });
  assert.equal(c.state.settings.sessionBudget, 120);
  assert.equal(c.state.settings.sessionMood, "wonder");
  const invalid = safeSettings(
    { sessionBudget: -40, sessionMood: "invalid", interfaceStyle: "<script>" },
    DEFAULT_SETTINGS,
  );
  assert.equal(invalid.sessionBudget, 90);
  assert.equal(invalid.sessionMood, "any");
  assert.equal(invalid.interfaceStyle, "riwaq");
});
