import {
  CINEMETA,
  DEFAULT_SETTINGS,
  keyFor,
  normalizeAddon,
  validateManifest,
  accepts,
  resourceUrl,
  catalogExtras,
  mergeAddons,
  safeSettings,
  webUrl,
} from "./protocol.mjs";
import { analyzeStreams, sizeLabel } from "./stream-engine.mjs";
import { DataHub } from "./data-hub.mjs";
import { Credits } from "./credits.mjs";
import { Integrations } from "./integrations.mjs";
import { LiveHub } from "./live-hub.mjs";
import { Profiles } from "./profiles.mjs";
import { Notifier } from "./notify.mjs";
import { Updates } from "./updates.mjs";
import { cleanMedia, editQueue, isCompleted } from "./library.mjs";
import { followedSeries, upNextList, calendarEntries } from "./episodes.mjs";
import { HOTKEY_ACTIONS, publicHotkeys, validBinding } from "./hotkeys.mjs";
import {
  collectBackup,
  encryptBackup,
  decryptBackup,
  restoreState,
  summarizeBackup,
} from "./backup.mjs";

/** A readable name for an addon subtitle; never the URL. */
function subtitleLabel(s) {
  for (const value of [s.label, s.name, s.title, s.id]) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text && !/^https?:/i.test(text) && !/^\d+$/.test(text))
      return text.replace(/[_]+/g, " ").slice(0, 120);
  }
  return "";
}
function subtitleFormat(url) {
  const ext = String(url)
    .split(/[?#]/)[0]
    .match(/\.(srt|vtt|ass|ssa|sub)$/i);
  return ext ? ext[1].toUpperCase() : "";
}
export async function fetchJson(url, init = {}) {
  const { timeout = 16000, ...rest } = init;
  try {
    const response = await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 20_000_000) throw new Error("Response too large");
    return JSON.parse(text);
  } catch (error) {
    // URLs may contain addon credentials. Never include them in errors or logs.
    throw new Error(
      error.message?.startsWith("HTTP ")
        ? error.message
        : "تعذّر الاتصال بالمصدر. تحقق من الإنترنت ثم أعد المحاولة.",
    );
  }
}
/** Playlists and XMLTV guides are text, and large: fetched separately from JSON. */
export async function fetchText(url, init = {}) {
  const { timeout = 45000, ...rest } = init;
  try {
    const response = await fetch(url, {
      ...rest,
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 120_000_000) throw new Error("Response too large");
    return text;
  } catch (error) {
    throw new Error(
      error.message?.startsWith("HTTP ")
        ? error.message
        : "تعذّر تحميل الملف من المصدر. تحقق من الرابط والاتصال.",
    );
  }
}
export async function stremioCall(method, payload) {
  const response = await fetchJson(`https://api.strem.io/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.error || response.result === undefined)
    throw new Error("تعذّر إكمال الطلب من ستريميو. جرّب تسجيل الدخول مجدداً.");
  return response.result;
}
export class Client {
  constructor({
    load,
    save,
    request = fetchJson,
    requestText = fetchText,
    api = stremioCall,
    version = "",
  }) {
    this.version = version;
    this.saveData = save;
    this.request = request;
    this.requestText = requestText;
    this.api = api;
    this.state = {
      addons: [],
      favorites: [],
      progress: {},
      settings: { ...DEFAULT_SETTINGS },
      auth: null,
      lastSync: null,
      ...load(),
    };
    this.state.settings = { ...DEFAULT_SETTINGS, ...this.state.settings };
    this.streams = new Map();
    this.subtitles = new Map();
    this.subtitleInfo = new Map();
    this.subtitleLists = new Map();
    this.metas = new Map();
    this.cache = new Map();
    this.dataHub = new DataHub(this);
    this.credits = new Credits(this);
    this.integrations = new Integrations(this);
    this.live = new LiveHub(this);
    this.profiles = new Profiles(this);
    this.notifier = new Notifier(this);
    this.updates = new Updates(this);
    // The active profile owns favorites, progress, lists and settings, so the
    // client state has to point at its bucket before anything reads them.
    this.profiles.ensure();
  }
  persist() {
    this.profiles.capture();
    this.saveData(this.state);
  }
  async init() {
    if (!this.state.addons.length) {
      try {
        await this.install(CINEMETA);
      } catch {
        this.state.addons = [
          {
            transportUrl: CINEMETA,
            enabled: true,
            manifest: {
              id: "com.linvo.cinemeta",
              name: "Cinemeta",
              version: "3.0.0",
              resources: ["catalog", "meta"],
              types: ["movie", "series"],
              idPrefixes: ["tt"],
              catalogs: ["movie", "series"].flatMap((type) =>
                ["top", "year"].map((id) => ({
                  type,
                  id,
                  name: id === "top" ? "الأكثر شعبية" : "إصدارات حديثة",
                  extra: [{ name: "search" }, { name: "skip" }],
                })),
              ),
            },
          },
        ];
        this.persist();
      }
    }
    return this.publicState();
  }
  publicState() {
    const { settings, favorites, progress, lastSync, auth } = this.state;
    return {
      settings,
      favorites,
      progress,
      queue: this.state.queue || [],
      lastSync,
      providers: this.dataHub.publicState(),
      integrations: this.integrations.publicState(),
      live: this.live.publicState(),
      profiles: this.profiles.publicState(),
      notify: this.notifier.publicState(),
      hotkeys: publicHotkeys(this.state.hotkeys),
      update: this.updates.publicState(this.version),
      connectedLists: this.state.connectedLists || [],
      user: auth ? { email: auth.email, name: auth.name } : null,
      addons: this.state.addons.map((a) => ({
        key: keyFor(a.transportUrl),
        enabled: a.enabled !== false,
        name: a.manifest.name,
        version: a.manifest.version,
        description: a.manifest.description,
        logo: a.manifest.logo,
        host: new URL(a.transportUrl).host,
        resources: (a.manifest.resources || []).map((r) =>
          typeof r === "string" ? r : r.name,
        ),
        catalogs: a.manifest.catalogs?.length || 0,
        configurable: !!a.manifest.behaviorHints?.configurable,
      })),
    };
  }
  /** Hotkeys belong to the installation rather than to one profile. */
  setHotkey({ id, binding }) {
    if (!HOTKEY_ACTIONS.some((action) => action.id === id))
      throw new Error("إجراء غير معروف");
    const store = (this.state.hotkeys ||= {});
    if (binding === null || binding === "" || binding === undefined)
      delete store[id];
    else if (validBinding(binding)) store[id] = binding;
    else
      throw new Error(
        "اختصار غير صالح. استخدم مفتاحاً واحداً مع Ctrl أو Shift أو Alt.",
      );
    this.persist();
    return this.publicState();
  }
  resetHotkeys() {
    this.state.hotkeys = {};
    this.persist();
    return this.publicState();
  }
  enabled() {
    return this.state.addons.filter(
      (a) =>
        a.enabled !== false && !a.manifest.behaviorHints?.configurationRequired,
    );
  }
  addon(key) {
    const addon = this.state.addons.find((a) => keyFor(a.transportUrl) === key);
    if (!addon) throw new Error("الإضافة غير موجودة");
    return addon;
  }
  async install(input) {
    const transportUrl = normalizeAddon(input);
    const manifest = validateManifest(await this.request(transportUrl));
    if (manifest.behaviorHints?.configurationRequired)
      throw new Error(
        "أكمل إعداد الإضافة في موقعها أولاً ثم الصق رابط التثبيت المهيأ",
      );
    this.state.addons = mergeAddons(this.state.addons, [
      { transportUrl, manifest },
    ]);
    this.cache.clear();
    this.persist();
    return this.publicState();
  }
  updateAddon({ key, action }) {
    const addon = this.addon(key);
    const index = this.state.addons.indexOf(addon);
    if (action === "toggle") addon.enabled = addon.enabled === false;
    else if (action === "remove") this.state.addons.splice(index, 1);
    else if (action === "up" && index > 0)
      [this.state.addons[index - 1], this.state.addons[index]] = [
        addon,
        this.state.addons[index - 1],
      ];
    else if (action === "down" && index < this.state.addons.length - 1)
      [this.state.addons[index + 1], this.state.addons[index]] = [
        addon,
        this.state.addons[index + 1],
      ];
    this.cache.clear();
    this.persist();
    return this.publicState();
  }
  async authenticate(authKey) {
    if (
      typeof authKey !== "string" ||
      authKey.length < 8 ||
      authKey.length > 4096
    )
      throw new Error("بيانات تسجيل الدخول غير صالحة");
    const user = await this.api("getUser", { authKey });
    this.state.auth = {
      authKey,
      email: user.email || "",
      name: user.fullname || "",
    };
    this.persist();
    return this.publicState();
  }
  async sync() {
    const authKey = this.state.auth?.authKey;
    if (!authKey) throw new Error("سجّل الدخول إلى ستريميو أولاً");
    const result = await this.api("addonCollectionGet", {
      authKey,
      type: "user",
      update: false,
    });
    if (!Array.isArray(result?.addons))
      throw new Error("استجابة الإضافات غير صالحة. لم تتغير إضافاتك.");
    const compatible = [],
      skipped = [];
    for (const addon of result.addons) {
      try {
        if (
          !/^(https?:|stremio:)/i.test(addon.transportUrl) ||
          !/\/manifest\.json(?:\?|$)/i.test(addon.transportUrl)
        )
          throw new Error("unsupported");
        compatible.push({
          transportUrl: normalizeAddon(addon.transportUrl),
          manifest: validateManifest(addon.manifest),
        });
      } catch {
        skipped.push(addon.manifest?.name || "إضافة غير مدعومة");
      }
    }
    this.state.addons = mergeAddons(this.state.addons, compatible);
    let libraryWarning = false;
    try {
      const ids = await this.api("datastoreMeta", {
        authKey,
        collection: "libraryItem",
      });
      if (!Array.isArray(ids)) throw new Error("invalid library");
      for (let offset = 0; offset < ids.length; offset += 100) {
        const items = await this.api("datastoreGet", {
          authKey,
          collection: "libraryItem",
          ids: ids.slice(offset, offset + 100).map(([id]) => id),
          all: false,
        });
        if (!Array.isArray(items)) throw new Error("invalid library");
        for (const item of items) {
          if (item.removed && !item.temp) continue;
          const meta = {
            id: item._id,
            type: item.type,
            name: item.name,
            poster: item.poster,
            background: item.background,
          };
          if (
            !item.temp &&
            !item.removed &&
            !this.state.favorites.some(
              (m) => m.id === meta.id && m.type === meta.type,
            )
          )
            this.state.favorites.push(meta);
          const videoId = item.state?.video_id || item._id;
          const key = `${item.type}:${videoId}`;
          const updated = Date.parse(item._mtime) || 0;
          if (
            item.state?.timeOffset > 0 &&
            (!this.state.progress[key] ||
              this.state.progress[key].updated < updated)
          )
            this.state.progress[key] = {
              meta,
              videoId,
              position: item.state.timeOffset / 1000,
              duration: (item.state.duration || 0) / 1000,
              updated,
            };
        }
      }
    } catch {
      libraryWarning = true;
    }
    this.state.lastSync = Date.now();
    this.cache.clear();
    this.persist();
    return {
      state: this.publicState(),
      imported: compatible.length,
      skipped,
      libraryWarning,
    };
  }
  logout() {
    this.state.auth = null;
    this.persist();
    return this.publicState();
  }
  settings(input) {
    this.state.settings = safeSettings(input, this.state.settings);
    this.persist();
    return this.publicState();
  }
  favorite(meta) {
    if (!meta?.id || !meta?.type || !meta?.name)
      throw new Error("بيانات العنوان غير صالحة");
    const index = this.state.favorites.findIndex(
      (m) => m.id === meta.id && m.type === meta.type,
    );
    if (index >= 0) this.state.favorites.splice(index, 1);
    else
      this.state.favorites.push({
        id: meta.id,
        type: meta.type,
        name: meta.name,
        poster: meta.poster,
        background: meta.background,
        description: meta.description,
      });
    this.persist();
    return this.publicState();
  }
  recordProgress(meta, videoId, position, duration) {
    if (!meta?.id || !Number.isFinite(position) || position < 0) return;
    this.state.progress[`${meta.type}:${videoId}`] = {
      meta: {
        id: meta.id,
        type: meta.type,
        name: meta.name,
        poster: meta.poster,
        background: meta.background,
      },
      videoId,
      position,
      duration: Number.isFinite(duration) ? duration : 0,
      updated: Date.now(),
    };
    this.persist();
  }
  queueEdit(input) {
    this.profiles.gate("library");
    this.state.queue = editQueue(this.state.queue || [], input);
    this.persist();
    return this.publicState();
  }
  historyEdit({ action, meta, videoId, videoIds }) {
    this.profiles.gate("library");
    const media = cleanMedia(meta);
    const validId = (value) =>
      typeof value === "string" && !!value && value.length <= 1000;
    if (action === "completeThrough") {
      // "I watched up to here": the viewer saw earlier episodes somewhere else
      // and wants up-next to start after this one.
      if (
        !Array.isArray(videoIds) ||
        !videoIds.length ||
        videoIds.length > 2000 ||
        !videoIds.every(validId)
      )
        throw new Error("قائمة الحلقات غير صالحة");
      for (const id of videoIds) {
        const key = `${media.type}:${id}`;
        const existing = this.state.progress[key];
        if (isCompleted(existing)) continue;
        this.state.progress[key] = {
          meta: media,
          videoId: id,
          position: 0,
          duration: 0,
          completed: true,
          updated: existing?.updated || 0,
          markedAt: Date.now(),
        };
      }
      this.persist();
      return this.publicState();
    }
    if (!validId(videoId)) throw new Error("معرّف المشاهدة غير صالح");
    const key = `${media.type}:${videoId}`;
    if (action === "remove") delete this.state.progress[key];
    else if (action === "complete")
      this.state.progress[key] = {
        meta: media,
        videoId,
        position: 0,
        duration: 0,
        completed: true,
        // Continue watching picks each title's most recent playback. A manual
        // mark is not playback: stamping it "now" would let ticking off an
        // earlier episode hide the one the viewer is halfway through.
        updated: this.state.progress[key]?.updated || 0,
        markedAt: Date.now(),
      };
    else throw new Error("إجراء السجل غير صالح");
    // Manual history changes stay local; they never submit tracker history.
    this.persist();
    return this.publicState();
  }
  /** Seals the installation into backup text. File dialogs live in main. */
  exportBackup({ passphrase, includeSecrets = false, app = "" }) {
    // Backups live in Settings. When a parent locks Settings the lock has to
    // hold here too, not only in the interface: a full backup carries keys.
    this.profiles.gate("settings");
    this.profiles.capture();
    const { payload, left } = collectBackup(this.state, {
      includeSecrets: includeSecrets === true,
    });
    const text = encryptBackup(payload, passphrase, {
      app,
      includesSecrets: includeSecrets === true,
    });
    return { text, left };
  }
  inspectBackup({ text, passphrase }) {
    this.profiles.gate("settings");
    const { header, payload } = decryptBackup(text, passphrase);
    return summarizeBackup(header, payload);
  }
  restoreBackup({ text, passphrase }) {
    // A restore replaces every profile. Behind a locked Settings room it would
    // let anyone holding an older backup strip the parental PINs.
    this.profiles.gate("settings");
    const { payload } = decryptBackup(text, passphrase);
    this.state = restoreState(this.state, payload);
    // A restored profile starts locked, and nothing derived from the old
    // state may survive: stream keys, metadata and live listings all reset.
    this.profiles.unlocked = false;
    this.profiles.ensure();
    this.streams.clear();
    this.subtitles.clear();
    this.subtitleInfo.clear();
    this.subtitleLists.clear();
    this.metas.clear();
    this.cache.clear();
    this.live.loaded.clear();
    this.dataHub.cache.clear();
    this.dataHub.generation++;
    this.integrations.devices.clear();
    this.persist();
    return this.publicState();
  }
  /** Addon metadata without provider enrichment: episode lists are enough here. */
  async rawMeta({ type, id }) {
    for (const addon of this.enabled().filter((a) =>
      accepts(a.manifest, "meta", type, id),
    )) {
      try {
        const result = await this.cached(
          resourceUrl(addon.transportUrl, "meta", type, id),
        );
        if (result.meta?.id) return result.meta;
      } catch {
        /* Try the next addon that serves this title. */
      }
    }
    return null;
  }
  /**
   * Up next and the calendar for the series this viewer follows. A series
   * whose metadata fails is left out rather than failing the whole view:
   * providers are optional and this is a convenience, not playback.
   */
  async episodes({ days = 30, pastDays = 7 } = {}) {
    const follow = followedSeries(this.state, 40);
    const metas = [];
    for (let offset = 0; offset < follow.length; offset += 4) {
      const batch = await Promise.all(
        follow
          .slice(offset, offset + 4)
          .map((meta) => this.rawMeta(meta).catch(() => null)),
      );
      metas.push(...batch.filter((meta) => meta?.videos?.length));
    }
    const now = Date.now();
    return {
      followed: follow.length,
      loaded: metas.length,
      upNext: upNextList(metas, this.state.progress, { now }),
      calendar: calendarEntries(metas, this.state.progress, {
        now,
        days: Math.max(1, Math.min(90, Number(days) || 30)),
        pastDays: Math.max(0, Math.min(30, Number(pastDays) || 0)),
      }),
    };
  }
  /**
   * A failure can be remembered for a while (failFor), so one dead addon does
   * not cost its full timeout again on every screen that lists catalogs.
   */
  async cached(url, { ttl = 180000, failFor = 0, timeout } = {}) {
    const cached = this.cache.get(url);
    if (cached?.failed && Date.now() - cached.at < cached.failFor)
      throw new Error(cached.message);
    if (cached && !cached.failed && Date.now() - cached.at < ttl)
      return cached.data;
    let data;
    try {
      data = await this.request(url, timeout ? { timeout } : undefined);
    } catch (error) {
      if (failFor)
        this.remember(url, {
          at: Date.now(),
          failed: true,
          failFor,
          message: error.message,
        });
      throw error;
    }
    this.remember(url, { at: Date.now(), data });
    return data;
  }
  remember(url, entry) {
    this.cache.delete(url);
    if (this.cache.size >= 800)
      this.cache.delete(this.cache.keys().next().value);
    this.cache.set(url, entry);
  }
  /** The catalogs a listing would request, in the viewer's addon order. */
  catalogTasks({
    type = "",
    search = "",
    genre = "",
    catalogKey = "",
    skip = 0,
  } = {}) {
    return this.enabled()
      .flatMap((addon) =>
        (addon.manifest.catalogs || [])
          .filter(
            (c) => c.type !== "addon_catalog" && (!type || c.type === type),
          )
          .map((cat) => ({
            addon,
            cat,
            key: keyFor(`${addon.transportUrl}|${cat.type}|${cat.id}`),
          })),
      )
      .filter((item) => !catalogKey || item.key === catalogKey)
      .map((item) => ({
        ...item,
        extras: catalogExtras(item.cat, search, genre, skip),
      }))
      .filter((item) => item.extras !== null);
  }
  /**
   * What the interface needs to load a listing one catalog at a time and show
   * rows as they arrive: opaque keys and labels, never addon URLs.
   */
  catalogPlan(args = {}) {
    return this.catalogTasks(args).map(({ addon, cat, key }) => ({
      key,
      name: cat.name || cat.id,
      provider: addon.manifest.name,
      type: cat.type,
    }));
  }
  async catalog(args = {}) {
    const tasks = this.catalogTasks(args);
    const results = new Array(tasks.length),
      failures = [];
    const load = async ({ addon, cat, key, extras }) => {
      try {
        const data = await this.cached(
          resourceUrl(addon.transportUrl, "catalog", cat.type, cat.id, extras),
          { ttl: 600000, failFor: 120000, timeout: 10000 },
        );
        const metas = (data.metas || [])
          .filter((m) => m?.id && m.name)
          .map((m) => ({ ...m, type: m.type || cat.type }));
        return {
          key,
          name: cat.name || cat.id,
          provider: addon.manifest.name,
          type: cat.type,
          metas,
          genres:
            (cat.extra || []).find((e) => e.name === "genre")?.options || [],
          hasMore:
            (cat.extra || []).some((e) => e.name === "skip") &&
            metas.length > 0,
        };
      } catch {
        failures.push(addon.manifest.name);
        return null;
      }
    };
    // A pool rather than lockstep batches: one slow addon holds up only its
    // own slot, never the seven requests that happened to share its batch.
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const index = next++;
        results[index] = await load(tasks[index]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(10, tasks.length) }, worker),
    );
    return {
      rows: results.filter(Boolean),
      failures: [...new Set(failures)],
    };
  }
  async metadata({ type, id, flexible = false }) {
    try {
      return await this.metadataOf(type, id);
    } catch (error) {
      // A title opened from credits carries a film/series kind read from
      // Wikidata, which is sometimes wrong; try the other kind once.
      if (
        flexible !== true ||
        !/^tt\d+$/.test(id) ||
        !["movie", "series"].includes(type)
      )
        throw error;
      return this.metadataOf(type === "movie" ? "series" : "movie", id);
    }
  }
  async metadataOf(type, id) {
    for (const addon of this.enabled().filter((a) =>
      accepts(a.manifest, "meta", type, id),
    )) {
      try {
        const result = await this.cached(
          resourceUrl(addon.transportUrl, "meta", type, id),
        );
        if (result.meta?.id) {
          const meta = await this.dataHub.enrich(result.meta);
          this.metas.set(`${type}:${id}`, meta);
          return meta;
        }
      } catch {
        /* Try the next matching provider. */
      }
    }
    throw new Error("تفاصيل العنوان غير متاحة الآن");
  }
  /**
   * Requested season, episode and runtime let the stream engine reject offers
   * that cannot be the episode the viewer asked for.
   */
  requestContext(type, id) {
    const parts = String(id).split(":");
    const requested = {};
    if (parts.length >= 3) {
      const season = Number(parts[1]);
      const episode = Number(parts[2]);
      if (Number.isInteger(season)) requested.season = season;
      if (Number.isInteger(episode)) requested.episode = episode;
    }
    const meta =
      this.metas.get(`${type}:${id}`) || this.metas.get(`${type}:${parts[0]}`);
    const runtime = Number(String(meta?.runtime || "").match(/\d+/)?.[0]);
    if (Number.isFinite(runtime) && runtime > 0) requested.runtime = runtime;
    return { requested };
  }
  async getStreams({ type, id }) {
    const failures = [];
    const addons = this.enabled().filter((a) =>
      accepts(a.manifest, "stream", type, id),
    );
    const results = await Promise.all(
      addons.map(async (addon) => {
        try {
          const response = await this.request(
            resourceUrl(addon.transportUrl, "stream", type, id),
          );
          return (response.streams || [])
            .filter((s) => s && typeof s === "object")
            .map((s) => ({ ...s, provider: addon.manifest.name }));
        } catch {
          failures.push(addon.manifest.name);
          return [];
        }
      }),
    );
    const seen = new Set();
    const unique = [];
    for (const stream of results.flat()) {
      const identity = JSON.stringify([
        stream.url,
        stream.infoHash,
        stream.fileIdx,
        stream.externalUrl,
        stream.ytId,
        stream.behaviorHints?.proxyHeaders,
      ]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      unique.push({ stream, identity });
    }
    const analysis = analyzeStreams(
      unique.map((entry) => entry.stream),
      this.state.settings,
      this.requestContext(type, id),
    );
    const streams = analysis.kept.map((entry) => {
      const { stream, parsed } = entry;
      const key = keyFor(unique[entry.index].identity);
      this.streams.set(key, { ...stream, type, videoId: id });
      const supported = !!(
        (typeof stream.url === "string" && /^https?:\/\//i.test(stream.url)) ||
        (typeof stream.infoHash === "string" &&
          /^[a-f\d]{40}$/i.test(stream.infoHash)) ||
        (typeof stream.externalUrl === "string" &&
          /^https?:\/\//i.test(stream.externalUrl)) ||
        (typeof stream.ytId === "string" && !!stream.ytId)
      );
      return {
        key,
        name: stream.name || stream.provider,
        title: stream.title || stream.description || "",
        provider: stream.provider,
        tier: entry.tier,
        score: entry.score,
        reasons: entry.reasons.slice(0, 5),
        resolution: parsed.resolution,
        resolutionLabel: parsed.resolutionLabel,
        hdr: parsed.hdr,
        codec: parsed.codec,
        audio: parsed.audio,
        channels: parsed.channels,
        source: parsed.source,
        group: parsed.group,
        trustedGroup: parsed.trustedGroup,
        size: parsed.size,
        sizeLabel: sizeLabel(parsed.size),
        seeders: parsed.seeders,
        cached: parsed.cached,
        debrid: parsed.debrid,
        arabicSub: parsed.arabic.sub,
        arabicDub: parsed.arabic.dub,
        languages: parsed.languages,
        cam: ["CAM", "TS", "TC"].includes(parsed.source),
        arabic: parsed.languages.includes("ar"),
        torrent: !!stream.infoHash,
        external: !!(stream.externalUrl || stream.ytId),
        supported,
      };
    });
    const dropped = analysis.dropped.map((entry) => ({
      name: entry.stream.name || entry.stream.provider || "مصدر",
      provider: entry.stream.provider,
      reasons: entry.rejections,
    }));
    return {
      streams,
      groups: analysis.groups.map((group) => ({
        tier: group.tier,
        label: group.label,
        count: group.items.length,
      })),
      dropped,
      failures,
      providers: addons.length,
      safety: analysis.safety,
    };
  }
  /**
   * Addon subtitles for what is playing, labelled for the interface. The URL
   * stays in main behind an opaque key; the list is kept for ten minutes so
   * reopening the panel does not ask every addon again.
   */
  async getSubtitles({ type, id, streamKey }) {
    const cacheKey = JSON.stringify([type, id, streamKey || ""]);
    const hit = this.subtitleLists.get(cacheKey);
    if (hit && Date.now() - hit.at < 600000) return hit.list;
    const selected = this.streams.get(streamKey);
    const extras = { videoID: id };
    if (selected?.behaviorHints?.videoHash)
      extras.videoHash = selected.behaviorHints.videoHash;
    if (selected?.behaviorHints?.videoSize)
      extras.videoSize = selected.behaviorHints.videoSize;
    const providers = this.enabled().filter((a) =>
      accepts(a.manifest, "subtitles", type, id),
    );
    const results = await Promise.all(
      providers.map(async (a) => {
        try {
          const found =
            (
              await this.request(
                resourceUrl(a.transportUrl, "subtitles", type, id, extras),
                { timeout: 10000 },
              )
            ).subtitles || [];
          return found.map((s) => ({ ...s, provider: a.manifest.name }));
        } catch {
          return [];
        }
      }),
    );
    const seen = new Set();
    const list = [
      ...(selected?.subtitles || []).map((s) => ({ ...s, provider: "المصدر" })),
      ...results.flat(),
    ]
      .filter((s) => typeof s?.url === "string" && /^https?:\/\//i.test(s.url))
      .filter((s) => !seen.has(s.url) && seen.add(s.url))
      .map((s) => {
        const key = keyFor(s.url);
        const label = subtitleLabel(s);
        this.subtitles.set(key, s.url);
        this.subtitleInfo.set(key, { lang: s.lang || "und", label });
        return {
          key,
          lang: s.lang || "und",
          label,
          provider: String(s.provider || "").slice(0, 60),
          format: subtitleFormat(s.url),
        };
      });
    if (this.subtitleLists.size > 20)
      this.subtitleLists.delete(this.subtitleLists.keys().next().value);
    this.subtitleLists.set(cacheKey, { at: Date.now(), list });
    return list;
  }

  configureUrl(key) {
    const url = webUrl(this.addon(key).transportUrl);
    url.pathname = url.pathname.replace(/\/manifest\.json$/, "/configure");
    return url.toString();
  }
}
