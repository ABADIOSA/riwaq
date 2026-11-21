// Release blocker W4 at the favourites boundary (Codex's final acceptance,
// 2026-11-21): clear records first rode in `live.favorites`, which every
// released client cuts to its first 5000; at 5000 real favourites the
// appended record was cut and a returning 0.55.0 device brought a removed
// Live TV source back. Records now travel in the data providers' entries
// (core/sync-clears.mjs). These are the pure rules; the same flows against
// the real v0.55.0 client and Worker are scripts/test-accounts-mixed.mjs
// (scenario 6 at 4999 and 5000, RIWAQ_MIXED_FAVORITES for scenarios 1–5).
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  CLEAR_CARRIERS,
  CLEAR_FIELD,
  MAX_CLEARS,
  clearRecord,
  hasClears,
  mergeClears,
  mergeWithClears,
  readClears,
  settleClears,
  stripClears,
  withClears,
} from "../core/sync-clears.mjs";
import { restoreState } from "../core/backup.mjs";
import { LIVE_FAVORITES_MAX, LiveHub } from "../core/live-hub.mjs";

const hex = () => randomBytes(12).toString("hex");
const favourites = (n) => Array.from({ length: n }, hex);
const S1 = "a".repeat(24);
const S2 = "b".repeat(24);
const source = (id) => ({
  id,
  kind: "m3u",
  name: "Fixture " + id.slice(0, 1),
  url: "https://fixture.invalid/" + id.slice(0, 1) + ".m3u",
});
const payload = ({
  sources = [],
  favorites = [],
  providers = {},
  clears,
} = {}) => {
  const p = {
    profiles: { active: "p", list: [{ id: "p", name: "P" }], data: {} },
    hotkeys: {},
    discordAppId: "",
    addons: [],
    live: { favorites, sources },
    auth: null,
    providers,
    integrations: {},
    notify: {},
  };
  return clears ? withClears(p, clears) : p;
};

test("records ride in every provider entry, never in the favourites list", () => {
  const list = [clearRecord("live", S1), clearRecord("live", S2)];
  const p = payload({
    favorites: favourites(LIVE_FAVORITES_MAX),
    providers: { tmdb: { key: "synthetic", enabled: true } },
    clears: list,
  });
  assert.equal(p.live.favorites.length, LIVE_FAVORITES_MAX);
  for (const id of CLEAR_CARRIERS)
    assert.equal(p.providers[id][CLEAR_FIELD], list.join(""));
  // The viewer's own provider settings are kept beside the records.
  assert.equal(p.providers.tmdb.key, "synthetic");
  assert.deepEqual(readClears(p), list);
  // Stripping gives the providers back exactly as the viewer set them.
  assert.deepEqual(stripClears(p).providers, {
    tmdb: { key: "synthetic", enabled: true },
  });
});

test("an empty list is still written, so passing it on differs from losing it", () => {
  const p = payload({ clears: [] });
  assert.ok(hasClears(p));
  assert.deepEqual(readClears(p), []);
  assert.equal(p.providers.omdb[CLEAR_FIELD], "");
  assert.ok(!hasClears(stripClears(p)));
  // Without secrets there is nothing to carry or clear.
  const plain = { ...payload() };
  delete plain.auth;
  assert.equal(withClears(plain, [S1]), plain);
});

test("one deleted provider entry (a released viewer removing a key) keeps the records", () => {
  const list = [
    clearRecord("addon", "https://fixture.invalid/k/manifest.json"),
  ];
  const p = payload({ clears: list });
  const { tmdb: _gone, ...rest } = p.providers;
  assert.deepEqual(readClears({ ...p, providers: rest }), list);
});

test("the carrier fits every released cleaner: at most MAX_CLEARS, 8192 characters", () => {
  const many = Array.from({ length: MAX_CLEARS + 25 }, (_, i) =>
    clearRecord("live", String(i).padStart(24, "0")),
  );
  const p = payload({ clears: many });
  const text = p.providers.tmdb[CLEAR_FIELD];
  assert.ok(text.length <= 8192, `${text.length} characters`);
  const kept = readClears(p);
  assert.equal(kept.length, MAX_CLEARS);
  // The oldest go first.
  assert.deepEqual(kept, many.slice(-MAX_CLEARS));
});

test("malformed carriers are ignored, never half read", () => {
  for (const bad of [
    "xyz",
    S1 + "abc",
    S1.toUpperCase(),
    "a".repeat(8193 - (8193 % 24)) + "a".repeat(24),
    42,
    null,
    { nested: S1 },
  ]) {
    const p = payload({ providers: { tmdb: { [CLEAR_FIELD]: bad } } });
    assert.deepEqual(readClears(p), [], String(bad).slice(0, 30));
  }
});

test("a restore never puts records in the provider store (they belong to the account)", () => {
  const p = payload({
    providers: { tmdb: { key: "synthetic", enabled: true } },
    clears: [clearRecord("live", S1)],
  });
  const state = restoreState({ settings: {} }, p);
  assert.deepEqual(state.providers, {
    tmdb: { key: "synthetic", enabled: true },
    omdb: {},
    mdblist: {},
    fanart: {},
    theintrodb: {},
  });
  for (const entry of Object.values(state.providers))
    assert.ok(!Object.hasOwn(entry, CLEAR_FIELD));
});

