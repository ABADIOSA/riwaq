/**
 * Riwaq's collection templates (November 2026 beta): eight collections
 * inspired by the subjects of Kaptain's Nuvio collections (International
 * Cinema, Reality TV, Kids & Family, Documentaries, Based On, Moods & Vibes,
 * Spotlight, and the Mega collection that holds them all). They are Riwaq's
 * own arrangements, not copies of Kaptain's folders, lists or artwork:
 * every folder is a set of TMDB discover queries anyone can read and edit
 * in the collection editor, and nothing claims more than its query says.
 *
 * - Genres are TMDB's genre IDs (movie and TV lists differ: Reality,
 *   Kids and the TV "Sci-Fi & Fantasy" exist only for TV).
 * - Countries use the production country (with_origin_country) and the
 *   Arabic folder the original language (with_original_language): two
 *   different questions, labelled as such.
 * - "New" rows use recentDays, counted from the day they are asked for, so
 *   they never freeze on one year.
 * - "Based on" uses four TMDB keyword IDs from widely used community
 *   configurations (818 novel or book, 9672 true story, 9717 comic, 41645
 *   video game). They could not be checked against TMDB from the
 *   environment this was written in; each folder shows its keyword so a
 *   viewer can verify or change it.
 * - Moods are plain genre combinations, named for what they are; Riwaq
 *   does not claim to read anyone's mood.
 * - Studios and networks are the TMDB IDs Riwaq already ships in
 *   TMDB_PRESETS.
 *
 * All of it needs the viewer's TMDB key; without one the folders say so
 * (core/client.mjs, note "needs-tmdb"). Collection and folder IDs are
 * stable ("riwaq-preset-…"), so adding a template again updates it.
 * Browser-safe.
 */
import { TMDB_PRESETS } from "./collections.mjs";

const movie = (title, filters, sort = "popularity.desc") => ({
  kind: "discover",
  media: "movie",
  sort,
  title,
  filters,
});
const tv = (title, filters, sort = "popularity.desc") => ({
  kind: "discover",
  media: "tv",
  sort,
  title,
  filters,
});
const folder = (id, title, emoji, tmdb, extra = {}) => ({
  id: `riwaq-preset-${id}`,
  title,
  emoji,
  shape: "landscape",
  tmdb,
  ...extra,
});
// Enough votes for a "top rated" row to mean something.
const RATED = { voteCountGte: 300 };

// --- International cinema --------------------------------------------------

const COUNTRIES = [
  ["sa", "السعودية", "🇸🇦", "SA"],
  ["eg", "مصر", "🇪🇬", "EG"],
  ["kr", "كوريا", "🇰🇷", "KR"],
  ["jp", "اليابان", "🇯🇵", "JP"],
  ["in", "الهند", "🇮🇳", "IN"],
  ["fr", "فرنسا", "🇫🇷", "FR"],
  ["es", "إسبانيا", "🇪🇸", "ES"],
  ["tr", "تركيا", "🇹🇷", "TR"],
  ["latam", "أمريكا اللاتينية", "🌎", "MX|AR|CO|CL|PE|BR"],
  ["nordic", "الشمال الأوروبي", "❄️", "SE|DK|NO|FI|IS"],
  ["africa", "أفريقيا", "🌍", "NG|ZA|KE|GH|SN"],
];
const international = () => ({
  id: "riwaq-preset-international",
  emoji: "🌐",
  title: "السينما العالمية",
  view: "tabs",
  folders: [
    folder("intl-arabic", "بالعربية", "🗣️", [
      movie("أفلام بالعربية", { withOriginalLanguage: "ar" }),
      tv("مسلسلات بالعربية", { withOriginalLanguage: "ar" }),
      movie(
        "الأعلى تقييماً بالعربية",
        { withOriginalLanguage: "ar", voteCountGte: 50 },
        "vote_average.desc",
      ),
    ]),
    ...COUNTRIES.map(([id, name, emoji, code]) =>
      folder(`intl-${id}`, name, emoji, [
        movie(`أفلام من ${name}`, { withOriginCountry: code }),
        tv(`مسلسلات من ${name}`, { withOriginCountry: code }),
        movie(
          `الأعلى تقييماً من ${name}`,
          { withOriginCountry: code, voteCountGte: 100 },
          "vote_average.desc",
        ),
      ]),
    ),
  ],
});

// --- Reality TV ------------------------------------------------------------

