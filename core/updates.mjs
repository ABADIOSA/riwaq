/**
 * Release update checks.
 *
 * Riwaq checks, it never downloads or installs: the binaries are unsigned, and
 * replacing an executable behind the viewer's back is exactly what an unsigned
 * app must not do. The check is one anonymous GET to GitHub's public API that
 * carries no viewer data, at most once a day, and the viewer can turn it off.
 *
 * Every Riwaq release so far is a prerelease, and GitHub's /releases/latest
 * skips prereleases, so the list endpoint is read and versions are compared
 * here.
 */

export const REPO = "ABADIOSA/riwaq";
const DAY = 86400000;
const RELEASES = `https://api.github.com/repos/${REPO}/releases?per_page=20`;

/** Parses "v1.2.3" or "1.2.3-beta.4". Anything else is not a Riwaq release. */
export function parseVersion(value) {
  const match = String(value || "")
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split(".") : [],
  };
}

/** Semver precedence: -1, 0 or 1. A release outranks its own prereleases. */
export function compareVersions(a, b) {
  const left = typeof a === "string" ? parseVersion(a) : a;
  const right = typeof b === "string" ? parseVersion(b) : b;
  if (!left || !right) return 0;
  for (const key of ["major", "minor", "patch"])
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  if (!left.pre.length || !right.pre.length)
    return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (
    let index = 0;
    index < Math.max(left.pre.length, right.pre.length);
    index++
  ) {
    const x = left.pre[index];
    const y = right.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny && Number(x) !== Number(y))
      return Number(x) > Number(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/**
 * Only a release page of this repository may be opened. A response that
 * points anywhere else is ignored rather than trusted.
 */
export function releaseUrlOk(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.host === "github.com" &&
      url.pathname.toLowerCase().startsWith(`/${REPO.toLowerCase()}/releases/`)
    );
  } catch {
    return false;
  }
}

export function pickLatest(releases) {
  let best = null;
  for (const release of Array.isArray(releases) ? releases : []) {
    if (!release || release.draft) continue;
    const version = parseVersion(release.tag_name);
    if (!version || !releaseUrlOk(release.html_url)) continue;
    if (!best || compareVersions(version, best.parsed) > 0)
      best = {
        parsed: version,
        version: String(release.tag_name).replace(/^v/, ""),
        name: String(release.name || release.tag_name).slice(0, 120),
        url: release.html_url,
        prerelease: !!release.prerelease,
        publishedAt: release.published_at || null,
      };
  }
  if (!best) return null;
  const { parsed, ...latest } = best;
  return latest;
}

export class Updates {
  constructor(client) {
    this.client = client;
    this.checking = null;
  }
  get store() {
    const state = this.client.state;
    state.updates ||= { enabled: true };
    return state.updates;
  }
  publicState(current = "") {
    const store = this.store;
    const latest = store.latest || null;
    return {
      enabled: store.enabled !== false,
      current,
      latest: latest && {
        version: latest.version,
        name: latest.name,
        prerelease: latest.prerelease,
        publishedAt: latest.publishedAt,
      },
      available:
        !!latest && !!current && compareVersions(latest.version, current) > 0,
      checkedAt: store.checkedAt || null,
      failed: !!store.failed,
    };
  }
  setEnabled(enabled) {
    this.store.enabled = enabled === true;
    this.client.persist();
    return this.client.publicState();
  }
  /** Checks at most once a day unless forced. Never throws: a check is a nicety. */
  async check({ current, force = false, now = Date.now() } = {}) {
    const store = this.store;
    if (!force && store.enabled === false) return this.publicState(current);
    if (!force && store.checkedAt && now - store.checkedAt < DAY)
      return this.publicState(current);
    if (this.checking) return this.checking;
    this.checking = (async () => {
      try {
        const releases = await this.client.request(RELEASES, {
          headers: { Accept: "application/vnd.github+json" },
        });
        store.latest = pickLatest(releases);
        store.failed = false;
      } catch {
        store.failed = true;
      }
      store.checkedAt = now;
      this.client.persist();
      return this.publicState(current);
    })().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }
  /** The page main may open: validated again at use, never taken from React. */
  releaseUrl() {
    const url = this.store.latest?.url;
    return releaseUrlOk(url) ? url : `https://github.com/${REPO}/releases`;
  }
}
