import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import {
  followedSeries,
  upNext,
  upNextList,
  calendarEntries,
  groupByDay,
  episodeLabel,
} from "../core/episodes.mjs";
import { continueWatching, isCompleted } from "../core/library.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 26, 12);
const at = (days) => new Date(NOW + days * DAY).toISOString();
const show = (id = "tt5", name = "مسلسل") => ({
  id,
  type: "series",
  name,
  videos: [
    { id: `${id}:0:1`, season: 0, episode: 1, released: at(-90) },
    {
      id: `${id}:1:1`,
      season: 1,
      episode: 1,
      released: at(-60),
      title: "البداية",
    },
    { id: `${id}:1:2`, season: 1, episode: 2, released: at(-30) },
    { id: `${id}:1:3`, season: 1, episode: 3, released: at(-3) },
    { id: `${id}:1:4`, season: 1, episode: 4, released: at(4) },
  ],
});
const done = (meta, videoId, updated = 1) => ({
  meta: { id: meta.id, type: meta.type, name: meta.name },
  videoId,
  position: 0,
  duration: 0,
  completed: true,
  updated,
});

test("followed series come from library, queue and history, newest first", () => {
  const a = { id: "a", type: "series", name: "a" };
  const b = { id: "b", type: "anime", name: "b" };
  const film = { id: "f", type: "movie", name: "f" };
  const state = {
    favorites: [a, film],
    queue: [{ meta: b, added: 50 }],
    progress: { "series:a:1:1": { ...done(a, "a:1:1"), updated: 10 } },
  };
  assert.deepEqual(
    followedSeries(state).map((m) => m.id),
    ["b", "a"],
  );
  assert.equal(followedSeries(state, 1).length, 1);
});

test("nothing is up next for a series the viewer never started", () => {
  assert.equal(upNext(show(), {}, { now: NOW }), null);
});

test("up next is the first released episode after the furthest one finished", () => {
  const meta = show();
  const next = upNext(
    meta,
    { "series:tt5:1:1": done(meta, "tt5:1:1") },
    { now: NOW },
  );
  assert.equal(next.video.id, "tt5:1:2");
  assert.equal(next.label, "الموسم 1 · الحلقة 2");
  // Episode 4 has not aired, so only 2 and 3 are waiting.
  assert.equal(next.remaining, 2);
  assert.equal(next.fresh, false);
});

test("an episode that aired in the last two weeks is flagged fresh", () => {
  const meta = show();
  const next = upNext(
    meta,
    { "series:tt5:1:2": done(meta, "tt5:1:2") },
    { now: NOW },
  );
  assert.equal(next.video.id, "tt5:1:3");
  assert.equal(next.fresh, true);
});

test("an episode still in progress belongs to continue watching, not up next", () => {
  const meta = show();
  const progress = {
    "series:tt5:1:1": done(meta, "tt5:1:1", 1),
    "series:tt5:1:2": {
      ...done(meta, "tt5:1:2", 2),
      completed: false,
      position: 300,
      duration: 1200,
    },
  };
  assert.equal(upNext(meta, progress, { now: NOW }), null);
  assert.equal(continueWatching(progress)[0].videoId, "tt5:1:2");
});

test("a caught-up viewer has nothing up next until the next episode airs", () => {
  const meta = show();
  const progress = { "series:tt5:1:3": done(meta, "tt5:1:3") };
  assert.equal(upNext(meta, progress, { now: NOW }), null);
  assert.equal(
    upNext(meta, progress, { now: NOW + 5 * DAY }).video.id,
    "tt5:1:4",
  );
});

test("specials never count as the next episode", () => {
  const meta = show();
  assert.equal(
    upNext(meta, { "series:tt5:0:1": done(meta, "tt5:0:1") }, { now: NOW }),
    null,
  );
});

test("fresh episodes lead the up next list", () => {
  const old = show("old", "قديم");
  const fresh = show("new", "جديد");
  const list = upNextList(
    [old, fresh],
    {
      "series:old:1:1": done(old, "old:1:1"),
      "series:new:1:2": done(fresh, "new:1:2"),
    },
    { now: NOW },
  );
  assert.deepEqual(
    list.map((item) => item.meta.id),
    ["new", "old"],
  );
});

