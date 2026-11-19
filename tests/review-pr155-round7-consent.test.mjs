// Codex's sixth review of PR #155 (docs/REVIEW-PR-155.md, "Seventh pass"),
// W2: an opt-in changed the flag in memory before its write was durable,
// and the usage timer, Trakt's history queue and scrobbles, Simkl's
// scrobbles and AniList's queue read that flag. With a store that answers
// later (the web's), a request left under a choice that was then refused.
// Reproduced here before the fix (the probes in docs/REVIEW-PR-155.md);
// these keep it fixed. Real Client over a DurableWriter whose write can be
// held; an in-memory provider; synthetic tokens. Nothing is logged.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setImmediate as turn } from "node:timers/promises";
import { Client } from "../core/client.mjs";
import { DurableWriter } from "../core/durable.mjs";

const fake = () => randomBytes(16).toString("hex");
const token = (v2) => ({
  access_token: fake(),
  refresh_token: fake(),
  created_at: Math.floor(Date.now() / 1000),
  expires_in: 3600,
  ...(v2 ? { v2: true } : {}),
});
const movie = { id: "tt1375666", type: "movie", name: "Synthetic" };
const frame = (o) => ({
  active: true,
  loading: false,
  pause: false,
  live: false,
  meta: movie,
  videoId: "tt1375666",
  position: 950,
  duration: 1000,
  ...o,
});
const turns = async (n = 6) => {
  for (let i = 0; i < n; i++) await turn();
};

function rig(initial = {}) {
  const sent = [];
  let gate;
  let current;
  let disk = structuredClone(initial);
  const writer = new DurableWriter({
    snapshot: () => ({ text: JSON.stringify(current) }),
    write: async (text) => {
      if (gate) {
        const g = gate;
        gate = null;
        g.started.resolve();
        await g.finish.promise;
      }
      disk = JSON.parse(text);
    },
  });
  const request = async (url, init) => {
    const u = new URL(String(url));
    sent.push({ host: u.hostname, path: u.pathname, method: init?.method });
    if (u.pathname === "/sync/history") return { added: { movies: 1 } };
    if (u.hostname === "graphql.anilist.co")
      return { data: { Media: { id: 1, episodes: 12, mediaListEntry: null } } };
    return {};
  };
  const boot = () =>
    new Client({
      load: () => structuredClone(disk),
      save(state, undo) {
        current = state;
        return writer.request(undo);
      },
      request,
      accountServer: "https://usage.example.test",
    });
  const r = {
    c: boot(),
    sent,
    writer,
    disk: () => disk,
    boot() {
      r.c = boot();
      r.c.usage.request = request;
      return r.c;
    },
    hold() {
      gate = {
        started: Promise.withResolvers(),
        finish: Promise.withResolvers(),
      };
      return gate;
    },
  };
  r.c.usage.request = request;
  return r;
}
const pulses = (sent) =>
  sent.filter((x) => x.path === "/v1/usage" && x.method === "POST").length;

test("W2: the usage timer sends nothing while an opt-in is written, and nothing at all when it is refused", async () => {
  const r = rig();
  r.c.usage.start(() => true);
  const held = r.hold();
  const editing = r.c.usage.edit(true).then(
    () => "accepted",
    () => "refused",
  );
  await held.started.promise;
  await r.c.usage.tick(); // the interval firing meanwhile
  assert.equal(pulses(r.sent), 0);
  held.finish.reject(new Error("synthetic refusal"));
  assert.equal(await editing, "refused");
  await r.writer.settled();
  await r.c.usage.tick();
  r.c.usage.stop();
  assert.equal(r.c.usage.publicState().enabled, false);
  assert.deepEqual(r.sent, []); // no pulse, so no deletion is owed either
});

test("W2: an accepted opt-in sends its first pulse only once durable; it survives a restart", async () => {
  const r = rig();
  const held = r.hold();
  const editing = r.c.usage.edit(true);
  await held.started.promise;
  await r.c.usage.tick();
  assert.equal(pulses(r.sent), 0);
  held.finish.resolve();
  await editing;
  assert.equal(pulses(r.sent), 1);
  // A restart reads the kept choice: nothing is pending.
  const again = r.boot();
  await again.usage.tick();
  assert.equal(pulses(r.sent), 2);
});

test("W2: withdrawing usage consent stops new pulses at once; a refused withdrawal keeps the choice that was kept", async () => {
  const r = rig();
  await r.c.usage.edit(true);
  assert.equal(pulses(r.sent), 1);
  r.c.usage.last = 0;
  // Withdrawal being written: the flag is already off, nothing new leaves.
  const held = r.hold();
  const off = r.c.usage.edit(false).then(
    () => "accepted",
    () => "refused",
  );
  await held.started.promise;
  await r.c.usage.tick();
  assert.equal(pulses(r.sent), 1);
  held.finish.reject(new Error("synthetic refusal"));
  assert.equal(await off, "refused");
  // Not kept: the viewer is told, and the kept choice (on) stands.
  assert.equal(r.c.usage.publicState().enabled, true);
  // Kept this time: only the deletion request leaves.
  await r.c.usage.edit(false);
  assert.equal(r.c.usage.publicState().enabled, false);
  assert.equal(
    r.sent.filter((x) => x.path === "/v1/usage" && x.method === "DELETE")
      .length,
    1,
  );
  await r.c.usage.tick();
  assert.equal(pulses(r.sent), 1);
});

