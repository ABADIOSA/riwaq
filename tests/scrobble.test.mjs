import test from "node:test";
import assert from "node:assert/strict";
import {
  Integrations,
  scrobbleBody,
  historyBody,
} from "../core/integrations.mjs";

const movie = { id: "tt1", type: "movie", name: "ديون" };
const show = { id: "tt2", type: "series", name: "مسلسل" };

function rig({ trakt = {}, respond } = {}) {
  const calls = [];
  const client = {
    cache: new Map(),
    state: {
      addons: [],
      connectedLists: [],
      integrations: {
        trakt: {
          clientId: "cid",
          clientSecret: "secret",
          token: { access_token: "token" },
          trackHistory: true,
          scrobble: true,
          ...trakt,
        },
      },
    },
    persist() {},
    publicState() {
      return {};
    },
    request: async (url, init) => {
      const path = new URL(url).pathname;
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ path, body });
      if (respond) return respond(path, body);
      if (path === "/sync/history")
        return { added: { movies: 1, episodes: 1 } };
      return { action: path.split("/").pop() };
    },
  };
  const integrations = new Integrations(client);
  return { integrations, calls, trakt: client.state.integrations.trakt };
}
const frame = (overrides) => ({
  active: true,
  loading: false,
  pause: false,
  live: false,
  meta: movie,
  videoId: "tt1",
  position: 100,
  duration: 1000,
  ...overrides,
});
const scrobbles = (calls) =>
  calls
    .filter((c) => c.path.startsWith("/scrobble/"))
    .map((c) => c.path.slice(10));

test("bodies name a movie, or a show with season and episode", () => {
  assert.deepEqual(scrobbleBody(movie, "tt1", 42.123), {
    movie: { ids: { imdb: "tt1" } },
    progress: 42.12,
  });
  assert.deepEqual(scrobbleBody(show, "tt2:3:7", 150), {
    show: { ids: { imdb: "tt2" } },
    episode: { season: 3, number: 7 },
    progress: 100,
  });
  assert.equal(
    scrobbleBody({ id: "kitsu:1", type: "series" }, "kitsu:1:1", 5),
    null,
  );
  assert.equal(historyBody(show, "not-an-episode"), null);
});

test("nothing is sent until the viewer opts in, and scrobble needs history on", async () => {
  const { integrations, calls } = rig({ trakt: { scrobble: false } });
  integrations.observePlayback(frame());
  assert.equal(calls.length, 0);
  integrations.save({ id: "trakt", trackHistory: false });
  integrations.save({ id: "trakt", scrobble: true });
  assert.equal(integrations.publicState()[0].scrobble, false);
  integrations.save({ id: "trakt", trackHistory: true });
  integrations.save({ id: "trakt", scrobble: true });
  assert.equal(integrations.publicState()[0].scrobble, true);
  integrations.save({ id: "trakt", trackHistory: false });
  assert.equal(integrations.publicState()[0].scrobble, false);
});

test("play, pause, resume and stop become start, pause, start, stop", async () => {
  const { integrations, calls, trakt } = rig();
  integrations.observePlayback(
    frame({ loading: true, duration: 0, position: 0 }),
  );
  integrations.observePlayback(frame({ position: 10 }));
  integrations.observePlayback(frame({ position: 11 }));
  integrations.observePlayback(frame({ pause: true, position: 400 }));
  integrations.observePlayback(frame({ position: 401 }));
  integrations.observePlayback(frame({ position: 950 }));
  integrations.observePlayback(frame({ active: false, position: 950 }));
  integrations.observePlayback(frame({ active: false, position: 950 }));
  await integrations.settle();
  assert.deepEqual(scrobbles(calls), ["start", "pause", "start", "stop"]);
  assert.equal(calls.at(-1).body.progress, 95);
  // Recorded by the stop: not left in the queue, remembered as sent.
  assert.deepEqual(trakt.pending, []);
  assert.ok(trakt.sent.includes("movie:tt1"));
  assert.ok(!calls.some((c) => c.path === "/sync/history"));
});

test("scrobble mode keeps the completion queue from counting the play twice", async () => {
  const { integrations, trakt } = rig();
  integrations.queueHistory(movie, "tt1", 950, 1000);
  assert.equal((trakt.pending || []).length, 0);
  const plain = rig({ trakt: { scrobble: false } });
  plain.integrations.queueHistory(movie, "tt1", 950, 1000);
  assert.equal(plain.trakt.pending.length, 1);
});

test("stopping early saves a position without recording a play", async () => {
  const { integrations, calls, trakt } = rig();
  integrations.observePlayback(frame({ position: 100 }));
  integrations.observePlayback(frame({ active: false, position: 500 }));
  await integrations.settle();
  assert.deepEqual(scrobbles(calls), ["start", "stop"]);
  assert.ok(!(trakt.sent || []).includes("movie:tt1"));
  assert.equal((trakt.pending || []).length, 0);
});

test("a stop that fails offline falls back to the history queue", async () => {
  const { integrations, calls, trakt } = rig({
    respond: (path) => {
      if (path === "/scrobble/stop") throw new Error("تعذّر الاتصال بالمصدر");
      if (path === "/sync/history") return { added: { episodes: 1 } };
      return {};
    },
  });
  integrations.observePlayback(frame({ meta: show, videoId: "tt2:1:4" }));
  integrations.observePlayback(
    frame({ meta: show, videoId: "tt2:1:4", active: false, position: 990 }),
  );
  await integrations.settle();
  await integrations.flushing;
  assert.ok(calls.some((c) => c.path === "/sync/history"));
  assert.deepEqual(trakt.pending, []);
  assert.ok(trakt.sent.includes("series:tt2:1:4"));
});

