/**
 * Finding a source in a long list (an addon like AIOStreams can return a
 * hundred): words typed by the viewer, quick filters, and, in the viewer's
 * addon order, one section per addon. These narrow what is shown only; the
 * ranked list itself (what autoplay and failover use) is never changed.
 * Browser-safe.
 */
import { matchesWords } from "./arabic.mjs";

/** Quick filters: [id, label, test]. */
export const SOURCE_CHIPS = [
  ["arabic", "ترجمة أو دبلجة عربية", (s) => !!(s.arabicSub || s.arabicDub)],
  ["cached", "مخزّن", (s) => !!s.cached],
  ["hdr", "HDR ودولبي فيجن", (s) => !!s.hdr],
  ["direct", "رابط مباشر", (s) => !s.torrent && !s.external],
  ["torrent", "تورنت", (s) => !!s.torrent],
];
const CHIP_TESTS = new Map(SOURCE_CHIPS.map(([id, , test]) => [id, test]));
// Two kinds of link exclude each other; asking for both means either.
const EITHER = [["direct", "torrent"]];

/** The text a source can be found by. */
export function sourceText(s) {
  return [
    s.name,
    s.title,
    s.provider,
    s.group,
    s.source,
    s.codec,
    s.audio,
    s.hdr,
    s.resolutionLabel,
    s.resolution ? `${s.resolution}p` : "",
    s.sizeLabel,
    ...(s.languages || []),
    ...(s.badges || []).map((b) => b.label),
  ]
    .filter((v) => typeof v === "string" && v)
    .join(" ")
    .slice(0, 2000);
}

/** The sources matching the typed words and every chosen quick filter. */
export function filterSources(streams = [], { query = "", chips = [] } = {}) {
  const words = String(query || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const chosen = [...new Set(chips)].filter((c) => CHIP_TESTS.has(c));
  const groups = [];
  const alone = [];
  for (const id of chosen) {
    const pair = EITHER.find((p) => p.includes(id));
    if (pair && pair.every((p) => chosen.includes(p))) {
      if (!groups.includes(pair)) groups.push(pair);
    } else alone.push(id);
  }
  return streams.filter(
    (s) =>
      alone.every((id) => CHIP_TESTS.get(id)(s)) &&
      groups.every((pair) => pair.some((id) => CHIP_TESTS.get(id)(s))) &&
      (!words || matchesWords(sourceText(s), words)),
  );
}

/** How many sources each quick filter would leave, for its label. */
export function chipCounts(streams = []) {
  return Object.fromEntries(
    SOURCE_CHIPS.map(([id, , test]) => [id, streams.filter(test).length]),
  );
}

/**
 * One section per addon copy, in the order each first appears. A source
 * moved out of its addon's run (the series' remembered source, sources
 * outside a saved filter) still joins its addon's one section, so a heading
 * never repeats. The viewer's own home-server copy has its own section.
 */
export function addonSections(streams = []) {
  const sections = new Map();
  for (const s of streams) {
    const id = s.home ? "home" : s.addonKey || s.addonId || s.provider || "";
    const section = sections.get(id);
    if (section) section.streams.push(s);
    else
      sections.set(id, {
        id,
        name: s.home ? "نسختك على خادمك" : s.provider || s.name || "مصدر",
        streams: [s],
      });
  }
  return [...sections.values()];
}
