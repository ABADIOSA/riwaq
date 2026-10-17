import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import { LISTS_QUERY, anilistLists } from "../core/anime.mjs";
import { simklScrobbleBody } from "../core/simkl.mjs";

const create = (request) =>
  new Client({ request, load: () => ({}), save: () => {} });
const connect = (c, id = "simkl") =>
  Object.assign(c.integrations.get(id), {
    clientId: "fixture",
    token: { access_token: "private-fixture" },
  });
const frame = (props = {}) => ({
  active: true,
  meta: { id: "tt0133093", type: "movie" },
  videoId: "tt0133093",
  duration: 1000,
  position: 100,
  pause: false,
  ...props,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("#92 Simkl full library uses the documented route, retains every status and anime without IMDb", async () => {
  const c = create(async (url) => {
    const u = new URL(url);
    assert.equal(u.pathname, "/sync/all-items");
    assert.equal(u.searchParams.get("extended"), null);
    return {
      shows: ["watching", "plantowatch", "hold", "dropped", "completed"].map(
        (status) => ({
          status,
          show: { title: status, ids: { imdb: "tt0903747" } },
        }),
      ),
      anime: [
        {
          status: "watching",
          show: {
            title: "Cowboy Bebop",
            ids: { simkl: 37089, anilist: "1" },
            poster: "36/36842f1bceb6b39",
          },
        },
      ],
    };
  });
  connect(c);
  await c.integrations.sync("simkl");
  assert.equal(c.state.connectedLists.length, 6);
  assert.equal(c.state.connectedLists.at(-1).metas[0].id, "anilist:1");
});

test("#92 AniList imports six statuses and merges custom sections of the same status", () => {
  assert.ok(!LISTS_QUERY.includes("status_in: [CURRENT, PLANNING]"));
  const lists = [
    "CURRENT",
    "PLANNING",
    "PAUSED",
    "DROPPED",
    "REPEATING",
    "COMPLETED",
    "CURRENT",
  ].map((status, i) => ({
    status,
    entries: [{ media: { id: i + 1, title: { english: status } } }],
  }));
  const rows = anilistLists({ lists });
  assert.equal(rows.length, 6);
  assert.equal(rows.find((r) => r.key === "anilist-current").metas.length, 2);
});

test("#92 Simkl scrobbles only opted-in transitions, in order, never player heartbeats", async () => {
  const calls = [];
  const c = create(async (url, options) => {
    calls.push({ path: new URL(url).pathname, options });
    return {};
  });
  connect(c);
  c.integrations.observePlayback(frame());
  await tick();
  assert.equal(calls.length, 0);
  c.integrations.save({ id: "simkl", trackHistory: true });
  c.integrations.observePlayback(frame());
  for (let i = 0; i < 20; i++)
    c.integrations.observePlayback(frame({ position: 100 + i }));
  c.integrations.observePlayback(frame({ pause: true, position: 500 }));
  c.integrations.observePlayback(frame({ position: 550 }));
  c.integrations.observePlayback(frame({ active: false, position: 920 }));
  await c.integrations.settle();
  assert.deepEqual(
    calls.map((x) => x.path),
    ["/scrobble/start", "/scrobble/pause", "/scrobble/start", "/scrobble/stop"],
  );
  assert.ok(calls.every((x) => x.options.method === "POST"));
  assert.equal(JSON.parse(calls.at(-1).options.body).progress, 92);
  assert.ok(!JSON.stringify(c.publicState()).includes("private-fixture"));
});

test("Simkl never guesses anime seasons or sends unsupported/live IDs", () => {
  assert.deepEqual(
    simklScrobbleBody({ id: "mal:1", type: "series" }, "mal:1:4", 50),
    {
      progress: 50,
      anime: { ids: { mal: "1" } },
      episode: { season: 1, number: 4 },
    },
  );
  assert.equal(
    simklScrobbleBody({ id: "mal:1", type: "series" }, "mal:1:2:4", 50),
    null,
  );
  const custom = anilistLists({
    lists: [
      { status: null, entries: [{ status: "PAUSED", media: { id: 9 } }] },
      { status: "PAUSED", entries: [{ media: { id: 9 } }] },
    ],
  });
  assert.equal(custom.length, 1);
  assert.equal(custom[0].metas.length, 1);
  assert.equal(
    simklScrobbleBody({ id: "simkl:1", type: "series" }, "simkl:1:4", 50),
    null,
  );
  assert.equal(
    simklScrobbleBody({ id: "tt1", type: "series" }, "tt2:1:4", 50),
    null,
  );
});

test("a fresh Simkl sign-in cannot inherit the previous user's activity or tracking consent", async () => {
  const c = create(async (url) => {
    const path = new URL(url).pathname;
    if (path === "/oauth2/device")
      return {
        device_code: "device",
        user_code: "1234",
        verification_uri: "https://simkl.com/pin",
        expires_in: 600,
        interval: 5,
      };
    if (path === "/oauth2/token")
      return { access_token: "different-user-private", expires_in: 604800 };
    throw new Error("Unexpected fixture call");
  });
  const s = connect(c);
  s.trackHistory = true;
  s.pending = [{ key: "old-private-watch" }];
  c.state.connectedLists = [
    { key: "old", service: "simkl", metas: [] },
    { key: "keep", service: "trakt", metas: [] },
  ];
  await c.integrations.begin("simkl");
  c.integrations.devices.get("simkl").next = 0;
  await c.integrations.poll("simkl");
  assert.equal(s.trackHistory, false);
  assert.deepEqual(s.pending, []);
  assert.deepEqual(
    c.state.connectedLists.map((l) => l.key),
    ["keep"],
  );
});

test("a malformed tracker library response preserves existing imported lists", async () => {
  for (const id of ["simkl", "anilist"]) {
    const c = create(async (url, options) => {
      if (id === "simkl") return { movies: "not-an-array" };
      return JSON.parse(options.body).query.includes("Viewer")
        ? { data: { Viewer: { id: 1 } } }
        : { data: { MediaListCollection: null } };
    });
    connect(c, id);
    c.state.connectedLists = [
      { key: "saved", service: id, metas: [{ id: "tt1" }] },
    ];
    await assert.rejects(c.integrations.sync(id), /غير صالحة/);
    assert.equal(c.state.connectedLists[0].key, "saved");
  }
});

test("Simkl opt-out cancels queued writes even when tracking is enabled again", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const calls = [];
  const c = create(async (url) => {
    calls.push(url);
    await gate;
    return {};
  });
  connect(c);
  c.integrations.save({ id: "simkl", trackHistory: true });
  c.integrations.observePlayback(frame());
  await tick();
  c.integrations.observePlayback(frame({ pause: true }));
  c.integrations.save({ id: "simkl", trackHistory: false });
  c.integrations.save({ id: "simkl", trackHistory: true });
  release();
  await c.integrations.settle();
  assert.equal(calls.length, 1);
});

test("AniList opt-out while resolving an episode prevents its subsequent progress write", async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  let writes = 0;
  const c = create(async (url, opts) => {
    const { query } = JSON.parse(opts.body);
    if (query.includes("SaveMediaListEntry")) {
      writes++;
      return { data: {} };
    }
    await gate;
    return { data: { Media: { id: 1, episodes: 12 } } };
  });
  connect(c, "anilist").trackHistory = true;
  c.integrations.queueAnilist(
    { id: "anilist:1", type: "series" },
    "anilist:1:1",
    950,
    1000,
  );
  const job = c.integrations.flushAnilist();
  c.integrations.save({ id: "anilist", trackHistory: false });
  release();
  await job;
  assert.equal(writes, 0);
});

