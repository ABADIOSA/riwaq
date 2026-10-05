/**
 * The music room: the viewer's own platforms, their saved playlists, albums
 * and artists, searches, and a title's soundtrack. Riwaq organizes and opens;
 * the platform plays. Local playback lives separately in music-player.mjs.
 * This link module never streams audio, never asks for a platform
 * password, and opens only HTTPS pages on each platform's own hosts (main
 * re-checks every address before handing it to the system). Per profile in
 * `settings.music`. Browser-safe.
 *
 * Why platform links stay separate: Spotify, Apple Music and Tidal play through
 * protected-content modules that a standard Electron build does not ship,
 * so an embedded player would break for them; the platform's app or the
 * browser already holds the viewer's sign-in.
 */

/** [id, name, colour, hosts, search(query) → URL]. */
export const MUSIC_PLATFORMS = [
  [
    "spotify",
    "Spotify",
    "#1DB954",
    ["open.spotify.com", "spotify.link"],
    (q) => `https://open.spotify.com/search/${q}`,
  ],
  [
    "anghami",
    "أنغامي",
    "#A83FDF",
    ["play.anghami.com", "open.anghami.com", "anghami.com", "www.anghami.com"],
    (q) => `https://play.anghami.com/search/${q}`,
  ],
  [
    "applemusic",
    "Apple Music",
    "#FA2D48",
    ["music.apple.com"],
    (q) => `https://music.apple.com/search?term=${q}`,
  ],
  [
    "youtubemusic",
    "YouTube Music",
    "#FF0033",
    ["music.youtube.com"],
    (q) => `https://music.youtube.com/search?q=${q}`,
  ],
  [
    "youtube",
    "YouTube",
    "#FF0000",
    ["www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be"],
    (q) => `https://www.youtube.com/results?search_query=${q}`,
  ],
  [
    "soundcloud",
    "SoundCloud",
    "#FF5500",
    ["soundcloud.com", "on.soundcloud.com", "m.soundcloud.com"],
    (q) => `https://soundcloud.com/search?q=${q}`,
  ],
  [
    "deezer",
    "Deezer",
    "#A238FF",
    ["www.deezer.com", "deezer.com", "link.deezer.com", "deezer.page.link"],
    (q) => `https://www.deezer.com/search/${q}`,
  ],
  [
    "tidal",
    "TIDAL",
    "#7BE0F5",
    ["tidal.com", "listen.tidal.com"],
    (q) => `https://listen.tidal.com/search?q=${q}`,
  ],
  [
    "amazonmusic",
    "Amazon Music",
    "#25D1DA",
    ["music.amazon.com"],
    (q) => `https://music.amazon.com/search/${q}`,
  ],
];
const BY_ID = new Map(MUSIC_PLATFORMS.map((p) => [p[0], p]));
export const MUSIC_ITEM_LIMIT = 120;
export const MUSIC_KINDS = {
  playlist: "قائمة تشغيل",
  album: "ألبوم",
  artist: "فنان",
  track: "أغنية",
  podcast: "بودكاست",
  link: "رابط",
};

export const platformName = (id) => BY_ID.get(id)?.[1] || "";
export const platformColor = (id) => BY_ID.get(id)?.[2] || "#888888";

/** The platform an address belongs to, by its exact host, or "". */
export function platformOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      MUSIC_PLATFORMS.find(([, , , hosts]) => hosts.includes(host))?.[0] || ""
    );
  } catch {
    return "";
  }
}

/** What a saved link points at, read from its path (a label, nothing more). */
export function linkKind(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return "link";
  }
  const path = u.pathname.toLowerCase();
  if (/\/(playlist|sets)\b/.test(path) || u.searchParams.has("list"))
    return "playlist";
  if (/\/album\b/.test(path)) return "album";
  if (/\/(artist|channel)\b/.test(path)) return "artist";
  if (/\/(show|episode|podcast)\b/.test(path)) return "podcast";
  if (/\/(track|song)\b/.test(path) || u.searchParams.has("v")) return "track";
  return "link";
}

