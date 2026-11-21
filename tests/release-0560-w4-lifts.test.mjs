// Release blocker W4, every carrier lost (Codex's release acceptance,
// 2026-11-21): a released device deleted all five provider keys, so no copy
// of a clear record was left in the account; a 0.55.0 device came back with
// the removed Live TV source; a new updated device joined before the
// remover synced and uploaded the source with an empty list of records; the
// remover read that list as a lift and the source came back everywhere.
// Lifts are now written (liftRecord), never inferred from a missing record.
// Pure rules here; the same flows against the real v0.55.0 client and
// Worker are scenario 7 of scripts/test-accounts-mixed.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLEARED_SOURCE,
  MAX_CLEARS,
  clearRecord,
  liftRecord,
  mergeWithClears,
  readClears,
  settleClears,
  withClears,
  withoutCleared,
} from "../core/sync-clears.mjs";

const S1 = "a".repeat(24);
const S2 = "b".repeat(24);
const R1 = clearRecord("live", S1);
const L1 = liftRecord(R1);
const source = (id) => ({
  id,
  kind: "m3u",
  name: "Fixture " + id.slice(0, 1),
  url: "https://fixture.invalid/" + id.slice(0, 1) + ".m3u",
});
const payload = ({
  sources = [],
  clears,
  auth = null,
  favorites = [],
} = {}) => {
  const p = {
    profiles: { active: "p", list: [{ id: "p", name: "P" }], data: {} },
    hotkeys: {},
    discordAppId: "",
    addons: [],
    live: { favorites, sources },
    auth,
    providers: {},
    integrations: {},
    notify: {},
  };
  return clears ? withClears(p, clears) : p;
};
const ids = (p) =>
  p.live.sources.filter((s) => /^[a-f\d]{24}$/.test(s.id)).map((s) => s.id);
/** One merge of a device on this version (AccountHub.run, pure). */
const merge = (base, local, remote, prefer = "local") =>
  settleClears(
    base,
    local,
    mergeWithClears(base, local, remote, { prefer, kept: readClears(local) }),
  );
/** What it uploads next (AccountHub.ownClears against its new base). */
const upload = (remote, merged) => {
  const base = withoutCleared(remote, new Set(readClears(merged)));
  return settleClears(base, merged, merged);
};

test("Codex's sequence: the remover keeps its record against a list from a device that never knew it", () => {
  // A removed S1 and holds its record; the account's copy came from the new
  // device C: S1 (from the returning 0.55.0 device) and an empty list.
  const aBase = payload({ sources: [CLEARED_SOURCE], clears: [R1] });
  const fromC = payload({ sources: [source(S1)], clears: [] });
  const a = merge(aBase, aBase, fromC);
  assert.deepEqual(ids(a), []);
  assert.deepEqual(readClears(a), [R1]);
  const aUp = upload(fromC, a);
  assert.deepEqual(readClears(aUp), [R1]);
  assert.ok(!readClears(aUp).includes(L1));
  // C reads A's answer and drops S1; it lifts nothing.
  const c = merge(fromC, fromC, aUp);
  assert.deepEqual(ids(c), []);
  assert.deepEqual(readClears(c), [R1]);
  assert.deepEqual(readClears(upload(aUp, c)), [R1]);
});

test("a device's first sync takes what the account holds without lifting it", () => {
  // The account's copy has lost every record (a released writer, no list).
  const remote = payload({ sources: [source(S1)] });
  const fresh = payload({ clears: [] });
  const joined = merge(undefined, fresh, remote, "remote");
  assert.deepEqual(ids(joined), [S1]);
  assert.deepEqual(readClears(joined), []);
  // Its first upload: S1 came from the account, so no lift goes up.
  const up = upload(remote, joined);
  assert.deepEqual(ids(up), [S1]);
  assert.deepEqual(readClears(up), []);
  // Its own item the account never had is a local add: its lift goes up.
  const own = payload({ sources: [source(S2)], clears: [] });
  const withOwn = merge(undefined, own, remote, "remote");
  assert.deepEqual(ids(withOwn).sort(), [S1, S2]);
  assert.deepEqual(readClears(upload(remote, withOwn)), [
    liftRecord(clearRecord("live", S2)),
  ]);
});

