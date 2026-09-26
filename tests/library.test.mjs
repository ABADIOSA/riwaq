import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import {
  editQueue,
  queueKey,
  continueWatching,
  latestProgress,
  isCompleted,
  filterLibrary,
  releasedEpisodes,
} from "../core/library.mjs";
const movie = {
  id: "tt1",
  type: "movie",
  name: "الحِكاية الأولى",
  year: "2024",
};
const series = {
  id: "tt1",
  type: "series",
  name: "الحكاية الثانية",
  year: "2026",
};
function fixture(load = {}) {
  let saved;
  const client = new Client({
    load: () => structuredClone(load),
    save: (s) => {
      saved = structuredClone(s);
    },
  });
  return { client, saved: () => saved };
}
test("queue keeps metadata only, deduplicates episodes and preserves viewer order", () => {
  let q = editQueue([], {
    action: "add",
    meta: { ...series, url: "PRIVATE", videos: [{ secret: true }] },
    videoId: "tt1:1:1",
    label: "الموسم 1 · الحلقة 1",
  });
  q = editQueue(q, { action: "add", meta: series, videoId: "tt1:1:1" });
  q = editQueue(q, { action: "add", meta: series, videoId: "tt1:1:2" });
  assert.equal(q.length, 2);
  assert.ok(!JSON.stringify(q).includes("PRIVATE"));
  assert.equal(q[0].meta.videos, undefined);
  const key = queueKey(series.type, "tt1:1:2");
  q = editQueue(q, { action: "move", key, direction: -1 });
  assert.equal(q[0].videoId, "tt1:1:2");
  q = editQueue(q, { action: "move", key, direction: -1 });
  assert.equal(q[0].key, key);
  q = editQueue(q, { action: "remove", key });
  assert.equal(q[0].videoId, "tt1:1:1");
});
test("queue validates identity and capacity without truncating existing entries", () => {
  assert.throws(() =>
    editQueue([], { action: "add", meta: movie, videoId: {} }),
  );
  assert.throws(() =>
    editQueue([], {
      action: "add",
      meta: { ...movie, type: "local" },
      videoId: "private-path",
    }),
  );
  const q = Array.from({ length: 200 }, (_, i) => ({ key: String(i) }));
  assert.throws(
    () => editQueue(q, { action: "add", meta: movie, videoId: movie.id }),
    /200/,
  );
  assert.equal(q.length, 200);
});
test("queues and manual history survive migration and remain isolated across profiles", () => {
  const f = fixture(),
    c = f.client;
  c.queueEdit({ action: "add", meta: movie, videoId: movie.id });
  c.historyEdit({ action: "complete", meta: movie, videoId: movie.id });
  const guest = c.profiles.create({ name: "ضيف" }).profiles.list[1].id;
  c.profiles.switch({ id: guest });
  assert.equal(c.state.queue.length, 0);
  assert.deepEqual(c.state.progress, {});
  c.queueEdit({ action: "add", meta: series, videoId: "tt1:1:1" });
  c.profiles.switch({ id: "default" });
  assert.equal(c.state.queue[0].videoId, movie.id);
  const reloaded = fixture(f.saved()).client;
  assert.equal(reloaded.state.queue[0].meta.name, movie.name);
  assert.ok(isCompleted(reloaded.state.progress["movie:tt1"]));
  assert.equal(reloaded.state.integrations?.trakt?.pending?.length || 0, 0);
});
test("protected library rejects queue and history mutations while locked", () => {
  const c = fixture().client;
  c.profiles.setPin({ id: "default", pin: "1234" });
  c.profiles.update({ id: "default", lockedRooms: ["library"] });
  c.profiles.lock();
  assert.throws(
    () => c.queueEdit({ action: "add", meta: movie, videoId: movie.id }),
    /محمي/,
  );
  assert.throws(
    () => c.historyEdit({ action: "complete", meta: movie, videoId: movie.id }),
    /محمي/,
  );
});
test("continue watching groups media types independently and never revives old episodes", () => {
  const progress = {
    a: { meta: series, videoId: "e1", position: 20, duration: 100, updated: 1 },
    b: { meta: series, videoId: "e2", position: 99, duration: 100, updated: 2 },
    c: { meta: movie, videoId: "tt1", position: 30, duration: 100, updated: 3 },
  };
  assert.equal(latestProgress(progress).length, 2);
  assert.deepEqual(
    continueWatching(progress).map((p) => p.meta.type),
    ["movie"],
  );
});
test("manual completion needs no artificial duration, and resuming creates new progress", () => {
  const c = fixture().client;
  c.historyEdit({ action: "complete", meta: movie, videoId: movie.id });
  assert.equal(c.state.progress["movie:tt1"].duration, 0);
  assert.ok(isCompleted(c.state.progress["movie:tt1"]));
  c.recordProgress(movie, movie.id, 20, 100);
  assert.ok(!isCompleted(c.state.progress["movie:tt1"]));
  c.historyEdit({ action: "remove", meta: movie, videoId: movie.id });
  assert.deepEqual(c.state.progress, {});
});
test("Arabic search ignores diacritics and sort/filter never mutate input", () => {
  const input = [movie, series];
  assert.equal(filterLibrary(input, { search: "الحكاية الاولي" }).length, 1);
  assert.equal(filterLibrary(input, { sort: "year" })[0].type, "series");
  assert.equal(input[0].type, "movie");
  assert.equal(filterLibrary(input, { type: "series" }).length, 1);
});
test("automatic episode candidates exclude future releases without changing addon metadata", () => {
  const meta = {
    videos: [
      { id: "future", season: 2, episode: 1, released: "2099-01-01" },
      { id: "second", season: 1, episode: 2 },
      { id: "first", season: 1, episode: 1, released: "2020-01-01" },
    ],
  };
  assert.deepEqual(
    releasedEpisodes(meta).map((v) => v.id),
    ["first", "second"],
  );
  assert.equal(meta.videos[0].id, "future");
});
