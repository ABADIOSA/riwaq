/**
 * A title's theme song on its page (`themeSong`: auto, button or off).
 * Riwaq plays it itself: a 30-second preview from Apple's iTunes Search API
 * or Deezer's public API, both keyless and meant for previews. A song is
 * chosen only when it clearly belongs to the title (its album or name
 * carries the title, with theme or soundtrack words); otherwise there is
 * silence, never a guess. Previews and artwork come only from the hosts
 * below. Browser-safe; main makes the requests.
 */

export const THEME_SONG_MODES = ["auto", "button", "off"];
export const THEME_SONG_VOLUMES = [10, 20, 35, 50, 70, 100];
export const THEME_SKIP_LIMIT = 300;

const PREVIEW_HOSTS = [/^audio-ssl\.itunes\.apple\.com$/, /\.dzcdn\.net$/];
const ART_HOSTS = [/\.mzstatic\.com$/, /\.dzcdn\.net$/];
const PAGE_HOSTS = [/^music\.apple\.com$/, /^(www\.)?deezer\.com$/];

const allowed = (value, hosts) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      hosts.some((h) => h.test(url.hostname))
      ? url.toString()
      : "";
  } catch {
    return "";
  }
};
/** A preview Riwaq may play: HTTPS on Apple's or Deezer's preview hosts. */
export const previewUrl = (value) => allowed(value, PREVIEW_HOSTS);
export const artUrl = (value) => allowed(value, ART_HOSTS);
const pageUrl = (value) => allowed(value, PAGE_HOSTS);

// Words kept apart (foldArabic joins them for search): accents and Arabic
// marks removed, alef forms, taa marbuta and alef maqsura folded.
const norm = (value) =>
  String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[ٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ىی]/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const ARABIC = /[\u0600-\u06ff]/;
const LATIN = /[A-Za-z]/;
/**
 * The names a title's music is filed under, best first: the addon's own
 * name and the original title before a translated one (with an Arabic
 * metadata language, TMDB names "Game of Thrones" «صراع العروش», and no
 * album carries that). Names in Latin letters come first; at most two.
 */
