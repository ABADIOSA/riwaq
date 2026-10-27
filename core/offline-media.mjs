// Download labels must work without fetching metadata again, including
// old records that only kept a conventional series:season:episode ID.
/** Predictable download refusals without exposing the source to the page. */
export function downloadCapability(
  stream,
  { live = false, local = false } = {},
) {
  if (live) return { supported: false, reason: "البث المباشر لا يدعم التنزيل" };
  if (local || !stream)
    return { supported: false, reason: "اختر مصدر فيديو للتنزيل" };
  if (stream.infoHash) return { supported: true, reason: "" };
  try {
    const url = new URL(stream.url);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      /\.(m3u8|mpd)$/i.test(url.pathname)
    )
      throw Error();
    return { supported: true, reason: "" };
  } catch {
    return {
      supported: false,
      reason: "هذا المصدر يحتاج بثًا مباشرًا؛ اختر ملف فيديو أو تورنت للتنزيل",
    };
  }
}

const number = (value) => {
  if (
    !["number", "string"].includes(typeof value) ||
    (typeof value === "string" && !/^\d+$/.test(value.trim()))
  )
    return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 100000 ? n : undefined;
};
export function offlineEpisode(meta, videoId, saved) {
  if (!meta || ["movie", "local", "live"].includes(meta.type)) return undefined;
  const video = Array.isArray(meta.videos)
    ? meta.videos.find((v) => v?.id === videoId)
    : null;
  const prefix = `${meta.id}:`;
  const match =
    ["series", "anime"].includes(meta.type) &&
    typeof videoId === "string" &&
    videoId.startsWith(prefix)
      ? /^(\d+):(\d+)$/.exec(videoId.slice(prefix.length))
      : null;
  const episode =
    number(saved?.episode) ?? number(video?.episode) ?? number(match?.[2]);
  const season =
    number(saved?.season) ??
    number(video?.season) ??
    number(match?.[1]) ??
    (episode !== undefined ? 1 : undefined);
  const text = saved?.title || video?.title || video?.name;
  const title =
    typeof text === "string"
      ? text
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .trim()
          .slice(0, 200)
      : "";
  if (episode === undefined && !title) return undefined;
  return {
    ...(episode !== undefined ? { season, episode } : {}),
    ...(title ? { title } : {}),
  };
}
