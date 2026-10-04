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
import { applyStreamPrefs } from "./stream-prefs.mjs";
import { discoverCinemetaUrl, discoverPlan, discoverRow } from "./discover.mjs";
import {
  forgetSeries,
  preferRemembered,
  rememberSeries,
  sourceIdentity,
} from "./series-memory.mjs";
import { cleanBadgeRules, ruleBadges } from "./badges.mjs";
import { ServicesHub } from "./services-hub.mjs";
import { AiSearch } from "./ai-hub.mjs";
import { editTaste } from "./taste.mjs";
import { parseReleaseDates } from "./countdown.mjs";
import {
  fillOverviews,
  needsEnglish,
  parseSeason,
  seasonRequest,
} from "./season-details.mjs";
import {
  fanartRequest,
  mergeArtwork,
  metaArtwork,
  parseFanart,
  parseTmdbImages,
  tmdbImagesRequest,
} from "./artwork.mjs";
import {
  logoFindRequest,
  logoImagesRequest,
  parseLogoFind,
  pickLogos,
} from "./logos.mjs";
import { isAdultAddon, withoutAdult } from "./adult.mjs";
import { DataHub } from "./data-hub.mjs";
import { Credits } from "./credits.mjs";
import { Integrations } from "./integrations.mjs";
import { LiveHub } from "./live-hub.mjs";
import { Profiles } from "./profiles.mjs";
import { Notifier } from "./notify.mjs";
import { Updates } from "./updates.mjs";
import { cleanMedia, editQueue, isCompleted } from "./library.mjs";
import {
  availableCatalogs,
  editCollections,
  fromNuvio,
  mergeCollections,
  resolveCatalog,
} from "./collections.mjs";
import { nuvioProfile } from "./nuvio.mjs";
import {
  FEED_PREFIX,
  chartRequest,
  cinemetaUrl,
  feedPlan,
  feedRow,
} from "./feed.mjs";
import {
  sourceLabel,
  tmdbGenreNames,
  tmdbItems,
  tmdbRequest,
  traktMetas,
  traktRequest,
} from "./collection-sources.mjs";
import {
  addonSignature,
  gatherSources,
  pruneRuns,
  reusableRun,
} from "./source-wait.mjs";
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
/**
 * Sets a key on a map that must not grow for the whole session: re-setting
 * moves it to the newest end, and the oldest entries beyond `limit` go.
 */
function boundedSet(map, key, value, limit) {
  map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}