export function themeNames(meta = {}) {
  const names = [];
  for (const value of [meta.addonName, meta.originalName, meta.name]) {
    const name = String(value || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, 100);
    if (name && !names.some((n) => n.toLowerCase() === name.toLowerCase()))
      names.push(name);
  }
  const rank = (n) => (LATIN.test(n) && !ARABIC.test(n) ? 0 : 1);
  return names
    .map((n, i) => [n, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([n]) => n)
    .slice(0, 2);
}

/** The phrases to search with, most specific first. */
export function themeQueries(meta = {}) {
  const name = String(meta.name || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 100);
  if (!name) return [];
  return meta.type === "series"
    ? [`${name} main title theme`, `${name} soundtrack`]
    : [`${name} main theme`, `${name} soundtrack`];
}

export const itunesUrl = (query) =>
  `https://itunes.apple.com/search?${new URLSearchParams({
    term: query,
    media: "music",
    entity: "song",
    limit: "15",
    country: "US",
  })}`;
export const deezerUrl = (query) =>
  `https://api.deezer.com/search?${new URLSearchParams({ q: query, limit: "15" })}`;

/** iTunes results as candidates. */
export function fromItunes(body) {
  return (Array.isArray(body?.results) ? body.results : [])
    .map((r) => ({
      track: String(r?.trackName || "").slice(0, 200),
      artist: String(r?.artistName || "").slice(0, 200),
      album: String(r?.collectionName || "").slice(0, 200),
      year: Number.parseInt(String(r?.releaseDate || "").slice(0, 4)) || 0,
      preview: previewUrl(r?.previewUrl),
      image: artUrl(
        String(r?.artworkUrl100 || "").replace("100x100", "300x300"),
      ),
      link: pageUrl(r?.trackViewUrl),
      source: "itunes",
    }))
    .filter((c) => c.preview && c.track);
}

/**
 * Spotify search results as candidates (with the linked account): the full
 * track's URI to play through Spotify, no preview needed.
 */
export function fromSpotify(body) {
  return (Array.isArray(body?.tracks?.items) ? body.tracks.items : [])
    .filter((t) => /^spotify:track:[A-Za-z0-9]{10,40}$/.test(t?.uri || ""))
    .map((t) => ({
      track: String(t.name || "").slice(0, 200),
      artist: String(t.artists?.[0]?.name || "").slice(0, 200),
      album: String(t.album?.name || "").slice(0, 200),
      year:
        Number.parseInt(String(t.album?.release_date || "").slice(0, 4)) || 0,
      preview: "",
      image: (() => {
        for (const img of t.album?.images || [])
          try {
            const u = new URL(img.url);
            if (u.protocol === "https:" && /\.scdn\.co$/.test(u.hostname))
              return u.toString();
          } catch {}
        return "";
      })(),
      link: "",
      spotifyUri: t.uri,
      source: "spotify",
    }))
    .filter((c) => c.track);
}

/** Deezer results as candidates. */
export function fromDeezer(body) {
  return (Array.isArray(body?.data) ? body.data : [])
    .map((r) => ({
      track: String(r?.title || "").slice(0, 200),
      artist: String(r?.artist?.name || "").slice(0, 200),
      album: String(r?.album?.title || "").slice(0, 200),
      year: 0,
      preview: previewUrl(r?.preview),
      image: artUrl(r?.album?.cover_medium),
      link: pageUrl(r?.link),
      source: "deezer",
    }))
    .filter((c) => c.preview && c.track);
}

const THEME_WORDS =
  /\b(main title|main theme|theme song|theme|opening|intro|title sequence|end credits|title song)\b/;
const SCORE_WORDS =
  /\b(soundtrack|original score|music from|ost|original motion picture|original series|original television|score)\b/;
// Fan-made, covers and re-arrangements: refused (plural forms included,
// "Piano Covers" slipped past a singular-only list).
const BAD_WORDS =
  /\b(covers?|karaoke|tributes?|remix(es)?|lullaby|lullabies|8 bit|ringtones?|made famous|in the style of|parody|workout|kids version|inspired by|piano version|epic version|lo ?fi|medley|rendition|fan made|instrumental cover|sleep music|relaxing)\b/;

const sameArtist = (artist, composers) => {
  const a = norm(artist);
  return (
    !!a &&
    composers.some((c) => {
      const n = norm(c);
      return n.length > 2 && (a.includes(n) || n.includes(a));
    })
  );
};

/**
 * How clearly a candidate is this title's theme; below 7 is not used. With
 * the title's composers known (Wikidata, TMDB), a song by one of them gains
 * much; in "official" trust a song by anyone else is refused.
 */
export function themeScore(
  candidate,
  meta = {},
  { composers = [], trust = "official" } = {},
) {
  const title = norm(meta.name);
  if (!title || title.length < 2) return -Infinity;
  const album = norm(candidate.album);
  const track = norm(candidate.track);
  const artist = norm(candidate.artist);
  const has = (text) => ` ${text} `.includes(` ${title} `);
  let score = 0;
  if (has(album)) score += 5;
  if (has(track)) score += 3;
  if (!score) return -Infinity;
  const english = (text) => text.toLowerCase();
  if (THEME_WORDS.test(english(track))) score += meta.type === "series" ? 3 : 2;
  if (SCORE_WORDS.test(english(album))) score += 2;
  if (
    BAD_WORDS.test(english(track)) ||
    BAD_WORDS.test(english(album)) ||
    BAD_WORDS.test(english(artist))
  )
    score -= 8;
  if (composers.length) {
    if (sameArtist(candidate.artist, composers)) score += 6;
    else if (trust === "official") return -Infinity;
  } else if (trust === "official" && !SCORE_WORDS.test(english(album)))
    // No composer to check: only a soundtrack or score album is trusted.
    return -Infinity;
  const year = Number.parseInt(String(meta.releaseInfo || meta.year || ""));
  if (meta.type === "movie" && year && candidate.year) {
    const gap = Math.abs(candidate.year - year);
    if (gap <= 1) score += 2;
    // Another film of the same name (a remake, the 1984 Dune) is not this one.
    else if (gap > 3) score -= 6;
  }
  return score;
}

/** The candidate that clearly is the title's theme, or null. */
export function pickThemeSong(candidates = [], meta = {}, options = {}) {
  let best = null;
  candidates.forEach((c, index) => {
    const score = themeScore(c, meta, options);
    if (score >= 7 && (!best || score > best.score))
      best = { ...c, score, index };
  });
  if (!best) return null;
  const { score, index, ...song } = best;
  return {
    ...song,
    official:
      !!options.composers?.length && sameArtist(song.artist, options.composers),
  };
}

/*
 * The official soundtrack, from Wikidata (keyless, already Riwaq's source
 * for credits): the work's soundtrack album (P406) with its Spotify (P2205),
 * Apple Music (P2281) and Deezer (P2722) album IDs, and its composers (P86).
 */
const IMDB_ID = /^tt\d{5,12}$/;
export function officialMusicQuery(imdb) {
  if (!IMDB_ID.test(imdb || "")) return "";
  return `SELECT ?spotify ?apple ?deezer ?composerLabel WHERE {
  ?work wdt:P345 "${imdb}" .
  OPTIONAL { ?work wdt:P406 ?album .
    OPTIONAL { ?album wdt:P2205 ?spotify }
    OPTIONAL { ?album wdt:P2281 ?apple }
    OPTIONAL { ?album wdt:P2722 ?deezer } }
  OPTIONAL { ?work wdt:P86 ?composer .
    ?composer rdfs:label ?composerLabel . FILTER(LANG(?composerLabel) = "en") }
} LIMIT 30`;
}

/** Album IDs (validated) and composer names from the SPARQL answer. */
export function parseOfficialMusic(body) {
  const out = { spotify: [], apple: [], deezer: [], composers: [] };
  const add = (list, value, pattern) => {
    if (
      typeof value === "string" &&
      pattern.test(value) &&
      !list.includes(value)
    )
      list.push(value);
  };
  for (const row of body?.results?.bindings || []) {
    add(out.spotify, row.spotify?.value, /^[A-Za-z0-9]{22}$/);
    add(out.apple, row.apple?.value, /^\d{4,15}$/);
    add(out.deezer, row.deezer?.value, /^\d{3,15}$/);
    const name = String(row.composerLabel?.value || "")
      .trim()
      .slice(0, 100);
    if (name && !out.composers.includes(name)) out.composers.push(name);
  }
  for (const key of Object.keys(out)) out[key] = out[key].slice(0, 3);
  return out;
}

export const itunesAlbumUrl = (id) =>
  `https://itunes.apple.com/lookup?${new URLSearchParams({ id, entity: "song", limit: "60" })}`;
export const deezerAlbumUrl = (id) =>
  `https://api.deezer.com/album/${encodeURIComponent(id)}/tracks?limit=60`;

/** Spotify album tracks as candidates (`/albums/{id}/tracks`). */
export function fromSpotifyAlbum(body) {
  return fromSpotify({
    tracks: {
      items: (Array.isArray(body?.items) ? body.items : []).map((t) => ({
        ...t,
        album: t.album || {},
      })),
    },
  });
}

/**
 * The theme on the title's own soundtrack album: a track named like a
 * theme or after the title, else the album's first track (where a main
 * title usually sits). Always official.
 */
export function pickOfficialTrack(tracks = [], meta = {}) {
  const title = norm(meta.name);
  let best = null;
  tracks.forEach((t, index) => {
    const name = norm(t.track);
    if (!name || BAD_WORDS.test(name)) return;
    let score = 0;
    if (THEME_WORDS.test(name)) score += 5;
    if (title && ` ${name} `.includes(` ${title} `)) score += 3;
    score += index === 0 ? 2 : index === 1 ? 1 : 0;
    if (!best || score > best.score) best = { ...t, score };
  });
  if (!best) return null;
  const { score, ...song } = best;
  return { ...song, official: true };
}

/** Titles whose song the viewer turned away ("مو هذي"), newest first. */
export function cleanThemeSkip(input) {
  return [
    ...new Set(
      (Array.isArray(input) ? input : []).filter(
        (k) =>
          typeof k === "string" && /^(movie|series):[^\s"<>]{1,120}$/.test(k),
      ),
    ),
  ].slice(0, THEME_SKIP_LIMIT);
}
