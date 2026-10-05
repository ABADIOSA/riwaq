/**
 * Spotify, linked with the viewer's own Client ID (Authorization Code with
 * PKCE: no client secret, no password typed into Riwaq). Riwaq then acts
 * as the player: it shows what is playing, controls it, plays the viewer's
 * playlists and saved links, and moves playback between their devices
 * (Spotify Connect). The audio itself comes from a Spotify app on one of
 * the viewer's devices, as Spotify requires; control needs Premium, which
 * is Spotify's rule. Tokens live in the encrypted state
 * (`integrations.spotify`), never in `publicState`, and leave in a backup
 * only when the viewer includes secrets. Main only (node:crypto).
 */
import { createHash, randomBytes } from "node:crypto";

export const SPOTIFY_PORT = 47811;
export const SPOTIFY_REDIRECT = `http://127.0.0.1:${SPOTIFY_PORT}/callback`;
export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
];
const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";
const URI =
  /^spotify:(track|album|playlist|artist|show|episode):[A-Za-z0-9]{10,40}$/;
const DEVICE = /^[A-Za-z0-9]{10,80}$/;
const IMAGE_HOSTS = [/\.scdn\.co$/, /\.spotifycdn\.com$/];

/** A Spotify Client ID: 32 hexadecimal characters, or "". */
export const cleanClientId = (value) =>
  typeof value === "string" && /^[0-9a-f]{32}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : "";
export const spotifyUriOk = (uri) => typeof uri === "string" && URI.test(uri);

/** The PKCE verifier and its S256 challenge. */
export function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl({ clientId, challenge, state }) {
  return `${ACCOUNTS}/authorize?${new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: SPOTIFY_REDIRECT,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES.join(" "),
    state,
  })}`;
}

const imageOf = (images) => {
  for (const img of Array.isArray(images) ? images : []) {
    try {
      const url = new URL(img?.url);
      if (
        url.protocol === "https:" &&
        IMAGE_HOSTS.some((h) => h.test(url.hostname))
      )
        return url.toString();
    } catch {}
  }
  return "";
};
const text = (v, max = 200) => String(v ?? "").slice(0, max);

/** What is playing, for the interface: names, picture, times, device. */
export function playbackView(body) {
  if (!body || typeof body !== "object") return null;
  const item = body.item;
  const device = body.device || {};
  return {
    playing: !!body.is_playing,
    shuffle: !!body.shuffle_state,
    progress: Number(body.progress_ms) || 0,
    duration: Number(item?.duration_ms) || 0,
    track: item
      ? {
          name: text(item.name),
          // A song names its artists; a podcast episode, its show.
          artists: (Array.isArray(item.artists)
            ? item.artists.map((a) => text(a?.name, 100))
            : item.show
              ? [text(item.show.name, 100)]
              : []
          ).slice(0, 4),
          album: text(item.album?.name),
          image: imageOf(item.album?.images || item.images),
          uri: spotifyUriOk(item.uri) ? item.uri : "",
        }
      : null,
    device: {
      id: DEVICE.test(device.id || "") ? device.id : "",
      name: text(device.name, 80),
      type: text(device.type, 30),
      volume: Number.isFinite(device.volume_percent)
        ? device.volume_percent
        : null,
    },
  };
}

export function devicesView(body) {
  return (Array.isArray(body?.devices) ? body.devices : [])
    .filter((d) => DEVICE.test(d?.id || ""))
    .map((d) => ({
      id: d.id,
      name: text(d.name, 80),
      type: text(d.type, 30),
      active: !!d.is_active,
    }));
}

export function playlistsView(body) {
  return (Array.isArray(body?.items) ? body.items : [])
    .filter((p) => spotifyUriOk(p?.uri))
    .map((p) => ({
      uri: p.uri,
      name: text(p.name, 120),
      image: imageOf(p.images),
      tracks: Number(p.tracks?.total) || 0,
      owner: text(p.owner?.display_name, 80),
    }));
}

/** Spotify's answers as Arabic sentences; `status` and `reason` stay on the error. */
export function spotifyProblem(status, body = {}) {
  const reason = String(body?.error?.reason || body?.error || "");
  const message =
    reason === "PREMIUM_REQUIRED" ||
    (status === 403 && /premium/i.test(JSON.stringify(body)))
      ? "التحكم بالتشغيل يحتاج اشتراك Spotify Premium (شرط من Spotify)."
      : reason === "NO_ACTIVE_DEVICE" || status === 404
        ? "ما فيه جهاز Spotify شغّال. افتح تطبيق Spotify على جهازك، ثم جرّب."
        : status === 401 || reason === "invalid_grant"
          ? "انتهى ربط Spotify. اربطه من جديد من غرفة الموسيقى."
          : status === 429
            ? "Spotify طلب الانتظار قليلاً. جرّب بعد شوي."
            : status === 403
              ? "Spotify رفض الطلب. تأكد إن حسابك مضاف في تطبيقك على لوحة مطوري Spotify."
              : `تعذّر الوصول إلى Spotify (${status || "شبكة"}).`;
  const error = new Error(message);
  error.status = status;
  error.reason = reason;
  return error;
}

/** fetch with a timeout and no redirects: { status, data, headers }. */
export async function spotifyFetch(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {}
  return { status: response.status, data, headers: response.headers };
}

