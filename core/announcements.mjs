import { compareVersions, parseVersion } from "./updates.mjs";

export const ANNOUNCEMENT_REPO = "ABADIOSA/riwaq";
export const ANNOUNCEMENT_PATH = "announcements/feed.json";
export const ANNOUNCEMENT_URL = `https://raw.githubusercontent.com/${ANNOUNCEMENT_REPO}/main/${ANNOUNCEMENT_PATH}`;
export const FEED_LIMIT = 64 * 1024;
export const POLL_INTERVAL = 15 * 60000;
const MAX_ITEMS = 80;
const ID = /^[a-zA-Z0-9_-]{8,80}$/;
const fail = () => {
  throw new Error("Invalid announcement feed");
};
const text = (value, limit, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    (required && !value.trim())
  )
    fail();
  return value.trim();
};
export function announcementLink(value) {
  if (!value) return "";
  const url = new URL(value);
  // A notice cannot turn into a download, a script or an arbitrary login page.
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(`/${ANNOUNCEMENT_REPO}/`)
  )
    fail();
  return url.href;
}
export function cleanAnnouncement(raw) {
  if (!raw || typeof raw.id !== "string" || !ID.test(raw.id)) fail();
  const at = raw.at,
    expires = raw.expires;
  if (
    !Number.isSafeInteger(at) ||
    at < 0 ||
    !Number.isSafeInteger(expires) ||
    expires <= at ||
    expires - at > 90 * 86400000
  )
    fail();
  if (!["all", "desktop", "web"].includes(raw.platform)) fail();
  if (raw.minVersion && !parseVersion(raw.minVersion)) fail();
  if (raw.maxVersion && !parseVersion(raw.maxVersion)) fail();
  if (
    raw.minVersion &&
    raw.maxVersion &&
    compareVersions(raw.minVersion, raw.maxVersion) > 0
  )
    fail();
  const message = (m) => ({
    title: text(m?.title, 160, true),
    body: text(m?.body, 3000, true),
  });
  return {
    id: raw.id,
    at,
    expires,
    platform: raw.platform,
    minVersion: raw.minVersion || "",
    maxVersion: raw.maxVersion || "",
    ar: message(raw.ar),
    ...(raw.en ? { en: message(raw.en) } : {}),
    link: announcementLink(raw.link),
  };
}
export function cleanFeed(raw) {
  if (
    raw?.schema !== 1 ||
    !Array.isArray(raw.items) ||
    raw.items.length > MAX_ITEMS ||
    new TextEncoder().encode(JSON.stringify(raw)).length > FEED_LIMIT
  )
    fail();
  const items = raw.items.map(cleanAnnouncement);
  if (new Set(items.map((n) => n.id)).size !== items.length) fail();
  return { schema: 1, items: items.sort((a, b) => b.at - a.at) };
}
export function audience(item, { now = Date.now(), version, platform }) {
  return (
    item.at <= now &&
    item.expires > now &&
    (item.platform === "all" || item.platform === platform) &&
    (!item.minVersion ||
      (parseVersion(version) &&
        compareVersions(version, item.minVersion) >= 0)) &&
    (!item.maxVersion ||
      (parseVersion(version) && compareVersions(version, item.maxVersion) <= 0))
  );
}
/** Bounded, redirect-free JSON. No credentials or viewer data in this request. */
export async function boundedJson(url, options = {}, limit = FEED_LIMIT) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("Response too large");
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
/** Device-local inbox: never part of the account backup or profile settings. */
export class Announcements {
  constructor(
    client,
    { request = boundedJson, platform = "desktop", now = Date.now } = {},
  ) {
    this.client = client;
    this.request = request;
    this.platform = platform;
    this.now = now;
    this.pending = null;
    this.epoch = 0;
    this.error = false;
    this.attempt = null;
    const old = client.state.announcements;
    let feed;
    try {
      feed = cleanFeed(old?.feed);
    } catch {
      feed = { schema: 1, items: [] };
    }
    const ids = new Set(feed.items.map((n) => n.id));
    client.state.announcements = {
      enabled: old?.enabled !== false,
      feed,
      read: (Array.isArray(old?.read) ? old.read : []).filter((id) =>
        ids.has(id),
      ),
      checked: Number.isSafeInteger(old?.checked) ? old.checked : null,
    };
  }
  get bag() {
    return this.client.state.announcements;
  }
  save() {
    this.client.profiles?.capture();
    this.client.saveData(this.client.state);
  }
  publicState() {
    const items = this.bag.feed.items
      .filter((n) =>
        audience(n, {
          now: this.now(),
          version: this.client.version,
          platform: this.platform,
        }),
      )
      .map((n) => ({ ...n, read: this.bag.read.includes(n.id) }));
    return {
      enabled: this.bag.enabled,
      items,
      unread: items.filter((n) => !n.read).length,
      checked: this.bag.checked,
      error: this.error,
      busy: !!this.pending,
    };
  }
  async refresh() {
    if (!this.bag.enabled) return this.publicState();
    if (this.pending) {
      await this.pending;
      return this.publicState();
    }
    if (this.attempt !== null && this.now() - this.attempt < 60000)
      return this.publicState();
    this.attempt = this.now();
    const epoch = this.epoch;
    this.pending = (async () => {
      try {
        const feed = cleanFeed(await this.request(ANNOUNCEMENT_URL));
        if (epoch !== this.epoch || !this.bag.enabled) return;
        this.bag.feed = feed;
        const ids = new Set(feed.items.map((n) => n.id));
        this.bag.read = this.bag.read.filter((id) => ids.has(id));
        this.bag.checked = this.now();
        this.error = false;
        this.save();
      } catch {
        if (epoch === this.epoch) this.error = true;
      }
    })();
    await this.pending;
    this.pending = null;
    return this.publicState();
  }
  edit({ action, id, enabled } = {}) {
    if (action === "enabled" && typeof enabled === "boolean") {
      this.bag.enabled = enabled;
      this.epoch++;
    } else if (action === "read") {
      const ids = this.publicState()
        .items.filter((n) => !id || n.id === id)
        .map((n) => n.id);
      this.bag.read = [...new Set([...this.bag.read, ...ids])];
    } else throw new Error("Invalid inbox action");
    this.save();
    return this.publicState();
  }
}
