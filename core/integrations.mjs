import { keyFor, validateManifest, mergeAddons } from "./protocol.mjs";

const POST = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  redirect: "error",
});
const poster = (id) =>
  /^tt\d+$/.test(id || "")
    ? `https://images.metahub.space/poster/medium/${id}/img`
    : undefined;
function metaFrom(item, type) {
  const m = item.movie || item.show || item.anime || item;
  if (!/^tt\d+$/.test(m.ids?.imdb || "")) return null;
  return {
    id: m.ids.imdb,
    type,
    name: m.title || m.name,
    releaseInfo: String(m.year || ""),
    poster: poster(m.ids.imdb),
  };
}
/** A /sync/history body for one movie or episode, or null for other ids. */
export function historyBody(
  meta,
  videoId,
  watched_at = new Date().toISOString(),
) {
  if (!/^tt\d+$/.test(meta?.id || "")) return null;
  if (meta.type === "movie")
    return { movies: [{ ids: { imdb: meta.id }, watched_at }] };
  const match = String(videoId).match(/^tt\d+:(\d+):(\d+)$/);
  if (!match) return null;
  return {
    shows: [
      {
        ids: { imdb: meta.id },
        seasons: [
          {
            number: Number(match[1]),
            episodes: [{ number: Number(match[2]), watched_at }],
          },
        ],
      },
    ],
  };
}
/** A /scrobble body: movie, or show plus season/episode, with percent progress. */
export function scrobbleBody(meta, videoId, progress) {
  if (!/^tt\d+$/.test(meta?.id || "")) return null;
  const percent =
    Math.round(Math.min(100, Math.max(0, Number(progress) || 0)) * 100) / 100;
  if (meta.type === "movie")
    return { movie: { ids: { imdb: meta.id } }, progress: percent };
  const match = String(videoId).match(/^tt\d+:(\d+):(\d+)$/);
  if (!match) return null;
  return {
    show: { ids: { imdb: meta.id } },
    episode: { season: Number(match[1]), number: Number(match[2]) },
    progress: percent,
  };
}
// Trakt records a play when a stop arrives at or above this percentage.
export const SCROBBLE_WATCHED = 80;
// A write-ahead history entry is held while its scrobble is in flight. A hold
// older than this belonged to a session that never answered, so it is sent.
const HOLD_MS = 60000;
export function parseCsv(text) {
  if (typeof text !== "string" || text.length > 5_000_000)
    throw new Error("ملف CSV كبير جداً");
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("ملف CSV غير مكتمل");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift() || [];
  if (!headers.includes("Name"))
    throw new Error(
      "اختر ملف watchlist.csv أو watched.csv أو diary.csv من تصدير Letterboxd",
    );
  return rows.map((r) =>
    Object.fromEntries(headers.map((h, i) => [h, r[i] || ""])),
  );
}
export class Integrations {
  constructor(client) {
    this.client = client;
    this.devices = new Map();
    this.refreshing = null;
    this.flushing = null;
    this.session = null;
    this.inflight = new Set();
  }
  publicState() {
    return ["trakt", "letterboxd", "simkl"].map((id) => {
      const s = this.client.state.integrations?.[id] || {};
      return {
        id,
        configured: !!(s.clientId || s.username),
        hasSecret: !!s.clientSecret,
        connected: !!(s.token?.access_token || s.addonKey),
        username: s.username || "",
        lastSync: s.lastSync || null,
        trackHistory: !!s.trackHistory,
        scrobble: !!s.scrobble,
        pending: (s.pending || []).length,
      };
    });
  }
  get(id) {
    if (!["trakt", "letterboxd", "simkl"].includes(id))
      throw new Error("منصة غير معروفة");
    return ((this.client.state.integrations ||= {})[id] ||= {});
  }
  save({ id, clientId, clientSecret, username, trackHistory, scrobble }) {
    let s = this.get(id);
    for (const value of [clientId, clientSecret])
      if (
        value !== undefined &&
        (typeof value !== "string" ||
          value.length > 4096 ||
          /[\r\n]/.test(value))
      )
        throw new Error("بيانات التطبيق غير صالحة");
    if (username !== undefined && !/^[\w-]{1,50}$/.test(username))
      throw new Error("اسم المستخدم غير صالح");
    const changed =
      (clientId?.trim() && s.clientId !== clientId.trim()) ||
      (clientSecret?.trim() && s.clientSecret !== clientSecret.trim()) ||
      (username && s.username !== username);
    if (changed) {
      const saved = { clientId: s.clientId, clientSecret: s.clientSecret };
      this.disconnect(id);
      s = this.get(id);
      Object.assign(s, saved);
    }
    if (clientId?.trim()) s.clientId = clientId.trim();
    if (clientSecret?.trim()) s.clientSecret = clientSecret.trim();
    if (username) s.username = username;
    if (id === "trakt" && typeof trackHistory === "boolean") {
      s.trackHistory = trackHistory;
      if (!trackHistory) {
        s.pending = [];
        s.scrobble = false;
        this.session = null;
      }
    }
    // Live scrobbling is a mode of history tracking, never a way around it.
    if (id === "trakt" && typeof scrobble === "boolean") {
      s.scrobble = scrobble && !!s.trackHistory;
      if (!s.scrobble) this.session = null;
    }
    this.client.persist();
    return this.client.publicState();
  }
  disconnect(id) {
    const s = this.get(id);
    this.devices.delete(id);
    if (id === "trakt") {
      this.session = null;
      // Disconnecting forgets the account's suggestions too.
      this.suggestions?.clear();
    }
    if (s.addonKey)
      this.client.state.addons = this.client.state.addons.filter(
        (a) => keyFor(a.transportUrl) !== s.addonKey,
      );
    delete this.client.state.integrations[id];
    this.client.state.connectedLists = (
      this.client.state.connectedLists || []
    ).filter((l) => l.service !== id);
    this.client.cache.clear();
    this.client.persist();
    return this.client.publicState();
  }
  async begin(id = "trakt") {
    if (!["trakt", "simkl"].includes(id)) throw new Error("المنصة غير مدعومة");
    const s = this.get(id);
    if (!s.clientId || (id === "trakt" && !s.clientSecret))
      throw new Error("احفظ بيانات تطبيق المنصة أولاً");
    const data =
      id === "trakt"
        ? await this.client.request(
            "https://auth.trakt.tv/oauth/device/code",
            POST({ client_id: s.clientId }),
          )
        : await this.simkl("/oauth/pin", false);
    if (!data.user_code) throw new Error("تعذّر الحصول على رمز الربط");
    const interval = Math.max(5, Number(data.interval) || 5);
    this.devices.set(id, {
      ...data,
      session: s,
      interval,
      expires:
        Date.now() + Math.min(Number(data.expires_in) || 600, 1800) * 1000,
      next: Date.now() + interval * 1000,
    });
    return {
      id,
      code: data.user_code,
      interval,
      url:
        id === "trakt"
          ? "https://auth.trakt.tv/activate"
          : "https://simkl.com/pin/",
      expiresIn: data.expires_in || 600,
    };
  }
  async poll(id = "trakt") {
    const d = this.devices.get(id),
      s = this.get(id);
    if (!d || d.session !== s || Date.now() > d.expires) {
      this.devices.delete(id);
      throw new Error("انتهت صلاحية رمز الربط. ابدأ من جديد.");
    }
    if (d.busy || Date.now() < d.next)
      return { pending: true, interval: d.interval };
    d.busy = true;
    d.next = Date.now() + d.interval * 1000;
    try {
      const token =
        id === "trakt"
          ? await this.client.request(
              "https://auth.trakt.tv/oauth/device/token",
              POST({
                code: d.device_code,
                client_id: s.clientId,
                client_secret: s.clientSecret,
              }),
            )
          : await this.simkl(
              `/oauth/pin/${encodeURIComponent(d.user_code)}`,
              false,
            );
      if (!token.access_token) return { pending: true, interval: d.interval };
      if (this.get(id) !== s || this.devices.get(id) !== d)
        return { cancelled: true };
      s.token = {
        ...token,
        created_at: token.created_at || Math.floor(Date.now() / 1000),
      };
      this.devices.delete(id);
      this.client.persist();
      return { connected: true, state: this.client.publicState() };
    } catch (error) {
      if (error.message === "HTTP 400")
        return { pending: true, interval: d.interval };
      if (error.message === "HTTP 429") {
        d.interval += 5;
        d.next = Date.now() + d.interval * 1000;
        return { pending: true, interval: d.interval };
      }
      this.devices.delete(id);
      throw new Error("تعذّر الربط أو تم رفضه. ابدأ من جديد.");
    } finally {
      d.busy = false;
    }
  }
  async trakt(path, body, method) {
    const s = this.get("trakt");
    if (!s.token) throw new Error("اربط حساب Trakt أولاً");
    if (
      s.token.expires_in &&
      (s.token.created_at + s.token.expires_in) * 1000 < Date.now() + 60000
    ) {
      if (!this.refreshing)
        this.refreshing = (async () => {
          const token = await this.client.request(
            "https://auth.trakt.tv/oauth/token",
            POST({
              refresh_token: s.token.refresh_token,
              client_id: s.clientId,
              client_secret: s.clientSecret,
              redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
              grant_type: "refresh_token",
            }),
          );
          if (!token.access_token || !token.refresh_token)
            throw new Error("أعد ربط Trakt");
          if (this.get("trakt") !== s)
            throw new Error("تغير الحساب أثناء الطلب");
          s.token = {
            ...token,
            created_at: token.created_at || Math.floor(Date.now() / 1000),
          };
          this.client.persist();
        })().finally(() => {
          this.refreshing = null;
        });
      await this.refreshing;
    }
    const options =
      method === "DELETE"
        ? { method: "DELETE", redirect: "error" }
        : body
          ? POST(body)
          : { redirect: "error" };
    return this.client.request("https://api.trakt.tv" + path, {
      ...options,
      headers: {
        ...options.headers,
        "trakt-api-version": "2",
        "trakt-api-key": s.clientId,
        Authorization: `Bearer ${s.token.access_token}`,
      },
    });
  }
  /**
   * Trakt's suggestions for the signed-in viewer, films or series. Read
   * only, never sent anywhere, and kept for 30 minutes per account. Titles
   * without an IMDb ID are dropped, since addons open titles by it.
   */
  async recommendations(kind = "movies", { force = false } = {}) {
    if (!["movies", "shows"].includes(kind))
      throw new Error("نوع الاقتراحات غير معروف");
    const s = this.get("trakt");
    if (!s.token?.access_token) return { connected: false, metas: [] };
    const cache = (this.suggestions ||= new Map());
    const key = `${s.username || ""}:${kind}`;
    const hit = cache.get(key);
    if (!force && hit && Date.now() - hit.at < 1800000) return hit.value;
    const result = await this.trakt(
      `/recommendations/${kind}?ignore_collected=true&ignore_watchlisted=false&limit=40`,
    );
    // A reply may only fill the account that asked for it.
    if (this.get("trakt") !== s) throw new Error("تغير الحساب أثناء الطلب");
    if (!Array.isArray(result)) throw new Error("استجابة Trakt غير صالحة");
    const type = kind === "movies" ? "movie" : "series";
    const value = {
      connected: true,
      username: s.username || "",
      metas: this.client.adultFilter(
        result.map((e) => metaFrom(e, type)).filter(Boolean),
      ),
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  }
  /** "Not interested": Trakt stops suggesting the title to this account. */
  async hideRecommendation(kind, id) {
    if (!["movies", "shows"].includes(kind) || !/^tt\d{5,12}$/.test(id || ""))
      throw new Error("العنوان غير صالح");
    const s = this.get("trakt");
    if (!s.token?.access_token) throw new Error("اربط حساب Trakt أولاً");
    await this.trakt(`/recommendations/${kind}/${id}`, null, "DELETE");
    if (this.get("trakt") !== s) throw new Error("تغير الحساب أثناء الطلب");
    const hit = this.suggestions?.get(`${s.username || ""}:${kind}`);
    if (hit)
      hit.value = {
        ...hit.value,
        metas: hit.value.metas.filter((m) => m.id !== id),
      };
    return true;
  }
  async simkl(path, authed = true) {
    const s = this.get("simkl");
    if (authed && !s.token) throw new Error("اربط حساب Simkl أولاً");
    const url = new URL(path, "https://api.simkl.com");
    url.searchParams.set("client_id", s.clientId);
    return this.client.request(url.toString(), {
      redirect: "error",
      headers: {
        "simkl-api-key": s.clientId,
        ...(authed ? { Authorization: `Bearer ${s.token.access_token}` } : {}),
      },
    });
  }
  async sync(id) {
    const s = this.get(id);
    let lists = [];
    if (id === "letterboxd") {
      if (!s.username) throw new Error("أدخل اسم مستخدم Letterboxd");
      const config = Buffer.from(
        JSON.stringify({
          u: s.username,
          c: {
            watchlist: true,
            popular: false,
            top250: false,
            likedFilms: true,
          },
          l: [],
          r: false,
        }),
      ).toString("base64url");
      const url = `https://api.stremboxd.com/${config}/manifest.json`;
      const manifest = validateManifest(await this.client.request(url));
      if (this.get(id) !== s) throw new Error("تغير الحساب أثناء المزامنة");
      this.client.state.addons = mergeAddons(this.client.state.addons, [
        { transportUrl: url, manifest },
      ]);
      this.client.cache.clear();
      s.addonKey = keyFor(url);
    } else if (id === "trakt") {
      const profile = await this.trakt("/users/settings");
      s.username = profile.user?.username || profile.user?.name || "Trakt";
      for (const kind of ["movies", "shows"]) {
        let entries = [];
        for (let page = 1; page <= 10; page++) {
          const result = await this.trakt(
            `/sync/watchlist/${kind}?page=${page}&limit=100`,
          );
          if (!Array.isArray(result))
            throw new Error("استجابة مكتبة Trakt غير صالحة");
          entries.push(...result);
          if (result.length < 100) break;
        }
        lists.push({
          key: `trakt-${kind}`,
          service: id,
          name: `Trakt · ${kind === "movies" ? "أفلام للمشاهدة" : "مسلسلات للمشاهدة"}`,
          metas: entries
            .map((e) => metaFrom(e, kind === "movies" ? "movie" : "series"))
            .filter(Boolean),
        });
      }
      await this.flushHistory().catch(() => {});
    } else if (id === "simkl") {
      const result = await this.simkl(
        "/sync/all-items/all/plantowatch?extended=full",
      );
      for (const kind of ["movies", "shows", "anime"])
        lists.push({
          key: `simkl-${kind}`,
          service: id,
          name: `Simkl · ${kind === "movies" ? "أفلام" : kind === "shows" ? "مسلسلات" : "أنمي"}`,
          metas: (result[kind] || [])
            .map((e) => metaFrom(e, kind === "movies" ? "movie" : "series"))
            .filter(Boolean),
        });
    }
    if (this.get(id) !== s) throw new Error("تغير الحساب أثناء المزامنة");
    this.client.state.connectedLists = [
      ...(this.client.state.connectedLists || []).filter(
        (l) => l.service !== id,
      ),
      ...lists,
    ];
    s.lastSync = Date.now();
    this.client.persist();
    return this.client.publicState();
  }
  queueHistory(meta, videoId, position, duration) {
    const s = this.get("trakt");
    if (
      !s.token ||
      !s.trackHistory ||
      duration < 30 ||
      position / duration < 0.9 ||
      !/^tt\d+$/.test(meta.id)
    )
      return;
    // In scrobble mode the stop event records the play. Queuing it here too
    // would give the viewer two plays for one viewing.
    if (s.scrobble) return;
    const body = historyBody(meta, videoId);
    if (body) this.enqueueHistory(`${meta.type}:${videoId}`, body);
  }
  enqueueHistory(key, body, { hold = false, flush = true } = {}) {
    const s = this.get("trakt");
    if (s.sent?.includes(key) || s.pending?.some((e) => e.key === key))
      return null;
    const entry = { key, body };
    if (hold) entry.heldAt = Date.now();
    s.pending = [...(s.pending || []), entry].slice(-500);
    this.client.persist();
    if (flush) this.flushHistory().catch(() => {});
    return entry;
  }
  /**
   * Follows the player and turns its state into scrobble start, pause and
   * stop. Called on every player update, so it only acts on transitions.
   */
  observePlayback(player) {
    // Read, never create: this runs on every player frame.
    const s = this.client.state.integrations?.trakt;
    if (!s?.token || !s.trackHistory || !s.scrobble) {
      this.session = null;
      return;
    }
    const meta = player?.meta;
    const eligible =
      !!meta &&
      !player.live &&
      ["movie", "series"].includes(meta.type) &&
      !!scrobbleBody(meta, player.videoId, 0);
    const key = eligible ? `${meta.type}:${player.videoId}` : null;
    const progress =
      player?.duration > 0 ? (player.position / player.duration) * 100 : 0;
    if (this.session && this.session.key !== key) {
      if (this.session.state === "playing" || this.session.state === "paused")
        this.sendScrobble("stop", { ...this.session });
      this.session = null;
    }
    if (!key) return;
    if (!this.session)
      this.session = {
        key,
        meta,
        videoId: player.videoId,
        state: "idle",
        progress: 0,
      };
    // The player keeps its last position when it stops, and that final frame
    // is the one that says how far the viewer got. Skipping to the end and
    // closing straight away must still count as watched.
    if (player.duration > 0) this.session.progress = progress;
    const want = !player.active
      ? "stopped"
      : player.loading || !(player.duration > 0)
        ? null
        : player.pause
          ? "paused"
          : "playing";
    if (!want || want === this.session.state) return;
    if (want === "stopped" && this.session.state === "idle") {
      // Playback that never started has nothing to stop.
      this.session.state = "stopped";
      return;
    }
    if (want === "paused" && this.session.state === "idle") return;
    this.session.state = want;
    this.sendScrobble(
      want === "playing" ? "start" : want === "paused" ? "pause" : "stop",
      { ...this.session },
    );
  }
  sendScrobble(event, session) {
    const body = scrobbleBody(session.meta, session.videoId, session.progress);
    if (!body) return Promise.resolve();
    // History is account-scoped. A reply that arrives after the viewer
    // disconnected or switched Trakt accounts must not write into the new one.
    const account = this.client.state.integrations?.trakt;
    const watched = event === "stop" && session.progress >= SCROBBLE_WATCHED;
    // Write ahead: a play Trakt should record is queued before the request,
    // held so the history queue does not send it too. If the request never
    // lands, the hold lapses and the queue delivers it later.
    const entry = watched
      ? this.enqueueHistory(
          session.key,
          historyBody(session.meta, session.videoId),
          {
            hold: true,
            flush: false,
          },
        )
      : null;
    const settle = (recorded) => {
      const s = this.client.state.integrations?.trakt;
      if (!s || s !== account) return;
      if (recorded) {
        s.pending = (s.pending || []).filter((e) => e !== entry);
        if (!s.sent?.includes(session.key))
          s.sent = [...(s.sent || []), session.key].slice(-5000);
        this.client.persist();
      } else if (entry) {
        delete entry.heldAt;
        this.client.persist();
        this.flushHistory().catch(() => {});
      }
    };
    const job = this.trakt(`/scrobble/${event}`, body).then(
      () => watched && settle(true),
      // 409 means Trakt already recorded this play moments ago.
      (error) => watched && settle(error.message === "HTTP 409"),
    );
    this.inflight.add(job);
    job.finally(() => this.inflight.delete(job));
    return job;
  }
  /** Lets in-flight scrobbles finish before the app quits, within a limit. */
  async settle(timeout = 3000) {
    if (!this.inflight.size) return;
    let timer;
    await Promise.race([
      Promise.allSettled([...this.inflight]),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeout);
      }),
    ]);
    clearTimeout(timer);
  }
  async flushHistory() {
    if (this.flushing) return this.flushing;
    const s = this.get("trakt");
    if (!s.trackHistory || !s.token) return;
    this.flushing = (async () => {
      for (const entry of [...(s.pending || [])]) {
        if (this.get("trakt") !== s || !s.trackHistory) break;
        if (entry.heldAt && Date.now() - entry.heldAt < HOLD_MS) continue;
        const result = await this.trakt("/sync/history", entry.body);
        if (!(result.added?.movies || result.added?.episodes)) break;
        s.pending = s.pending.filter((e) => e !== entry);
        s.sent = [...(s.sent || []), entry.key].slice(-5000);
        this.client.persist();
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }
  async importLetterboxd(text) {
    if (!this.client.state.providers?.tmdb?.key)
      throw new Error("أضف مفتاح TMDB لمطابقة أسماء الأفلام بدقة");
    const rows = parseCsv(text),
      metas = [];
    let unmatched = 0;
    for (const row of rows.slice(0, 500)) {
      let meta = null;
      try {
        meta = await this.client.dataHub.resolve(row.Name, row.Year);
      } catch {}
      if (meta) metas.push(meta);
      else unmatched++;
    }
    const unique = [...new Map(metas.map((m) => [m.id, m])).values()];
    this.client.state.connectedLists = [
      ...(this.client.state.connectedLists || []).filter(
        (l) => l.key !== "letterboxd-csv",
      ),
      {
        key: "letterboxd-csv",
        service: "letterboxd",
        name: "Letterboxd · قائمة مستوردة",
        metas: unique,
      },
    ];
    this.client.persist();
    return {
      state: this.client.publicState(),
      count: unique.length,
      unmatched,
      remaining: Math.max(0, rows.length - 500),
    };
  }
}
