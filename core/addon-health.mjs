/**
 * Addon health: which installed addons still answer, which are gone for
 * good, which are only down for now, which need the local Stremio Service,
 * and which are installed twice. Shown on the Addons page and in the full
 * diagnostic. Addons are named by their opaque key and name only; their
 * addresses (which can carry tokens) never leave main. Browser-safe.
 */
import { keyFor } from "./protocol.mjs";

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

/** A reachability probe: any HTTP answer means the service is reachable. */
export async function probeUrl(
  fetcher,
  url,
  { timeout = 8000, headers = {} } = {},
) {
  const started = Date.now();
  const response = await fetcher(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
    headers,
  });
  await response.body?.cancel?.().catch(() => {});
  return {
    status: response.status,
    ms: Date.now() - started,
    headers: response.headers,
  };
}

/** Pool of at most `size` promises at a time. */
export async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Every addon's manifest, probed at most six at a time: its health by key and
 * name only. Used by the Addons page and the report, on the desktop and on
 * the web.
 */
export async function probeAddons(
  addons,
  { fetcher = fetch, version = "" } = {},
) {
  const headers = { "User-Agent": `Riwaq/${version} (health)` };
  // Stored addons carry no key: they are named by keyFor(transportUrl), as
  // publicState gives them to the interface and removeAddons matches them.
  const list = (addons || []).map((a) => ({
    ...a,
    key: a.key || keyFor(a.transportUrl),
  }));
  const results = await pool(list, 6, async (a) => {
    let status, ms;
    try {
      const r = await probeUrl(fetcher, a.transportUrl, {
        timeout: 8000,
        headers,
      });
      status = r.status;
      ms = r.ms;
    } catch (error) {
      status = error?.name === "TimeoutError" ? "timeout" : "error";
    }
    return {
      key: a.key,
      name: a.manifest?.name || a.manifest?.id || "?",
      enabled: a.enabled !== false,
      ...classifyHealth({ status, ms, local: isLocalAddon(a.transportUrl) }),
    };
  });
  return { results, duplicates: duplicateAddons(list) };
}
