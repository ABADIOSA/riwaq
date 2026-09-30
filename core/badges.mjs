/**
 * Stream badges (Harbor's Badges, Custom rules and Packs pages).
 *
 * - Built-in format chips come from what the stream engine read: resolution,
 *   HDR, codec, source, audio, size, seeds, cache, trusted group and Arabic.
 *   The viewer may turn all of them off or hide single kinds.
 * - Custom rules are the viewer's own badges: a label, a colour and a
 *   pattern tested against the stream's name and title.
 * - A pack is a JSON file of rules and hidden kinds, to share or import.
 *
 * Patterns run on every stream row, so they are kept short and patterns
 * known to backtrack without end (a repeated group that is itself repeated)
 * are refused, and a title is cut before it is tested. Browser-safe.
 */

export const BADGE_KINDS = [
  ["resolution", "الدقة"],
  ["hdr", "HDR"],
  ["codec", "الترميز"],
  ["source", "نوع النسخة"],
  ["audio", "الصوت"],
  ["size", "الحجم"],
  ["seeders", "المشاركون"],
  ["cached", "المخزّن"],
  ["group", "المجموعة الموثوقة"],
  ["arabic", "العربية"],
];
export const RULE_LIMIT = 60;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const TITLE_MAX = 400;
const DEFAULT_COLOR = "#E7B66E";

const text = (value, max) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/**
 * A pattern Riwaq will run: a valid expression of at most 200 characters,
 * without a quantified group that contains a quantifier, the shape behind
 * catastrophic backtracking. Returns the error, or "" when it is fine.
 */
export function patternProblem(pattern) {
  if (typeof pattern !== "string" || !pattern.trim()) return "اكتب نمطاً";
  if (pattern.length > 200) return "النمط أطول من 200 حرف";
  if (/\([^()]*[+*][^()]*\)\s*(?:[+*]|\{\d*,)/.test(pattern))
    return "هذا النمط قد يبطئ رِواق كثيراً؛ بسّطه";
  if (/\\[1-9]/.test(pattern)) return "المراجع الخلفية غير مدعومة";
  try {
    new RegExp(pattern, "i");
  } catch {
    return "النمط غير صحيح";
  }
  return "";
}

/** The viewer's rules, each validated; broken ones are dropped. */
export function cleanBadgeRules(input) {
  const out = [];
  for (const r of Array.isArray(input) ? input : []) {
    if (!r || typeof r !== "object") continue;
    const id = /^[\w-]{1,40}$/.test(r.id || "") ? r.id : "";
    const label = text(r.label ?? r.name, 24);
    const pattern = typeof r.pattern === "string" ? r.pattern.trim() : "";
    if (!id || !label || patternProblem(pattern) || out.some((x) => x.id === id))
      continue;
    out.push({
      id,
      label,
      pattern,
      color: HEX.test(r.color) ? r.color.toUpperCase() : DEFAULT_COLOR,
      enabled: r.enabled !== false,
    });
    if (out.length >= RULE_LIMIT) break;
  }
  return out;
}

export const cleanHiddenBadges = (input) =>
  Array.isArray(input)
    ? [...new Set(input.filter((k) => BADGE_KINDS.some(([id]) => id === k)))]
    : [];

/** The custom badges a stream earns from the enabled rules. */
export function ruleBadges(stream, rules) {
  const subject = `${stream?.name || ""} ${stream?.title || ""}`.slice(
    0,
    TITLE_MAX,
  );
  const out = [];
  for (const rule of rules || []) {
    if (!rule.enabled) continue;
    try {
      if (new RegExp(rule.pattern, "i").test(subject))
        out.push({ label: rule.label, color: rule.color });
    } catch {
      /* A rule that stopped compiling simply earns nothing. */
    }
  }
  return out;
}

const PACK = "riwaq-badges";
/** A pack to share: the rules and the hidden kinds, nothing else. */
export function exportBadgePack(settings = {}) {
  return JSON.stringify(
    {
      format: PACK,
      version: 1,
      rules: cleanBadgeRules(settings.badgeRules).map(
        ({ label, pattern, color }) => ({ label, pattern, color }),
      ),
      hidden: cleanHiddenBadges(settings.badgesHidden),
    },
    null,
    2,
  );
}

/**
 * Reads a pack: Riwaq's own, or any list of { label | name, pattern | regex,
 * color } objects. New IDs are given; the result still goes through the
 * same cleaning as the viewer's own rules.
 */
export function importBadgePack(json, makeId) {
  let data;
  try {
    data = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    throw new Error("الملف ليس JSON صالحاً");
  }
  const list = Array.isArray(data) ? data : data?.rules;
  if (!Array.isArray(list)) throw new Error("لا توجد قواعد في هذا الملف");
  const rules = cleanBadgeRules(
    list.slice(0, RULE_LIMIT).map((r, i) => ({
      id: makeId ? makeId(i) : `pack-${i}`,
      label: r?.label ?? r?.name,
      pattern: r?.pattern ?? r?.regex,
      color: r?.color,
    })),
  );
  if (!rules.length) throw new Error("لم نجد قاعدة صالحة في هذا الملف");
  return {
    rules,
    hidden: cleanHiddenBadges(data?.hidden),
    skipped: list.length - rules.length,
  };
}