test("an explicit re-add lifts the record on every device that holds it, through a released relay", () => {
  // E (this version) knew R1 and restores S1 on purpose.
  const eBase = payload({ clears: [R1] });
  const eLocal = payload({ sources: [source(S1)], clears: [R1] });
  const eUp = settleClears(eBase, eLocal, eLocal);
  assert.deepEqual(ids(eUp), [S1]);
  assert.deepEqual(readClears(eUp), [L1]);
  // A released device relays the payload (its cleaner keeps the carriers).
  const relayed = JSON.parse(JSON.stringify(eUp));
  const aBase = payload({ clears: [R1] });
  const a = merge(aBase, aBase, relayed);
  assert.deepEqual(ids(a), [S1]);
  assert.deepEqual(readClears(a), [L1]);
  // Settling again writes nothing new: no upload war.
  assert.deepEqual(settleClears(relayed, a, a), a);
  assert.deepEqual(readClears(upload(relayed, a)), [L1]);
});

test("an explicit add on a device that never knew the record still lifts it", () => {
  // Every carrier was lost; E never saw R1 and adds S1 (a backup restored).
  const eBase = payload({ clears: [] });
  const eLocal = payload({ sources: [source(S1)], clears: [] });
  const eUp = settleClears(eBase, eLocal, eLocal);
  assert.deepEqual(readClears(eUp), [L1]);
  const aBase = payload({ clears: [R1] });
  const a = merge(aBase, aBase, eUp);
  assert.deepEqual(ids(a), [S1]);
  assert.deepEqual(readClears(a), [L1]);
});

test("removed again after a lift: the record comes back and the lift goes, on both sides", () => {
  const lifted = payload({ sources: [source(S1)], clears: [L1] });
  const removed = settleClears(
    lifted,
    payload({ clears: [L1] }),
    payload({ clears: [L1] }),
  );
  assert.deepEqual(readClears(removed), [R1]);
  const other = merge(lifted, lifted, removed);
  assert.deepEqual(ids(other), []);
  assert.deepEqual(readClears(other), [R1]);
  // Carriers a released device made disagree (one kept the old lift, one
  // has the record again), with S1: the clear wins.
  const stale = payload({ sources: [source(S1)], clears: [R1] });
  stale.providers.tmdb = { ...stale.providers.tmdb, riwaqClears: L1 };
  assert.deepEqual(readClears(stale).sort(), [L1, R1].sort());
  const again = merge(other, other, stale);
  assert.deepEqual(ids(again), []);
  assert.deepEqual(readClears(again), [R1]);
});

test("a removal and a re-add with no order between them: the removal wins", () => {
  // This device removed S1 while another, which never had R1 in its base,
  // re-added it: both are new to this device's base.
  const base = payload({ sources: [source(S1)], clears: [] });
  const local = payload({ clears: [] });
  const remote = payload({ sources: [source(S1)], clears: [L1] });
  const out = merge(base, local, remote);
  assert.deepEqual(ids(out), []);
  assert.deepEqual(readClears(out), [R1]);
});

test("a lift filters nothing and shares the records' bound", () => {
  const p = payload({ sources: [source(S1)] });
  assert.deepEqual(ids(withoutCleared(p, new Set([L1]))), [S1]);
  const many = Array.from({ length: MAX_CLEARS }, (_, i) =>
    clearRecord("addon", "https://fixture.invalid/" + i + "/manifest.json"),
  );
  const list = readClears(withClears(payload(), [...many, L1]));
  assert.equal(list.length, MAX_CLEARS);
  assert.equal(list.at(-1), L1);
  assert.equal(list[0], many[1]);
});

test("a Stremio session linked again on purpose is lifted; a joining device's copy of a cleared one is not", () => {
  const R = clearRecord("stremio", "k1");
  const key = (authKey) => ({ authKey, email: "", name: "" });
  const base = payload({ clears: [R] });
  const linked = payload({ auth: key("k1"), clears: [R] });
  const up = settleClears(base, linked, linked);
  assert.equal(up.auth.authKey, "k1");
  assert.deepEqual(readClears(up), [liftRecord(R)]);
  // At sign-in the account's records decide: the joiner's copy is dropped.
  const remote = payload({ clears: [R] });
  const joiner = payload({ auth: key("k1"), clears: [] });
  const joined = merge(undefined, joiner, remote, "remote");
  assert.equal(joined.auth, null);
  assert.deepEqual(readClears(upload(remote, joined)), [R]);
});
