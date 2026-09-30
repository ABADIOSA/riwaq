/**
 * Award icons (Harbor's Award icons page). Wikidata lists the awards a work
 * received (P166) one category at a time; they are grouped here into the
 * families people recognise, from their Arabic or English labels, so the
 * details page can show a trophy per family with a count. Pure.
 */

export const AWARD_FAMILIES = [
  ["oscar", "الأوسكار", /academy award|oscar|أوسكار|اوسكار/i, "#E6B450"],
  ["globe", "غولدن غلوب", /golden globe|غولدن غلوب|الكرة الذهبية/i, "#F2C94C"],
  ["emmy", "إيمي", /emmy|إيمي|ايمي/i, "#C9A227"],
  ["bafta", "بافتا", /bafta|british academy|الأكاديمية البريطانية/i, "#D4AF37"],
  [
    "cannes",
    "مهرجان كان",
    /cannes|palme d.or|السعفة الذهبية|مهرجان كان/i,
    "#E0C068",
  ],
  [
    "venice",
    "مهرجان البندقية",
    /venice|golden lion|البندقية|الأسد الذهبي/i,
    "#C8A951",
  ],
  [
    "berlin",
    "مهرجان برلين",
    /berlin|golden bear|برلين|الدب الذهبي/i,
    "#B8963E",
  ],
  [
    "sag",
    "نقابة ممثلي الشاشة",
    /screen actors guild|نقابة ممثلي الشاشة/i,
    "#9FA8B3",
  ],
  ["critics", "اختيار النقاد", /critics.? choice|اختيار النقاد/i, "#8FB3D9"],
  ["saturn", "ساتورن", /saturn award|ساتورن/i, "#A78BFA"],
  ["annie", "آني", /annie award|جائزة آني/i, "#F472B6"],
  ["grammy", "غرامي", /grammy|غرامي|جرامي/i, "#E5A54B"],
];

/** Families with counts, most first; labels that match none are "other". */
export function awardFamilies(awards) {
  const counts = new Map();
  let other = 0;
  for (const award of Array.isArray(awards) ? awards : []) {
    const name = String(award?.name || "");
    const family = AWARD_FAMILIES.find(([, , pattern]) => pattern.test(name));
    if (family) counts.set(family[0], (counts.get(family[0]) || 0) + 1);
    else if (name) other++;
  }
  const out = AWARD_FAMILIES.filter(([id]) => counts.has(id)).map(
    ([id, label, , color]) => ({ id, label, color, count: counts.get(id) }),
  );
  out.sort((a, b) => b.count - a.count);
  return { families: out, other };
}
