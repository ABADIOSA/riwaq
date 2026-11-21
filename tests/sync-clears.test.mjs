// Release blocker W4 (PR #155, seventh review), mixed versions: clear
// records and the cleared Live TV list (core/sync-clears.mjs), and settings
// a released writer does not know (core/sync-merge.mjs withKnownSettings).
// Pure functions; the same rules against the real v0.55.0 client and Worker
// are in scripts/test-accounts-mixed.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLEARED_SOURCE,
  clearRecord,
  liftRecord,
  readClears,
  secretRecords,
  settleClears,
  withClears,
  withClearedSource,
  withoutCleared,
} from "../core/sync-clears.mjs";
import { merge3, withKnownSettings } from "../core/sync-merge.mjs";
import { restoreState } from "../core/backup.mjs";
import { keyFor } from "../core/protocol.mjs";

const S1 = "a".repeat(24);
const S2 = "b".repeat(24);
const source = (id) => ({
  id,
  kind: "m3u",
  name: "Fixture " + id.slice(0, 1),
  url: "https://fixture.invalid/" + id.slice(0, 1) + ".m3u",
});
const CONFIGURED = "https://fixture.invalid/token-x/manifest.json";
const PLAIN = "https://fixture.invalid/manifest.json";
const addon = (transportUrl) => ({ transportUrl, manifest: {}, enabled: true });
const payload = ({
  sources = [],
  favorites = [],
  clears = [],
  auth = null,
  addons = [],
  discordAppId = "",
  secrets = true,
} = {}) => {
  const p = {
    profiles: { active: "p", list: [{ id: "p", name: "P" }], data: {} },
    hotkeys: {},
    discordAppId,
    addons,
    live: { favorites, sources },
  };
  if (secrets) {
    p.auth = auth;
    p.providers = {};
    p.integrations = {};
    p.notify = {};
  }
  return withClears(p, clears);
};
const key = (authKey) => ({ authKey, email: "", name: "" });

test("a clear record is 24 hex, stable, per kind, and never a channel key", () => {
  const record = clearRecord("live", S1);
  assert.match(record, /^[a-f\d]{24}$/);
  assert.equal(record, clearRecord("live", S1));
  assert.notEqual(record, clearRecord("addon", S1));
  assert.notEqual(record, keyFor(S1));
  assert.ok(!record.includes(S1));
});

test("secretRecords lists sources, configured addons, the Stremio key and the Discord ID only under secrets", () => {
  const p = payload({
    sources: [source(S1), { ...CLEARED_SOURCE }],
    addons: [addon(CONFIGURED), addon(PLAIN)],
    auth: key("synthetic-key"),
    discordAppId: "123456789012345678",
  });
  assert.deepEqual(
    [...secretRecords(p)].sort(),
    [
      clearRecord("live", S1),
      clearRecord("addon", CONFIGURED),
      clearRecord("stremio", "synthetic-key"),
      clearRecord("discord", "123456789012345678"),
    ].sort(),
  );
  assert.equal(secretRecords(payload({ secrets: false })).size, 0);
});

test("a removal here since the base gets a record; the item stays out", () => {
  const base = payload({ sources: [source(S1)], auth: key("k1") });
  const local = payload();
  const out = settleClears(base, local, local);
  assert.deepEqual(
    readClears(out).sort(),
    [clearRecord("live", S1), clearRecord("stremio", "k1")].sort(),
  );
  // Records never touch the favorites list (Codex, 5000 favorites).
  assert.deepEqual(out.live.favorites, []);
  // A released client's copy brought back later is refused.
  const legacy = payload({
    sources: [source(S1)],
    auth: key("k1"),
    clears: readClears(out),
  });
  const merged = merge3(out, out, legacy);
  const settled = settleClears(out, out, merged);
  assert.equal(settled.live.sources.length, 0);
  assert.equal(settled.auth, null);
});

test("a removal another device made is recorded when it reaches this one", () => {
  const base = payload({ sources: [source(S1), source(S2)] });
  const local = base;
  const remote = payload({ sources: [source(S2)] });
  const out = settleClears(base, local, merge3(base, local, remote));
  assert.deepEqual(readClears(out), [clearRecord("live", S1)]);
  assert.deepEqual(
    out.live.sources.map((s) => s.id),
    [S2],
  );
});

