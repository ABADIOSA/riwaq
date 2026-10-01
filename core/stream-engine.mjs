/**
 * Riwaq stream intelligence.
 *
 * Addons describe an offer with free text, so the only way to choose well is to
 * read that text carefully. The pipeline is parse -> trust -> score -> rank.
 * Every rejection and every point is recorded, because a ranking a viewer
 * cannot inspect is a ranking they cannot correct.
 *
 * Arabic subtitle and dub detection is a parsed field here rather than a
 * keyword bonus bolted on at the end: for this audience it decides whether an
 * offer is watchable at all.
 */

export const TIERS = [
  "4K_DV",
  "4K_HDR",
  "4K",
  "1080p_HDR",
  "1080p",
  "720p",
  "SD",
  "ROUGH",
];
export const TIER_LABELS = {
  "4K_DV": "4K دولبي فيجن",
  "4K_HDR": "4K نطاق ديناميكي عالٍ",
  "4K": "4K",
  "1080p_HDR": "1080p نطاق ديناميكي عالٍ",
  "1080p": "1080p",
  "720p": "720p",
  SD: "دقة عادية",
  ROUGH: "نسخ أولية",
};
export const SAFETY_LEVELS = ["strict", "balanced", "off"];

const MB = 1024 * 1024;
const SIZE_UNITS = {
  k: 1024,
  m: MB,
  g: 1024 * MB,
  t: 1024 * 1024 * MB,
};
// Typical delivery bitrates in megabits per second, used only for plausibility.
const BITRATE_HINT = {
  4320: 60,
  2160: 22,
  1440: 14,
  1080: 8,
  720: 4,
  480: 1.6,
  0: 1,
};
const SOURCE_BITRATE_FACTOR = {
  REMUX: 3.2,
  BluRay: 1.9,
  BDRip: 1,
  "WEB-DL": 1,
  WEBRip: 0.75,
  HDRip: 0.6,
  HDTV: 0.6,
  DVDRip: 0.5,
};
const RESOLUTION_LABEL = {
  4320: "8K",
  2160: "4K",
  1440: "1440p",
  1080: "1080p",
  720: "720p",
  480: "480p",
  0: "غير معروفة",
};
const SOURCE_RANK = {
  REMUX: 100,
  BluRay: 92,
  "WEB-DL": 88,
  BDRip: 78,
  WEBRip: 74,
  HDRip: 58,
  HDTV: 52,
  DVDRip: 40,
  SCR: 24,
  TC: 16,
  TS: 8,
  CAM: 0,
  "": 60,
};
const AUDIO_RANK = {
  Atmos: 100,
  "DTS-X": 96,
  TrueHD: 92,
  "DTS-HD MA": 88,
  FLAC: 80,
  DTS: 72,
  "DD+": 64,
  AC3: 54,
  Opus: 50,
  AAC: 46,
  MP3: 24,
  "": 40,
};
// Groups with a long record of accurate, complete encodes. Not exhaustive and
// deliberately conservative: a missing group is neutral, never penalised.
const TRUSTED_GROUPS = new Set(
  [
    "FraMeSToR",
    "BLURANiUM",
    "CtrlHD",
    "Chotab",
    "D-Z0N3",
    "DON",
    "EbP",
    "ESiR",
    "HiDt",
    "HiFi",
    "KRaLiMaRKo",
    "NTb",
    "SA89",
    "TAoE",
    "TayTO",
    "W4NK3R",
    "decibeL",
    "playBD",
    "HDMaNiAcS",
    "SiCFoI",
    "iFT",
    "FLUX",
    "NOSiViD",
    "monkee",
    "SMURF",
    "TOMMY",
    "CMRG",
    "Kitsune",
    "QOQ",
    "playWEB",
    "3L",
    "BiZKiT",
    "PmP",
    "SPHD",
    "ZQ",
    "GalaxyRG",
    "RARBG",
    "YTS",
    "PSA",
    "QxR",
    "Tigole",
    "UTR",
    "afm72",
    "Silence",
    "Vyndros",
    "ImE",
    "Ghost",
    "SubsPlease",
    "Erai-raws",
    "HorribleSubs",
    "Judas",
    "Anime Time",
    "Cleo",
    "smol",
  ].map((g) => g.toLowerCase()),
);
// Groups whose releases are frequently mislabelled, re-encoded or padded.
const SUSPECT_GROUPS = new Set(
  [
    "mkvcage",
    "rmteam",
    "shaanig",
    "evo",
    "mkvhub",
    "hdhub",
    "filmxy",
    "mrmovie",
  ].map((g) => g.toLowerCase()),
);
const ARAB_COUNTRIES = new Set([
  "SA",
  "AE",
  "EG",
  "MA",
  "DZ",
  "IQ",
  "JO",
  "KW",
  "LB",
  "QA",
  "SY",
  "TN",
  "YE",
  "LY",
  "OM",
  "BH",
  "SD",
  "PS",
  "MR",
  "SO",
  "DJ",
  "KM",
]);
const COUNTRY_LANGUAGE = {
  US: "en",
  GB: "en",
  CA: "en",
  AU: "en",
  IE: "en",
  NZ: "en",
  FR: "fr",
  BE: "fr",
  DE: "de",
  AT: "de",
  CH: "de",
  ES: "es",
  MX: "es",
  AR: "es",
  CO: "es",
  CL: "es",
  IT: "it",
  JP: "ja",
  KR: "ko",
  CN: "zh",
  TW: "zh",
  HK: "zh",
  RU: "ru",
  UA: "uk",
  TR: "tr",
  IN: "hi",
  PK: "ur",
  BD: "bn",
  PT: "pt",
  BR: "pt",
  NL: "nl",
  PL: "pl",
  SE: "sv",
  NO: "no",
  DK: "da",
  FI: "fi",
  GR: "el",
  IL: "he",
  IR: "fa",
  TH: "th",
  VN: "vi",
  ID: "id",
  MY: "ms",
  PH: "tl",
  RO: "ro",
  HU: "hu",
  CZ: "cs",
  BG: "bg",
  RS: "sr",
  HR: "hr",
  SK: "sk",
};
const LANGUAGE_WORDS = [
  [/\b(arabic|arabe|arabisch)\b|عرب/i, "ar"],
  [/\b(english|eng|anglais)\b/i, "en"],
  [/\b(french|fre|fra|francais|français|vff|vostfr|truefrench)\b/i, "fr"],
  [/\b(german|ger|deu|deutsch)\b/i, "de"],
  [/\b(spanish|spa|esp|castellano|latino)\b/i, "es"],
  [/\b(italian|ita)\b/i, "it"],
  [/\b(japanese|jpn|jap)\b/i, "ja"],
  [/\b(korean|kor)\b/i, "ko"],
  [/\b(chinese|chi|zho|mandarin|cantonese)\b/i, "zh"],
  [/\b(russian|rus)\b/i, "ru"],
  [/\b(turkish|tur)\b/i, "tr"],
  [/\b(hindi|hin|tamil|telugu)\b/i, "hi"],
  [/\b(portuguese|por|brazilian)\b/i, "pt"],
  [/\b(persian|farsi|fas|per)\b/i, "fa"],
  [/\b(dutch|nld|nederlands)\b/i, "nl"],
  [/\b(polish|pol|lektor)\b/i, "pl"],
  [/\b(hebrew|heb)\b/i, "he"],
];
// Arabic release vocabulary. "مترجم" marks burned or bundled Arabic subtitles;
// "مدبلج" marks an Arabic audio track. Treating them as the same signal sends
// dubbed children's content to viewers who wanted the original audio.
const ARABIC_SUB_RX =
  /مترجم|مترجمة|ترجمة\s*عربية|ترجمه|تعريب|نسخة\s*مترجمة|arabic\s*sub|ara\s*sub|sub\s*arabic|arsub/i;
