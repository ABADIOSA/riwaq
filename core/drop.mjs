/**
 * Files dropped on Riwaq, as Stremio Community does: a video plays, a
 * subtitle joins what is playing. Main learns the path from Chromium's own
 * file navigation, never from the page's scripts, and only these kinds are
 * accepted.
 */

export const VIDEO_EXTENSIONS = [
  "mp4",
  "mkv",
  "avi",
  "webm",
  "mov",
  "m4v",
  "ts",
  "m2ts",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
];
export const SUBTITLE_EXTENSIONS = ["srt", "ass", "ssa", "vtt", "sub"];

/** "video", "subtitle" or null for a dropped file:// address. */
export function dropKind(url) {
  if (typeof url !== "string" || !/^file:\/\//i.test(url)) return null;
  const clean = url.split(/[?#]/)[0];
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(clean)?.[1] || "").toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (SUBTITLE_EXTENSIONS.includes(ext)) return "subtitle";
  return null;
}
