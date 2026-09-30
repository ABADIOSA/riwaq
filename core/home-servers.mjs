/**
 * Home servers (Harbor's "Home servers"): the viewer's own Jellyfin or Emby.
 *
 * Signing in sends the user name and password once and keeps only the access
 * token the server returns; the password is never stored. The token lives in
 * main with the server address. When the viewer picks a title, Riwaq looks
 * for the same film or episode on their server by its IMDb ID and offers it
 * at the top of the sources as "your copy". Its stream address carries the
 * token, so like every addon stream it stays in main behind an opaque key.
 *
 * Plex signs in through plex.tv and is not part of this module yet.
 * Pure builders and parsers; the client does the fetching.
 */

export const HOME_SERVER_LIMIT = 6;
const APP = "Riwaq";

/** The address a viewer typed, as an http(s) origin plus base path. */
export function serverBase(input) {
  let url;
  try {
    url = new URL(String(input || "").trim());
  } catch {
    throw new Error("اكتب عنوان الخادم كاملاً، مثل http://192.168.1.10:8096");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("استخدم عنوان http أو https بلا اسم مستخدم أو كلمة مرور");
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

/** The header Jellyfin and Emby expect from a client. */
export function authHeader({ deviceId, version, token = "" }) {
  const parts = [
    `Client="${APP}"`,
    `Device="Windows"`,
    `DeviceId="${deviceId}"`,
    `Version="${version}"`,
  ];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(", ")}`;
}

/** Which product answered, from its public info. */
export function parsePublicInfo(body) {
  const product = String(body?.ProductName || "");
  if (!body || typeof body !== "object" || !body.Id)
    throw new Error("هذا العنوان لا يبدو خادم Jellyfin أو Emby");
  return {
    kind: /emby/i.test(product) ? "emby" : "jellyfin",
    name: String(body.ServerName || product || "خادمي").slice(0, 60),
    version: String(body.Version || "").slice(0, 30),
    serverId: String(body.Id).slice(0, 64),
  };
}

/** A sign-in reply: the token and the user, nothing else is kept. */
export function parseLogin(body) {
  const token = body?.AccessToken;
  const userId = body?.User?.Id;
  if (typeof token !== "string" || !token || typeof userId !== "string")
    throw new Error("لم يقبل الخادم اسم المستخدم أو كلمة المرور");
  return {
    token,
    userId,
    userName: String(body.User.Name || "").slice(0, 60),
  };
}

/** Every film and series of the user, with the IDs Riwaq opens titles by. */
export function libraryRequest(server, start = 0) {
  const url = new URL(`${server.url}/Users/${server.userId}/Items`);
  url.searchParams.set("Recursive", "true");
  url.searchParams.set("IncludeItemTypes", "Movie,Series");
  url.searchParams.set("Fields", "ProviderIds,ProductionYear,MediaSources");
  url.searchParams.set("StartIndex", String(start));
  url.searchParams.set("Limit", "1000");
  return url.toString();
}

const imdbOf = (item) => {
  const ids = item?.ProviderIds || {};
  const imdb = ids.Imdb || ids.IMDB || ids.imdb;
  return /^tt\d{5,12}$/.test(imdb || "") ? imdb : "";
};

/** An index from IMDb ID to the item on the server. */
export function indexLibrary(items) {
  const index = new Map();
  for (const item of items || []) {
    const imdb = imdbOf(item);
    if (!imdb || typeof item.Id !== "string") continue;
    const type = item.Type === "Series" ? "series" : "movie";
    if (!index.has(`${type}:${imdb}`))
      index.set(`${type}:${imdb}`, {
        id: item.Id,
        name: String(item.Name || "").slice(0, 120),
        year: item.ProductionYear || null,
        source: item.MediaSources?.[0] || null,
      });
  }
  return index;
}

/** One season's episodes of a series on the server. */
export function episodesRequest(server, seriesId, season) {
  const url = new URL(`${server.url}/Shows/${seriesId}/Episodes`);
  url.searchParams.set("UserId", server.userId);
  url.searchParams.set("Season", String(season));
  url.searchParams.set("Fields", "MediaSources");
  return url.toString();
}
export function findEpisode(body, episode) {
  return (
    (Array.isArray(body?.Items) ? body.Items : []).find(
      (e) => e?.IndexNumber === episode && typeof e.Id === "string",
    ) || null
  );
}

/** The file as it is, streamed straight from the server. */
export function streamUrl(server, itemId) {
  const url = new URL(`${server.url}/Videos/${itemId}/stream`);
  url.searchParams.set("static", "true");
  url.searchParams.set("api_key", server.token);
  return url.toString();
}

/** A label for the copy the server holds. */
export function copyLabel(source) {
  const video = (source?.MediaStreams || []).find((s) => s?.Type === "Video");
  const height = Number(video?.Height) || 0;
  const resolution =
    height >= 2000
      ? "2160p"
      : height >= 1000
        ? "1080p"
        : height >= 700
          ? "720p"
          : "";
  const size = Number(source?.Size) || 0;
  return {
    resolution,
    codec: String(video?.Codec || "")
      .toUpperCase()
      .slice(0, 12),
    container: String(source?.Container || "").slice(0, 12),
    size,
  };
}

/** The viewer's servers, as stored in main: validated, secrets included. */
export function cleanServers(input) {
  const out = [];
  for (const s of Array.isArray(input) ? input : []) {
    try {
      const url = serverBase(s?.url);
      if (
        !/^[\w-]{1,64}$/.test(s?.id || "") ||
        typeof s.token !== "string" ||
        !s.token ||
        s.token.length > 512 ||
        typeof s.userId !== "string" ||
        !/^[\w-]{1,64}$/.test(s.userId) ||
        out.some((x) => x.id === s.id)
      )
        continue;
      out.push({
        id: s.id,
        kind: s.kind === "emby" ? "emby" : "jellyfin",
        url,
        name: String(s.name || "").slice(0, 60) || "خادمي",
        userId: s.userId,
        userName: String(s.userName || "").slice(0, 60),
        token: s.token,
        deviceId: /^[\w-]{1,64}$/.test(s.deviceId || "") ? s.deviceId : s.id,
        enabled: s.enabled !== false,
      });
    } catch {
      /* A malformed server is dropped. */
    }
    if (out.length >= HOME_SERVER_LIMIT) break;
  }
  return out;
}

/** What the interface may see of a server: never its token. */
export function publicServer(s) {
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    host: new URL(s.url).host,
    userName: s.userName,
    enabled: s.enabled,
    status: s.status || "untested",
    items: s.items || 0,
    checkedAt: s.checkedAt || null,
  };
}
