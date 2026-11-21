// Codex's sixth review of PR #155 (docs/REVIEW-PR-155.md, "Seventh pass"),
// W5: a Simkl refresh that answered while a disconnect was being written
// was dropped (the session looked disconnected), the disconnect's write was
// refused, and its undo put back the token Simkl had just retired; the next
// save wrote it. The refreshed token now stays with its session object, and
// the revoke after a written disconnect sends the token Simkl honours.
// Synthetic credentials and an in-memory provider only; nothing is logged.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Client } from "../core/client.mjs";
import { DurableWriter } from "../core/durable.mjs";

const fake = () => randomBytes(20).toString("hex");
const session = (provider, { expired = false } = {}) => ({
  clientId: "fixture",
  clientSecret: fake(),
  token: {
    v2: provider === "simkl",
    access_token: fake(),
    refresh_token: fake(),
    created_at: Math.floor(Date.now() / 1000) - (expired ? 10_000 : 0),
    expires_in: 3600,
  },
});

/**
 * A client over a DurableWriter whose next write can be held (`hold()`),
 * with a provider (`provider(url, init)`) answering Simkl's or Trakt's
 * token, revoke and data endpoints.
 */
function fixture(provider, { expired = true, answer } = {}) {
  const original = session(provider, { expired });
  let disk = { integrations: { [provider]: original } };
  let gate;
  let current;
  const writer = new DurableWriter({
    snapshot: () => ({ text: JSON.stringify(current) }),
    write: async (text) => {
      if (gate) {
        const g = gate;
        gate = undefined;
        g.started.resolve();
        await g.finish.promise;
      }
      disk = JSON.parse(text);
    },
  });
  const calls = [];
  const boot = () =>
    new Client({
      load: () => structuredClone(disk),
      save(data, undo) {
        current = data;
        return writer.request(undo);
      },
      request: async (url, init) => {
        const path = new URL(String(url)).pathname;
        const form = new URLSearchParams(init?.body || "");
        calls.push({ path, form });
        return answer(path, form);
      },
    });
  return {
    c: boot(),
    boot,
    original,
    calls,
    writer,
    disk: () => disk,
    revoked: () =>
      calls.filter((x) => x.path === "/oauth2/revoke").map((x) => x.form),
    hold() {
      gate = {
        started: Promise.withResolvers(),
        finish: Promise.withResolvers(),
      };
      return gate;
    },
  };
}
/** A Simkl provider whose refresh can be held; it retires the old token. */
function simklProvider() {
  const renewed = {
    access_token: fake(),
    refresh_token: fake(),
    expires_in: 604800,
  };
  const p = {
    renewed,
    asked: Promise.withResolvers(),
    reply: Promise.withResolvers(),
    retired: false,
    refuse: false,
    async answer(path) {
      if (path === "/oauth2/revoke") return {};
      if (path === "/oauth2/token") {
        p.asked.resolve();
        await p.reply.promise;
        p.retired = true;
        if (p.refuse)
          throw Object.assign(Error("invalid_grant"), { status: 400 });
        return renewed;
      }
      return {};
    },
  };
  return p;
}
const settled = async (f) => {
  await f.writer.settled();
  await nextTurn();
  await f.writer.settled();
};

test("W5: a refresh answering while a refused disconnect is written leaves the renewed token, in memory and on disk, without another save", async () => {
  const p = simklProvider();
  const f = fixture("simkl", { answer: p.answer });
  const loading = f.c.integrations.simkl("/sync/activities").then(
    () => "accepted",
    () => "superseded",
  );
  await p.asked.promise;
  const slot = f.hold();
  f.c.integrations.disconnect("simkl");
  const failed = assert.rejects(f.c.durable());
  await slot.started.promise;
  p.reply.resolve();
  assert.equal(await loading, "superseded"); // no request for an ended view
  slot.finish.reject(new Error("synthetic disconnect write refusal"));
  await failed;
  await settled(f);
  assert.equal(p.retired, true);
  assert.equal(f.revoked().length, 0);
  // Codex's finding: the spent token came back and was written again.
  const kept = f.c.state.integrations.simkl.token;
  assert.equal(kept.refresh_token === p.renewed.refresh_token, true);
  assert.equal(kept.access_token === p.renewed.access_token, true);
  assert.equal(
    f.disk().integrations.simkl.token.refresh_token === p.renewed.refresh_token,
    true,
  );
  // After a restart, the session is the renewed one.
  const again = f.boot();
  assert.equal(
    again.state.integrations.simkl.token.access_token ===
      p.renewed.access_token,
    true,
  );
  // A retried disconnect is written and revokes the token Simkl honours.
  f.c.integrations.disconnect("simkl");
  await f.c.durable();
  await settled(f);
  assert.equal(f.disk().integrations?.simkl, undefined);
  assert.deepEqual(
    f.revoked().map((x) => x.get("token") === p.renewed.access_token),
    [true],
  );
});

