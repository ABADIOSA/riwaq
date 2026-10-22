import test from "node:test";
import assert from "node:assert/strict";
import { quickQueueTarget } from "../core/quick-queue.mjs";

test("poster queue resolves movies, resume episodes, and the next unwatched released episode", () => {
  assert.deepEqual(quickQueueTarget({ type: "movie", id: "m" }), {
    videoId: "m",
    label: "",
  });
  const meta = {
    type: "series",
    id: "s",
    videos: [
      { id: "future", season: 1, episode: 3, released: "2999-01-01" },
      { id: "second", season: 1, episode: 2 },
      { id: "first", season: 1, episode: 1 },
      { id: "special", season: 0, episode: 1 },
    ],
  };
  assert.equal(quickQueueTarget(meta).videoId, "first");
  const progress = {
    "series:first": {
      meta,
      videoId: "first",
      position: 50,
      duration: 200,
      updated: 1,
    },
  };
  assert.equal(quickQueueTarget(meta, progress).videoId, "first");
  progress["series:first"].completed = true;
  assert.equal(quickQueueTarget(meta, progress).videoId, "second");
  assert.equal(quickQueueTarget(meta, progress, "special").videoId, "special");
  assert.equal(quickQueueTarget(meta, progress, "future").videoId, "second");
  assert.equal(quickQueueTarget({ type: "series", id: "s", videos: [] }), null);
});