const REALITY = { withGenres: "10764" };
const reality = () => ({
  id: "riwaq-preset-reality",
  emoji: "📺",
  title: "تلفزيون الواقع",
  view: "rows",
  folders: [
    folder("reality-new", "جديد", "🆕", [
      tv(
        "برامج واقع جديدة",
        { ...REALITY, recentDays: 180, voteCountGte: 5 },
        "first_air_date.desc",
      ),
    ]),
    folder("reality-trending", "الأكثر رواجاً", "🔥", [
      tv("الأكثر رواجاً", REALITY),
    ]),
    folder("reality-top", "الأعلى تقييماً", "⭐", [
      tv(
        "الأعلى تقييماً",
        { ...REALITY, voteCountGte: 100 },
        "vote_average.desc",
      ),
    ]),
    folder("reality-popular", "الأكثر تصويتاً", "👥", [
      tv("الأكثر تصويتاً", REALITY, "vote_count.desc"),
    ]),
  ],
});

// --- Kids & family ---------------------------------------------------------

const kids = () => ({
  id: "riwaq-preset-family",
  emoji: "🧸",
  title: "الأطفال والعائلة",
  view: "rows",
  folders: [
    folder("family-films", "أفلام العائلة", "👨‍👩‍👧", [
      movie("أفلام العائلة", { withGenres: "10751" }),
      movie(
        "عائلية مرشّحة",
        { withGenres: "10751", ...RATED },
        "vote_average.desc",
      ),
    ]),
    folder("family-animation", "الأنيميشن", "🎨", [
      movie("أفلام أنيميشن عائلية", { withGenres: "16,10751" }),
      movie(
        "أنيميشن مرشّح",
        { withGenres: "16", ...RATED },
        "vote_average.desc",
      ),
    ]),
    folder("family-kids-tv", "مسلسلات الأطفال", "🧒", [
      tv("مسلسلات الأطفال", { withGenres: "10762" }),
      tv("أنيميشن للعائلة", { withGenres: "16,10751" }),
    ]),
    folder("family-adventure", "مغامرات عائلية", "🗺️", [
      movie("مغامرات عائلية", { withGenres: "12,10751" }),
    ]),
  ],
});

// --- Documentaries ---------------------------------------------------------

const DOC = "99";
const docs = () => ({
  id: "riwaq-preset-docs",
  emoji: "🎥",
  title: "الوثائقيات",
  view: "rows",
  folders: [
    folder("docs-popular", "وثائقيات رائجة", "🎬", [
      movie("أفلام وثائقية", { withGenres: DOC }),
      tv("مسلسلات وثائقية", { withGenres: DOC }),
    ]),
    folder("docs-history", "التاريخ", "🏛️", [
      movie("وثائقيات تاريخية", { withGenres: `${DOC},36` }),
    ]),
    folder("docs-crime", "الجريمة", "🕵️", [
      movie("وثائقيات الجريمة", { withGenres: `${DOC},80` }),
      tv("سلاسل الجريمة الوثائقية", { withGenres: `${DOC},80` }),
    ]),
    folder("docs-music", "الموسيقى", "🎵", [
      movie("وثائقيات موسيقية", { withGenres: `${DOC},10402` }),
    ]),
    folder("docs-top", "الأعلى تقييماً", "⭐", [
      movie(
        "وثائقيات مرشّحة",
        { withGenres: DOC, voteCountGte: 150 },
        "vote_average.desc",
      ),
    ]),
  ],
});

// --- Based on --------------------------------------------------------------

const based = () => ({
  id: "riwaq-preset-based",
  emoji: "📚",
  title: "مأخوذ عن",
  view: "rows",
  folders: [
    folder("based-true", "قصص حقيقية", "📰", [
      movie("مأخوذة عن قصة حقيقية (كلمة TMDB 9672)", {
        withKeywords: "9672",
      }),
      tv("مسلسلات عن قصة حقيقية (كلمة TMDB 9672)", { withKeywords: "9672" }),
    ]),
    folder("based-books", "كتب وروايات", "📖", [
      movie("مأخوذة عن كتاب أو رواية (كلمة TMDB 818)", {
        withKeywords: "818",
      }),
      tv("مسلسلات عن كتاب أو رواية (كلمة TMDB 818)", { withKeywords: "818" }),
    ]),
    folder("based-comics", "قصص مصوّرة", "💥", [
      movie("مأخوذة عن قصص مصوّرة (كلمة TMDB 9717)", {
        withKeywords: "9717",
      }),
    ]),
    folder("based-games", "ألعاب فيديو", "🎮", [
      movie("مأخوذة عن ألعاب فيديو (كلمة TMDB 41645)", {
        withKeywords: "41645",
      }),
    ]),
    folder("based-history", "التاريخ", "🏺", [
      movie("أفلام تصنيفها تاريخ", { withGenres: "36" }),
    ]),
  ],
});