const ARABIC_DUB_RX =
  /مدبلج|مدبلجة|دبلجة|دوبلاج|مدبلجه|arabic\s*dub|dub\s*arabic|aradub|\bدبلجه\b/i;
const ARABIC_HARDSUB_RX = /هارد\s*سب|hard\s*sub|hardsub|hc[-. ]?sub|hardcoded/i;
const ARABIC_ANY_RX = /عرب|arabic|\bara\b/i;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lower = (value) => String(value || "").toLowerCase();

function sourceText(stream) {
  return [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
    stream?.filename,
  ]
    .filter((part) => typeof part === "string")
    .join(" \n ");
}

function parseSize(text, stream) {
  const hinted = Number(
    stream?.behaviorHints?.videoSize || stream?.sizebytes || stream?.size,
  );
  if (Number.isFinite(hinted) && hinted > 0) return Math.round(hinted);
  const match = text.match(
    /(\d+(?:[.,]\d+)?)\s*(t|g|m|k)i?b\b|(\d+(?:[.,]\d+)?)\s*(تيرا|جيجا|ميجا|جيغا)/i,
  );
  if (!match) return 0;
  if (match[3]) {
    const unit = { تيرا: "t", جيجا: "g", جيغا: "g", ميجا: "m" }[match[4]];
    return Math.round(Number(match[3].replace(",", ".")) * SIZE_UNITS[unit]);
  }
  const value = Number(match[1].replace(",", "."));
  return Math.round(value * SIZE_UNITS[match[2].toLowerCase()]);
}