test("W5: a refresh answering after the disconnect was written is waited for, and its new token is the one revoked; nothing comes back", async () => {
  const p = simklProvider();
  const f = fixture("simkl", { answer: p.answer });
  const loading = f.c.integrations
    .simkl("/sync/activities")
    .catch(() => "superseded");
  await p.asked.promise;
  f.c.integrations.disconnect("simkl");
  await f.c.durable();
  await nextTurn();
  assert.equal(f.revoked().length, 0); // waits for the refresh
  p.reply.resolve();
  assert.equal(await loading, "superseded");
  await settled(f);
  assert.equal(f.disk().integrations?.simkl, undefined);
  assert.equal(
    Object.keys(f.c.state.integrations?.simkl || {}).length,
    0,
    "no session in memory",
  );
  assert.deepEqual(
    f.revoked().map((x) => x.get("token") === p.renewed.access_token),
    [true],
  );
});

test("W5: a refresh before the disconnect: the written disconnect revokes the renewed token once", async () => {
  const p = simklProvider();
  p.reply.resolve();
  const f = fixture("simkl", { answer: p.answer });
  await f.c.integrations.simkl("/sync/activities");
  await settled(f);
  f.c.integrations.disconnect("simkl");
  await f.c.durable();
  await settled(f);
  assert.equal(f.disk().integrations?.simkl, undefined);
  assert.deepEqual(
    f.revoked().map((x) => x.get("token") === p.renewed.access_token),
    [true],
  );
});

test("W5: a refresh Simkl refuses during a refused disconnect ends the session: it comes back without a token, asking to link again", async () => {
  const p = simklProvider();
  p.refuse = true;
  const f = fixture("simkl", { answer: p.answer });
  const loading = f.c.integrations
    .simkl("/sync/activities")
    .catch((e) => e.message);
  await p.asked.promise;
  const slot = f.hold();
  f.c.integrations.disconnect("simkl");
  const failed = assert.rejects(f.c.durable());
  await slot.started.promise;
  p.reply.resolve();
  assert.match(await loading, /انتهت جلسة Simkl/);
  slot.finish.reject(new Error("synthetic disconnect write refusal"));
  await failed;
  await settled(f);
  const back = f.c.state.integrations.simkl;
  assert.equal(back.clientId, "fixture");
  assert.equal(back.token, undefined);
  assert.equal(f.disk().integrations.simkl.token, undefined);
  assert.equal(
    f.c.publicState().integrations.find((x) => x.id === "simkl").connected,
    false,
  );
  assert.equal(f.revoked().length, 0);
});

test("W5: a new sign-in after the disconnect keeps its own session when the old refresh answers late", async () => {
  const p = simklProvider();
  const f = fixture("simkl", { answer: p.answer });
  const loading = f.c.integrations
    .simkl("/sync/activities")
    .catch(() => "superseded");
  await p.asked.promise;
  f.c.integrations.disconnect("simkl");
  await f.c.durable();
  const replacement = session("simkl");
  f.c.state.integrations.simkl = replacement;
  f.c.persist();
  await f.c.durable();
  p.reply.resolve();
  await loading;
  await settled(f);
  const now = f.c.state.integrations.simkl;
  assert.equal(now, replacement);
  assert.equal(now.token.access_token === replacement.token.access_token, true);
  assert.equal(
    f.disk().integrations.simkl.token.refresh_token ===
      replacement.token.refresh_token,
    true,
  );
  // The revoke named the old session's renewed token, never the new one.
  assert.deepEqual(
    f.revoked().map((x) => x.get("token") === p.renewed.access_token),
    [true],
  );
});

test("W5: a revoke that fails leaves the written disconnect standing", async () => {
  const f = fixture("simkl", {
    expired: false,
    answer: async (path) => {
      if (path === "/oauth2/revoke") throw new Error("synthetic outage");
      return {};
    },
  });
  f.c.integrations.disconnect("simkl");
  await f.c.durable();
  await settled(f);
  assert.equal(f.disk().integrations?.simkl, undefined);
  assert.equal(f.revoked().length, 1);
  assert.equal(f.boot().state.integrations?.simkl, undefined);
});

test("W5: Trakt's single-use refresh answering during a refused disconnect puts back the rotated pair, written on its own", async () => {
  const rotated = {
    access_token: fake(),
    refresh_token: fake(),
    expires_in: 7776000,
  };
  const asked = Promise.withResolvers();
  const reply = Promise.withResolvers();
  const f = fixture("trakt", {
    answer: async (path) => {
      if (path === "/oauth/token") {
        asked.resolve();
        await reply.promise;
        return rotated;
      }
      return {};
    },
  });
  const loading = f.c.integrations
    .trakt("/users/settings")
    .catch(() => "superseded");
  await asked.promise;
  const slot = f.hold();
  f.c.integrations.disconnect("trakt");
  const failed = assert.rejects(f.c.durable());
  await slot.started.promise;
  reply.resolve();
  assert.equal(await loading, "superseded");
  slot.finish.reject(new Error("synthetic disconnect write refusal"));
  await failed;
  await settled(f);
  assert.equal(
    f.c.state.integrations.trakt.token.refresh_token === rotated.refresh_token,
    true,
  );
  assert.equal(
    f.disk().integrations.trakt.token.refresh_token === rotated.refresh_token,
    true,
  );
});
