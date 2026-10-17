/**
 * Anime helpers: which titles are anime (Anime4K's scope) and AniList
 * tracking (issue #71). Pure; core/integrations.mjs does the requests.
 *
 * AniList is read and written through its GraphQL API with a token the
 * viewer copies from AniList's PIN page, issued to their own API client
 * (implicit grant: no secret, valid for a year, no refresh). Riwaq records
 * a finished episode only when the viewer turned tracking on, never lowers
 * progress and never touches a finished show.
 */

export const ANILIST_API = "https://graphql.anilist.co";
export const ANILIST_DEVELOPER = "https://anilist.co/settings/developer";
export const ANILIST_PIN = "https://anilist.co/api/v2/oauth/pin";
const ARM = "https://arm.haglund.dev/api/v2";

/** Titles Anime4K and AniList are for: anime IDs, the anime type or genre. */
export function isAnime(meta = {}) {
  const id = String(meta.id || "");
  if (/^(kitsu|mal|anilist|anidb):/i.test(id)) return true;
  if (meta.type === "anime") return true;
  const genres = (Array.isArray(meta.genres) ? meta.genres : [])
    .map((g) => String(g))
    .join(" ");
  if (/anime|أنمي|انمي|انيمي/i.test(genres)) return true;
  const japanese =
    meta.originalLanguage === "ja" ||
    /japan|اليابان|\bJP\b/i.test(String(meta.country || ""));
  return japanese && /animation|رسوم متحركة|أنيميشن/i.test(genres);
}

/** The AniList client ID: digits only. */
export const anilistClientId = (value) =>
  /^\d{1,10}$/.test(String(value || "").trim()) ? String(value).trim() : "";

/** AniList's authorize page for the viewer's own client (implicit grant). */
export function anilistAuthorize(clientId) {
  const id = anilistClientId(clientId);
  if (!id) throw new Error("احفظ Client ID من تطبيقك في AniList أولاً");
  return `https://anilist.co/api/v2/oauth/authorize?client_id=${id}&response_type=token`;
}

/**
 * The token from what the viewer pasted: the token itself, or the whole
 * redirect address with `#access_token=…`. With its expiry when the JWT
 * states one.
 */