function parseSeeders(text) {
  const match = text.match(
    /(?:👤|👥|🌱|⇵|seed(?:er)?s?|بذور|سيدرز)\s*[:：]?\s*(\d{1,7})/i,
  );
  return match ? Number(match[1]) : null;
}

// "1080p", "2160i" or a bare "1080", but never a size or a rate such as
// "720 MB" or "1080 kbps".
const linesRx = (n) =>
  new RegExp(
    `\\b${n}(?:[pi]\\b|\\b(?![.,]\\d|\\s*(?:[kmgt]i?b|[km]bps|fps|hz)\\b))`,
    "i",
  );
const LINES = [4320, 2160, 1440, 1080, 720].map((n) => [n, linesRx(n)]);

function parseResolution(text, source) {
  // A stated number of lines wins over words. "1080p UHD BluRay" is a 1080p
  // encode made from a 4K disc (often with Dolby Vision and HDR10), and
  // "4K remaster" names how the film was restored, not this file.
  for (const [n, rx] of LINES) if (rx.test(text)) return n;
  if (/\b(480[pi]|576[pi]|360[pi])\b/i.test(text)) return 480;
  if (/\b8k\b/i.test(text)) return 4320;
  if (/\b(4k|uhd)\b/i.test(text)) return 2160;
  if (/\b2k\b/i.test(text)) return 1440;
  if (/\bfhd\b/i.test(text)) return 1080;
  // Without an explicit marker the source format is the only honest hint.
  if (["CAM", "TS", "TC", "SCR"].includes(source)) return 480;
  if (source === "DVDRip") return 480;
  if (/\bhd\b/i.test(text)) return 720;
  return 0;
}

function parseHdr(text) {
  const dolby =
    /\b(dolby\s*vision|dovi|dv)\b/i.test(text) && !/\bdvd\b/i.test(text);
  const hdr10plus = /\bhdr10\s*(?:\+|plus)\b/i.test(text);
  const hdr10 = hdr10plus || /\bhdr10\b/i.test(text);
  const hlg = /\bhlg\b/i.test(text);
  const generic = /\bhdr\b/i.test(text);
  if (dolby && (hdr10 || generic)) return "DV+HDR10";
  if (dolby) return "DV";
  if (hdr10plus) return "HDR10+";
  if (hdr10 || generic) return "HDR10";
  if (hlg) return "HLG";
  return null;
}

function parseCodec(text) {
  if (/\bav1\b/i.test(text)) return "AV1";
  if (/\b(hevc|x265|h\.?\s?265)\b/i.test(text)) return "HEVC";
  if (/\b(avc|x264|h\.?\s?264)\b/i.test(text)) return "AVC";
  if (/\bvp9\b/i.test(text)) return "VP9";
  if (/\b(xvid|divx)\b/i.test(text)) return "XviD";
  if (/\bmpeg-?2\b/i.test(text)) return "MPEG2";
  return "";
}

