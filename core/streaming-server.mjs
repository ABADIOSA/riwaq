/**
 * The torrent streaming server (Stremio Service), which Riwaq drives for P2P
 * sources: its reachability and version, the torrent engine's profile and
 * the size of its cache. The server keeps these settings itself; Riwaq reads
 * them with GET /settings and writes the whole set back with POST /settings.
 * Pure helpers.
 */

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

/** Riwaq's three engine profiles, from gentle to fast. */
export const TORRENT_PROFILES = {
  gentle: {
    btMaxConnections: 35,
    btMinPeersForStable: 5,
    btHandshakeTimeout: 20000,
    btRequestTimeout: 4000,
    btDownloadSpeedSoftLimit: 1.6 * MIB,
    btDownloadSpeedHardLimit: 1.6 * MIB,
  },
  balanced: {
    btMaxConnections: 55,
    btMinPeersForStable: 5,
    btHandshakeTimeout: 20000,
    btRequestTimeout: 4000,
    btDownloadSpeedSoftLimit: 2.5 * MIB,
    btDownloadSpeedHardLimit: 3.5 * MIB,
  },
  fast: {
    btMaxConnections: 200,
    btMinPeersForStable: 10,
    btHandshakeTimeout: 20000,
    btRequestTimeout: 4000,
    btDownloadSpeedSoftLimit: 4 * MIB,
    btDownloadSpeedHardLimit: 37.5 * MIB,
  },
};
/** Cache sizes the viewer may pick; null is unlimited, 0 is no cache. */
export const CACHE_SIZES = [0, 2 * GIB, 5 * GIB, 10 * GIB, null];

/** The settings object a server replies with, whichever shape it uses. */
export function serverValues(body) {
  const values =
    body?.values && typeof body.values === "object" ? body.values : body;
  return values && typeof values === "object" ? values : null;
}

/** Which of Riwaq's profiles the server is on, or "custom". */
export function profileOf(values) {
  if (!values) return "custom";
  for (const [id, profile] of Object.entries(TORRENT_PROFILES))
    if (
      Object.entries(profile).every(
        ([key, value]) => Math.abs(Number(values[key]) - value) < 1,
      )
    )
      return id;
  return "custom";
}

/** What the interface shows: never paths on disk, only what can be changed. */
export function serverSummary(values) {
  if (!values) return null;
  return {
    version: String(values.serverVersion || "").slice(0, 30),
    profile: profileOf(values),
    cacheSize:
      values.cacheSize === null || values.cacheSize === undefined
        ? null
        : Number(values.cacheSize) || 0,
    editable: "cacheSize" in values && "btMaxConnections" in values,
  };
}

/** The full settings to POST back after the viewer's change. */
export function updatedValues(values, { profile, cacheSize } = {}) {
  const next = { ...values };
  if (profile && TORRENT_PROFILES[profile])
    Object.assign(next, TORRENT_PROFILES[profile]);
  if (cacheSize !== undefined) {
    if (!CACHE_SIZES.includes(cacheSize)) throw new Error("حجم غير متاح");
    next.cacheSize = cacheSize;
  }
  return next;
}