test("AniList retries a failed queued episode after backoff without requiring a different title", async () => {
  let fails = true;
  let calls = 0;
  const c = create(async () => {
    calls++;
    if (fails) throw Object.assign(new Error("HTTP 503"), { status: 503 });
    return { data: { Media: { id: 1, episodes: 12 } } };
  });
  const s = connect(c, "anilist");
  s.trackHistory = true;
  const queue = () =>
    c.integrations.queueAnilist(
      { id: "anilist:1", type: "series" },
      "anilist:1:1",
      950,
      1000,
    );
  queue();
  await c.integrations.flushAnilist();
  assert.ok(s.retryAt > Date.now());
  queue();
  await c.integrations.flushAnilist();
  assert.equal(calls, 1);
  fails = false;
  s.retryAt = 0;
  queue();
  await tick();
  await c.integrations.flushAnilist();
  assert.equal(s.pending.length, 0);
});

test("Simkl failed final positions survive for manual sync, and 409 acknowledges the recorded watch", async () => {
  let failed = true;
  let stops = 0;
  const c = create(async (url) => {
    if (new URL(url).pathname === "/scrobble/stop") {
      stops++;
      throw Object.assign(new Error(failed ? "HTTP 503" : "HTTP 409"), {
        status: failed ? 503 : 409,
      });
    }
    return {};
  });
  const s = connect(c);
  s.trackHistory = true;
  c.integrations.observePlayback(frame());
  c.integrations.observePlayback(frame({ active: false, position: 920 }));
  await c.integrations.settle();
  assert.equal(s.pending.length, 1);
  assert.ok(s.trackingError);
  failed = false;
  await c.integrations.sync("simkl");
  assert.equal(stops, 2);
  assert.equal(s.pending.length, 0);
  assert.equal(s.trackingError, "");
});

test("Simkl refresh retries the same POST body and a disconnected account cannot send queued actions", async () => {
  let posts = 0;
  const bodies = [];
  const c = create(async (url, options) => {
    if (new URL(url).pathname === "/oauth2/token")
      return {
        access_token: "fresh-private",
        refresh_token: "refresh",
        expires_in: 604800,
      };
    bodies.push(options.body);
    posts++;
    if (posts === 1)
      throw Object.assign(new Error("HTTP 401"), { status: 401 });
    assert.equal(options.headers.Authorization, "Bearer fresh-private");
    return {};
  });
  const s = connect(c);
  s.trackHistory = true;
  Object.assign(s.token, { v2: true, refresh_token: "refresh" });
  c.integrations.observePlayback(frame());
  await c.integrations.settle();
  assert.equal(posts, 2);
  assert.equal(bodies[0], bodies[1]);
  c.integrations.observePlayback(frame({ pause: true }));
  c.integrations.disconnect("simkl");
  connect(c).trackHistory = true;
  await c.integrations.settle();
  // Revoke is a separate best-effort request for the old account.
  assert.equal(bodies.filter((b) => b?.includes('"progress"')).length, 2);
});
