/**
 * Clear records for account sync while released clients still sync (PR #155
 * release blocker W4, mixed versions; docs/ACCOUNTS.md "Clears and released
 * apps").
 *
 * A released Riwaq (0.55.0 and earlier) reads a secrets payload's empty Live
 * TV list, null Stremio sign-in, missing configured addon and empty Discord
 * app ID as "not carried": it keeps its own copy and its next sync uploads
 * it again, so a device that removed it got it back. The account server
 * only stores ciphertext, and a released client rewrites the whole payload
 * from its own state, dropping anything it does not know. What a released
 * client does keep, checked against the real v0.55.0 code
 * (scripts/test-accounts-mixed.mjs) and every released cleaner since
 * accounts began (0.40.0):
 *
 * - Clear records. A record is a 24-hex fingerprint: SHA-256 of a fixed
 *   label, the kind and the item's identity (a Live TV source's random ID,
 *   a configured addon's address, a Stremio session key, a Discord app ID),
 *   cut to 96 bits. It cannot be turned back into the value. A device on
 *   this version that sees an item whose record is listed never takes it
 *   from the account, whoever wrote it.
 *
 *   They travel as one text field, `riwaqClears` (the records joined, at
 *   most MAX_CLEARS of them, 8160 characters), in each data provider's
 *   entry of the secrets payload (`providers.tmdb`, `.omdb`, `.mdblist`,
 *   `.fanart`, `.theintrodb`). Every released cleanSecretBag keeps a
 *   provider entry's text fields of up to 8192 characters, released code
 *   reads an entry only through its `key`, and the released interface
 *   offers to delete an entry only when it has a key: an entry that holds
 *   only the records is "not configured" there and cannot be removed. A
 *   released DataHub.save spreads the entry, so adding a key keeps them.
 *   Deleting a key on a released device removes that one copy; the other
 *   four remain.
 *
 *   Final acceptance, 2026-11-21 (Codex): the records first lived in
 *   `live.favorites`, which a released client cuts to its first 5000. At
 *   5000 real favorites the appended record was cut, the account's copy
 *   lost it, and a returning 0.55.0 device brought the removed source back
 *   to an updated device and a new one. Records no longer touch the
 *   favorites list, so its 5000 entries are the viewer's own, everywhere.
 * - A one-entry Live TV list holding `CLEARED_SOURCE` (not a valid source)
 *   is non-empty, so 0.55.0's restore takes the list and its own cleaner
 *   drops the entry: that device really loses its last source. Only the
 *   last source needs it; removing one of several already reached 0.55.0.
 *
 * Records merge as a set with three rules (mergeClears): a record either
 * side added stays; one this device lifted (it added the item again) goes;
 * one the account's copy lacks goes only when that copy holds a list (an
 * updated writer always writes one, empty included, and a released device
 * passes it on) and holds the item again, as a lift does. A released copy
 * with no list at all lost it: this device keeps the record and puts it
 * back.
 *
 * What a released client cannot be made to do: drop its own Stremio key,
 * configured addon or Discord app ID. It keeps them, on that device, until
 * it updates or the viewer removes them there; devices on this version
 * never take them back.
 *
 * Pure and browser-safe.
 */
import { createHash } from "node:crypto";
import { CLEAR_FIELD, isPlainAddon } from "./backup.mjs";
import { merge3 } from "./sync-merge.mjs";

export { CLEAR_FIELD };

const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const HEX24 = /^[a-f\d]{24}$/;
const RECORDS = /^(?:[a-f\d]{24})*$/;

/** The provider entries that carry the records (all five, every release). */
export const CLEAR_CARRIERS = Object.freeze([
  "tmdb",
  "omdb",
  "mdblist",
  "fanart",
  "theintrodb",
]);
/** 340 × 24 = 8160 characters: under every released cleaner's 8192. */
export const MAX_CLEARS = 340;

/** The Live TV list entry that tells a released client its list is empty. */
export const CLEARED_SOURCE = Object.freeze({
  id: "riwaq:cleared",
  cleared: true,
});

/** The clear record (a 24-hex fingerprint) of one item. */
export function clearRecord(kind, value) {
  return createHash("sha256")
    .update(`riwaq-sync-clear\n${kind}\n${value}`)
    .digest("hex")
    .slice(0, 24);
}

/** True when a payload carries secrets (`auth`, null when signed out). */
export const carriesSecrets = (payload) =>
  isObject(payload) && Object.hasOwn(payload, "auth");

/** At most MAX_CLEARS distinct records, the oldest dropped first. */
const bounded = (list) => {
  const out = [...new Set(list.filter((r) => HEX24.test(r)))];
  return out.length > MAX_CLEARS ? out.slice(-MAX_CLEARS) : out;
};

/**
 * The records a payload carries, oldest first: the first readable carrier,
 * then any record another carrier adds (they are written alike; a released
 * device can only delete one).
 */
