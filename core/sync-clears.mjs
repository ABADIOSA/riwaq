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
 * Lifts are written, never inferred (Codex's release acceptance,
 * 2026-11-21). An item added on a device on this version (in its payload,
 * not in the copy it last agreed with the account) gets a lift record in
 * the same list: the 24-hex fingerprint of its clear record under another
 * label (liftRecord). A device that holds a clear record drops it only when
 * the account's copy carries its lift; a list that merely lacks the record
 * proves nothing. Until then a list without the record was read as a lift,
 * and a device that never knew the record wrote exactly that: a released
 * device deleted all five carriers, a 0.55.0 device returned with the
 * removed source, and a new updated device that joined before the remover
 * synced uploaded it with an empty list, which the remover took as a lift
 * and the source came back everywhere.
 *
 * Records merge as a set (mergeClears): a record either side added stays;
 * one this device lifted or trimmed since the agreed copy goes; one the
 * account's copy lacks goes only when that copy carries its counterpart (a
 * clear record's lift, or a lift's clear record when the item was removed
 * again), and is otherwise put back: that copy lost it. A record and its
 * own lift never stay together; when the order cannot be told the clear
 * wins.
 *
 * What a released client cannot be made to do: drop its own Stremio key,
 * configured addon or Discord app ID. It keeps them, on that device, until
 * it updates or the viewer removes them there; devices on this version
 * never take them back.
 *
 * What no client can know: once every copy of a record is gone from the
 * account (five keys deleted on a released device), a device joining
 * before one that still holds the record syncs sees the item. Its first
 * upload carries no lift, so that device puts the record back and the
 * joining device drops the item at its next sync.
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

/**
 * The lift record of a clear record: written by a device on this version
 * that added the item (it is in its payload and not in the copy it last
 * agreed with the account). Only a device that knows the clear record can
 * tell it from another record, and only a lift drops a clear record.
 */
export function liftRecord(record) {
  return createHash("sha256")
    .update(`riwaq-sync-lift\n${record}`)
    .digest("hex")
    .slice(0, 24);
}

/** A record and its own lift never stay together: the clear wins. */
const unlifted = (list) => {
  const listed = new Set(list);
  const drop = new Set();
  for (const record of list) {
    const lift = liftRecord(record);
    if (listed.has(lift)) drop.add(lift);
  }
  return drop.size ? list.filter((record) => !drop.has(record)) : list;
};

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
 * It says nothing about lifts: a list written by a device that never knew a
 * record lacks it too (mergeClears reads lifts only from liftRecord).
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
 * Merges record lists (oldest first), clear and lift records alike. `base`
 * is undefined at sign-in, when the account's records decide.
 *
 * - In the account's copy and not dropped here (in base, gone from local:
 *   lifted, cleared again or trimmed here): kept.
 * - Added here since the base: kept, newest.
 * - In base and local but gone from the account's copy: dropped only when
 *   that copy carries its counterpart, which only a device on this version
 *   writes, and a released device passes on unchanged: the lift of a clear
 *   record (the item was added again on such a device), or the clear record
 *   of a lift (it was removed again). A copy that merely lacks it lost it
 *   (a released device without any carrier, a device that never knew it, a
 *   list trimmed past MAX_CLEARS), and it is kept, oldest, so trimming
 *   drops it first again.
 * - A record and its own lift both left (two devices at once, or carriers a
 *   released device made disagree): the clear wins.
 */
export function mergeClears(base, local, remote) {
  if (base === undefined) return unlifted(bounded(remote));
  const inBase = new Set(base);
  const inLocal = new Set(local);
  const inRemote = new Set(remote);
  const liftsOfRemote = new Set(remote.map(liftRecord));
  const front = [];
  const added = [];
  for (const record of local) {
    if (inRemote.has(record)) continue;
    if (!inBase.has(record)) added.push(record);
    else if (!inRemote.has(liftRecord(record)) && !liftsOfRemote.has(record))
      front.push(record);
  }
  const middle = remote.filter(
    (record) => inLocal.has(record) || !inBase.has(record),
  );
  return unlifted(bounded([...front, ...middle, ...added]));
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
  return withClears(
    merged,
    mergeClears(
      base === undefined ? undefined : readClears(base),
      readClears(local),
      readClears(remote),
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
 * record (and lose a lift of theirs). One in `local` but not in `base` was
 * added here (a new sign-in, an addon installed again, a backup restored):
 * its record is lifted and its lift record written, the only thing that
 * lifts it on other devices. An item that only came from the account is in
 * `base` by then, so taking a copy is never a lift. At sign-in nothing is
 * recorded or lifted: the account's records decide, so an item cleared on
 * another device is dropped here too, while this device's own sign-in that
 * the account never saw is kept.
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
  const fresh = [...new Set(added)].filter(
    (record) => !records.has(record) && !lifted.has(record),
  );
  const lifts = [...lifted]
    .map(liftRecord)
    .filter((record) => !records.has(record));
  // A clear record lifted here, and the lift of one cleared again here.
  const dropped = new Set([...lifted, ...fresh.map(liftRecord)]);
  for (const record of dropped) records.delete(record);
  for (const record of [...fresh, ...lifts]) records.add(record);
  const out = withoutCleared(merged, records, local);
  if (
    !fresh.length &&
    !lifts.length &&
    !current.some((record) => dropped.has(record))
  )
    return out;
  return withClears(out, [
    ...current.filter((record) => !dropped.has(record)),
    ...fresh,
    ...lifts,
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
