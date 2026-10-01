/**
 * Release update checks.
 *
 * Shared release/version metadata. DesktopUpdates extends this class with a
 * signed-package download and NSIS installation coordinator in Electron main.
 * This base class remains useful to headless clients and never executes files.
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
      !url.username &&
      !url.password &&
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

/**
 * The releases feed on github.com itself, read when the API refuses: the
 * API's anonymous limit (60 an hour per address) is shared by everyone
 * behind a carrier's NAT, while the website feed is not counted against it.
 */
export const RELEASES_FEED = `https://github.com/${REPO}/releases.atom`;
export const FEED_MAX = 2_000_000;

const xmlText = (value) =>
  String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/**
 * Releases from the Atom feed, shaped like the API's list so `pickLatest`
 * reads them. The feed has no prerelease flag, so a version is taken as a
 * prerelease only when it says so ("-beta"); the signed manifest's channel
 * still decides what a stable copy may install.
 */
export function parseReleaseFeed(xml) {
  if (typeof xml !== "string" || xml.length > FEED_MAX) return [];
  const out = [];
  for (const entry of xml.split(/<entry[\s>]/).slice(1)) {
    const body = entry.split("</entry>")[0];
    const href =
      body.match(
        /<link[^>]*href="(https:\/\/github\.com\/[^"]+\/releases\/tag\/[^"]+)"/,
      )?.[1] || "";
    const tag =
      decodeURIComponent(href.split("/releases/tag/")[1] || "") ||
      xmlText(body.match(/<id>([^<]*)<\/id>/)?.[1])
        .split("/")
        .pop();
    const version = parseVersion(tag);
    if (!version) continue;
    const url = `https://github.com/${REPO}/releases/tag/${encodeURIComponent(tag)}`;
    out.push({
      tag_name: tag,
      html_url: url,
      name: xmlText(body.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]) || tag,
      prerelease: version.pre.length > 0,
      draft: false,
      published_at:
        xmlText(body.match(/<updated>([^<]*)<\/updated>/)?.[1]) || null,
    });
  }
  return out;
}

/**
 * What went wrong with an update check, in words a viewer can act on, plus
 * a short technical note (status codes only, never addresses or keys).
 */
export function describeUpdateError(error, where = "GitHub") {
  const message = String(error?.message || "");
  const status =
    Number(error?.status) || Number(message.match(/HTTP (\d{3})/)?.[1]) || 0;
  if (status === 403 || status === 429)
    return {
      message:
        "GitHub حدّ مؤقتاً عدد الطلبات من شبكتك (الحد 60 طلباً في الساعة لكل عنوان، وقد تتشاركه شبكة الجوال مع غيرك). نعيد المحاولة تلقائياً بعد قليل.",
      code: `${where} · HTTP ${status}`,
    };
  if (status === 404)
    return {
      message: "لم نجد ملف التحديث في صفحة الإصدار.",
      code: `${where} · HTTP 404`,
    };
  if (status >= 500)
    return {
      message: "خوادم GitHub لا تستجيب الآن. نعيد المحاولة تلقائياً بعد قليل.",
      code: `${where} · HTTP ${status}`,
    };
  if (error?.name === "TimeoutError" || /timeout|timed out|مهلة/i.test(message))
    return {
      message: "انتهت مهلة الاتصال بـ GitHub. تحقق من الاتصال وحاول مجدداً.",
      code: `${where} · مهلة`,
    };
  if (
    /تعذّر الاتصال|fetch failed|ENOTFOUND|ECONNRESET|EAI_AGAIN|network/i.test(
      message,
    )
  )
    return {
      message:
        "تعذّر الوصول إلى GitHub. تحقق من اتصالك بالإنترنت وحاول مجدداً.",
      code: `${where} · لا اتصال`,
    };
  if (/[\u0600-\u06ff]/.test(message) && !/https?:|\\\\/.test(message))
    return { message, code: "" };
  return {
    message:
      "تعذّر إكمال التحديث؛ تحقق من الاتصال والمساحة المتاحة ثم حاول مجدداً",
    code: "",
  };
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
        // GitHub asks API clients to name themselves. The version is the only
        // thing sent, and GitHub sees the request either way.
        const releases = await this.client.request(RELEASES, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `Riwaq/${String(current || "").replace(/[^\w.-]/g, "") || "dev"}`,
          },
        });
        store.latest = pickLatest(releases);
        store.failed = false;
      } catch {
        // Unauthenticated GitHub API calls share a 60-per-hour limit per IP,
        // which carrier-grade NAT can exhaust for a whole neighbourhood. A
        // failed check waits for the next day rather than retrying.
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
    // After a failed check the stored release may be stale: open the list.
    const url = this.store.failed ? "" : this.store.latest?.url;
    return releaseUrlOk(url) ? url : `https://github.com/${REPO}/releases`;
  }
}
