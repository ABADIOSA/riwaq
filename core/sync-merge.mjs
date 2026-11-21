/**
 * Merging a Riwaq account's data when two devices changed it (core/account.mjs).
 *
 * The data is the backup payload (core/backup.mjs collectBackup). A device
 * keeps the payload it last agreed with the server (`base`); when both it
 * and the server moved on, the three versions are merged:
 *
 * - A value only one side changed takes that side's change.
 * - Lists whose entries have an identity (addons by address, queue entries
 *   by key, titles by type and ID, profiles and collections by ID, plain
 *   strings by value) merge entry by entry: additions from both sides are
 *   kept, and an entry one side removed stays removed.
 * - A watch-progress record (one with a numeric `updated`) is never mixed
 *   field by field: the newer record wins as a whole.
 * - Anything else changed on both sides takes the preferred side: this
 *   device during normal syncing, the account when signing in.
 *
 * Pure and browser-safe.
 */

const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Structural equality for JSON data (key order ignored). */
export function same(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => same(value, b[index]));
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
  }
  return false;
}

/** The identity of a list entry, or null when entries have none. */
export function identity(entry) {
  if (typeof entry === "string" || typeof entry === "number")
    return `v:${entry}`;
  if (!isObject(entry)) return null;
  if (typeof entry.transportUrl === "string") return `a:${entry.transportUrl}`;
  if (typeof entry.key === "string") return `k:${entry.key}`;
  if (typeof entry.id === "string" || typeof entry.id === "number")
    return `i:${entry.type || ""}:${entry.id}`;
  return null;
}

const isRecord = (value) =>
  isObject(value) && Number.isFinite(Number(value.updated));

function mergeLists(base, local, remote, prefer) {
  const all = [...(base || []), ...local, ...remote];
  if (!all.length || all.some((entry) => identity(entry) === null))
    return prefer === "remote" ? remote : local;
  const index = (list) => new Map(list.map((e) => [identity(e), e]));
  const b = index(base || []);
  const l = index(local);
  const r = index(remote);
  const out = [];
  const seen = new Set();
  const take = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const inBase = b.has(id);
    const inLocal = l.has(id);
    const inRemote = r.has(id);
    // Removed on one side and untouched on the other: stays removed.
    if (inBase && !inLocal && (!inRemote || same(b.get(id), r.get(id)))) return;
    if (inBase && !inRemote && (!inLocal || same(b.get(id), l.get(id)))) return;
    if (inLocal && inRemote)
      out.push(merge3(b.get(id), l.get(id), r.get(id), { prefer }));
    else out.push(inLocal ? l.get(id) : r.get(id));
  };
  // The preferred side's order, then the other side's additions.
  const [first, second] =
    prefer === "remote" ? [remote, local] : [local, remote];
  for (const entry of first) take(identity(entry));
  for (const entry of second) take(identity(entry));
  return out;
}

/**
 * Merges `local` and `remote`, both descended from `base` (undefined when
 * there is no common ancestor, as at sign-in). `prefer` decides real
 * conflicts: "local" (default) or "remote".
 */
export function merge3(base, local, remote, { prefer = "local" } = {}) {
  if (same(local, remote)) return local;
  if (base !== undefined && same(base, local)) return remote;
  if (base !== undefined && same(base, remote)) return local;
  if (isRecord(local) && isRecord(remote))
    return Number(remote.updated) > Number(local.updated) ? remote : local;
  if (Array.isArray(local) && Array.isArray(remote))
    return mergeLists(Array.isArray(base) ? base : [], local, remote, prefer);
  if (isObject(local) && isObject(remote)) {
    const b = isObject(base) ? base : {};
    const out = {};
    const keys = [...new Set([...Object.keys(local), ...Object.keys(remote)])];
    for (const key of keys) {
      const inLocal = Object.hasOwn(local, key);
      const inRemote = Object.hasOwn(remote, key);
      const inBase = Object.hasOwn(b, key);
      if (inLocal && inRemote)
        out[key] = merge3(
          inBase ? b[key] : undefined,
          local[key],
          remote[key],
          {
            prefer,
          },
        );
      else if (inLocal) {
        // The other side deleted it, unless this side changed it since.
        if (!inBase || !same(b[key], local[key])) out[key] = local[key];
      } else if (!inBase || !same(b[key], remote[key])) out[key] = remote[key];
    }
    return out;
  }
  return prefer === "remote" ? remote : local;
}

/**
 * Seventh pass, W4: a payload that carries secrets now clears the Stremio
 * sign-in when its `auth` is null (core/backup.mjs restoreState). With no
 * common ancestor (signing in), merge3 lets the account's side win a
 * conflict, which would sign this device out of its own Stremio session
 * just for joining an account that has none. There the sign-in this device
 * has is kept (and goes up with the rest of its secrets); after the first
 * sync, a null that the account's side changed to is a real sign-out.
 * A sign-in the account's clear records name is still dropped afterwards
 * (core/sync-clears.mjs settleClears): the device held the very session
 * that was signed out elsewhere.
 */
export function keepSignIn(base, local, remote, merged) {
  if (base !== undefined || !isObject(merged) || !isObject(remote))
    return merged;
  let out = merged;
  if (
    Object.hasOwn(merged, "auth") &&
    merged.auth === null &&
    isObject(local?.auth) &&
    remote.auth == null
  )
    out = { ...out, auth: local.auth };
  // Release blocker W4: the same for the Discord app ID, which an empty
  // value clears since the seventh pass. Joining an account that has none
  // keeps this device's own.
  if (
    merged.discordAppId === "" &&
    /^\d{17,20}$/.test(local?.discordAppId || "") &&
    !remote.discordAppId
  )
    out = { ...out, discordAppId: local.discordAppId };
  return out;
}

/**
 * Release blocker W4 (mixed versions): a released app drops the profile
 * settings it does not know (0.55.0 has no `badgeLook`, `sourceFacets`,
 * `collectionsLayout`, `tasteCompass`… and its cleaner leaves them out).
 * Read by merge3, a key the account's copy lacks was deleted, so every
 * sync from a released device reset those settings here to their defaults,
 * and this device's next upload put them back: the two uploaded in turn
 * for as long as both ran. Riwaq never deletes a settings key (safeSettings
 * writes them all), so a missing one only means the writer did not know
 * it: `target` takes `from`'s value for every settings key, at any depth
 * of plain objects, it lacks. Profiles `target` does not have are left out.
 */
export function withKnownSettings(target, from) {
  const data = target?.profiles?.data;
  const own = from?.profiles?.data;
  if (!isObject(data) || !isObject(own)) return target;
  let changed = false;
  const fill = (into, source) => {
    if (!isObject(into) || !isObject(source)) return into;
    let out = into;
    for (const [key, value] of Object.entries(source)) {
      if (!Object.hasOwn(into, key)) {
        if (out === into) out = { ...into };
        out[key] = value;
      } else if (isObject(into[key]) && isObject(value)) {
        const deeper = fill(into[key], value);
        if (deeper !== into[key]) {
          if (out === into) out = { ...into };
          out[key] = deeper;
        }
      }
    }
    return out;
  };
  const nextData = { ...data };
  for (const [id, bucket] of Object.entries(data)) {
    const settings = own[id]?.settings;
    if (!isObject(bucket) || !isObject(bucket.settings) || !isObject(settings))
      continue;
    const filled = fill(bucket.settings, settings);
    if (filled === bucket.settings) continue;
    nextData[id] = { ...bucket, settings: filled };
    changed = true;
  }
  if (!changed) return target;
  return {
    ...target,
    profiles: { ...target.profiles, data: nextData },
  };
}