function parseSource(text) {
  if (/\bremux\b/i.test(text)) return "REMUX";
  if (/\b(bdrip|brrip|bd-?rip)\b/i.test(text)) return "BDRip";
  if (/\b(blu-?ray|bluray|bdmv|bd(?:25|50|66|100))\b/i.test(text))
    return "BluRay";
  if (/\bweb[-. ]?rip\b/i.test(text)) return "WEBRip";
  if (
    /\b(web[-. ]?dl|webdl|amzn|nf|dsnp|hmax|atvp|hulu|pcok|stan|shahid)\b/i.test(
      text,
    )
  )
    return "WEB-DL";
  if (/\bweb\b/i.test(text)) return "WEB-DL";
  if (/\bhd-?rip\b/i.test(text)) return "HDRip";
  if (/\b(hdtv|pdtv|sdtv|dvb|tvrip)\b/i.test(text)) return "HDTV";
  if (/\b(dvdrip|dvd-?r|dvd5|dvd9)\b/i.test(text)) return "DVDRip";
  if (/\b(dvdscr|scr|screener)\b/i.test(text)) return "SCR";
  if (/\btelecine\b/i.test(text) || /(?<![.\w])tc(?![\w])/i.test(text))
    return "TC";
  if (/\b(hdts|telesync)\b/i.test(text) || /(?<![.\w])ts(?![\w])/i.test(text))
    return "TS";
  if (/\b(hdcam|camrip|\bcam\b)\b/i.test(text)) return "CAM";
  return "";
}

function parseAudio(text) {
  if (/\batmos\b/i.test(text)) return "Atmos";
  if (/\bdts[-. ]?x\b/i.test(text)) return "DTS-X";
  if (/\btrue-?hd\b/i.test(text)) return "TrueHD";
  if (/\bdts[-. ]?hd(?:[-. ]?ma)?\b/i.test(text)) return "DTS-HD MA";
  if (/\bflac\b/i.test(text)) return "FLAC";
  if (/\bdts\b/i.test(text)) return "DTS";
  if (/\b(ddp|dd\+|e-?ac-?3|eac3)\b/i.test(text)) return "DD+";
  if (/\b(ac-?3|dd(?:5|2|7)[.\- ]?\d)\b/i.test(text)) return "AC3";
  if (/\bopus\b/i.test(text)) return "Opus";
  if (/\baac\b/i.test(text)) return "AAC";
  if (/\bmp3\b/i.test(text)) return "MP3";
  return "";
}

function parseChannels(text) {
  const attached = text.match(
    /(?:atmos|true-?hd|dts(?:[-. ]?hd)?(?:[-. ]?ma)?|dts[-. ]?x|ddp?|e?-?ac-?3|eac3|aac|flac|opus)[\s.\-]*([752])[.\- ]([01])\b/i,
  );
  if (attached) return `${attached[1]}.${attached[2]}`;
  // A bare "2.1" is far more often a file size than a channel layout.
  const bare = text.match(
    /(?<![\d.])([752])[.\- ]([01])(?![\d])(?!\s*(?:[kmgt]i?b|جيجا|ميجا|تيرا|جيغا))/i,
  );
  return bare ? `${bare[1]}.${bare[2]}` : "";
}