// --- Moods & vibes ---------------------------------------------------------

// [id, title, emoji, movie genres, tv genres, extra movie filters]
const MOODS = [
  ["feel-good", "يبعث على البهجة", "😊", "35,10751", "35,10751"],
  ["cozy", "سهرة دافئة", "☕", "10749,35", "35,18"],
  ["mind", "يشغل العقل", "🌀", "878,9648", "10765,9648"],
  ["suspense", "تشويق", "😬", "53,9648", "80,9648"],
  ["emotional", "مؤثر", "💧", "18,10749", "18"],
  ["dark", "قاتم وغامض", "🌑", "27|53", "80,18"],
  ["family-night", "ليلة عائلية", "🍿", "10751,16", "10751"],
  ["epic", "مغامرة ملحمية", "⚔️", "12,14", "10759,10765"],
  ["light", "كوميديا خفيفة", "😄", "35", "35", { withRuntimeLte: 100 }],
];
const moods = () => ({
  id: "riwaq-preset-moods",
  emoji: "🎭",
  title: "حسب المزاج",
  view: "tabs",
  folders: MOODS.map(([id, title, emoji, films, series, extra = {}]) =>
    folder(`mood-${id}`, title, emoji, [
      movie(`أفلام: ${title}`, { withGenres: films, ...extra, ...RATED }),
      tv(`مسلسلات: ${title}`, { withGenres: series, voteCountGte: 100 }),
    ]),
  ),
});

// --- Spotlight -------------------------------------------------------------

const spotlight = () => ({
  id: "riwaq-preset-spotlight",
  emoji: "🔦",
  title: "تحت الضوء",
  view: "rows",
  folders: [
    folder(
      "spot-studios",
      "استوديوهات",
      "🏢",
      TMDB_PRESETS.filter((p) => p.kind === "company"),
    ),
    folder(
      "spot-networks",
      "شبكات ومنصات",
      "📡",
      TMDB_PRESETS.filter((p) => p.kind === "network"),
    ),
    // People and franchises are the viewer's to choose: the folder says
    // what to add instead of filling itself with someone's picks.
    folder("spot-people", "ممثلون ومخرجون تختارهم", "🎬", []),
  ],
});

/** The templates, in the order the gallery shows them. */
export const PRESETS = [
  { id: "international", build: international },
  { id: "reality", build: reality },
  { id: "family", build: kids },
  { id: "docs", build: docs },
  { id: "based", build: based },
  { id: "moods", build: moods },
  { id: "spotlight", build: spotlight },
];

/**
 * The Mega collection: the seven above as one collection, each a folder
 * holding its own first folder's sources and those of the next two, so the
 * whole library opens from one place without thousands of cards at once.
 */
function mega() {
  return {
    id: "riwaq-preset-mega",
    emoji: "🗂️",
    title: "مكتبة رِواق الكبرى",
    view: "tabs",
    folders: PRESETS.filter((p) => p.id !== "mega").map(({ id, build }) => {
      const c = build();
      return folder(
        `mega-${id}`,
        c.title,
        c.emoji,
        // One query once: rows that differ only by order collapse here.
        c.folders
          .flatMap((f) => f.tmdb || [])
          .filter(
            (t, i, all) =>
              all.findIndex(
                (o) =>
                  o.media === t.media &&
                  (o.id ?? JSON.stringify(o.filters)) ===
                    (t.id ?? JSON.stringify(t.filters)),
              ) === i,
          )
          .slice(0, 12),
      );
    }),
  };
}
PRESETS.push({ id: "mega", build: mega });

/** One template as collection input for editCollections/importCollections. */
export function presetCollection(id) {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error("قالب غير معروف");
  return { ...preset.build(), pinned: false };
}

/** What the gallery shows for each template: no queries, just the facts. */
export function presetCards() {
  return PRESETS.map(({ id, build }) => {
    const c = build();
    return {
      id,
      emoji: c.emoji,
      title: c.title,
      folders: c.folders.length,
      sources: c.folders.reduce((n, f) => n + (f.tmdb?.length || 0), 0),
    };
  });
}
