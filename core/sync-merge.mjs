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