function parseEditions(text) {
  const editions = [];
  const table = [
    [/\bextended\b/i, "Extended"],
    [/\bdirector'?s?\s*cut\b/i, "Director's Cut"],
    [/\bimax\b/i, "IMAX"],
    [/\bremaster(ed)?\b/i, "Remastered"],
    [/\btheatrical\b/i, "Theatrical"],
    [/\b(unrated|uncut)\b/i, "Uncut"],
    [/\bcriterion\b/i, "Criterion"],
    [/\bopen\s*matte\b/i, "Open Matte"],
    [/\bfinal\s*cut\b/i, "Final Cut"],
  ];
  for (const [rx, label] of table) if (rx.test(text)) editions.push(label);
  return editions;
}

function parseGroup(text) {
  const bracketed = text.match(/\[([A-Za-z0-9][\w .&'-]{1,24})\]/);
  if (
    bracketed &&
    !/^(rd|ad|pm|dl|tb|oc)(\+|\s*(?:download|dl))?$/i.test(bracketed[1])
  )
    return bracketed[1];
  const trailing = text.match(
    /-\s*([A-Za-z0-9][\w&]{1,20})(?:\.(?:mkv|mp4|avi|ts|m4v))?\s*(?:\n|$)/,
  );
  return trailing ? trailing[1] : "";
}

function parseEpisode(text) {
  const standard = text.match(/\bs(\d{1,2})[. _-]?e(\d{1,3})\b/i);
  if (standard)
    return { season: Number(standard[1]), episode: Number(standard[2]) };
  const cross = text.match(/\b(\d{1,2})x(\d{1,3})\b/);
  if (cross) return { season: Number(cross[1]), episode: Number(cross[2]) };
  return { season: null, episode: null };
}

function parsePack(text, episode) {
  if (episode.episode !== null) return false;
  return (
    /\b(complete|season\s*pack|full\s*season|batch|الموسم\s*كامل|كامل)\b/i.test(
      text,
    ) ||
    /\bs\d{1,2}\b/i.test(text) ||
    /\b\d{1,3}\s*[-~]\s*\d{1,3}\b/.test(text)
  );
}

const DEBRID_SLUGS = {
  rd: "RD",
  ad: "AD",
  pm: "PM",
  dl: "DL",
  tb: "TB",
  oc: "OC",
  "real-debrid": "RD",
  realdebrid: "RD",
  alldebrid: "AD",
  premiumize: "PM",
  "debrid-link": "DL",
  debridlink: "DL",
  torbox: "TB",
  offcloud: "OC",
};
function parseDebrid(text) {
  // Addons mark a cached debrid offer as "[RD+]" and an uncached one as
  // "[RD download]". A bare "DL" is almost always the tail of "WEB-DL".
  const bracket = text.match(
    /\[\s*(RD|AD|PM|DL|TB|OC)\s*(\+|download|dl)?\s*\]/i,
  );
  const named = text.match(
    /\b(real-?debrid|alldebrid|premiumize|debrid-?link|torbox|offcloud)\b/i,
  );
  const slug = bracket
    ? DEBRID_SLUGS[lower(bracket[1])]
    : named
      ? DEBRID_SLUGS[lower(named[1])] || ""
      : "";
  if (bracket && /^(download|dl)$/i.test(bracket[2] || ""))
    return { debrid: slug, cached: false };
  const cached =
    (!!bracket && bracket[2] === "+") ||
    /⚡/.test(text) ||
    /\b(cached|instant)\b/i.test(text) ||
    /مخزّن|مخزن/.test(text);
  return { debrid: slug, cached };
}

function parseLanguages(text) {
  const languages = new Set();
  for (const match of text.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)) {
    const code = [...match[0]]
      .map((char) => String.fromCharCode(char.codePointAt(0) - 0x1f1e6 + 65))
      .join("");
    if (ARAB_COUNTRIES.has(code)) languages.add("ar");
    else if (COUNTRY_LANGUAGE[code]) languages.add(COUNTRY_LANGUAGE[code]);
  }
  for (const [rx, code] of LANGUAGE_WORDS)
    if (rx.test(text)) languages.add(code);
  return [...languages];
}

export function parseStream(stream = {}) {
  const text = sourceText(stream);
  const source = parseSource(text);
  const episode = parseEpisode(text);
  const { debrid, cached } = parseDebrid(text);
  const languages = parseLanguages(text);
  const arabicSub = ARABIC_SUB_RX.test(text);
  const arabicDub = ARABIC_DUB_RX.test(text);
  const arabicHint =
    arabicSub ||
    arabicDub ||
    ARABIC_ANY_RX.test(text) ||
    languages.includes("ar");
  if (arabicHint && !languages.includes("ar")) languages.push("ar");
  const group = parseGroup(text);
  const kind =
    typeof stream.infoHash === "string" &&
    /^[a-f\d]{40}$/i.test(stream.infoHash)
      ? "torrent"
      : typeof stream.ytId === "string" && stream.ytId
        ? "youtube"
        : typeof stream.url === "string" && /^https?:\/\//i.test(stream.url)
          ? "http"
          : typeof stream.externalUrl === "string" &&
              /^https?:\/\//i.test(stream.externalUrl)
            ? "external"
            : "unknown";
  const resolution = parseResolution(text, source);
  return {
    text,
    resolution,
    resolutionLabel: RESOLUTION_LABEL[resolution] || "غير معروفة",
    hdr: parseHdr(text),
    codec: parseCodec(text),
    bitDepth:
      /\b(10|12)\s?bits?\b/i.test(text) || /\bhi10p?\b/i.test(text) ? 10 : 8,
    source,
    audio: parseAudio(text),
    channels: parseChannels(text),
    size: parseSize(text, stream),
    seeders: parseSeeders(text),
    languages,
    arabic: {
      sub: arabicSub,
      dub: arabicDub,
      hardsub: ARABIC_HARDSUB_RX.test(text) && arabicHint,
    },
    group,
    trustedGroup: !!group && TRUSTED_GROUPS.has(lower(group)),
    suspectGroup: !!group && SUSPECT_GROUPS.has(lower(group)),
    editions: parseEditions(text),
    season: episode.season,
    episode: episode.episode,
    pack: parsePack(text, episode),
    debrid,
    cached,
    kind,
    sample: /\bsample\b/i.test(text),
    trailer: /\b(trailer|teaser|مقطع\s*دعائي)\b/i.test(text),
    extra:
      /\b(featurette|behind\s*the\s*scenes|deleted\s*scenes|bloopers)\b/i.test(
        text,
      ),
    threeD: /\b(3d|hsbs|h-?sbs|half-?ou)\b/i.test(text),
    upscaled: /\b(upscal(?:e|ed|ing)|ai[-. ]?enhanced|fake\s*4k)\b/i.test(text),
    junk: /(www\.[a-z0-9-]+\.[a-z]{2,}|https?:\/\/|\bdownload\s+now\b|\bsign\s*up\b|\bpassword\b|\bxxx\b|\b18\+\b)/i.test(
      text,
    ),
  };
}

/**
 * Rejects offers that cannot be what they claim. `safety` mirrors the setting a
 * viewer can lower: strict drops everything below, balanced keeps rough sources
 * when nothing better exists, off drops only outright junk.
 */
export function trustStream(parsed, context = {}) {
  const safety = SAFETY_LEVELS.includes(context.safety)
    ? context.safety
    : "strict";
  const rejections = [];
  const reject = (code, label) => rejections.push({ code, label });
  if (parsed.sample) reject("sample", "ملف عيّنة قصير");
  if (parsed.trailer) reject("trailer", "مقطع دعائي وليس العمل");
  if (parsed.extra) reject("extra", "مادة إضافية وليست العمل");
  if (parsed.junk) reject("junk", "وصف يحمل روابط أو دعاية");
  if (safety !== "off") {
    if (parsed.upscaled) reject("upscaled", "دقة مضخّمة صناعياً");
    if (
      context.hideCam !== false &&
      ["CAM", "TS", "TC"].includes(parsed.source)
    )
      reject("cam", "نسخة تصوير داخل الصالة");
  }
  if (safety === "strict" && parsed.source === "SCR")
    reject("screener", "نسخة مراجعة");
  const wanted = context.requested || {};
  if (
    Number.isInteger(wanted.season) &&
    Number.isInteger(parsed.season) &&
    !parsed.pack &&
    parsed.season !== wanted.season
  )
    reject("season", `موسم مختلف (${parsed.season})`);
  if (
    Number.isInteger(wanted.episode) &&
    Number.isInteger(parsed.episode) &&
    parsed.episode !== wanted.episode
  )
    reject("episode", `حلقة مختلفة (${parsed.episode})`);
  // A file far below the bitrate its own label implies is usually a stub, a
  // placeholder or a re-encode of something else entirely.
  if (
    safety !== "off" &&
    parsed.size > 0 &&
    Number.isFinite(wanted.runtime) &&
    wanted.runtime > 0
  ) {
    const expected =
      ((BITRATE_HINT[parsed.resolution] || 1) *
        1_000_000 *
        wanted.runtime *
        60) /
      8;
    const floor = safety === "strict" ? 0.18 : 0.1;
    if (parsed.size < expected * floor)
      reject("undersized", "حجم أصغر من أن يطابق الوصف");
  }
  if (safety === "strict" && parsed.kind === "torrent" && parsed.seeders === 0)
    reject("dead", "لا يوجد مصدر متاح للتورنت");
  const limit = Number(context.sizeLimit) || 0;
  if (limit > 0 && parsed.size > limit)
    reject("oversize", `أكبر من حدّ الحجم (${sizeLabel(parsed.size)})`);
  return { ok: rejections.length === 0, rejections };
}

function languagePreference(value) {
  return String(value || "")
    .split(",")
    .map((code) => code.trim().toLowerCase().slice(0, 3))
    .filter(Boolean);
}

/**
 * Scores a parsed offer against the viewer's preferences. The returned reasons
 * are what the interface shows, so each one has to read as a sentence a person
 * would accept as an explanation.
 */
export function scoreStream(parsed, preferences = {}) {
  const reasons = [];
  const add = (points, code, label) => {
    if (!points) return;
    reasons.push({ code, label, points: Math.round(points) });
  };
  const ceiling = Number(preferences.quality) || 2160;
  const subLanguages = languagePreference(preferences.subtitleLanguage);
  const audioLanguages = languagePreference(preferences.audioLanguage);
  const wantsArabicAudio = audioLanguages.some(
    (code) => code === "ar" || code === "ara",
  );
  const wantsArabicSubs = subLanguages.some(
    (code) => code === "ar" || code === "ara",
  );

  if (parsed.resolution) {
    // Above the ceiling a stream is not better, it is just heavier.
    const distance =
      parsed.resolution <= ceiling ? 0 : Math.log2(parsed.resolution / ceiling);
    const base =
      (Math.log2(parsed.resolution / 240) / Math.log2(4320 / 240)) * 300;
    add(base - distance * 90, "resolution", `${parsed.resolutionLabel}`);
  }
  if (parsed.hdr) {
    const bonus =
      { DV: 70, "DV+HDR10": 80, "HDR10+": 55, HDR10: 45, HLG: 25 }[
        parsed.hdr
      ] || 0;
    add(preferences.hdr === false ? bonus / 4 : bonus, "hdr", parsed.hdr);
  }
  add(
    (SOURCE_RANK[parsed.source] ?? 60) * 0.9,
    "source",
    parsed.source || "مصدر غير موصوف",
  );
  add(
    (AUDIO_RANK[parsed.audio] ?? 40) * 0.5,
    "audio",
    parsed.audio || "صوت غير موصوف",
  );
  if (parsed.channels === "7.1") add(14, "channels", "7.1");
  else if (parsed.channels === "5.1") add(10, "channels", "5.1");
  if (parsed.codec === "HEVC" || parsed.codec === "AV1")
    add(18, "codec", parsed.codec);
  if (parsed.bitDepth >= 10) add(10, "depth", "10 بت");

  if (parsed.arabic.dub)
    add(
      wantsArabicAudio ? 150 : -40,
      "arabic-dub",
      wantsArabicAudio ? "صوت عربي مدبلج" : "دبلجة عربية غير مطلوبة",
    );
  if (parsed.arabic.sub)
    add(wantsArabicSubs ? 130 : 20, "arabic-sub", "ترجمة عربية");
  if (parsed.arabic.hardsub)
    add(-25, "hardsub", "ترجمة محروقة لا يمكن إخفاؤها");
  for (const code of parsed.languages) {
    if (code === "ar") continue;
    if (audioLanguages.includes(code))
      add(25, "language", `لغة مفضّلة: ${code}`);
  }

  if (parsed.cached)
    add(
      preferences.preferCached === false ? 60 : 220,
      "cached",
      `مخزّن مسبقاً${parsed.debrid ? ` على ${parsed.debrid}` : ""}`,
    );
  else if (parsed.kind === "http") add(60, "direct", "رابط مباشر");
  if (parsed.kind === "torrent" && Number.isFinite(parsed.seeders))
    add(
      Math.min(80, Math.log2(parsed.seeders + 1) * 14),
      "seeders",
      `${parsed.seeders} مصدر`,
    );
  if (parsed.trustedGroup) add(45, "group", `فريق موثوق: ${parsed.group}`);
  if (parsed.suspectGroup)
    add(-70, "group-risk", `فريق كثير الأخطاء: ${parsed.group}`);
  if (parsed.editions.length) add(12, "edition", parsed.editions.join("، "));
  if (parsed.threeD) add(-120, "3d", "نسخة ثلاثية الأبعاد");
  if (parsed.pack) add(-15, "pack", "حزمة موسم كامل");

  if (parsed.size > 0) {
    // Reward files near the size their own label implies and taper off in both
    // directions, so neither a padded encode nor a starved one wins on bytes.
    const seconds =
      (Number(preferences.runtime) > 0 ? Number(preferences.runtime) : 90) * 60;
    const factor = SOURCE_BITRATE_FACTOR[parsed.source] ?? 1;
    const expected =
      (BITRATE_HINT[parsed.resolution] || 4) * 1_000_000 * factor * seconds;
    const ratio = (parsed.size * 8) / expected;
    add(
      clamp(40 - Math.abs(Math.log2(ratio || 1)) * 18, -40, 40),
      "size",
      sizeLabel(parsed.size),
    );
  }
  const score = reasons.reduce((total, reason) => total + reason.points, 0);
  return { score: Math.round(score), reasons };
}

export function sizeLabel(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

export function tierOf(parsed) {
  const dolby = parsed.hdr === "DV" || parsed.hdr === "DV+HDR10";
  if (["CAM", "TS", "TC", "SCR"].includes(parsed.source)) return "ROUGH";
  if (parsed.resolution >= 2160)
    return dolby ? "4K_DV" : parsed.hdr ? "4K_HDR" : "4K";
  if (parsed.resolution >= 1080) return parsed.hdr ? "1080p_HDR" : "1080p";
  if (parsed.resolution >= 720) return "720p";
  return "SD";
}

/**
 * Full pipeline. Returns kept offers in ranked order, the tier grouping the
 * interface renders, and the dropped offers with their reasons so a viewer can
 * always ask "where did the rest go".
 */
export function analyzeStreams(streams = [], settings = {}, context = {}) {
  const safety = SAFETY_LEVELS.includes(settings.streamSafety)
    ? settings.streamSafety
    : "strict";
  const trustContext = {
    ...context,
    safety,
    hideCam: settings.hideCam !== false,
    sizeLimit: (Number(settings.streamSizeLimit) || 0) * 1024 * 1024 * 1024,
  };
  const preferences = { ...settings, runtime: context.requested?.runtime };
  const kept = [];
  const dropped = [];
  streams.forEach((stream, index) => {
    const parsed = parseStream(stream);
    const trust = trustStream(parsed, trustContext);
    const entry = { stream, parsed, index, tier: tierOf(parsed) };
    if (!trust.ok) {
      dropped.push({ ...entry, rejections: trust.rejections });
      return;
    }
    const { score, reasons } = scoreStream(parsed, preferences);
    kept.push({ ...entry, score, reasons });
  });
  kept.sort((a, b) => b.score - a.score || a.index - b.index);
  const groups = TIERS.map((tier) => ({
    tier,
    label: TIER_LABELS[tier],
    items: kept.filter((entry) => entry.tier === tier),
  })).filter((group) => group.items.length > 0);
  return { kept, dropped, groups, safety };
}