/**
 * A saved link as Riwaq keeps and opens it: HTTPS, no credentials, at most
 * 600 characters, on a known platform's own host. "" when it is not one.
 */
export function musicLink(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text.length > 600 || /[\u0000-\u001f\u007f\s]/.test(text))
    return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return "";
    return platformOf(url.toString()) ? url.toString() : "";
  } catch {
    return "";
  }
}

/** A search phrase: one line, at most 120 characters. */
export function musicQuery(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * A saved Spotify page as the URI Spotify plays ("spotify:playlist:…"), or
 * "" when the link is not one Riwaq can start through Spotify.
 */
export function spotifyUri(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "open.spotify.com") return "";
    const m = u.pathname.match(
      /^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]{10,40})\/?$/,
    );
    return m ? `spotify:${m[1]}:${m[2]}` : "";
  } catch {
    return "";
  }
}

/** The platform's own search page for a phrase, or "". */
export function musicSearchUrl(platform, query) {
  const p = BY_ID.get(platform);
  const q = musicQuery(query);
  if (!p || !q) return "";
  return p[4](encodeURIComponent(q));
}

/**
 * The phrase that finds a title's music: its name and year with
 * "soundtrack" for a film, "theme" for a series.
 */
export function soundtrackQuery(meta = {}) {
  const name = musicQuery(meta.name);
  if (!name) return "";
  const year = /^\d{4}/.exec(String(meta.releaseInfo || meta.year || ""))?.[0];
  const word = meta.type === "series" ? "soundtrack theme" : "soundtrack";
  return musicQuery(
    [name, meta.type === "movie" && year ? year : "", word]
      .filter(Boolean)
      .join(" "),
  );
}

/** A short stable ID for a saved link (FNV-1a over the address). */
function linkId(url) {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `m${h.toString(36)}`;
}

const label = (value, max) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/** The music settings, validated field by field (also on backup restore). */
export function cleanMusic(input) {
  const value = input && typeof input === "object" ? input : {};
  const platforms = [
    ...new Set(
      (Array.isArray(value.platforms) ? value.platforms : []).filter((id) =>
        BY_ID.has(id),
      ),
    ),
  ];
  const seen = new Set();
  const items = [];
  for (const item of Array.isArray(value.items) ? value.items : []) {
    if (!item || typeof item !== "object") continue;
    const url = musicLink(item.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const platform = platformOf(url);
    items.push({
      id: linkId(url),
      url,
      platform,
      kind: Object.hasOwn(MUSIC_KINDS, item.kind) ? item.kind : linkKind(url),
      title: label(item.title, 80),
      added: Number.isFinite(item.added) && item.added > 0 ? item.added : 0,
    });
    if (items.length >= MUSIC_ITEM_LIMIT) break;
  }
  return { platforms, items };
}

/** Adds a pasted link (newest first); throws an Arabic sentence when it is not usable. */
export function addMusicLink(music, { url, title = "" }, now = Date.now()) {
  const clean = cleanMusic(music);
  const link = musicLink(url);
  if (!link)
    throw new Error(
      "الصق رابطاً من منصة موسيقى مدعومة (Spotify، أنغامي، Apple Music، YouTube Music…)",
    );
  if (clean.items.some((i) => i.url === link))
    throw new Error("هذا الرابط محفوظ عندك");
  const platform = platformOf(link);
  return cleanMusic({
    ...clean,
    // Saving from a platform turns it on, so it shows among yours.
    platforms: clean.platforms.includes(platform)
      ? clean.platforms
      : [...clean.platforms, platform],
    items: [
      { url: link, title, kind: linkKind(link), added: now },
      ...clean.items,
    ],
  });
}

/** The platform a title's soundtrack opens on: the viewer's first, else YouTube Music. */
export function preferredPlatform(music) {
  return cleanMusic(music).platforms[0] || "youtubemusic";
}