/** What makes two offers the same source, across addons. */
const streamIdentity = (stream) =>
  JSON.stringify([
    stream.url,
    stream.infoHash,
    stream.fileIdx,
    stream.externalUrl,
    stream.ytId,
    stream.behaviorHints?.proxyHeaders,
  ]);
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
    // A 204 or an empty body (Trakt's deletes) is a success with nothing in it.
    if (!text.trim()) return null;
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
    this.services = new ServicesHub(this);
    this.ai = new AiSearch(this);
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
      collections: this.state.collections || [],
      // Plugin repository addresses stay in main, like addon URLs.
      nuvioPlugins: (this.state.nuvioPlugins || []).map((p) => ({
        key: keyFor(p.url),
        name: p.name,
        host: new URL(p.url).host,
        scrapers: p.scrapers,
      })),
      lastSync,
      providers: this.dataHub.publicState(),
      services: this.services.publicState(),
      aiSearch: this.ai.publicState(),
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
        id: String(a.manifest.id || "").slice(0, 200),
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
  /**
   * Removes several addons at once (the Addons page's "remove the ones that
   * stopped"), by their opaque keys. Behind the addons room lock.
   */
  removeAddons({ keys } = {}) {
    this.profiles.gate("addons");
    const drop = new Set(Array.isArray(keys) ? keys.map(String) : []);
    if (!drop.size) return this.publicState();
    // Stored addons carry no key: they are named by keyFor(transportUrl),
    // as publicState and addonsHealth give them to the interface.
    this.state.addons = this.state.addons.filter(
      (a) => !drop.has(keyFor(a.transportUrl)),
    );
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
  tasteEdit(input) {
    this.profiles.gate("library");
    if (input?.profileId !== this.profiles.store.active)
      throw new Error("تغير الملف الشخصي؛ أعد اختيار ذوقك في الملف الحالي");
    this.state.settings.taste = editTaste(this.state.settings.taste, input);
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
  collectionsEdit(input) {
    this.profiles.gate("library");
    this.state.collections = editCollections(
      this.state.collections || [],
      input,
    );
    this.persist();
    return this.publicState();
  }
  /**
   * Imports what the viewer chose from one Nuvio profile. Addons are
   * installed through the normal manifest check, so a dead or unconfigured
   * addon is reported rather than stored; collections join the active
   * profile's; library titles join its library; plugin repositories are
   * listed, never run.
   */
  async importNuvio(stores, { profile, parts = {} } = {}) {
    this.profiles.gate("settings");
    const index = Number(profile);
    if (!Number.isInteger(index) || index < 1)
      throw new Error("اختر ملف نوفيو");
    const data = nuvioProfile(stores, index);
    const result = {
      addons: 0,
      addonFailures: [],
      collections: 0,
      skippedSources: 0,
      library: 0,
      plugins: 0,
      tmdbKey: "",
    };
    if (parts.addons) {
      for (const addon of data.addons.slice(0, 100)) {
        let key;
        try {
          key = keyFor(normalizeAddon(addon.url));
        } catch {
          result.addonFailures.push(new URL(addon.url).host);
          continue;
        }
        if (this.state.addons.some((a) => keyFor(a.transportUrl) === key))
          continue;
        try {
          await this.install(addon.url);
          const added = this.state.addons.find(
            (a) => keyFor(a.transportUrl) === key,
          );
          if (added && !addon.enabled) added.enabled = false;
          result.addons++;
        } catch {
          result.addonFailures.push(new URL(addon.url).host);
        }
      }
    }
    if (parts.collections) {
      const merged = mergeCollections(
        this.state.collections || [],
        data.collections.collections,
      );
      this.state.collections = merged.collections;
      result.collections = merged.added;
      result.skippedSources = data.collections.skipped;
    }
    if (parts.library) {
      for (const media of data.library) {
        if (
          this.state.favorites.some(
            (m) => m.id === media.id && m.type === media.type,
          )
        )
          continue;
        this.state.favorites.unshift(media);
        result.library++;
      }
    }
    if (parts.plugins) {
      const list = (this.state.nuvioPlugins ||= []);
      for (const repo of data.plugins) {
        if (list.some((p) => p.url === repo.url)) continue;
        list.push({ ...repo, added: Date.now() });
        result.plugins++;
      }
    }
    if (parts.tmdbKey && data.tmdbKey) {
      // The viewer's key in Riwaq wins; Nuvio's only fills an empty slot.
      if (this.state.providers?.tmdb?.key) result.tmdbKey = "kept";
      else {
        this.dataHub.save({ id: "tmdb", key: data.tmdbKey, enabled: true });
        result.tmdbKey = "imported";
      }
    }
    this.cache.clear();
    this.persist();
    return { result, state: this.publicState() };
  }
  removeNuvioPlugin({ key }) {
    this.state.nuvioPlugins = (this.state.nuvioPlugins || []).filter(
      (p) => keyFor(p.url) !== key,
    );
    this.persist();
    return this.publicState();
  }
  /** Nuvio's collections JSON pasted from any Nuvio app (phone, TV, desktop). */
  importNuvioCollections({ text } = {}) {
    this.profiles.gate("library");
    if (typeof text !== "string" || !text.trim() || text.length > 4_000_000)
      throw new Error("الصق نص مجموعات نوفيو أولاً");
    const converted = fromNuvio(text);
    const merged = mergeCollections(
      this.state.collections || [],
      converted.collections,
    );
    this.state.collections = merged.collections;
    this.persist();
    return {
      result: {
        collections: merged.added,
        folders: converted.folders,
        skippedSources: converted.skipped,
      },
      state: this.publicState(),
    };
  }
  collectionCatalogs() {
    return availableCatalogs(this.enabled());
  }
  /**
   * One folder's content: the hand-picked titles in the viewer's order, then
   * one row per catalog as the addons answer. Sources whose addon is gone are
   * named so the interface can say what is missing.
   */
  /**
   * One folder's content: the hand-picked titles in the viewer's order, then
   * one row per source. Every source answers with a row, even an empty one,
   * carrying a `note` that says why (addon not installed, no answer, needs a
   * key, nothing matched), so a folder never looks empty without a reason.
   */
  async collectionFolder({ collectionId, folderId, skip = 0 } = {}) {
    this.profiles.gate("library");
    const collection = (this.state.collections || []).find(
      (c) => c.id === collectionId,
    );
    const folder = collection?.folders.find((f) => f.id === folderId);
    if (!folder) throw new Error("المجلد غير موجود");
    const addons = this.enabled();
    const offset = Math.max(0, Math.min(100000, Number(skip) || 0));
    const tasks = [
      ...folder.catalogs.map((source, i) => ({
        key: `c${i}`,
        run: () => this.catalogRow(addons, source, offset),
      })),
      ...(folder.tmdb || []).map((source, i) => ({
        key: `t${i}`,
        run: () => this.tmdbRow(source, addons),
      })),
      ...(folder.trakt || []).map((source, i) => ({
        key: `k${i}`,
        run: () => this.traktRow(source),
      })),
    ];
    const rows = new Array(tasks.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const index = next++;
        const row = await tasks[index]
          .run()
          .catch(() => ({ name: "", provider: "", metas: [], note: "failed" }));
        rows[index] = { type: "movie", ...row, index: tasks[index].key };
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, tasks.length) }, worker),
    );
    for (const [i, u] of (folder.unsupported || []).entries())
      rows.push({
        index: `u${i}`,
        name: u.title || u.provider,
        provider: u.provider,
        type: "movie",
        metas: [],
        note: "unsupported",
      });
    const needs = new Set(
      rows
        .filter((r) => r.note === "needs-tmdb" || r.note === "needs-trakt")
        .map((r) => r.note.slice(6)),
    );
    return { titles: folder.titles, rows, needs: [...needs] };
  }
  async catalogRow(addons, source, skip) {
    const found = resolveCatalog(addons, source);
    if (!found)
      return {
        name: source.catalog,
        provider: source.addon,
        type: source.type,
        metas: [],
        note: "missing",
      };
    const name =
      (found.cat.name || found.cat.id) +
      (source.genre ? ` · ${source.genre}` : "");
    const base = {
      name,
      provider: found.addon.manifest.name,
      type: found.cat.type,
    };
    const extras = catalogExtras(found.cat, "", source.genre || "", skip);
    if (!extras) return { ...base, metas: [], note: "input" };
    try {
      const data = await this.cached(
        resourceUrl(
          found.addon.transportUrl,
          "catalog",
          found.cat.type,
          found.cat.id,
          extras,
        ),
        { ttl: 600000, failFor: 120000, timeout: 10000 },
      );
      const metas = this.adultFilter(
        (data.metas || [])
          .filter((m) => m?.id && m.name)
          .map((m) => ({ ...m, type: m.type || found.cat.type })),
      );
      // A catalog that takes "skip" can be read further on the folder page.
      const pages = (found.cat.extra || []).some((e) => e?.name === "skip");
      return {
        ...base,
        metas,
        ...(metas.length ? {} : { note: "empty" }),
        more: pages && metas.length > 0,
      };
    } catch {
      return { ...base, metas: [], note: "failed" };
    }
  }
  /**
   * A further page of one folder source, for the folder page's "more":
   * an addon catalog by `skip`, TMDB and Trakt by page number.
   */
  async collectionSource({
    collectionId,
    folderId,
    index,
    skip = 0,
    page = 2,
  }) {
    this.profiles.gate("library");
    const collection = (this.state.collections || []).find(
      (c) => c.id === collectionId,
    );
    const folder = collection?.folders.find((f) => f.id === folderId);
    if (!folder) throw new Error("المجلد غير موجود");
    const m = /^([ctk])(\d{1,3})$/.exec(String(index || ""));
    if (!m) throw new Error("المصدر غير موجود");
    const i = Number(m[2]);
    const offset = Math.max(0, Math.min(100000, Number(skip) || 0));
    const number = Math.max(1, Math.min(500, Math.floor(Number(page)) || 1));
    let row;
    if (m[1] === "c") {
      const source = folder.catalogs[i];
      if (!source) throw new Error("المصدر غير موجود");
      row = await this.catalogRow(this.enabled(), source, offset);
    } else if (m[1] === "t") {
      const source = folder.tmdb?.[i];
      if (!source) throw new Error("المصدر غير موجود");
      row = await this.tmdbRow(source, this.enabled(), number);
    } else {
      const source = folder.trakt?.[i];
      if (!source) throw new Error("المصدر غير موجود");
      row = await this.traktRow(source, number);
    }
    return { type: "movie", ...row, index: m[0], page: number };
  }
  /**
   * TMDB with the viewer's key, at most four requests at a time across the
   * whole folder and one retry, so a folder of many TMDB sources does not
   * trip TMDB's rate limit and silently lose titles.
   */
  async tmdbCall(path, params) {
    const gate = (this.tmdbGate ||= { running: 0, waiting: [] });
    if (gate.running >= 4)
      await new Promise((resolve) => gate.waiting.push(resolve));
    gate.running++;
    try {
      try {
        return await this.dataHub.request("tmdb", path, params);
      } catch (error) {
        if (/أضف مفتاح|لم تقبل/.test(error.message)) throw error;
        await new Promise((r) => setTimeout(r, this.tmdbRetryMs ?? 1200));
        return await this.dataHub.request("tmdb", path, params);
      }
    } finally {
      gate.running--;
      gate.waiting.shift()?.();
    }
  }
  /**
   * A TMDB source. Each result is matched to an IMDb ID (cached), because
   * most addons open titles by IMDb ID. A title without one is kept when an
   * enabled addon opens TMDB IDs itself (TMDB Addon, AIOMetadata...).
   */
  async tmdbRow(source, addons = this.enabled(), page = 1) {
    const base = {
      name: sourceLabel(source),
      provider: "TMDB",
      type: source.media === "tv" ? "series" : "movie",
    };
    const entry = this.state.providers?.tmdb;
    if (!entry?.key || entry.enabled === false)
      return { ...base, metas: [], note: "needs-tmdb" };
    let items;
    let more = false;
    try {
      const language = this.state.settings.metadataLanguage || "ar-SA";
      // Riwaq's own rows (core/feed.mjs) also read TMDB's charts and trending.
      const { path, params } = ["chart", "trending"].includes(source.kind)
        ? chartRequest(source, {
            page,
            language,
            region: this.state.settings.region || "SA",
          })
        : tmdbRequest(source, { language, page });
      // Ten minutes per TMDB page, so opening a folder again is instant.
      const pages = (this.tmdbPages ||= new Map());
      const key = `${path}?${new URLSearchParams(params)}`;
      let body = pages.get(key);
      if (!body || Date.now() - body.at > 600000) {
        body = { at: Date.now(), data: await this.tmdbCall(path, params) };
        if (pages.size > 200) pages.delete(pages.keys().next().value);
        pages.set(key, body);
      }
      items = tmdbItems(body.data, source).slice(0, 40);
      // Lists and discover queries are paged; a film series or a filmography
      // arrives whole.
      more = "page" in params && Number(body.data?.total_pages) > Number(page);
    } catch {
      return { ...base, metas: [], note: "failed" };
    }
    if (!items.length) return { ...base, metas: [], note: "empty" };
    const cache = (this.tmdbImdb ||= new Map());
    await Promise.all(
      items.map(async (item) => {
        const key = `${item.kind}:${item.tmdb}`;
        if (!cache.has(key)) {
          try {
            const ids = await this.tmdbCall(
              `${item.kind}/${item.tmdb}/external_ids`,
            );
            if (cache.size > 5000) cache.delete(cache.keys().next().value);
            cache.set(
              key,
              /^tt\d{5,12}$/.test(ids?.imdb_id || "") ? ids.imdb_id : "",
            );
          } catch {
            /* Unmatched this time; asked again next time. */
          }
        }
        item.imdb = cache.get(key) || "";
      }),
    );
    const opensTmdb = (kind) =>
      addons.some((a) =>
        accepts(
          a.manifest,
          "meta",
          kind === "tv" ? "series" : "movie",
          "tmdb:1",
        ),
      );
    const genreLanguage = this.state.settings.metadataLanguage || "ar-SA";
    const metas = items
      .map((item) => {
        const id =
          item.imdb || (opensTmdb(item.kind) ? `tmdb:${item.tmdb}` : "");
        if (!id) return null;
        return {
          id,
          type: item.kind === "tv" ? "series" : "movie",
          name: item.name,
          poster: item.poster
            ? `https://image.tmdb.org/t/p/w342${item.poster}`
            : item.imdb
              ? `https://images.metahub.space/poster/medium/${item.imdb}/img`
              : undefined,
          ...(item.backdrop
            ? { background: `https://image.tmdb.org/t/p/w1280${item.backdrop}` }
            : {}),
          ...(item.released
            ? {
                releaseInfo: item.released.slice(0, 4),
                // The full date, so "not out yet" checks see this year's
                // upcoming films (the taste shelf, countdowns).
                released: item.released,
              }
            : {}),
          ...(item.rating ? { imdbRating: item.rating.toFixed(1) } : {}),
          ...(item.genres?.length
            ? { genres: tmdbGenreNames(item.genres, genreLanguage) }
            : {}),
        };
      })
      .filter(Boolean);
    return {
      ...base,
      metas,
      ...(metas.length ? {} : { note: "unmatched" }),
      ...(metas.length < items.length
        ? { hidden: items.length - metas.length }
        : {}),
      more,
    };
  }
  /** A Trakt public list with the viewer's Trakt client ID (no sign-in needed). */
  async traktRow(source, page = 1) {
    const base = {
      name: sourceLabel(source, true),
      provider: "Trakt",
      type: source.media === "tv" ? "series" : "movie",
    };
    const clientId = this.state.integrations?.trakt?.clientId;
    if (!clientId) return { ...base, metas: [], note: "needs-trakt" };
    try {
      const body = await this.cached(traktRequest(source, { page }), {
        ttl: 600000,
        failFor: 120000,
        timeout: 12000,
        headers: {
          "trakt-api-version": "2",
          "trakt-api-key": clientId,
        },
      });
      const metas = traktMetas(body, source);
      return {
        ...base,
        metas,
        ...(metas.length ? {} : { note: "empty" }),
        // Trakt pages hold 50 items; a full page may have another behind it.
        more: Array.isArray(body) && body.length >= 50,
      };
    } catch {
      return { ...base, metas: [], note: "failed" };
    }
  }
  queueEdit(input) {
    this.profiles.gate("library");
    if (
      input.profileId !== undefined &&
      input.profileId !== this.profiles.store.active
    )
      throw new Error("تغير الملف الشخصي؛ أعد إضافة الجلسة من الملف المطلوب");
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
  async cached(url, { ttl = 180000, failFor = 0, timeout, headers } = {}) {
    const cached = this.cache.get(url);
    if (cached?.failed && Date.now() - cached.at < cached.failFor)
      throw new Error(cached.message);
    if (cached && !cached.failed && Date.now() - cached.at < ttl)
      return cached.data;
    let data;
    try {
      // A request carrying a credential header never follows a redirect.
      data = await this.request(
        url,
        headers
          ? { timeout, headers, redirect: "error" }
          : timeout
            ? { timeout }
            : undefined,
      );
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
  /** Whether the active profile hides adult addons and titles. */
  hidesAdult() {
    return !!this.profiles?.active?.()?.hideAdult;
  }
  adultFilter(metas) {
    return this.hidesAdult() ? withoutAdult(metas) : metas;
  }
  /** The catalogs a listing would request, in the viewer's addon order. */
  catalogTasks({
    type = "",
    search = "",
    genre = "",
    catalogKey = "",
    skip = 0,
  } = {}) {
    const hideAdult = this.hidesAdult();
    return this.enabled()
      .filter((addon) => !(hideAdult && isAdultAddon(addon.manifest)))
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
    const addons = this.catalogTasks(args).map(({ addon, cat, key }) => ({
      key,
      name: cat.name || cat.id,
      provider: addon.manifest.name,
      type: cat.type,
    }));
    // One of Riwaq's own rows opened on its full page.
    if (String(args.catalogKey || "").startsWith(FEED_PREFIX)) {
      const tmdb = this.tmdbActive();
      const own = discoverRow(args.catalogKey, { tmdb });
      return own
        ? discoverPlan({ tmdb, tab: own.tab }).filter(
            (r) => r.key === args.catalogKey,
          )
        : feedPlan({ tmdb }).filter((r) => r.key === args.catalogKey);
    }
    // Discover asks for one of Riwaq's sections, then the addons' catalogs,
    // which the page folds into its sections (core/discover.mjs).
    if (typeof args.discover === "string" && !args.search && !args.catalogKey)
      return [
        ...discoverPlan({ tmdb: this.tmdbActive(), tab: args.discover }),
        ...addons,
      ];
    // Home asks for Riwaq's own rows first (core/feed.mjs).
    if (args.feed !== true || args.search || args.catalogKey) return addons;
    return [
      ...feedPlan({
        tmdb: this.tmdbActive(),
        hidden: this.state.settings.feedHidden || [],
      }),
      ...addons,
    ];
  }
  /** Whether the viewer's TMDB key is present and switched on. */
  tmdbActive() {
    const entry = this.state.providers?.tmdb;
    return !!entry?.key && entry.enabled !== false;
  }
  /**
   * One of Riwaq's own rows: a TMDB chart or discover query matched to IMDb
   * IDs with the viewer's key, or a Cinemeta catalog without one.
   */
  async feedCatalog(key, { page = 1, skip = 0 } = {}) {
    const tmdb = this.tmdbActive();
    const row = feedRow(key, { tmdb }) || discoverRow(key, { tmdb });
    if (!row) return { rows: [], failures: [] };
    const base = {
      key,
      name: row.name,
      provider: "رِواق",
      type: row.type,
      feed: true,
      page,
      ...(row.tab ? { tab: row.tab } : {}),
    };
    if (tmdb) {
      const result = await this.tmdbRow(row.source, this.enabled(), page);
      const metas = this.adultFilter(result.metas || []);
      return {
        rows: metas.length ? [{ ...base, metas, hasMore: !!result.more }] : [],
        failures: result.note === "failed" ? ["TMDB"] : [],
      };
    }
    try {
      const url = row.tab
        ? discoverCinemetaUrl(row, skip)
        : cinemetaUrl(row, skip);
      const data = await this.cached(url, {
        ttl: 600000,
        failFor: 120000,
        timeout: 10000,
      });
      const metas = this.adultFilter(
        (data.metas || [])
          .filter((m) => m?.id && m.name)
          .map((m) => ({ ...m, type: m.type || row.type })),
      );
      return {
        rows: metas.length
          ? [{ ...base, metas, hasMore: metas.length > 0 }]
          : [],
        failures: [],
      };
    } catch {
      return { rows: [], failures: ["Cinemeta"] };
    }
  }
  async catalog(args = {}) {
    if (String(args.catalogKey || "").startsWith(FEED_PREFIX))
      return this.feedCatalog(args.catalogKey, {
        page: Number.isInteger(args.page) && args.page > 0 ? args.page : 1,
        skip: Number(args.skip) || 0,
      });
    const tasks = this.catalogTasks(args);
    const results = new Array(tasks.length),
      failures = [];
    const load = async ({ addon, cat, key, extras }) => {
      try {
        const data = await this.cached(
          resourceUrl(addon.transportUrl, "catalog", cat.type, cat.id, extras),
          { ttl: 600000, failFor: 120000, timeout: 10000 },
        );
        const metas = this.adultFilter(
          (data.metas || [])
            .filter((m) => m?.id && m.name)
            .map((m) => ({ ...m, type: m.type || cat.type })),
        );
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
  /**
   * A title's artwork gallery (core/artwork.mjs): the addon's images and
   * metahub's always, TMDB's with the viewer's key, Fanart.tv's with theirs.
   * A failing source is named in `failed` and never blocks the others.
   */
  async artwork({ type, id }) {
    if (!["movie", "series"].includes(type) || typeof id !== "string")
      throw new Error("العنوان غير صالح");
    const cacheKey = `${type}:${id}`;
    const hit = (this.artworkCache ||= new Map()).get(cacheKey);
    if (hit && Date.now() - hit.at < 1800000) return hit.value;
    const meta =
      this.metas.get(cacheKey) ||
      (await this.metadataOf(type, id).catch(() => ({ id, type })));
    const active = (p) => {
      const entry = this.state.providers?.[p];
      return !!entry?.key && entry.enabled !== false;
    };
    const parts = [metaArtwork(meta)];
    const failed = [];
    const needs = [];
    const imdb = /^tt\d{5,12}$/.test(meta.id || "") ? meta.id : "";
    let tmdbId = meta.tmdbId;
    let tvdbId = meta.tvdbId || meta.tvdb_id;
    if (active("tmdb")) {
      try {
        if (!tmdbId && imdb) {
          const found = await this.tmdbCall(`find/${imdb}`, {
            external_source: "imdb_id",
          });
          tmdbId =
            found?.[type === "series" ? "tv_results" : "movie_results"]?.[0]
              ?.id;
        }
        const request = tmdbImagesRequest(type, tmdbId);
        if (request) {
          parts.push(
            parseTmdbImages(await this.tmdbCall(request.path, request.params)),
          );
          if (type === "series" && !tvdbId) {
            const ids = await this.tmdbCall(`tv/${tmdbId}/external_ids`).catch(
              () => null,
            );
            tvdbId = ids?.tvdb_id;
          }
        }
      } catch {
        failed.push("TMDB");
      }
    } else needs.push("tmdb");
    if (active("fanart")) {
      const path = fanartRequest(type, { imdb, tmdbId, tvdbId });
      if (path)
        try {
          parts.push(parseFanart(await this.dataHub.request("fanart", path)));
        } catch (error) {
          // Fanart.tv answers 404 for a title it has no art for.
          if (!/HTTP 404/.test(error.message)) failed.push("Fanart.tv");
        }
    } else needs.push("fanart");
    const value = { ...mergeArtwork(...parts), needs, failed };
    if (!failed.length) {
      if (this.artworkCache.size > 200)
        this.artworkCache.delete(this.artworkCache.keys().next().value);
      this.artworkCache.set(cacheKey, { at: Date.now(), value });
    }
    return value;
  }
  /**
   * TMDB's details for one season (core/season-details.mjs), in the viewer's
   * metadata language with English filling missing descriptions. Without a
   * TMDB key the page uses the addon's episode fields alone.
   */
  async seasonDetails({ id, season }) {
    const entry = this.state.providers?.tmdb;
    if (!entry?.key || entry.enabled === false)
      return { needs: ["tmdb"], episodes: {} };
    const imdb = String(id || "").split(":")[0];
    if (!/^tt\d{5,12}$/.test(imdb) || !Number.isInteger(season))
      throw new Error("العنوان غير صالح");
    const language = this.state.settings.metadataLanguage || "ar-SA";
    const meta = this.metas.get(`series:${imdb}`);
    const cache = (this.seasonCache ||= new Map());
    const tvIds = (this.tvIds ||= new Map());
    let tmdbId = meta?.tmdbId || tvIds.get(imdb);
    if (!tmdbId) {
      const found = await this.tmdbCall(`find/${imdb}`, {
        external_source: "imdb_id",
      });
      tmdbId = found?.tv_results?.[0]?.id;
      if (tmdbId) tvIds.set(imdb, tmdbId);
    }
    const request = seasonRequest(tmdbId, season, language);
    if (!request) return { needs: [], episodes: {} };
    const key = `${tmdbId}:${season}:${language}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 86400000) return hit.value;
    let episodes = parseSeason(
      await this.tmdbCall(request.path, request.params),
    );
    if (language !== "en-US" && needsEnglish(episodes)) {
      const english = await this.tmdbCall(request.path, {
        language: "en-US",
      }).catch(() => null);
      if (english) episodes = fillOverviews(episodes, parseSeason(english));
    }
    const value = { needs: [], episodes };
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    cache.set(key, { at: Date.now(), value });
    return value;
  }
  /**
   * A film's release date in the viewer's region from TMDB (Saudi cinemas by
   * default), for its countdown. Without a TMDB key there is none.
   */
  async releaseDates({ id }) {
    const entry = this.state.providers?.tmdb;
    if (!entry?.key || entry.enabled === false) return null;
    if (!/^tt\d{5,12}$/.test(id || "")) return null;
    const region = /^[A-Z]{2}$/.test(this.state.settings.region || "")
      ? this.state.settings.region
      : "SA";
    let tmdbId = this.metas.get(`movie:${id}`)?.tmdbId;
    if (!tmdbId) {
      const found = await this.tmdbCall(`find/${id}`, {
        external_source: "imdb_id",
      });
      tmdbId = found?.movie_results?.[0]?.id;
    }
    if (!tmdbId) return null;
    return parseReleaseDates(
      await this.tmdbCall(`movie/${tmdbId}/release_dates`),
      region,
    );
  }
  /**
   * A title's logos from TMDB in the viewer's order (core/logos.mjs), for
   * the hero and the title page. Without a TMDB key the page uses the
   * addon's logo and metahub's, so the answer is empty and names the need.
   */
  async titleLogos({ type, id }) {
    if (!["movie", "series"].includes(type) || typeof id !== "string")
      throw new Error("العنوان غير صالح");
    const mode = this.state.settings.titleLogos || "arabic";
    if (mode === "text") return { logos: [], needs: [] };
    const entry = this.state.providers?.tmdb;
    if (!entry?.key || entry.enabled === false)
      return { logos: [], needs: ["tmdb"] };
    const imdb = id.split(":")[0];
    const cache = (this.logoCache ||= new Map());
    const cacheKey = `${type}:${imdb}:${mode}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < 43200000) return hit.value;
    let found = null;
    const tmdbMatch = /^tmdb:(\d{1,10})$/.exec(id);
    if (tmdbMatch) {
      const details = await this.tmdbCall(
        `${type === "series" ? "tv" : "movie"}/${tmdbMatch[1]}`,
      );
      found = parseLogoFind(
        { [type === "series" ? "tv_results" : "movie_results"]: [details] },
        type,
      );
    } else {
      const request = logoFindRequest(imdb);
      if (!request) return { logos: [], needs: [] };
      found = parseLogoFind(
        await this.tmdbCall(request.path, request.params),
        type,
      );
    }
    const images = found
      ? logoImagesRequest(type, found.tmdbId, found.original)
      : null;
    const logos = images
      ? pickLogos(
          await this.tmdbCall(images.path, images.params),
          mode,
          found.original,
        )
      : [];
    const value = { logos, needs: [] };
    if (cache.size > 400) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
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
          boundedSet(this.metas, `${type}:${id}`, meta, 400);
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
  /**
   * The series an episode ID belongs to: the title's own ID when the caller
   * names it and the episode sits under it, otherwise IMDb-style
   * "tt…:season:episode" without its numbers. "" for films.
   */
  seriesOf(type, id, seriesId) {
    if (type !== "series" || typeof id !== "string") return "";
    if (
      typeof seriesId === "string" &&
      /^[\w:.-]{1,120}$/.test(seriesId) &&
      id.startsWith(`${seriesId}:`)
    )
      return seriesId;
    const m = id.match(/^(tt\d{1,12}):\d+:\d+$/);
    return m ? m[1] : "";
  }
  /** A series' remembered choice, or null when remembering is off. */
  seriesChoice(seriesId) {
    const settings = this.state.settings;
    if (!seriesId || settings.rememberSeries === false) return null;
    return settings.seriesMemory?.[seriesId] || null;
  }
  /** Stores what the viewer chose for a series (identities, never links). */
  rememberSeries(seriesId, patch) {
    const settings = this.state.settings;
    if (!seriesId || settings.rememberSeries === false) return false;
    settings.seriesMemory = rememberSeries(
      settings.seriesMemory,
      seriesId,
      patch,
    );
    this.persist();
    return true;
  }
  /** Forgets one series' choices, or every series' when none is named. */
  forgetSeries(seriesId) {
    this.state.settings.seriesMemory = forgetSeries(
      this.state.settings.seriesMemory,
      typeof seriesId === "string" ? seriesId : "",
    );
    this.persist();
    return this.publicState();
  }
  async getStreams({ type, id, seriesId, again = false }) {
    const addons = this.enabled().filter((a) =>
      accepts(a.manifest, "stream", type, id),
    );
    // Addons are asked at once and the list does not wait for the slowest
    // (core/source-wait.mjs). Late answers fill the same run; asking again
    // within five minutes shows them without a new request.
    const runs = (this.sourceRuns ||= new Map());
    const runKey = `${type}:${id}`;
    const signature = addonSignature(addons);
    let run = again ? reusableRun(runs, runKey, Date.now(), signature) : null;
    if (run) await run.ready;
    else {
      const { ready, done, answers } = gatherSources(
        addons,
        async (addon) => {
          const response = await this.request(
            resourceUrl(addon.transportUrl, "stream", type, id),
          );
          return (response?.streams || [])
            .filter((s) => s && typeof s === "object")
            .map((s) => ({
              ...s,
              provider: addon.manifest.name,
              addonId: addon.manifest.id,
              addonKey: keyFor(addon.transportUrl),
            }));
        },
        { ...this.sourceWait, keyOf: (addon) => addon.transportUrl },
      );
      // The live answers go on the run at once, so a request that reuses it
      // while it is still out waits on `ready` and never sees an empty run.
      run = { at: Date.now(), addons, signature, answers, ready };
      pruneRuns(runs);
      runs.delete(runKey);
      if (runs.size >= 20) runs.delete(runs.keys().next().value);
      runs.set(runKey, run);
      const first = await ready;
      if (first.late.length)
        done.then((all) => {
          if (runs.get(runKey) !== run) return;
          const lateKeys = new Set(first.late.map((a) => a.transportUrl));
          // Count only what the list will gain: sources not already shown
          // under another addon, and not rejected by the stream engine.
          const seen = new Set();
          for (const [key, streams] of all)
            if (!lateKeys.has(key))
              for (const stream of streams || [])
                seen.add(streamIdentity(stream));
          const fresh = [];
          const failed = [];
          for (const addon of first.late) {
            const streams = all.get(addon.transportUrl);
            if (!streams) failed.push(addon.manifest.name);
            for (const stream of streams || []) {
              const identity = streamIdentity(stream);
              if (seen.has(identity)) continue;
              seen.add(identity);
              fresh.push(stream);
            }
          }
          let found = 0;
          try {
            found = fresh.length
              ? analyzeStreams(
                  fresh,
                  this.state.settings,
                  this.requestContext(type, id),
                ).kept.length
              : 0;
          } catch {
            found = fresh.length;
          }
          this.onLateSources?.({ type, id, found, failed });
        });
    }
    const failures = [];
    const late = [];
    const results = [];
    for (const addon of run.addons) {
      const answer = run.answers.get(addon.transportUrl);
      if (answer === undefined) late.push(addon.manifest.name);
      else if (answer === null) failures.push(addon.manifest.name);
      else results.push(answer);
    }
    const seen = new Set();
    const unique = [];
    for (const stream of results.flat()) {
      const identity = streamIdentity(stream);
      if (seen.has(identity)) continue;
      seen.add(identity);
      unique.push({ stream, identity });
    }
    const analysis = analyzeStreams(
      unique.map((entry) => entry.stream),
      this.state.settings,
      this.requestContext(type, id),
    );
    const ranked = analysis.kept.map((entry) => {
      const { stream, parsed } = entry;
      const key = keyFor(unique[entry.index].identity);
      // Bounded: a long session lists many titles. Every list re-sets its
      // own keys, so the sources on screen and the one playing stay.
      boundedSet(this.streams, key, { ...stream, type, videoId: id }, 4000);
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
        addonId: stream.addonId,
        addonKey: stream.addonKey,
        // Its place in the replies as the addons sent them, for addon order.
        order: entry.index,
      };
    });
    // What a played source is remembered by, kept beside its link in main.
    for (const r of ranked) {
      const raw = this.streams.get(r.key);
      if (raw) raw.memory = sourceIdentity(r);
    }
    // The viewer's source mode, saved filter and order, then their badges.
    const settings = this.state.settings;
    const prefs = applyStreamPrefs(
      ranked,
      settings,
      this.enabled().map((a) => ({
        id: a.manifest.id,
        key: keyFor(a.transportUrl),
      })),
    );
    // The source this series was last watched from comes first (inside the
    // filter), so the next episode keeps the same release.
    const series = this.seriesOf(type, id, seriesId);
    const remembered = preferRemembered(
      prefs.streams,
      this.seriesChoice(series)?.source,
    );
    // Badge matching gets a time budget so no stream title can hold up the
    // picker.
    const rules = cleanBadgeRules(settings.badgeRules);
    const badgeDeadline = Date.now() + 1500;
    // The viewer's own copies on their home servers come first.
    const home = (
      await this.services.homeStreams({ type, id }).catch(() => [])
    ).map((copy) => {
      const key = keyFor(`home|${copy.server.id}|${copy.itemId}`);
      boundedSet(
        this.streams,
        key,
        { url: copy.url, type, videoId: id, home: true },
        4000,
      );
      const resolution = Number.parseInt(copy.label.resolution) || 0;
      return {
        key,
        name: copy.server.name,
        title: `نسختك على ${copy.server.name}${copy.label.container ? ` · ${copy.label.container}` : ""}`,
        provider: copy.server.name,
        tier:
          resolution >= 2160
            ? "4K"
            : resolution >= 1080
              ? "1080p"
              : resolution >= 720
                ? "720p"
                : "SD",
        score: 1000,
        reasons: [
          { code: "home", label: "نسختك على خادمك المنزلي", points: 1000 },
        ],
        resolution,
        resolutionLabel: copy.label.resolution || "",
        codec: copy.label.codec,
        size: copy.label.size || null,
        sizeLabel: sizeLabel(copy.label.size || 0),
        home: true,
        supported: true,
        matches: true,
        badges: [{ label: "نسختك", color: "#4ADE80" }],
      };
    });
    const streams = [
      ...home,
      ...remembered.streams.map((s) => {
        const badges = ruleBadges(s, rules, badgeDeadline);
        return badges.length ? { ...s, badges } : s;
      }),
    ];
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
      late,
      providers: run.addons.length,
      safety: analysis.safety,
      mode: prefs.mode,
      modeFallback: prefs.modeFallback,
      filter: prefs.filter,
      order: settings.streamOrder === "addon" ? "addon" : "riwaq",
      remembered: remembered.remembered,
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
    // Addons use the release filename to match the cut, not just the title.
    // Never derive it from a signed playback URL or forward a local directory.
    const filename = selected?.behaviorHints?.filename;
    if (
      typeof filename === "string" &&
      filename.length <= 512 &&
      !/[\u0000-\u001f\u007f]|^[a-z][a-z\d+.-]*:\/\//i.test(filename.trim())
    ) {
      const basename = filename.trim().split(/[\\/]/).at(-1);
      if (basename && basename !== "." && basename !== "..")
        extras.filename = basename;
    }
    const providers = this.enabled().filter((a) =>
      accepts(a.manifest, "subtitles", type, id),
    );
    let answered = 0;
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
          answered++;
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
        boundedSet(this.subtitles, key, s.url, 3000);
        boundedSet(
          this.subtitleInfo,
          key,
          { lang: s.lang || "und", label },
          3000,
        );
        return {
          key,
          lang: s.lang || "und",
          label,
          provider: String(s.provider || "").slice(0, 60),
          format: subtitleFormat(s.url),
        };
      });
    // A list is kept for ten minutes only when some addon answered: when
    // every one failed (a cold start, a network blip), the next ask retries.
    if (answered > 0 || !providers.length) {
      if (this.subtitleLists.size > 20)
        this.subtitleLists.delete(this.subtitleLists.keys().next().value);
      this.subtitleLists.set(cacheKey, { at: Date.now(), list });
    }
    return list;
  }

  configureUrl(key) {
    const url = webUrl(this.addon(key).transportUrl);
    url.pathname = url.pathname.replace(/\/manifest\.json$/, "/configure");
    return url.toString();
  }
}
