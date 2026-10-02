/**
 * Intro and outro detection.
 *
 * Chapter markers are the only trustworthy source, so they are used whenever a
 * file carries them. When a file has none, a conservative heuristic offers a
 * skip only inside the window where an intro realistically sits; guessing wider
 * than that costs a viewer part of the episode, which is worse than no button.
 */

const INTRO_WORDS =
  /\b(intro|opening|op\b|title\s*sequence|main\s*titles?|theme)\b|مقدمة|شارة\s*البداية|تتر\s*البداية/i;
const OUTRO_WORDS =
  /\b(outro|ending|ed\b|credits?|end\s*credits?|closing)\b|النهاية|شارة\s*النهاية|تتر\s*النهاية/i;
const RECAP_WORDS =
  /\b(recap|previously|last\s*time)\b|ملخص\s*الحلقة|في\s*الحلقة\s*السابقة/i;
const PREVIEW_WORDS =
  /\b(preview|next\s*episode|next\s*time)\b|الحلقة\s*القادمة/i;

const MIN_SEGMENT = 5;
const MAX_INTRO = 210;
const INTRO_WINDOW = 420;

function normalizeChapters(chapters) {
  return (Array.isArray(chapters) ? chapters : [])
    .filter((chapter) => Number.isFinite(chapter?.time) && chapter.time >= 0)
    .map((chapter) => ({
      time: Number(chapter.time),
      title: String(chapter.title || ""),
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Builds skip segments for one file. `duration` bounds the last chapter and
 * enables the heuristic fallback; without it only chapter titles are trusted.
 */
export function detectSegments({
  chapters = [],
  duration = 0,
  heuristics = true,
} = {}) {
  const ordered = normalizeChapters(chapters);
  const total = Number(duration) > 0 ? Number(duration) : 0;
  const segments = [];
  ordered.forEach((chapter, position) => {
    const end =
      position + 1 < ordered.length ? ordered[position + 1].time : total;
    if (!end || end - chapter.time < MIN_SEGMENT) return;
    const kind = RECAP_WORDS.test(chapter.title)
      ? "recap"
      : INTRO_WORDS.test(chapter.title)
        ? "intro"
        : PREVIEW_WORDS.test(chapter.title)
          ? "preview"
          : OUTRO_WORDS.test(chapter.title)
            ? "outro"
            : null;
    if (kind)
      segments.push({ kind, start: chapter.time, end, source: "chapter" });
  });
  if (segments.length) return dedupe(segments);
  if (!heuristics || !total) return [];
  // Two chapters inside the opening minutes, the first short: that shape is an
  // intro far more often than it is anything else.
  if (ordered.length >= 2 && ordered[0].time <= 60) {
    const candidate = ordered.find(
      (chapter, position) =>
        position + 1 < ordered.length &&
        chapter.time < INTRO_WINDOW &&
        ordered[position + 1].time - chapter.time >= 25 &&
        ordered[position + 1].time - chapter.time <= MAX_INTRO,
    );
    if (candidate) {
      const index = ordered.indexOf(candidate);
      segments.push({
        kind: "intro",
        start: candidate.time,
        end: ordered[index + 1].time,
        source: "shape",
      });
    }
  }
  // Closing credits are reliably the tail of a long enough programme.
  if (total > 900) {
    const last = ordered[ordered.length - 1];
    if (last && total - last.time >= 45 && total - last.time <= 360)
      segments.push({
        kind: "outro",
        start: last.time,
        end: total,
        source: "shape",
      });
  }
  return dedupe(segments);
}

function dedupe(segments) {
  const seen = new Set();
  return segments
    .filter((segment) => {
      const identity = `${segment.kind}:${Math.round(segment.start)}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return segment.end > segment.start;
    })
    .sort((a, b) => a.start - b.start);
}

export const SEGMENT_LABELS = {
  intro: "تخطي المقدمة",
  outro: "تخطي الخاتمة",
  recap: "تخطي الملخص",
  preview: "تخطي الإعلان",
};

/**
 * The segment covering `position`, if the viewer opted into skipping its kind.
 * A segment is offered from its start until three seconds before its end, so
 * the button never appears with nothing left to skip.
 */
export function activeSegment(segments, position, preferences = {}) {
  const intro = preferences.skipIntro ?? "button";
  const outro = preferences.skipOutro ?? "off";
  const enabled = {
    intro: intro !== "off",
    recap: intro !== "off",
    outro: outro !== "off",
    preview: outro !== "off",
  };
  const at = Number(position) || 0;
  const found = (segments || []).find(
    (segment) =>
      enabled[segment.kind] && at >= segment.start && at < segment.end - 3,
  );
  if (!found) return null;
  return {
    kind: found.kind,
    label: SEGMENT_LABELS[found.kind] || "تخطي",
    start: found.start,
    end: found.end,
    remaining: Math.max(0, Math.round(found.end - at)),
  };
}

/** Series the viewer excluded from automatic skipping (Nuvio #771). */
export const SKIP_EXCEPT_LIMIT = 300;
export function cleanSkipExcept(input) {
  return Array.isArray(input)
    ? [
        ...new Set(
          input.filter(
            (id) => typeof id === "string" && /^[\w:.-]{1,120}$/.test(id),
          ),
        ),
      ].slice(-SKIP_EXCEPT_LIMIT)
    : [];
}

/**
 * The skip preferences for a viewing: the viewer's own, except that a series
 * they excluded offers the button instead of skipping on its own. Skipping by
 * hand always stays available.
 */
export function skipPreferences(settings = {}, seriesId = "") {
  if (!seriesId || !cleanSkipExcept(settings.skipExcept).includes(seriesId))
    return settings;
  const manual = (mode) => (mode === "auto" ? "button" : mode);
  return {
    ...settings,
    skipIntro: manual(settings.skipIntro ?? "button"),
    skipOutro: manual(settings.skipOutro ?? "off"),
  };
}