export class SpotifyHub {
  /**
   * `bag()` returns the mutable `integrations.spotify` object, `save()`
   * persists, `request` is spotifyFetch (replaced in tests).
   */
  constructor({ bag, save, request = spotifyFetch, now = () => Date.now() }) {
    this.bag = bag;
    this.save = save;
    this.request = request;
    this.now = now;
    this.refreshing = null;
  }
  publicState() {
    const s = this.bag();
    return {
      configured: !!s.clientId,
      connected: !!s.token?.refresh_token,
      name: text(s.name, 80),
      premium: s.product === "premium",
      redirect: SPOTIFY_REDIRECT,
    };
  }
  setClientId(value) {
    const clientId = cleanClientId(value);
    if (!clientId)
      throw new Error(
        "الـ Client ID من Spotify هو 32 حرفاً ورقماً (0-9 وa-f).",
      );
    const s = this.bag();
    if (s.clientId !== clientId) {
      delete s.token;
      delete s.name;
      delete s.product;
    }
    s.clientId = clientId;
    this.save();
    return clientId;
  }
  async tokenRequest(form) {
    const r = await this.request(`${ACCOUNTS}/api/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
    if (r.status !== 200 || !r.data?.access_token)
      throw spotifyProblem(r.status === 400 ? 401 : r.status, r.data);
    return r.data;
  }
  keep(data) {
    const s = this.bag();
    s.token = {
      access_token: String(data.access_token),
      // Spotify may rotate the refresh token; keep the new one when sent.
      refresh_token: String(data.refresh_token || s.token?.refresh_token || ""),
      expires_at: this.now() + (Number(data.expires_in) || 3600) * 1000,
    };
    this.save();
  }
  /** Finishes the sign-in: the code from the redirect, with the verifier. */
  async exchange(code, verifier) {
    const s = this.bag();
    if (!s.clientId) throw new Error("أدخل Client ID أولاً");
    this.keep(
      await this.tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: SPOTIFY_REDIRECT,
        client_id: s.clientId,
        code_verifier: verifier,
      }),
    );
    const me = await this.api("GET", "/me");
    s.name = text(me?.display_name || me?.id, 80);
    s.product = text(me?.product, 20);
    this.save();
    return this.publicState();
  }
  /** A live access token, refreshed once when it is about to expire. */
  async token() {
    const s = this.bag();
    if (!s.token?.refresh_token) throw spotifyProblem(401);
    if (s.token.access_token && s.token.expires_at - this.now() > 60000)
      return s.token.access_token;
    this.refreshing ||= this.tokenRequest({
      grant_type: "refresh_token",
      refresh_token: s.token.refresh_token,
      client_id: s.clientId,
    })
      .then((data) => {
        this.keep(data);
        return data.access_token;
      })
      .catch((error) => {
        // A refused refresh ends the link: credentials are removed.
        if (error.status === 401) this.disconnect();
        throw error;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }
  async api(method, path, { query, body, retried = false } = {}) {
    const token = await this.token();
    const url = `${API}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
    const r = await this.request(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (r.status === 401 && !retried) {
      this.bag().token.expires_at = 0;
      return this.api(method, path, { query, body, retried: true });
    }
    if (r.status === 204 || r.status === 202) return null;
    if (r.status < 200 || r.status >= 300)
      throw spotifyProblem(r.status, r.data);
    return r.data;
  }
  async playback() {
    return playbackView(await this.api("GET", "/me/player"));
  }
  async devices() {
    return devicesView(await this.api("GET", "/me/player/devices"));
  }
  async playlists() {
    return playlistsView(
      await this.api("GET", "/me/playlists", { query: { limit: "50" } }),
    );
  }
  /** Track search (any account), for a title's theme song. */
  async searchTracks(query) {
    const q = String(query || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, 120);
    if (!q) return null;
    return this.api("GET", "/search", {
      query: { q, type: "track", limit: "10" },
    });
  }
  /** play (optionally a URI), pause, next, previous, volume, shuffle, transfer. */
  async control({ action, uri, deviceId, volume, state } = {}) {
    const device =
      typeof deviceId === "string" && DEVICE.test(deviceId)
        ? { device_id: deviceId }
        : undefined;
    switch (action) {
      case "play": {
        if (uri !== undefined && !spotifyUriOk(uri))
          throw new Error("رابط Spotify غير صالح");
        const body = !uri
          ? undefined
          : /^spotify:(track|episode):/.test(uri)
            ? { uris: [uri] }
            : { context_uri: uri };
        return this.api("PUT", "/me/player/play", { query: device, body });
      }
      case "pause":
        return this.api("PUT", "/me/player/pause", { query: device });
      case "next":
        return this.api("POST", "/me/player/next", { query: device });
      case "previous":
        return this.api("POST", "/me/player/previous", { query: device });
      case "volume": {
        const v = Math.round(Number(volume));
        if (!(v >= 0 && v <= 100)) throw new Error("مستوى الصوت غير صالح");
        return this.api("PUT", "/me/player/volume", {
          query: { volume_percent: String(v), ...(device || {}) },
        });
      }
      case "shuffle":
        return this.api("PUT", "/me/player/shuffle", {
          query: { state: state ? "true" : "false", ...(device || {}) },
        });
      case "transfer":
        if (!device) throw new Error("اختر جهازاً");
        return this.api("PUT", "/me/player", {
          body: { device_ids: [device.device_id], play: true },
        });
      default:
        throw new Error("أمر غير معروف");
    }
  }
  /** Removes the link's credentials; the Client ID (not secret) stays. */
  disconnect() {
    const s = this.bag();
    delete s.token;
    delete s.name;
    delete s.product;
    this.save();
  }
}
