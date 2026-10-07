/**
 * Intro, recap and ending times for anime from AniSkip, a keyless
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
 * The segments for a viewing, [] when it is not anime, nothing is known or a
 * service does not answer. `fetchJson(url)` resolves with parsed JSON.
 */
export async function onlineSegments(videoId, { fetchJson }) {
  const entry = animeEpisode(videoId);
  if (!entry) return [];
  try {
    const mal =
      entry.source === "mal"
        ? entry.id
        : parseArm(await fetchJson(armUrl(entry.id)));
    if (!mal) return [];
    return parseAniskip(await fetchJson(aniskipUrl(mal, entry.episode)));
  } catch {
    return [];
  }
}
