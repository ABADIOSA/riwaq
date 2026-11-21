/**
 * Live TV source management.
 *
 * Playlist and Xtream URLs carry the viewer's subscription credentials in the
 * path, so nothing here returns a playable URL to the interface. The renderer
 * sees channels by opaque key and asks main to resolve one only at play time,
 * the same contract addon streams already use.
 */

import { keyFor, webUrl } from "./protocol.mjs";
import {
  parseM3U,
  parseXmltv,
  indexProgrammes,
  nowNext,
  buildGuide,
  buildCatchupUrl,
  detectCatchup,
  groupChannels,
  searchChannels,
  xtreamChannels,
  xtreamEndpoints,
} from "./livetv.mjs";

/** Live TV favourites a viewer can keep (the restore limit, every release). */
export const LIVE_FAVORITES_MAX = 5000;

const MAX_SOURCES = 12;
const PAGE = 120;

export class LiveHub {
  constructor(client) {
    this.client = client;
    this.loaded = new Map();
    this.loading = new Map();
  }
  get store() {
    const state = this.client.state;
    state.live ||= { sources: [], favorites: [] };
    state.live.sources ||= [];
    state.live.favorites ||= [];
    return state.live;
  }
  publicState() {
    return {
      sources: this.store.sources.map((source) => {
        const loaded = this.loaded.get(source.id);
        return {
          id: source.id,
          kind: source.kind,
          name: source.name,
          // The URL itself is a credential for most providers.
          host: hostOf(source),
          enabled: source.enabled !== false,
          hasGuide: !!(source.epgUrl || source.kind === "xtream"),
          channels: loaded?.channels.length || 0,
          programmes: loaded?.programmes || 0,
          refreshedAt: source.refreshedAt || null,
          error: loaded?.error || "",
        };
      }),
      favorites: this.store.favorites.length,
      groups: this.allChannels().length
        ? groupChannels(this.allChannels())
        : [],
    };
  }
  /** Every enabled channel paired with the guide index of its own source. */
  entries() {
    const rows = [];
    for (const source of this.store.sources) {
      if (source.enabled === false) continue;
      const loaded = this.loaded.get(source.id);
      if (!loaded) continue;
      for (const channel of loaded.channels)
        rows.push({ channel, index: loaded.index });
    }
    return rows;
  }
  allChannels() {
    return this.entries().map((entry) => entry.channel);
  }
  source(id) {
    const source = this.store.sources.find((entry) => entry.id === id);
    if (!source) throw new Error("مصدر القنوات غير موجود");
    return source;
  }
  async addSource({ kind, name, url, host, username, password, epgUrl }) {
    if (!["m3u", "xtream"].includes(kind))
      throw new Error("نوع المصدر غير مدعوم");
    if (this.store.sources.length >= MAX_SOURCES)
      throw new Error("وصلت إلى الحد الأقصى من مصادر القنوات");
    if (typeof name !== "string" || !name.trim() || name.length > 80)
      throw new Error("أدخل اسماً للمصدر");
    const source = {
      id: keyFor(`${kind}|${url || host}|${username || ""}|${Date.now()}`),
      kind,
      name: name.trim(),
      enabled: true,
      addedAt: Date.now(),
    };
    if (kind === "m3u") {
      source.url = webUrl(url).toString();
      if (epgUrl) source.epgUrl = webUrl(epgUrl).toString();
    } else {
      for (const value of [username, password])
        if (
          typeof value !== "string" ||
          !value ||
          value.length > 256 ||
          /[\r\n]/.test(value)
        )
          throw new Error("بيانات اشتراك Xtream غير صالحة");
      source.host = webUrl(host).toString().replace(/\/$/, "");
      source.username = username;
      source.password = password;
    }
    // A commit (sixth pass, V2): a refused write takes the source out
    // again, before anything reads it, and the add is reported as failed.
    await this.client.transact(() => {
      this.store.sources.push(source);
      return () => {
        this.store.sources = this.store.sources.filter(
          (entry) => entry.id !== source.id,
        );
        this.loaded.delete(source.id);
      };
    });
    await this.refresh(source.id);
    return this.client.publicState();
  }
  updateSource({ id, action }) {
    const source = this.source(id);
    if (!["toggle", "remove"].includes(action))
      throw new Error("إجراء غير معروف");
    // Each a commit with its own undo (sixth pass, V2): a refused toggle
    // or removal is put back, never written by a later save, a backup or
    // account sync.
    this.client.transact(() => {
      if (action === "toggle") {
        const had = Object.hasOwn(source, "enabled");
        const was = source.enabled;
        const now = source.enabled === false;
        source.enabled = now;
        return () => {
          const entry = this.store.sources.find((e) => e.id === id);
          if (!entry || entry.enabled !== now) return;
          if (had) entry.enabled = was;
          else delete entry.enabled;
        };
      }
      const index = this.store.sources.findIndex((entry) => entry.id === id);
      const loaded = this.loaded.get(id);
      this.store.sources = this.store.sources.filter(
        (entry) => entry.id !== id,
      );
      this.loaded.delete(id);
      return () => {
        const sources = this.store.sources;
        if (sources.some((entry) => entry.id === id)) return;
        sources.splice(Math.min(index, sources.length), 0, source);
        if (loaded && !this.loaded.has(id)) this.loaded.set(id, loaded);
      };
    });
    return this.client.publicState();
  }
  async refresh(id) {
    if (this.loading.has(id)) return this.loading.get(id);
    const source = this.source(id);
    const job = (async () => {
      try {
        const { channels, programmes } = await this.fetchSource(source);
        this.loaded.set(id, {
          channels,
          index: indexProgrammes(programmes),
          programmes: programmes.length,
          error: "",
        });
        source.refreshedAt = Date.now();
        this.client.persist();
      } catch (error) {
        this.loaded.set(id, {
          channels: this.loaded.get(id)?.channels || [],
          index: this.loaded.get(id)?.index || new Map(),
          programmes: 0,
          error: error.message,
        });
        throw error;
      } finally {
        this.loading.delete(id);
      }
    })();
    this.loading.set(id, job);
    return job;
  }
  async fetchSource(source) {
    const language = String(
      this.client.state.settings.metadataLanguage || "ar",
    ).slice(0, 2);
    if (source.kind === "m3u") {
      const playlist = parseM3U(await this.client.requestText(source.url));
      const guideUrl = source.epgUrl || playlist.epgUrl;
      let programmes = [];
      if (guideUrl) {
        try {
          programmes = parseXmltv(
            await this.client.requestText(webUrl(guideUrl).toString()),
            {
              language,
            },
          ).programmes;
        } catch {
          // A guide is an enhancement. Channels must still arrive without one.
        }
      }
      return { channels: playlist.channels, programmes };
    }
    const endpoints = xtreamEndpoints(source);
    const [streams, categories] = await Promise.all([
      this.client.request(endpoints.api("get_live_streams")),
      this.client.request(endpoints.api("get_live_categories")).catch(() => []),
    ]);
    const channels = xtreamChannels(streams, categories, source);
    if (!channels.length)
      throw new Error("لم يرجع المزوّد أي قناة. تحقق من بيانات الاشتراك.");
    let programmes = [];
    try {
      programmes = parseXmltv(await this.client.requestText(endpoints.epg), {
        language,
      }).programmes;
    } catch {
      // Xtream guides are frequently large or absent; channels come first.
    }
    return { channels, programmes };
  }
  async ensureLoaded() {
    await Promise.allSettled(
      this.store.sources
        .filter(
          (source) => source.enabled !== false && !this.loaded.has(source.id),
        )
        .map((source) => this.refresh(source.id)),
    );
  }
  indexFor(key) {
    for (const source of this.store.sources) {
      if (source.enabled === false) continue;
      const loaded = this.loaded.get(source.id);
      if (loaded?.channels.some((channel) => channel.key === key))
        return {
          source,
          loaded,
          channel: loaded.channels.find((c) => c.key === key),
        };
    }
    return null;
  }
  async list({
    group = "",
    search = "",
    favoritesOnly = false,
    skip = 0,
    limit = PAGE,
  } = {}) {
    await this.ensureLoaded();
    const favorites = new Set(this.store.favorites);
    const all = this.entries();
    let rows = all;
    if (group) rows = rows.filter((entry) => entry.channel.group === group);
    if (favoritesOnly)
      rows = rows.filter((entry) => favorites.has(entry.channel.key));
    if (search) {
      const matched = new Set(
        searchChannels(
          rows.map((entry) => entry.channel),
          search,
        ),
      );
      rows = rows.filter((entry) => matched.has(entry.channel));
    }
    const total = rows.length;
    const page = rows.slice(
      Math.max(0, skip),
      Math.max(0, skip) + Math.min(limit, PAGE),
    );
    const at = Date.now();
    return {
      total,
      groups: groupChannels(all.map((entry) => entry.channel)),
      channels: page.map(({ channel, index }) => {
        const { now, next } = nowNext(index, channel.tvgId, at);
        return {
          key: channel.key,
          name: channel.name,
          logo: channel.logo,
          group: channel.group,
          favorite: favorites.has(channel.key),
          catchup: !!detectCatchup(channel),
          now: now && {
            title: now.title,
            start: now.start,
            stop: now.stop,
            progress: Math.min(
              1,
              Math.max(0, (at - now.start) / Math.max(1, now.stop - now.start)),
            ),
          },
          next: next && { title: next.title, start: next.start },
        };
      }),
    };
  }
  async guide({
    group = "",
    search = "",
    start = Date.now(),
    hours = 4,
    limit = 30,
  } = {}) {
    await this.ensureLoaded();
    const listing = await this.list({
      group,
      search,
      limit: Math.min(limit, 60),
    });
    const keys = new Set(listing.channels.map((channel) => channel.key));
    const rows = [];
    for (const source of this.store.sources) {
      const loaded = this.loaded.get(source.id);
      if (!loaded) continue;
      const selected = loaded.channels.filter((channel) =>
        keys.has(channel.key),
      );
      if (selected.length)
        rows.push(...buildGuide(selected, loaded.index, { start, hours }));
    }
    return { start, hours, rows, groups: listing.groups, total: listing.total };
  }
  favorite(key) {
    // Every Riwaq keeps at most LIVE_FAVORITES_MAX (a restore and every
    // released client cut the list there, core/backup.mjs restoreState):
    // a favourite past it would be dropped silently at the next sync or
    // restore, so it is refused here, where the viewer sees why.
    const at = this.store.favorites.indexOf(key);
    if (at < 0 && this.store.favorites.length >= LIVE_FAVORITES_MAX)
      throw new Error(
        `بلغت القنوات المفضلة حدها (${LIVE_FAVORITES_MAX})؛ أزل قناة لتضيف أخرى`,
      );
    // A commit (sixth pass, V2): Codex saw a refused favorite stay in
    // memory, reach a backup and, through account sync, another device.
    this.client.transact(() => {
      const favorites = this.store.favorites;
      const index = favorites.indexOf(key);
      const adding = index < 0;
      if (adding) favorites.push(key);
      else favorites.splice(index, 1);
      return () => {
        const now = this.store.favorites;
        const at = now.indexOf(key);
        if (adding) {
          if (at >= 0) now.splice(at, 1);
        } else if (at < 0) now.splice(Math.min(index, now.length), 0, key);
      };
    });
    return this.client.publicState();
  }
  /** Main-process only: turns an opaque key into a playable URL and headers. */
  resolve(key, { start = 0, stop = 0 } = {}) {
    const found = this.indexFor(key);
    if (!found) throw new Error("القناة غير متاحة. حدّث مصدر القنوات.");
    const { channel } = found;
    const url =
      start && stop ? buildCatchupUrl(channel, start, stop) : channel.url;
    if (!url) throw new Error("هذه القناة لا تدعم إعادة المشاهدة");
    const headers = {};
    if (channel.userAgent) headers["User-Agent"] = channel.userAgent;
    if (channel.referrer) headers.Referer = channel.referrer;
    return {
      url,
      headers,
      name: channel.name,
      live: !start,
      logo: channel.logo,
    };
  }
}

function hostOf(source) {
  try {
    return new URL(source.kind === "m3u" ? source.url : source.host).host;
  } catch {
    return "";
  }
}