test("409 means Trakt already has the play: recorded, not retried", async () => {
  const { integrations, calls, trakt } = rig({
    respond: (path) => {
      if (path === "/scrobble/stop") throw new Error("HTTP 409");
      return {};
    },
  });
  integrations.observePlayback(frame());
  integrations.observePlayback(frame({ active: false, position: 990 }));
  await integrations.settle();
  assert.ok(trakt.sent.includes("movie:tt1"));
  assert.deepEqual(trakt.pending, []);
  assert.ok(!calls.some((c) => c.path === "/sync/history"));
});

test("a held write-ahead entry is not sent while its stop is in flight", async () => {
  let release;
  const { integrations, calls, trakt } = rig({
    respond: (path) => {
      if (path === "/scrobble/stop")
        return new Promise((resolve) => (release = resolve));
      if (path === "/sync/history") return { added: { movies: 1 } };
      return {};
    },
  });
  integrations.observePlayback(frame());
  integrations.observePlayback(frame({ active: false, position: 990 }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(trakt.pending.length, 1);
  await integrations.flushHistory();
  assert.ok(!calls.some((c) => c.path === "/sync/history"));
  release({ action: "scrobble" });
  await integrations.settle();
  assert.deepEqual(trakt.pending, []);
  assert.ok(trakt.sent.includes("movie:tt1"));
});

test("an abandoned hold lapses and the queue delivers the play", async () => {
  const { integrations, calls, trakt } = rig();
  trakt.pending = [
    {
      key: "movie:tt9",
      body: historyBody({ id: "tt9", type: "movie" }, "tt9"),
      heldAt: Date.now() - 120000,
    },
  ];
  await integrations.flushHistory();
  assert.ok(calls.some((c) => c.path === "/sync/history"));
  assert.deepEqual(trakt.pending, []);
});

test("playback that never started sends nothing", async () => {
  const { integrations, calls } = rig();
  integrations.observePlayback(frame({ loading: true, duration: 0 }));
  integrations.observePlayback(frame({ active: false, duration: 0 }));
  await integrations.settle();
  assert.equal(calls.length, 0);
});

test("live channels, local files and non-IMDb titles are never scrobbled", async () => {
  const { integrations, calls } = rig();
  integrations.observePlayback(
    frame({ live: true, meta: { id: "live:x", type: "live", name: "قناة" } }),
  );
  integrations.observePlayback(
    frame({ meta: { id: "C:/a.mkv", type: "local", name: "ملف" } }),
  );
  integrations.observePlayback(
    frame({
      meta: { id: "kitsu:1", type: "series", name: "أنمي" },
      videoId: "kitsu:1:1",
    }),
  );
  await integrations.settle();
  assert.equal(calls.length, 0);
});

test("switching titles without a gap closes the first before starting the next", async () => {
  const { integrations, calls } = rig();
  integrations.observePlayback(
    frame({ meta: show, videoId: "tt2:1:1", position: 100 }),
  );
  integrations.observePlayback(
    frame({ meta: show, videoId: "tt2:1:2", position: 5 }),
  );
  await integrations.settle();
  assert.deepEqual(scrobbles(calls), ["start", "stop", "start"]);
  assert.equal(calls[1].body.episode.number, 1);
  assert.equal(calls[2].body.episode.number, 2);
});

test("settle waits for in-flight requests but never past its limit", async () => {
  const { integrations } = rig({ respond: () => new Promise(() => {}) });
  integrations.observePlayback(frame());
  const started = Date.now();
  await integrations.settle(150);
  assert.ok(Date.now() - started < 1000);
});

test("disconnecting Trakt forgets the live session", async () => {
  const { integrations } = rig();
  integrations.observePlayback(frame());
  assert.ok(integrations.session);
  integrations.disconnect("trakt");
  assert.equal(integrations.session, null);
});

test("skipping to the end and closing at once still records the play", async () => {
  const { integrations, calls, trakt } = rig();
  integrations.observePlayback(frame({ position: 100 }));
  // No active frame near the end: the stop frame alone carries the position.
  integrations.observePlayback(frame({ active: false, position: 990 }));
  await integrations.settle();
  assert.equal(calls.at(-1).body.progress, 99);
  assert.ok(trakt.sent.includes("movie:tt1"));
});

test("observing the player never creates a Trakt entry as a side effect", () => {
  const { integrations } = rig();
  delete integrations.client.state.integrations.trakt;
  integrations.observePlayback(frame());
  assert.equal(integrations.client.state.integrations.trakt, undefined);
});

test("a reply after disconnecting never writes into the next account", async () => {
  let release;
  const { integrations } = rig({
    respond: (path) =>
      path === "/scrobble/stop"
        ? new Promise((resolve) => (release = resolve))
        : {},
  });
  integrations.observePlayback(frame());
  integrations.observePlayback(frame({ active: false, position: 990 }));
  await new Promise((resolve) => setImmediate(resolve));
  integrations.disconnect("trakt");
  // The viewer connects a different account before the old reply lands.
  integrations.client.state.integrations.trakt = { clientId: "other" };
  release({ action: "scrobble" });
  await integrations.settle();
  assert.equal(integrations.client.state.integrations.trakt.sent, undefined);
  assert.equal(integrations.client.state.integrations.trakt.pending, undefined);
});
