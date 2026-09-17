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
  rankStreams,
  safeSettings,
  webUrl,
} from "./protocol.mjs";
import { DataHub } from "./data-hub.mjs";
import { Integrations } from "./integrations.mjs";

export async function fetchJson(url, init = {}) {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(16000),
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
  constructor({ load, save, request = fetchJson, api = stremioCall }) {
    this.saveData = save;
    this.request = request;
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
    this.metas = new Map();
    this.cache = new Map();
    this.dataHub = new DataHub(this);
    this.integrations = new Integrations(this);
  }
  persist() {
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
      lastSync,
      providers: this.dataHub.publicState(),
      integrations: this.integrations.publicState(),
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
  async cached(url) {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < 180000) return cached.data;
    const data = await this.request(url);
    if (this.cache.size > 300)
      this.cache.delete(this.cache.keys().next().value);
    this.cache.set(url, { at: Date.now(), data });
    return data;
  }
  async catalog({
    type = "",
    search = "",
    genre = "",
    catalogKey = "",
    skip = 0,
  } = {}) {
    const tasks = this.enabled()
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
    const rows = [],
      failures = [];
    // Limit concurrent addon requests without truncating the user's addon list.
    for (let offset = 0; offset < tasks.length; offset += 8) {
      const batch = await Promise.all(
        tasks
          .slice(offset, offset + 8)
          .map(async ({ addon, cat, key, extras }) => {
            try {
              const data = await this.cached(
                resourceUrl(
                  addon.transportUrl,
                  "catalog",
                  cat.type,
                  cat.id,
                  extras,
                ),
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
                  (cat.extra || []).find((e) => e.name === "genre")?.options ||
                  [],
                hasMore:
                  (cat.extra || []).some((e) => e.name === "skip") &&
                  metas.length > 0,
              };
            } catch {
              failures.push(addon.manifest.name);
              return null;
            }
          }),
      );
      rows.push(...batch.filter(Boolean));
    }
    return { rows, failures: [...new Set(failures)] };
  }
  async metadata({ type, id }) {
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
  async getStreams({ type, id }) {
    const failures = [],
      streams = [];
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
            .map((s) => ({
              ...s,
              provider: addon.manifest.name,
            }));
        } catch {
          failures.push(addon.manifest.name);
          return [];
        }
      }),
    );
    const seen = new Set();
    for (const stream of rankStreams(results.flat(), this.state.settings)) {
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
      const key = keyFor(identity);
      this.streams.set(key, { ...stream, type, videoId: id });
      const supported = !!(
        (typeof stream.url === "string" && /^https?:\/\//i.test(stream.url)) ||
        (typeof stream.infoHash === "string" &&
          /^[a-f\d]{40}$/i.test(stream.infoHash)) ||
        (typeof stream.externalUrl === "string" &&
          /^https?:\/\//i.test(stream.externalUrl)) ||
        (typeof stream.ytId === "string" && !!stream.ytId)
      );
      streams.push({
        key,
        name: stream.name || stream.provider,
        title: stream.title || stream.description || "",
        provider: stream.provider,
        resolution: stream.resolution,
        hdr: stream.hdr,
        codec: stream.codec,
        cam: stream.cam,
        arabic: stream.arabic,
        torrent: !!stream.infoHash,
        external: !!(stream.externalUrl || stream.ytId),
        supported,
      });
    }
    return { streams, failures, providers: addons.length };
  }
  async getSubtitles({ type, id, streamKey }) {
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
          return (
            (
              await this.request(
                resourceUrl(a.transportUrl, "subtitles", type, id, extras),
              )
            ).subtitles || []
          );
        } catch {
          return [];
        }
      }),
    );
    return [...(selected?.subtitles || []), ...results.flat()]
      .filter((s) => typeof s?.url === "string" && /^https?:\/\//i.test(s.url))
      .map((s) => {
        const key = keyFor(s.url);
        this.subtitles.set(key, s.url);
        return {
          key,
          lang: s.lang || "und",
          name: s.id || s.lang || "Subtitle",
        };
      })
      .sort(
        (a, b) =>
          Number(/^(ar|ara)$/i.test(b.lang)) -
          Number(/^(ar|ara)$/i.test(a.lang)),
      );
  }
  configureUrl(key) {
    const url = webUrl(this.addon(key).transportUrl);
    url.pathname = url.pathname.replace(/\/manifest\.json$/, "/configure");
    return url.toString();
  }
}