const trackers = [
  {
    name: "Trakt history",
    provider: "trakt",
    bag: () => ({ clientId: "fixture", clientSecret: fake(), token: token() }),
    enable: { trackHistory: true },
    act: async (c) => {
      c.integrations.queueHistory(movie, "tt1375666", 950, 1000);
      await c.integrations.flushHistory();
    },
  },
  {
    name: "Trakt scrobble",
    provider: "trakt",
    bag: () => ({
      clientId: "fixture",
      clientSecret: fake(),
      token: token(),
      trackHistory: true,
    }),
    enable: { scrobble: true },
    act: async (c) => {
      c.integrations.observePlayback(frame());
      c.integrations.observePlayback(frame({ active: false }));
      await c.integrations.settle(500);
    },
  },
  {
    name: "Simkl scrobble",
    provider: "simkl",
    bag: () => ({ clientId: "fixture", token: token(true) }),
    enable: { trackHistory: true },
    act: async (c) => {
      c.integrations.observePlayback(frame());
      await c.integrations.settle(500);
    },
  },
  {
    name: "AniList progress",
    provider: "anilist",
    bag: () => ({ clientId: "12345", token: { access_token: fake() } }),
    enable: { trackHistory: true },
    act: async (c) => {
      c.integrations.queueAnilist(
        { id: "anilist:1", type: "series", name: "Synthetic" },
        "anilist:1:1",
        950,
        1000,
      );
      await c.integrations.flushAnilist().catch(() => {});
    },
  },
];

for (const t of trackers) {
  test(`W2: ${t.name} sends nothing under an opt-in that is still written or refused, and works once it is kept`, async () => {
    // Refused.
    {
      const r = rig({ integrations: { [t.provider]: t.bag() } });
      const held = r.hold();
      r.c.integrations.save({ id: t.provider, ...t.enable });
      const written = r.c.durable().then(
        () => "accepted",
        () => "refused",
      );
      await held.started.promise;
      // A→B→A meanwhile changes nothing about consent.
      const a = r.c.profiles.store.active;
      const b = r.c.profiles
        .create({ name: "B" })
        .profiles.list.find((p) => p.id !== a).id;
      r.c.profiles.switch({ id: b });
      r.c.profiles.switch({ id: a });
      await t.act(r.c);
      await turns();
      assert.deepEqual(r.sent, [], "nothing while written");
      held.finish.reject(new Error("synthetic refusal"));
      assert.equal(await written, "refused");
      await r.writer.settled();
      await t.act(r.c);
      await turns();
      assert.deepEqual(r.sent, [], "nothing after the refusal");
      const s = r.c.state.integrations[t.provider];
      for (const key of Object.keys(t.enable)) assert.ok(!s[key], key);
    }
    // Accepted.
    {
      const r = rig({ integrations: { [t.provider]: t.bag() } });
      const held = r.hold();
      r.c.integrations.save({ id: t.provider, ...t.enable });
      const written = r.c.durable();
      await held.started.promise;
      await t.act(r.c);
      await turns();
      assert.deepEqual(r.sent, [], "nothing while written");
      held.finish.resolve();
      await written;
      await r.writer.settled();
      await t.act(r.c);
      await turns();
      assert.ok(r.sent.length > 0, "sends once kept");
    }
  });
}

test("W2: tracking turned off while Trakt's queue is being sent stops the rest of it", async () => {
  const r = rig({
    integrations: {
      trakt: {
        clientId: "fixture",
        clientSecret: fake(),
        token: token(),
        trackHistory: true,
        pending: [
          {
            key: "movie:tt0000001",
            body: { movies: [{ ids: { imdb: "tt0000001" } }] },
          },
          {
            key: "movie:tt0000002",
            body: { movies: [{ ids: { imdb: "tt0000002" } }] },
          },
        ],
      },
    },
  });
  const first = Promise.withResolvers();
  const release = Promise.withResolvers();
  const plain = r.c.request;
  r.c.request = async (url, init) => {
    const out = await plain(url, init);
    if (new URL(String(url)).pathname === "/sync/history") {
      first.resolve();
      await release.promise;
    }
    return out;
  };
  const flushing = r.c.integrations.flushHistory();
  await first.promise;
  r.c.integrations.save({ id: "trakt", trackHistory: false });
  release.resolve();
  await flushing;
  assert.equal(r.sent.filter((x) => x.path === "/sync/history").length, 1);
  assert.deepEqual(r.c.state.integrations.trakt.pending, []);
});
