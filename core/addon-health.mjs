/**
 * Addon health: which installed addons still answer, which are gone for
 * good, which are only down for now, which need the local Stremio Service,
 * and which are installed twice. Shown on the Addons page and in the full
 * diagnostic. Addons are named by their opaque key and name only; their
 * addresses (which can carry tokens) never leave main. Browser-safe.
 */

export const SLOW_MS = 3000;

export const HEALTH_LABELS = {
  ok: "تعمل",
  slow: "بطيئة",
  gone: "توقفت نهائياً",
  down: "لا تستجيب الآن",
  "needs-server": "تحتاج Stremio Service",
};

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/i;

/** Whether an addon is served by this machine (the local Stremio Service). */
export function isLocalAddon(transportUrl) {
  try {
    return LOOPBACK.test(new URL(transportUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * One addon's state from its manifest probe: `status` is the HTTP status,
 * "timeout" or "error"; `ms` the answer time.
 */
export function classifyHealth({ status, ms = 0, local = false }) {
  if (status === 200)
    return { state: ms > SLOW_MS ? "slow" : "ok", status, ms };
  if (local && (status === "error" || status === "timeout"))
    return { state: "needs-server", status, ms };
  if (status === 404 || status === 410) return { state: "gone", status, ms };
  return { state: "down", status, ms };
}

/** Addons installed more than once: by manifest ID, then by name. */
export function duplicateAddons(addons = []) {
  const seen = new Map();
  const dupes = [];
  for (const a of addons) {
    const id = a?.manifest?.id || a?.id || "";
    const name = (a?.manifest?.name || a?.name || "").trim().toLowerCase();
    const sig = id ? `id:${id}` : name ? `name:${name}` : "";
    if (!sig) continue;
    if (seen.has(sig)) dupes.push({ key: a.key, of: seen.get(sig) });
    else seen.set(sig, a.key);
  }
  return dupes;
}

/** Counts per state, for a one-line summary. */
export function healthSummary(results = []) {
  const counts = { ok: 0, slow: 0, gone: 0, down: 0, "needs-server": 0 };
  for (const r of results) if (r.state in counts) counts[r.state]++;
  return counts;
}
