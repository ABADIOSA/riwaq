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
 * from its own state, dropping anything it does not know. Two things in the
 * payload do survive a released client, and both were checked against the
 * real v0.55.0 code (scripts/test-accounts-mixed.mjs):
 *
 * - `live.favorites` is a list of 24-hex keys that 0.55.0 keeps, merges
 *   entry by entry and uploads again as it is. A clear record is a 24-hex
 *   fingerprint in it: SHA-256 of a fixed label, the kind and the item's
 *   identity (a Live TV source's random ID, a configured addon's address, a
 *   Stremio session key, a Discord app ID), cut to 96 bits. It matches no
 *   channel (channel keys hash other text), so to 0.55.0 it is a favourite
 *   of a channel that is gone, which it already ignores. It cannot be turned
 *   back into the value. A device on this version that sees an item whose
 *   record is listed never takes it from the account, whoever wrote it.
 * - A one-entry Live TV list holding `CLEARED_SOURCE` (not a valid source)
 *   is non-empty, so 0.55.0's restore takes the list and its own cleaner
 *   drops the entry: that device really loses its last source. Only the
 *   last source needs it; removing one of several already reached 0.55.0.
 *
 * What a released client cannot be made to do: drop its own Stremio key,
 * configured addon or Discord app ID. It keeps them, on that device, until
 * it updates or the viewer removes them there; devices on this version
 * never take them back.
 *
 * Pure and browser-safe.
 */
import { createHash } from "node:crypto";
import { isPlainAddon } from "./backup.mjs";

const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const HEX24 = /^[a-f\d]{24}$/;

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
 * - `local`: this device's payload before the merge.
 * - `merged`: merge3's result (after keepSignIn).
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
  const favorites = Array.isArray(merged.live?.favorites)
    ? merged.live.favorites
    : [];
  const records = new Set(favorites);
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
  return {
    ...out,
    live: {
      ...(isObject(out.live) ? out.live : {}),
      favorites: [...favorites.filter((key) => !lifted.has(key)), ...fresh],
    },
  };
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