export function anilistToken(text) {
  let value = String(text || "").trim();
  const fragment = /[#&?]access_token=([^&\s]+)/.exec(value);
  if (fragment) value = decodeURIComponent(fragment[1]);
  if (!/^[A-Za-z0-9._-]{20,4000}$/.test(value)) return null;
  let expiresAt = null;
  const parts = value.split(".");
  if (parts.length === 3)
    try {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json =
        typeof atob === "function"
          ? atob(b64)
          : Buffer.from(b64, "base64").toString("utf8");
      const exp = Number(JSON.parse(json).exp);
      if (Number.isFinite(exp) && exp > 0) expiresAt = exp * 1000;
    } catch {}
  return { access_token: value, expiresAt };
}

/**
 * What one finished viewing names on AniList's side: an AniList, MAL or
 * Kitsu ID with its episode (from the addon's own IDs), or an IMDb series
 * that ARM maps to exactly one AniList entry. Films count as episode 1.
 * IMDb titles are only considered when they are anime.
 */
export function anilistTarget(meta = {}, videoId = "") {
  const video = String(videoId || "");
  const episode = /^(anilist|mal|kitsu):(\d{1,9}):(\d{1,5})$/.exec(video);
  if (episode && Number(episode[2]) && Number(episode[3]))
    return {
      source: episode[1],
      id: Number(episode[2]),
      episode: Number(episode[3]),
      movie: false,
    };
  const title = /^(anilist|mal|kitsu):(\d{1,9})$/.exec(String(meta.id || ""));
  if (title && Number(title[2]) && meta.type === "movie")
    return { source: title[1], id: Number(title[2]), episode: 1, movie: true };
  const imdb = /^(tt\d{5,10})(?::(\d{1,3}):(\d{1,5}))?$/.exec(video);
  if (imdb && isAnime(meta)) {
    if (meta.type === "movie" && !imdb[2])
      return { source: "imdb", id: imdb[1], episode: 1, movie: true };
    // A later IMDb season is a different AniList entry: never guessed.
    if (meta.type === "series" && imdb[2] === "1" && Number(imdb[3]))
      return {
        source: "imdb",
        id: imdb[1],
        episode: Number(imdb[3]),
        movie: false,
      };
  }
  return null;
}

/** A queued target as anilistTarget makes it (a restored queue is checked). */
export function validTarget(entry) {
  if (!entry || !Number.isInteger(entry.episode)) return false;
  if (entry.episode < 1 || entry.episode > 99999) return false;
  if (entry.source === "imdb") return /^tt\d{5,10}$/.test(entry.id);
  return (
    ["anilist", "mal", "kitsu"].includes(entry.source) &&
    Number.isInteger(entry.id) &&
    entry.id > 0 &&
    entry.id < 1e9
  );
}

/** ARM's address for a Kitsu or IMDb ID, or "" for anything else. */
export function armLookup(target) {
  if (target?.source === "kitsu" && Number.isInteger(target.id))
    return `${ARM}/ids?source=kitsu&id=${target.id}&include=anilist`;
  if (target?.source === "imdb" && /^tt\d{5,10}$/.test(target.id))
    return `${ARM}/imdb?id=${target.id}&include=anilist`;
  return "";
}

/**
 * The AniList ID in ARM's answer. The IMDb endpoint lists every entry of a
 * show; more than one (a later season, a film) is too uncertain to write.
 */
export function armAnilist(body) {
  const list = (Array.isArray(body) ? body : body ? [body] : [])
    .map((entry) => Number(entry?.anilist))
    .filter((id) => Number.isInteger(id) && id > 0 && id < 1e9);
  const unique = [...new Set(list)];
  return unique.length === 1 ? unique[0] : 0;
}

export const MEDIA_QUERY = `query ($id: Int, $idMal: Int) {
  Media(id: $id, idMal: $idMal, type: ANIME) {
    id
    episodes
    format
    mediaListEntry { progress status }
  }
}`;
export const SAVE_ENTRY = `mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
  SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
    id
    progress
    status
  }
}`;
export const VIEWER_QUERY = "query { Viewer { id name } }";
export const LISTS_QUERY = `query ($userId: Int) {
  MediaListCollection(userId: $userId, type: ANIME) {
    lists {
      status
      entries {
        status
        media {
          id
          format
          startDate { year }
          title { romaji english native }
          coverImage { large }
        }
      }
    }
  }
}`;

/**
 * The write one finished episode calls for, or null: progress only rises,
 * a finished show is left alone, and an episode past the show's count is
 * a numbering mismatch, not progress.
 */
export function nextListEntry(media, { episode, movie } = {}) {
  if (!media || !Number.isInteger(media.id)) return null;
  const total = Number(media.episodes) || 0;
  const progress = movie ? 1 : Number(episode);
  if (!Number.isInteger(progress) || progress < 1) return null;
  if (total && progress > total) return null;
  const entry = media.mediaListEntry;
  if (entry?.status === "COMPLETED") return null;
  if (entry && Number(entry.progress) >= progress) return null;
  const done = total > 0 && progress >= total;
  const status =
    entry?.status === "REPEATING" && !done
      ? "REPEATING"
      : done
        ? "COMPLETED"
        : "CURRENT";
  return { mediaId: media.id, progress, status };
}

/** AniList's lists as connected rows; titles open by `anilist:` ID. */
export function anilistLists(collection) {
  const names = {
    CURRENT: "AniList · أشاهده",
    PLANNING: "AniList · أريد مشاهدته",
    PAUSED: "AniList · متوقف مؤقتاً",
    DROPPED: "AniList · متروك",
    REPEATING: "AniList · إعادة المشاهدة",
    COMPLETED: "AniList · مكتمل",
  };
  // Custom lists can repeat a status and a work. Merge them so React row
  // keys are unique and a title is not displayed twice in the same row.
  return Object.entries(names).flatMap(([status, name]) => {
    const entries = (collection?.lists || []).flatMap((list) =>
      (list.entries || []).filter(
        (entry) => (entry?.status || list.status) === status,
      ),
    );
    if (!entries.length) return [];
    return [
      {
        key: `anilist-${status.toLowerCase()}`,
        service: "anilist",
        name,
        metas: [
          ...new Map(
            entries
              .map((e) => e?.media)
              .filter((m) => Number.isInteger(m?.id) && m.id > 0)
              .map((m) => [m.id, m]),
          ).values(),
        ]
          .slice(0, 1000)
          .map((m) => ({
            id: `anilist:${m.id}`,
            type: m.format === "MOVIE" ? "movie" : "series",
            name:
              String(
                m.title?.english || m.title?.romaji || m.title?.native || "",
              ).slice(0, 200) || `AniList ${m.id}`,
            poster: /^https:\/\/s\d*\.anilist\.co\//.test(
              m.coverImage?.large || "",
            )
              ? m.coverImage.large
              : undefined,
            releaseInfo: m.startDate?.year
              ? String(m.startDate.year)
              : undefined,
          })),
      },
    ];
  });
}

/** AniList's refusals in Arabic, keeping `status` on the error. */
export function anilistProblem(error) {
  const status = Number(error?.status) || 0;
  const message =
    status === 401 || status === 400
      ? "رمز AniList غير صالح أو انتهت صلاحيته؛ اربط الحساب من جديد"
      : status === 429
        ? "AniList مشغول بحد الطلبات؛ يعيد رِواق المحاولة بعد دقيقة"
        : status === 404
          ? "لم يجد AniList هذا العمل"
          : status >= 500
            ? "AniList لا يستجيب الآن؛ جرّب لاحقاً"
            : error?.message || "تعذّر الاتصال بـ AniList";
  return Object.assign(new Error(message), { status });
}