export function readClears(payload) {
  const out = [];
  if (!carriesSecrets(payload) || !isObject(payload.providers)) return out;
  for (const id of CLEAR_CARRIERS) {
    const text = payload.providers[id]?.[CLEAR_FIELD];
    if (typeof text !== "string" || text.length > 8192 || !RECORDS.test(text))
      continue;
    for (const record of text.match(/.{24}/g) || [])
      if (!out.includes(record)) out.push(record);
  }
  return bounded(out);
}

/**
 * Whether a payload holds a writer's list of records at all, even an empty
 * one. Every updated writer puts one in each carrier; a released device
 * passes them on as they are. A secrets payload with none was written by a
 * released device that lost them (every carrier's provider entry deleted).
 */
export function hasClears(payload) {
  if (!carriesSecrets(payload) || !isObject(payload.providers)) return false;
  return CLEAR_CARRIERS.some((id) => {
    const text = payload.providers[id]?.[CLEAR_FIELD];
    return (
      typeof text === "string" && text.length <= 8192 && RECORDS.test(text)
    );
  });
}

/**
 * The payload with no records in it: the providers as the viewer set them
 * (an entry that held only the records is left out).
 */
export function stripClears(payload) {
  if (!isObject(payload) || !isObject(payload.providers)) return payload;
  if (
    !CLEAR_CARRIERS.some((id) =>
      Object.hasOwn(payload.providers[id] || {}, CLEAR_FIELD),
    )
  )
    return payload;
  const providers = { ...payload.providers };
  for (const id of CLEAR_CARRIERS) {
    if (!isObject(providers[id]) || !Object.hasOwn(providers[id], CLEAR_FIELD))
      continue;
    const { [CLEAR_FIELD]: _drop, ...rest } = providers[id];
    if (Object.keys(rest).length) providers[id] = rest;
    else delete providers[id];
  }
  return { ...payload, providers };
}

/**
 * The payload carrying exactly `records`, in every carrier, an empty list
 * included (so a released device that passes it on is told apart from one
 * that lost it). Nothing when the payload carries no secrets: the records
 * only ever clear secrets.
 */
export function withClears(payload, records) {
  if (!carriesSecrets(payload)) return payload;
  const out = stripClears(payload);
  const text = bounded([...(records || [])]).join("");
  const providers = { ...(isObject(out.providers) ? out.providers : {}) };
  for (const id of CLEAR_CARRIERS)
    providers[id] = {
      ...(isObject(providers[id]) ? providers[id] : {}),
      [CLEAR_FIELD]: text,
    };
  return { ...out, providers };
}

/**
 * Merges record lists (oldest first). `base` is undefined at sign-in, when
 * the account's records decide. `lifts`: the account's copy holds a
 * writer's list (hasClears), so a record missing from it may have been
 * lifted. `holds(record)`: that copy holds the item the record names.
 *
 * - In the account's copy and not lifted here (in base, gone from local):
 *   kept.
 * - Added here since the base: kept, newest.
 * - In base and local but gone from the account's copy: dropped only when
 *   the copy's list lifted it, which an updated device does only by adding
 *   the item again (a released device passes that on unchanged). Otherwise
 *   the copy lost it (a released device without any carrier, or a list
 *   trimmed past MAX_CLEARS) and it is kept, oldest, so trimming drops it
 *   first again.
 */
export function mergeClears(
  base,
  local,
  remote,
  { lifts = false, holds = () => false } = {},
) {
  if (base === undefined) return bounded(remote);
  const inBase = new Set(base);
  const inLocal = new Set(local);
  const inRemote = new Set(remote);
  const front = [];
  const added = [];
  for (const record of local) {
    if (inRemote.has(record)) continue;
    if (!inBase.has(record)) added.push(record);
    else if (!(lifts && holds(record))) front.push(record);
  }
  const middle = remote.filter(
    (record) => inLocal.has(record) || !inBase.has(record),
  );
  return bounded([...front, ...middle, ...added]);
}

/**
 * merge3 for payloads that carry records: everything but the records goes
 * through merge3, and the records merge as a set (mergeClears). `kept` is
 * this device's own list, used when either side carries no secrets (then
 * the account's copy says nothing about records).
 */
export function mergeWithClears(
  base,
  local,
  remote,
  { prefer = "local", kept = [] } = {},
) {
  const merged = merge3(
    base === undefined ? undefined : stripClears(base),
    stripClears(local),
    stripClears(remote),
    { prefer },
  );
  if (!carriesSecrets(merged)) return merged;
  if (!carriesSecrets(local) || !carriesSecrets(remote))
    return withClears(merged, kept);
  const holding = secretRecords(remote);
  return withClears(
    merged,
    mergeClears(
      base === undefined ? undefined : readClears(base),
      readClears(local),
      readClears(remote),
      { lifts: hasClears(remote), holds: (record) => holding.has(record) },
    ),
  );
}

const realSources = (payload) =>
  (Array.isArray(payload?.live?.sources) ? payload.live.sources : []).filter(
    (source) => isObject(source) && HEX24.test(source.id || ""),
  );