test("the calendar covers the past week and the coming month", () => {
  const meta = show();
  const entries = calendarEntries(
    [meta],
    { "series:tt5:1:3": done(meta, "tt5:1:3") },
    { now: NOW },
  );
  assert.deepEqual(
    entries.map((entry) => [entry.video.id, entry.aired, entry.watched]),
    [
      ["tt5:1:3", true, true],
      ["tt5:1:4", false, false],
    ],
  );
  assert.equal(
    calendarEntries([meta], {}, { now: NOW, pastDays: 0 }).length,
    1,
  );
});

test("an episode without a readable date is left off the calendar", () => {
  const meta = {
    id: "x",
    type: "series",
    name: "x",
    videos: [
      { id: "x:1:1", season: 1, episode: 1, released: "soon" },
      { id: "x:1:2", season: 1, episode: 2 },
    ],
  };
  assert.deepEqual(calendarEntries([meta], {}, { now: NOW }), []);
});

test("days are grouped in the viewer's time zone", () => {
  // 22:00 UTC on the 26th is already the 27th in Riyadh.
  const entry = { at: Date.UTC(2026, 8, 26, 22) };
  assert.equal(groupByDay([entry], { timeZone: "UTC" })[0].day, "2026-09-26");
  assert.equal(
    groupByDay([entry], { timeZone: "Asia/Riyadh" })[0].day,
    "2026-09-27",
  );
});

test("episode labels read as Arabic", () => {
  assert.equal(episodeLabel({ season: 2, episode: 7 }), "الموسم 2 · الحلقة 7");
  assert.equal(episodeLabel(null), "");
});

function fixture(metas) {
  const addon = {
    transportUrl: "https://meta.test/manifest.json",
    enabled: true,
    manifest: {
      id: "meta",
      name: "meta",
      version: "1",
      resources: ["meta"],
      types: ["series"],
      idPrefixes: ["tt"],
    },
  };
  return new Client({
    load: () => ({ addons: [addon] }),
    save: () => {},
    request: async (url) => {
      const id = decodeURIComponent(
        url.match(/\/meta\/series\/([^/]+)\.json/)?.[1] || "",
      );
      if (!metas[id]) throw new Error("HTTP 404");
      return { meta: metas[id] };
    },
  });
}

test("the overview loads followed series and skips the ones that fail", async () => {
  const good = show("tt5");
  const c = fixture({ tt5: good });
  c.favorite({ id: "tt5", type: "series", name: "مسلسل" });
  c.favorite({ id: "tt404", type: "series", name: "مفقود" });
  c.historyEdit({ action: "complete", meta: good, videoId: "tt5:1:1" });
  const overview = await c.episodes({ days: 3650, pastDays: 30 });
  assert.equal(overview.followed, 2);
  assert.equal(overview.loaded, 1);
  assert.equal(overview.upNext[0].video.id, "tt5:1:2");
  assert.ok(overview.calendar.some((entry) => entry.video.id === "tt5:1:3"));
});

test("watched-up-to-here marks every earlier episode and moves up next", () => {
  const meta = show();
  const c = fixture({});
  c.recordProgress(meta, "tt5:1:1", 1190, 1200);
  const original = c.state.progress["series:tt5:1:1"].updated;
  c.historyEdit({
    action: "completeThrough",
    meta,
    videoIds: ["tt5:1:1", "tt5:1:2", "tt5:1:3"],
  });
  for (const id of ["tt5:1:1", "tt5:1:2", "tt5:1:3"])
    assert.ok(isCompleted(c.state.progress[`series:${id}`]), id);
  // An already finished record is left alone, playback time included.
  assert.equal(c.state.progress["series:tt5:1:1"].updated, original);
  assert.equal(
    upNext(meta, c.state.progress, { now: NOW + 5 * DAY }).video.id,
    "tt5:1:4",
  );
  assert.throws(
    () => c.historyEdit({ action: "completeThrough", meta, videoIds: [] }),
    /الحلقات/,
  );
  assert.throws(
    () => c.historyEdit({ action: "completeThrough", meta, videoIds: [{}] }),
    /الحلقات/,
  );
});
