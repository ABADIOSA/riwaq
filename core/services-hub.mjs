import {
  DEBRID,
  cleanServices,
  debridRequest,
  parseDebridAccount,
  parseWatchProviders,
  serviceSources,
  watchProvidersRequest,
} from "./services.mjs";
import {
  HOME_SERVER_LIMIT,
  authHeader,
  cleanServers,
  copyLabel,
  episodesRequest,
  findEpisode,
  indexLibrary,
  libraryRequest,
  parseLogin,
  parsePublicInfo,
  publicServer,
  serverBase,
  streamUrl,
} from "./home-servers.mjs";
import {
  serverSummary,
  serverValues,
  updatedValues,
} from "./streaming-server.mjs";
import { interleave } from "./folder-view.mjs";

const INDEX_TTL = 30 * 60000;
const newId = () =>
  (globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random()}`)
    .replace(/[^\w-]/g, "")
    .slice(0, 32);

/**
 * Streaming services, debrid accounts, home servers and the torrent
 * streaming server, for the Sources & library pages. Keys and tokens live in
 * the client's encrypted state and never reach the interface.
 */
export class ServicesHub {
  constructor(client) {
    this.client = client;
    this.indexes = new Map();
    this.providerLists = new Map();
  }
  get state() {
    return this.client.state;
  }
  publicState() {
    const debrid = this.state.debrid || {};
    return {
      debrid: DEBRID.map((d) => {
        const s = debrid[d.id] || {};
        return {
          ...d,
          configured: !!s.key,
          status: s.status || (s.key ? "untested" : "off"),
          days: s.days ?? null,
          account: s.name || "",
          checkedAt: s.checkedAt || null,
        };
      }),
      homeServers: cleanServers(this.state.homeServers).map((s) => ({
        ...publicServer(s),
        ...(this.state.homeServerStatus?.[s.id] || {}),
      })),
    };
  }

  // --- Debrid accounts --------------------------------------------------
  debridSave({ id, key, clear = false }) {
    if (!DEBRID.some((d) => d.id === id)) throw new Error("خدمة غير معروفة");
    const store = (this.state.debrid ||= {});
    if (clear) delete store[id];
    else {
      if (
        typeof key !== "string" ||
        !key.trim() ||
        key.length > 512 ||
        /\s/.test(key.trim())
      )
        throw new Error("المفتاح غير صالح");
      store[id] = { key: key.trim(), status: "untested" };
    }
    this.client.persist();
    return this.client.publicState();
  }
  async debridCheck({ id }) {
    const entry = this.state.debrid?.[id];
    if (!entry?.key) throw new Error("احفظ المفتاح أولاً");
    const { url, headers } = debridRequest(id, entry.key);
    try {
      const body = await this.client.request(url, {
        headers,
        redirect: "error",
        timeout: 12000,
      });
      Object.assign(entry, parseDebridAccount(id, body));
    } catch (error) {
      entry.status = /HTTP (401|403)/.test(error.message)
        ? "rejected"
        : "error";
    }
    entry.checkedAt = Date.now();
    this.client.persist();
    return this.client.publicState();
  }

  // --- Streaming catalogs ------------------------------------------------
  region() {
    return /^[A-Z]{2}$/.test(this.state.settings.region || "")
      ? this.state.settings.region
      : "SA";
  }
  /** TMDB's streaming services for the viewer's region, cached for a day. */
  async watchProviders() {
    const region = this.region();
    const hit = this.providerLists.get(region);
    if (hit && Date.now() - hit.at < 86400000) return hit.list;
    const { path, params } = watchProvidersRequest(region);
    const list = parseWatchProviders(await this.client.tmdbCall(path, params));
    this.providerLists.set(region, { at: Date.now(), list });
    return list;
  }
  /** One home row per chosen service: its popular films and series. */
  async serviceRows() {
    const services = cleanServices(this.state.settings.streamingServices);
    if (!services.length) return { rows: [], needs: [] };
    const entry = this.state.providers?.tmdb;
    if (!entry?.key || entry.enabled === false)
      return { rows: [], needs: ["tmdb"] };
    const addons = this.client.enabled();
    const region = this.region();
    const rows = await Promise.all(
      services.map(async (service) => {
        const parts = await Promise.all(
          serviceSources(service, region).map((source) =>
            this.client
              .tmdbRow(source, addons)
              .catch(() => ({ metas: [], note: "failed" })),
          ),
        );
        return {
          key: `service-${service.id}`,
          name: service.name,
          logo: service.logo,
          metas: interleave(parts.map((p) => p.metas || [])).slice(0, 40),
          note: parts.every((p) => p.note === "failed") ? "failed" : "",
        };
      }),
    );
    return { rows, needs: [] };
  }

  // --- Home servers ------------------------------------------------------
  version() {
    return String(this.client.version || "0");
  }
  async homeServerAdd({ url, username, password }) {
    const servers = cleanServers(this.state.homeServers);
    if (servers.length >= HOME_SERVER_LIMIT)
      throw new Error("وصلت إلى الحد الأعلى من الخوادم");
    const base = serverBase(url);
    if (
      typeof username !== "string" ||
      !username.trim() ||
      username.length > 200
    )
      throw new Error("اكتب اسم المستخدم");
    if (typeof password !== "string" || password.length > 500)
      throw new Error("كلمة المرور غير صالحة");
    const info = parsePublicInfo(
      await this.client.request(`${base}/System/Info/Public`, {
        redirect: "error",
        timeout: 10000,
      }),
    );
    const deviceId = newId();
    const login = parseLogin(
      await this.client.request(`${base}/Users/AuthenticateByName`, {
        method: "POST",
        redirect: "error",
        timeout: 15000,
        headers: {
          "Content-Type": "application/json",
          "X-Emby-Authorization": authHeader({
            deviceId,
            version: this.version(),
          }),
        },
        body: JSON.stringify({ Username: username.trim(), Pw: password }),
      }),
    );
    // The password is not kept: only the token the server issued.
    const server = {
      id: newId(),
      kind: info.kind,
      url: base,
      name: info.name,
      userId: login.userId,
      userName: login.userName,
      token: login.token,
      deviceId,
      enabled: true,
    };
    this.state.homeServers = [...servers, server];
    this.client.persist();
    await this.homeServerCheck({ id: server.id }).catch(() => {});
    return this.client.publicState();
  }
  homeServerRemove({ id }) {
    this.state.homeServers = cleanServers(this.state.homeServers).filter(
      (s) => s.id !== id,
    );
    delete this.state.homeServerStatus?.[id];
    this.indexes.delete(id);
    this.client.persist();
    return this.client.publicState();
  }
  homeServerToggle({ id, enabled }) {
    this.state.homeServers = cleanServers(this.state.homeServers).map((s) =>
      s.id === id ? { ...s, enabled: enabled === true } : s,
    );
    this.client.persist();
    return this.client.publicState();
  }
  headersFor(server) {
    return {
      "X-Emby-Authorization": authHeader({
        deviceId: server.deviceId,
        version: this.version(),
        token: server.token,
      }),
      "X-Emby-Token": server.token,
    };
  }
  async index(server, force = false) {
    const hit = this.indexes.get(server.id);
    if (!force && hit && Date.now() - hit.at < INDEX_TTL) return hit.index;
    const items = [];
    for (let start = 0; start < 20000; start += 1000) {
      const body = await this.client.request(libraryRequest(server, start), {
        headers: this.headersFor(server),
        redirect: "error",
        timeout: 20000,
      });
      const page = Array.isArray(body?.Items) ? body.Items : [];
      items.push(...page);
      if (page.length < 1000) break;
    }
    const index = indexLibrary(items);
    this.indexes.set(server.id, { at: Date.now(), index });
    return index;
  }
  async homeServerCheck({ id }) {
    const server = cleanServers(this.state.homeServers).find(
      (s) => s.id === id,
    );
    if (!server) throw new Error("الخادم غير موجود");
    const status = ((this.state.homeServerStatus ||= {})[id] = {});
    try {
      const index = await this.index(server, true);
      status.status = "ok";
      status.items = index.size;
    } catch (error) {
      status.status = /HTTP 401/.test(error.message) ? "rejected" : "error";
    }
    status.checkedAt = Date.now();
    this.client.persist();
    return this.client.publicState();
  }
  /**
   * The viewer's own copies of a title, one per server that has it, as
   * stream entries for the picker. Films match by IMDb ID; an episode is
   * looked up in its season on the server.
   */
  async homeStreams({ type, id }) {
    const parts = String(id).split(":");
    const imdb = parts[0];
    if (!/^tt\d{5,12}$/.test(imdb)) return [];
    const servers = cleanServers(this.state.homeServers).filter(
      (s) => s.enabled,
    );
    const found = await Promise.all(
      servers.map(async (server) => {
        try {
          const index = await this.index(server);
          const item = index.get(
            `${type === "series" ? "series" : "movie"}:${imdb}`,
          );
          if (!item) return null;
          let itemId = item.id;
          let source = item.source;
          if (type === "series") {
            const season = Number(parts[1]);
            const episode = Number(parts[2]);
            if (!Number.isInteger(season) || !Number.isInteger(episode))
              return null;
            const body = await this.client.request(
              episodesRequest(server, item.id, season),
              {
                headers: this.headersFor(server),
                redirect: "error",
                timeout: 12000,
              },
            );
            const match = findEpisode(body, episode);
            if (!match) return null;
            itemId = match.Id;
            source = match.MediaSources?.[0] || null;
          }
          return { server, itemId, label: copyLabel(source) };
        } catch {
          return null;
        }
      }),
    );
    return found.filter(Boolean).map(({ server, itemId, label }) => ({
      server,
      itemId,
      label,
      url: streamUrl(server, itemId),
    }));
  }

  // --- The torrent streaming server --------------------------------------
  serverUrl() {
    return String(
      this.state.settings.serverUrl || "http://127.0.0.1:11470",
    ).replace(/\/+$/, "");
  }
  async streamServerInfo() {
    try {
      const body = await this.client.request(`${this.serverUrl()}/settings`, {
        timeout: 6000,
        redirect: "error",
      });
      const summary = serverSummary(serverValues(body));
      return summary ? { reachable: true, ...summary } : { reachable: false };
    } catch {
      return { reachable: false };
    }
  }
  async streamServerSave({ profile, cacheSize }) {
    const body = await this.client.request(`${this.serverUrl()}/settings`, {
      timeout: 6000,
      redirect: "error",
    });
    const values = serverValues(body);
    if (!values || !("cacheSize" in values))
      throw new Error("هذا الخادم لا يتيح تعديل إعداداته");
    const next = updatedValues(values, {
      ...(profile ? { profile } : {}),
      ...(cacheSize !== undefined ? { cacheSize } : {}),
    });
    try {
      await this.client.request(`${this.serverUrl()}/settings`, {
        method: "POST",
        timeout: 8000,
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      /* Some servers answer without JSON; the read below tells the truth. */
    }
    const info = await this.streamServerInfo();
    const applied =
      info.reachable &&
      (cacheSize === undefined || info.cacheSize === cacheSize) &&
      (!profile || info.profile === profile);
    if (!applied) throw new Error("لم يقبل الخادم التغيير");
    return info;
  }
}