/** The clear records of every secret item a payload holds. */
export function secretRecords(payload) {
  const out = new Set();
  if (!carriesSecrets(payload)) return out;
  for (const source of realSources(payload))
    out.add(clearRecord("live", source.id));
  for (const addon of Array.isArray(payload.addons) ? payload.addons : [])
    if (
      typeof addon?.transportUrl === "string" &&
      !isPlainAddon(addon.transportUrl)
    )
      out.add(clearRecord("addon", addon.transportUrl));
  if (typeof payload.auth?.authKey === "string" && payload.auth.authKey)
    out.add(clearRecord("stremio", payload.auth.authKey));
  if (/^\d{17,20}$/.test(payload.discordAppId || ""))
    out.add(clearRecord("discord", payload.discordAppId));
  return out;
}

const listed = (records, kind, value) => records.has(clearRecord(kind, value));

/**
 * The payload without the items whose clear record is listed. A Stremio
 * sign-in or Discord app ID that was cleared falls back to `own` (this
 * device's) when that one is not cleared too, as keepSignIn does at sign-in.
 */
export function withoutCleared(payload, records, own) {
  if (!carriesSecrets(payload) || !records.size) return payload;
  const out = { ...payload };
  if (isObject(payload.live) && Array.isArray(payload.live.sources))
    out.live = {
      ...payload.live,
      sources: payload.live.sources.filter(
        (source) =>
          !(
            isObject(source) &&
            HEX24.test(source.id || "") &&
            listed(records, "live", source.id)
          ),
      ),
    };
  if (Array.isArray(payload.addons))
    out.addons = payload.addons.filter(
      (addon) =>
        typeof addon?.transportUrl !== "string" ||
        isPlainAddon(addon.transportUrl) ||
        !listed(records, "addon", addon.transportUrl),
    );
  const key = payload.auth?.authKey;
  if (typeof key === "string" && listed(records, "stremio", key)) {
    const mine = own?.auth?.authKey;
    out.auth =
      isObject(own?.auth) &&
      typeof mine === "string" &&
      mine &&
      !listed(records, "stremio", mine)
        ? own.auth
        : null;
  }
  const discord = payload.discordAppId;
  if (
    /^\d{17,20}$/.test(discord || "") &&
    listed(records, "discord", discord)
  ) {
    const mine = own?.discordAppId;
    out.discordAppId =
      /^\d{17,20}$/.test(mine || "") && !listed(records, "discord", mine)
        ? mine
        : "";
  }
  return out;
}

/**
 * Settles one sync's clear records and returns the payload to apply.
 *
 * - `base`: the payload this device last agreed with the account, already
 *   without cleared items (undefined at sign-in: no common ancestor).
 * - `local`: this device's payload before the merge, carrying its records.
 * - `merged`: mergeWithClears's result (after keepSignIn), carrying the
 *   merged records.
 *
 * After the first sync (a base exists), a secret item that was in `base`
 * and is gone from `local` was removed here, and one that was in `local`
 * and is gone from `merged` was removed by another device: both get a
 * record. One in `local` but not in `base` was added here (a new sign-in,
 * an addon installed again), and its record is lifted. At sign-in nothing
 * is recorded or lifted: the account's records decide, so an item cleared
 * on another device is dropped here too, while this device's own sign-in
 * that the account never saw is kept.
 */
export function settleClears(base, local, merged) {
  if (!carriesSecrets(merged)) return merged;
  const current = readClears(merged);
  const records = new Set(current);
  const added = [];
  const lifted = new Set();
  if (base !== undefined && carriesSecrets(local)) {
    const mine = secretRecords(local);
    const after = secretRecords(merged);
    if (carriesSecrets(base)) {
      const before = secretRecords(base);
      for (const record of before) if (!mine.has(record)) added.push(record);
      for (const record of mine) if (!before.has(record)) lifted.add(record);
    }
    for (const record of mine)
      if (!after.has(record) && !lifted.has(record)) added.push(record);
  }
  for (const record of lifted) records.delete(record);
  const fresh = [...new Set(added)].filter(
    (record) => !records.has(record) && !lifted.has(record),
  );
  for (const record of fresh) records.add(record);
  const out = withoutCleared(merged, records, local);
  if (!lifted.size && !fresh.length) return out;
  return withClears(out, [
    ...current.filter((record) => !lifted.has(record)),
    ...fresh,
  ]);
}

/**
 * What goes up for the Live TV list: an empty list becomes
 * `[CLEARED_SOURCE]` while the account's copy (`base`, or the payload just
 * pulled) still lists anything, so a released client drops its own last
 * source instead of keeping it; once the account's list is empty too, an
 * empty list goes up as it is.
 */
export function withClearedSource(local, ...seen) {
  if (!carriesSecrets(local) || !isObject(local.live)) return local;
  if (Array.isArray(local.live.sources) && local.live.sources.length)
    return local;
  const listed = seen.some(
    (payload) =>
      Array.isArray(payload?.live?.sources) && payload.live.sources.length,
  );
  if (!listed) return local;
  return {
    ...local,
    live: { ...local.live, sources: [{ ...CLEARED_SOURCE }] },
  };
}
