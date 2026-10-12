/**
 * Albums and artists of the local music library (LocalMusic.jsx), from the
 * tags core/audio-tags.mjs read. Browser-safe.
 */
import { foldArabic } from "./arabic.mjs";

const keyOf = (text) =>
  foldArabic(String(text || ""))
    .toLowerCase()
    .trim();
const byName = (a, b) =>
  a.name.localeCompare(b.name, ["ar", "en"], { sensitivity: "base" });

/**
 * Albums: songs that share an album name (and album artist, when tagged).
 * A compilation stays one album; its artist reads "فنانون متعددون".
 */
export function albumsOf(tracks = []) {
  const albums = new Map();
  for (const t of tracks) {
    if (!t.album) continue;
    const key = `${keyOf(t.album)}|${keyOf(t.albumArtist)}`;
    const album = albums.get(key) || {
      key,
      name: t.album,
      artists: new Set(),
      albumArtist: t.albumArtist || "",
      ids: [],
      coverId: null,
      year: 0,
    };
    if (t.artist) album.artists.add(t.artist);
    album.ids.push(t.id);
    if (!album.coverId && t.cover) album.coverId = t.id;
    if (t.year && !album.year) album.year = t.year;
    albums.set(key, album);
  }
  return [...albums.values()]
    .map(({ artists, ...album }) => ({
      ...album,
      artist:
        album.albumArtist ||
        (artists.size === 1
          ? [...artists][0]
          : artists.size
            ? "فنانون متعددون"
            : ""),
      count: album.ids.length,
    }))
    .sort(byName);
}

/** Artists by the songs' artist tag, with how many songs each has. */
export function artistsOf(tracks = []) {
  const artists = new Map();
  for (const t of tracks) {
    if (!t.artist) continue;
    const key = keyOf(t.artist);
    const artist = artists.get(key) || {
      key,
      name: t.artist,
      ids: [],
      coverId: null,
      albums: new Set(),
    };
    artist.ids.push(t.id);
    if (!artist.coverId && t.cover) artist.coverId = t.id;
    if (t.album) artist.albums.add(keyOf(t.album));
    artists.set(key, artist);
  }
  return [...artists.values()]
    .map(({ albums, ...artist }) => ({
      ...artist,
      count: artist.ids.length,
      albumCount: albums.size,
    }))
    .sort(byName);
}

/**
 * The songs of one album (in track order) or one artist (by album, then
 * track); every song when `group` is empty.
 */
export function songsOf(tracks = [], group = null) {
  if (!group?.key) return tracks;
  const list = (group.kind === "album" ? albumsOf(tracks) : artistsOf(tracks))
    .find((g) => g.key === group.key)
    ?.ids.map((id) => tracks.find((t) => t.id === id))
    .filter(Boolean);
  if (!list) return [];
  return [...list].sort(
    (a, b) =>
      (group.kind === "artist"
        ? keyOf(a.album).localeCompare(keyOf(b.album), "ar")
        : 0) ||
      (a.track || 9999) - (b.track || 9999) ||
      a.title.localeCompare(b.title, ["ar", "en"]),
  );
}

/** One line under a song: artist and album, or its format. */
export const songLine = (t) =>
  [t.artist, t.album].filter(Boolean).join(" · ") || t.format || "";

/** The words search looks through: title, artist and album. */
export const songWords = (t) => [t.title, t.artist, t.album].join(" ");