test("adding an item here lifts its record: an explicit re-install travels", () => {
  const record = clearRecord("addon", CONFIGURED);
  const base = payload({ clears: [record] });
  const local = payload({ clears: [record], addons: [addon(CONFIGURED)] });
  const out = settleClears(base, local, local);
  // The record goes and its lift is written: only that lifts it elsewhere.
  assert.deepEqual(readClears(out), [liftRecord(record)]);
  assert.equal(out.addons.length, 1);
  // Settling again changes nothing.
  assert.deepEqual(settleClears(out, out, out), out);
});

test("at sign-in nothing is recorded or lifted; the account's records decide", () => {
  const records = [clearRecord("stremio", "shared")];
  const remote = payload({ clears: records });
  // The joining device holds the very session that was signed out: dropped.
  const same = payload({ auth: key("shared") });
  let out = settleClears(
    undefined,
    same,
    merge3(undefined, same, remote, {
      prefer: "remote",
    }),
  );
  assert.equal(out.auth, null);
  assert.deepEqual(readClears(out), records);
  // Its own different session is kept.
  const other = payload({ auth: key("own") });
  out = settleClears(undefined, other, {
    ...merge3(undefined, other, remote, { prefer: "remote" }),
    auth: key("own"),
  });
  assert.equal(out.auth.authKey, "own");
  // A released client's copy of the cleared key, with the joiner's own:
  // the joiner's own wins.
  const legacy = payload({ clears: records, auth: key("shared") });
  out = settleClears(
    undefined,
    other,
    merge3(undefined, other, legacy, { prefer: "remote" }),
  );
  assert.equal(out.auth.authKey, "own");
});

test("without secrets the payload says nothing, and nothing is filtered or recorded", () => {
  const local = payload({ secrets: false, favorites: ["c".repeat(24)] });
  assert.equal(settleClears(payload({ secrets: false }), local, local), local);
  const records = new Set([clearRecord("live", S1)]);
  const p = payload({ secrets: false, sources: [] });
  assert.equal(withoutCleared(p, records), p);
});

test("withoutCleared keeps plain addons, falls back to this device's own Discord ID", () => {
  const records = new Set([
    clearRecord("addon", CONFIGURED),
    clearRecord("discord", "123456789012345678"),
  ]);
  const p = payload({
    addons: [addon(CONFIGURED), addon(PLAIN)],
    discordAppId: "123456789012345678",
  });
  const out = withoutCleared(p, records, {
    discordAppId: "876543210987654321",
  });
  assert.deepEqual(
    out.addons.map((a) => a.transportUrl),
    [PLAIN],
  );
  assert.equal(out.discordAppId, "876543210987654321");
  assert.equal(withoutCleared(p, records).discordAppId, "");
});

test("an empty list goes up as the cleared entry only while the account still lists something", () => {
  const empty = payload();
  assert.deepEqual(
    withClearedSource(empty, payload({ sources: [source(S1)] })).live.sources,
    [CLEARED_SOURCE],
  );
  assert.deepEqual(
    withClearedSource(empty, payload({ sources: [{ ...CLEARED_SOURCE }] })).live
      .sources,
    [CLEARED_SOURCE],
  );
  assert.equal(withClearedSource(empty, payload(), undefined), empty);
  const one = payload({ sources: [source(S2)] });
  assert.equal(withClearedSource(one, payload({ sources: [source(S1)] })), one);
  assert.equal(
    withClearedSource(
      payload({ secrets: false }),
      payload({ sources: [source(S1)] }),
    ).live.sources.length,
    0,
  );
});

test("the cleared entry restores as an empty list here, and is never a source", () => {
  const current = { live: { sources: [source(S1)], favorites: [] } };
  const restored = restoreState(
    current,
    payload({ sources: [{ ...CLEARED_SOURCE }] }),
  );
  assert.deepEqual(restored.live.sources, []);
});

test("settings a released writer dropped keep this device's values, at any depth", () => {
  const bucket = (settings) => ({
    profiles: { data: { p: { settings } } },
  });
  const local = bucket({
    badgeLook: "glass",
    appearance: { glass: "on", mode: "dark" },
    uiLanguage: "en",
  });
  const remote = bucket({ appearance: { mode: "light" }, uiLanguage: "ar" });
  const base = local;
  const merged = withKnownSettings(merge3(base, local, remote), local);
  assert.deepEqual(merged.profiles.data.p.settings, {
    badgeLook: "glass",
    appearance: { glass: "on", mode: "light" },
    uiLanguage: "ar",
  });
  // A profile the other side removed is not brought back.
  const gone = withKnownSettings({ profiles: { data: {} } }, local);
  assert.deepEqual(gone.profiles.data, {});
  assert.equal(withKnownSettings(local, local), local);
});
