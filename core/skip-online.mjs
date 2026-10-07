/**
 * Intro, recap and ending times from community databases: TheIntroDB for
 * titles with an IMDb ID (below), and for anime from AniSkip, a keyless
 * community database (api.aniskip.com), for viewings whose ID names a
 * MyAnimeList or Kitsu entry ("mal:ID:EP", "kitsu:ID:EP", as anime addons
 * send them). A Kitsu ID is turned into MyAnimeList's through the keyless
 * ARM mapping service (arm.haglund.dev). Only the anime ID and the episode
 * number are sent, and only when the viewer turned this on. A file's own
 * chapters still win. Pure, apart from the fetch it is given.
 */

const KINDS = {
  op: "intro",
  "mixed-op": "intro",
  ed: "outro",
  "mixed-ed": "outro",
  recap: "recap",
};

/** The anime entry and episode a viewing names, or null. */
export function animeEpisode(videoId) {
  const match = /^(kitsu|mal):(\d{1,9}):(\d{1,5})$/.exec(String(videoId || ""));
  if (!match) return null;
  const id = Number(match[2]);
  const episode = Number(match[3]);
  if (!id || !episode) return null;
  return { source: match[1], id, episode };
}

export const armUrl = (kitsuId) =>
  `https://arm.haglund.dev/api/v2/ids?source=kitsu&id=${Number(kitsuId)}`;

/** MyAnimeList's ID from an ARM answer, or 0. */
export function parseArm(body) {
  const id = Number(body?.myanimelist);
  return Number.isInteger(id) && id > 0 && id < 1e9 ? id : 0;
}

export const aniskipUrl = (malId, episode) =>
  `https://api.aniskip.com/v2/skip-times/${Number(malId)}/${Number(episode)}` +
  "?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap&episodeLength=0";

/** AniSkip's answer as skip segments, checked number by number. */
export function parseAniskip(body) {
  if (!body || body.found !== true || !Array.isArray(body.results)) return [];
  const segments = [];
  for (const result of body.results.slice(0, 12)) {
    const kind = KINDS[result?.skipType];
    const start = Number(result?.interval?.startTime);
    const end = Number(result?.interval?.endTime);
    if (
      !kind ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end - start < 5 ||
      end > 6 * 3600
    )
      continue;
    segments.push({
      kind,
      start: Math.round(start * 10) / 10,
      end: Math.round(end * 10) / 10,
      source: "aniskip",
    });
  }
  return segments.sort((a, b) => a.start - b.start);
}

/**
 * TheIntroDB (theintrodb.org): a community database of intro, recap,
 * credits and preview times by IMDb or TMDB ID. It answers without a key;
 * the viewer's key, sent as a Bearer token, raises the request limit.
 * The request shape follows TheIntroDB's own MPV script.
 */
export const THEINTRODB_API = "https://api.theintrodb.org/v3/media";

/** The IMDb title, season and episode a viewing names, or null. */
export function introDbTarget(videoId) {
  const match = /^(tt\d{5,12})(?::(\d{1,4}):(\d{1,5}))?$/.exec(
    String(videoId || ""),
  );
  if (!match) return null;
  return match[2]
    ? { imdb: match[1], season: Number(match[2]), episode: Number(match[3]) }
    : { imdb: match[1] };
}

export function theIntroDbUrl({ imdb, season, episode, durationMs } = {}) {
  const params = new URLSearchParams({ imdb_id: imdb });
  if (Number.isInteger(season) && Number.isInteger(episode)) {
    params.set("season", String(season));
    params.set("episode", String(episode));
  }
  if (Number(durationMs) > 0)
    params.set("duration_ms", String(Math.round(durationMs)));
  return `${THEINTRODB_API}?${params}`;
}

const INTRODB_KINDS = {
  intro: "intro",
  recap: "recap",
  credits: "outro",
  preview: "preview",
};

/**
 * TheIntroDB's answer as skip segments. Times are milliseconds; a missing or
 * zero end runs to the end of the file (so it needs the duration), and both
 * at zero mean "none".
 */
export function parseTheIntroDb(body, duration = 0) {
  if (!body || typeof body !== "object") return [];
  const total = Number(duration) || 0;
  const segments = [];
  for (const [key, kind] of Object.entries(INTRODB_KINDS)) {
    const list = Array.isArray(body[key]) ? body[key].slice(0, 6) : [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const startMs = item.start_ms == null ? 0 : Number(item.start_ms);
      const endMs = item.end_ms == null ? 0 : Number(item.end_ms);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0)
        continue;
      if (startMs === 0 && endMs === 0) continue;
      const start = startMs / 1000;
      let end = endMs > 0 ? endMs / 1000 : total;
      if (total > 0) end = Math.min(end, total);
      if (!end || end - start < 5 || end > 6 * 3600) continue;
      segments.push({
        kind,
        start: Math.round(start * 10) / 10,
        end: Math.round(end * 10) / 10,
        source: "theintrodb",
      });
    }
  }
  return segments.sort((a, b) => a.start - b.start);
}

// "No times for this title yet" is an answer; anything else is a failure
// the caller should not remember.
const missing = (error) => /^HTTP (400|404)\b/.test(error?.message || "");

/**
 * The segments for a viewing: AniSkip for an anime ID, TheIntroDB for an
 * IMDb ID, [] for anything else or when nothing is known. A failed request
 * throws, so it is retried later instead of remembered as "none".
 * `fetchJson(url, headers)` resolves with parsed JSON.
 */
export async function onlineSegments(
  videoId,
  { fetchJson, introDbKey = "", duration = 0 },
) {
  try {
    const anime = animeEpisode(videoId);
    if (anime) {
      const mal =
        anime.source === "mal"
          ? anime.id
          : parseArm(await fetchJson(armUrl(anime.id), {}));
      if (!mal) return [];
      return parseAniskip(await fetchJson(aniskipUrl(mal, anime.episode), {}));
    }
    const title = introDbTarget(videoId);
    if (!title) return [];
    const headers = introDbKey ? { Authorization: `Bearer ${introDbKey}` } : {};
    const body = await fetchJson(
      theIntroDbUrl({ ...title, durationMs: (Number(duration) || 0) * 1000 }),
      headers,
    );
    return parseTheIntroDb(body, duration);
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}