test("above 5000 favourites a restore keeps the supported first 5000, records untouched", () => {
  const many = favourites(LIVE_FAVORITES_MAX + 3);
  const p = payload({
    favorites: [...many, "not-a-key", 7, null],
    clears: [clearRecord("live", S1)],
  });
  const state = restoreState({ settings: {} }, p);
  assert.deepEqual(state.live.favorites, many.slice(0, LIVE_FAVORITES_MAX));
  assert.deepEqual(readClears(p), [clearRecord("live", S1)]);
});

test("the Live TV hub refuses a favourite past the limit, and still removes one", () => {
  const client = {
    state: { live: { sources: [], favorites: favourites(LIVE_FAVORITES_MAX) } },
    transact(fn) {
      fn();
    },
    publicState: () => ({}),
  };
  const hub = new LiveHub(client);
  assert.throws(() => hub.favorite(hex()), /5000/);
  assert.equal(client.state.live.favorites.length, LIVE_FAVORITES_MAX);
  const first = client.state.live.favorites[0];
  hub.favorite(first);
  assert.equal(client.state.live.favorites.length, LIVE_FAVORITES_MAX - 1);
  hub.favorite(first);
  assert.equal(client.state.live.favorites.length, LIVE_FAVORITES_MAX);
});

test("mergeClears: additions from both sides stay; a lift here goes", () => {
  const [r1, r2, r3, r4] = [1, 2, 3, 4].map((i) =>
    clearRecord("live", String(i).repeat(24)),
  );
  // Remote added r3, this device added r4 and lifted r2.
  assert.deepEqual(
    mergeClears([r1, r2], [r1, r4], [r1, r2, r3], { lifts: true }),
    [r1, r3, r4],
  );
  // At sign-in the account decides.
  assert.deepEqual(mergeClears(undefined, [r4], [r1]), [r1]);
});

test("mergeClears: a record missing from the account's copy is kept unless that copy lifted it", () => {
  const r1 = clearRecord("live", S1);
  // A released copy with no list at all: lost, kept.
  assert.deepEqual(mergeClears([r1], [r1], [], { lifts: false }), [r1]);
  // A list without it and without the item: lost or trimmed, kept.
  assert.deepEqual(
    mergeClears([r1], [r1], [], { lifts: true, holds: () => false }),
    [r1],
  );
  // A list without it that holds the item again: lifted.
  assert.deepEqual(
    mergeClears([r1], [r1], [], { lifts: true, holds: (r) => r === r1 }),
    [],
  );
  // No list, item held (a released device re-uploading the removed
  // source with every carrier lost): the record stays.
  assert.deepEqual(
    mergeClears([r1], [r1], [], { lifts: false, holds: () => true }),
    [r1],
  );
});

test("mergeClears: trimming on another device converges instead of fighting", () => {
  const all = Array.from({ length: MAX_CLEARS + 1 }, (_, i) =>
    clearRecord("addon", "https://fixture.invalid/" + i + "/manifest.json"),
  );
  const mine = all.slice(0, MAX_CLEARS);
  const theirs = all.slice(1); // they added one and trimmed the oldest
  assert.deepEqual(
    mergeClears(mine, mine, theirs, { lifts: true, holds: () => false }),
    theirs,
  );
});

test("a released device passing on a lift is followed; one that lost the list is not", () => {
  const record = clearRecord("live", S1);
  const base = payload({ clears: [record] });
  const local = base;
  // An updated device re-added S1 (its record lifted), a released device
  // relayed that copy: the list is there, without the record, with S1.
  const relayed = payload({ sources: [source(S1)], clears: [] });
  let merged = settleClears(base, local, mergeWithClears(base, local, relayed));
  assert.deepEqual(
    merged.live.sources.map((s) => s.id),
    [S1],
  );
  assert.deepEqual(readClears(merged), []);
  // The same source from a released device whose copy carries no list.
  const lost = payload({ sources: [source(S1)] });
  merged = settleClears(base, local, mergeWithClears(base, local, lost));
  assert.deepEqual(merged.live.sources, []);
  assert.deepEqual(readClears(merged), [record]);
});

test("the favourites list is the same before and after every records step at 5000", () => {
  const list = favourites(LIVE_FAVORITES_MAX);
  const base = payload({
    favorites: list,
    sources: [source(S1), source(S2)],
    clears: [],
  });
  const local = payload({ favorites: list, sources: [source(S2)], clears: [] });
  const settled = settleClears(base, local, local);
  assert.deepEqual(settled.live.favorites, list);
  assert.deepEqual(readClears(settled), [clearRecord("live", S1)]);
  // A released device that never saw the records comes back with S1.
  const remote = payload({
    favorites: list,
    sources: [source(S1), source(S2)],
  });
  const merged = settleClears(
    settled,
    settled,
    mergeWithClears(settled, settled, remote),
  );
  assert.deepEqual(merged.live.favorites, list);
  assert.deepEqual(
    merged.live.sources.map((s) => s.id),
    [S2],
  );
});
