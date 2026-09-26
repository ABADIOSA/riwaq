/**
 * Live television for Riwaq.
 *
 * Three source shapes cover almost every provider a viewer will bring: an M3U
 * playlist URL, a standalone XMLTV guide, and Xtream Codes credentials that
 * generate both. Everything here is pure parsing over text so it can be tested
 * without a network, and playlist URLs frequently embed the subscription
 * credentials, so channels leave this module addressed by an opaque key only.
 */

import { keyFor, webUrl } from "./protocol.mjs";
import { foldArabic } from "./arabic.mjs";

export const CATCHUP_TYPES = [
  "default",
  "append",
  "shift",
  "flussonic",
  "xtream",
];
const XTREAM_LIVE_RX =
  /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)\.(\w+)(?:\?|$)/i;
const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeXml(value) {
  return String(value || "").replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity) => {
      if (entity[0] === "#") {
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function readAttributes(source) {
  const attrs = {};
  for (const match of String(source).matchAll(
    /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g,
  ))
    attrs[(match[1] || match[3]).toLowerCase()] = decodeXml(
      match[2] ?? match[4],
    );
  return attrs;
}

/**
 * Parses an M3U/M3U8 playlist. Unknown directives are ignored rather than
 * failing the import: a single odd line should not cost a viewer their whole
 * channel list.
 */
export function parseM3U(text) {
  if (typeof text !== "string") throw new Error("قائمة القنوات غير صالحة");
  if (text.length > 80_000_000) throw new Error("ملف القنوات كبير جداً");
  const lines = text.split(/\r?\n/);
  if (!/^\s*#EXTM3U/i.test(lines[0] || ""))
    throw new Error("الملف ليس قائمة M3U صالحة");
  const header = readAttributes(lines[0]);
  const channels = [];
  let pending = null;
  let group = "";
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    if (/^#EXTINF:/i.test(line)) {
      const body = line.slice(line.indexOf(":") + 1);
      const comma = body.lastIndexOf(",");
      const attrs = readAttributes(comma >= 0 ? body.slice(0, comma) : body);
      pending = {
        name: (comma >= 0 ? body.slice(comma + 1) : "").trim(),
        attrs,
        options: {},
      };
      continue;
    }
    if (/^#EXTGRP:/i.test(line)) {
      group = line.slice(line.indexOf(":") + 1).trim();
      continue;
    }
    if (/^#EXTVLCOPT:/i.test(line) && pending) {
      const [key, ...rest] = line.slice(line.indexOf(":") + 1).split("=");
      pending.options[key.trim().toLowerCase()] = rest.join("=").trim();
      continue;
    }
    if (line.startsWith("#")) continue;
    if (!pending) continue;
    const attrs = pending.attrs;
    const name = pending.name || attrs["tvg-name"] || attrs["tvg-id"] || "قناة";
    let url;
    try {
      url = webUrl(line).toString();
    } catch {
      pending = null;
      continue;
    }
    channels.push({
      key: keyFor(`${url}|${name}`),
      name,
      url,
      logo: /^https?:\/\//i.test(attrs["tvg-logo"] || "")
        ? attrs["tvg-logo"]
        : "",
      group: attrs["group-title"] || group || "بدون تصنيف",
      tvgId: attrs["tvg-id"] || "",
      tvgName: attrs["tvg-name"] || "",
      shift: Number(attrs["tvg-shift"]) || 0,
      catchup: attrs.catchup || attrs["catchup-type"] || "",
      catchupSource: attrs["catchup-source"] || "",
      catchupDays: Number(attrs["catchup-days"]) || 0,
      userAgent: pending.options["http-user-agent"] || "",
      referrer: pending.options["http-referrer"] || "",
      attrs,
    });
    pending = null;
    // #EXTGRP labels the entry that follows it, not the rest of the playlist.
    group = "";
  }
  return { epgUrl: header["url-tvg"] || header["x-tvg-url"] || "", channels };
}

/** XMLTV timestamps are `YYYYMMDDHHMMSS` with an optional ` +HHMM` offset. */
export function parseXmltvTime(value) {
  const match = String(value || "").match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*([+-])(\d{2})(\d{2}))?/,
  );
  if (!match) return null;
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    sign,
    offsetHours,
    offsetMinutes,
  ] = match;
  const base = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second || 0),
  );
  if (!sign) return base;
  const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60000;
  return sign === "+" ? base - offset : base + offset;
}

function innerText(block, tag, language = "") {
  const matches = [
    ...block.matchAll(
      new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi"),
    ),
  ];
  if (!matches.length) return "";
  const preferred =
    (language &&
      matches.find((m) => readAttributes(m[1]).lang?.startsWith(language))) ||
    matches[0];
  return decodeXml(
    preferred[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"),
  ).trim();
}

/**
 * Parses an XMLTV guide. `language` picks which `<title lang="…">` wins, which
 * is how an Arabic guide stays Arabic when the provider also ships English.
 */
export function parseXmltv(text, { language = "ar", limit = 200_000 } = {}) {
  if (typeof text !== "string") throw new Error("دليل البرامج غير صالح");
  if (text.length > 120_000_000) throw new Error("ملف دليل البرامج كبير جداً");
  const channels = new Map();
  for (const match of text.matchAll(
    /<channel\b([^>]*)>([\s\S]*?)<\/channel>/gi,
  )) {
    const id = readAttributes(match[1]).id;
    if (!id) continue;
    const icon = [...match[2].matchAll(/<icon\b([^>]*)\/?>/gi)]
      .map((iconMatch) => readAttributes(iconMatch[1]).src)
      .find((src) => /^https?:\/\//i.test(src || ""));
    channels.set(id, {
      id,
      name: innerText(match[2], "display-name", language) || id,
      icon: icon || "",
    });
  }
  const programmes = [];
  for (const match of text.matchAll(
    /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi,
  )) {
    if (programmes.length >= limit) break;
    const attrs = readAttributes(match[1]);
    const start = parseXmltvTime(attrs.start);
    const stop = parseXmltvTime(attrs.stop);
    if (start === null || !attrs.channel) continue;
    programmes.push({
      channel: attrs.channel,
      start,
      stop: stop === null ? start + 3600000 : stop,
      title: innerText(match[2], "title", language) || "بدون عنوان",
      description: innerText(match[2], "desc", language),
      category: innerText(match[2], "category", language),
      episode: innerText(match[2], "episode-num", language),
    });
  }
  programmes.sort(
    (a, b) => a.start - b.start || a.channel.localeCompare(b.channel),
  );
  return { channels, programmes };
}

/** Indexes programmes by channel id so guide lookups stay linear. */
export function indexProgrammes(programmes = []) {
  const index = new Map();
  for (const programme of programmes) {
    if (!index.has(programme.channel)) index.set(programme.channel, []);
    index.get(programme.channel).push(programme);
  }
  for (const list of index.values()) list.sort((a, b) => a.start - b.start);
  return index;
}

export function nowNext(index, channelId, at = Date.now()) {
  const list = index.get(channelId) || [];
  const now =
    list.find((programme) => programme.start <= at && programme.stop > at) ||
    null;
  const next = list.find((programme) => programme.start > at) || null;
  return { now, next };
}

/**
 * Slices the guide into the window the grid renders, keeping each programme's
 * fractional offset and width so the view does not repeat the arithmetic.
 */
export function buildGuide(
  channels,
  index,
  { start = Date.now(), hours = 4 } = {},
) {
  const span = Math.max(1, Math.min(24, hours)) * 3600000;
  const end = start + span;
  return channels.map((channel) => {
    const list = index.get(channel.tvgId) || [];
    const blocks = list
      .filter((programme) => programme.stop > start && programme.start < end)
      .map((programme) => ({
        title: programme.title,
        description: programme.description,
        start: programme.start,
        stop: programme.stop,
        offset: Math.max(0, (programme.start - start) / span),
        width:
          (Math.min(programme.stop, end) - Math.max(programme.start, start)) /
          span,
        past: programme.stop <= Date.now(),
        live: programme.start <= Date.now() && programme.stop > Date.now(),
      }));
    return { key: channel.key, name: channel.name, logo: channel.logo, blocks };
  });
}

export function detectCatchup(channel) {
  const raw = String(channel.catchup || "")
    .toLowerCase()
    .trim();
  if (raw === "flussonic" || raw === "fs") return "flussonic";
  if (raw === "xc" || raw === "xtream") return "xtream";
  if (raw === "append") return "append";
  if (raw === "shift" || raw === "timeshift") return "shift";
  if (raw === "default" || channel.catchupSource) return "default";
  if (XTREAM_LIVE_RX.test(channel.url || "")) return "xtream";
  return null;
}

const pad = (value, width = 2) => String(value).padStart(width, "0");
function strftime(format, date) {
  return format.replace(
    /[YmdHMS]/g,
    (token) =>
      ({
        Y: String(date.getUTCFullYear()),
        m: pad(date.getUTCMonth() + 1),
        d: pad(date.getUTCDate()),
        H: pad(date.getUTCHours()),
        M: pad(date.getUTCMinutes()),
        S: pad(date.getUTCSeconds()),
      })[token],
  );
}

function fillTemplate(template, { start, end, now, duration }) {
  const tokens = {
    start: String(start),
    utc: String(start),
    timestamp: String(start),
    end: String(end),
    utcend: String(end),
    now: String(now),
    lutc: String(now),
    timenow: String(now),
    duration: String(duration),
    dur: String(duration),
    offset: String(Math.max(0, now - start)),
    "duration-minutes": String(Math.ceil(duration / 60)),
  };
  return template
    .replace(/\$?\{(?:start|utc):([^}]+)\}/gi, (_, format) =>
      strftime(format, new Date(start * 1000)),
    )
    .replace(
      /\$?\{(\w[\w-]*)\}/g,
      (match, token) => tokens[token.toLowerCase()] ?? match,
    );
}

function flussonicUrl(base, start, duration) {
  const query = base.indexOf("?");
  const path = query >= 0 ? base.slice(0, query) : base;
  const suffix = query >= 0 ? base.slice(query) : "";
  const match = path.match(/^(.*)\/([^/]+)\.(m3u8|ts|mpd)$/i);
  if (match) {
    const stem =
      match[2] === "mpegts" || match[2] === "mono" ? "index" : match[2];
    return `${match[1]}/${stem}-${start}-${duration}.${match[3]}${suffix}`;
  }
  return `${path.replace(/\/+$/, "")}/archive-${start}-${duration}.ts${suffix}`;
}

/**
 * Builds the replay URL for a programme that already aired. Providers disagree
 * about the scheme, so the channel's own declaration decides and the Xtream
 * path shape is the fallback.
 */
export function buildCatchupUrl(channel, startMs, endMs, nowMs = Date.now()) {
  const type = detectCatchup(channel);
  if (!type) return null;
  const start = Math.floor(startMs / 1000);
  const end = Math.floor(endMs / 1000);
  const now = Math.floor(nowMs / 1000);
  const duration = Math.max(60, end - start);
  const base = channel.catchupSource || channel.url;
  if (!base) return null;
  if (type === "default" && channel.catchupSource)
    return fillTemplate(channel.catchupSource, { start, end, now, duration });
  if (type === "append")
    return (
      channel.url +
      fillTemplate(channel.catchupSource || "", { start, end, now, duration })
    );
  if (type === "shift") {
    const url = new URL(channel.url);
    url.searchParams.set("utc", String(start));
    url.searchParams.set("lutc", String(now));
    return url.toString();
  }
  if (type === "flussonic") return flussonicUrl(channel.url, start, duration);
  const parts = channel.url.match(XTREAM_LIVE_RX);
  if (!parts) return null;
  const [, origin, username, password, streamId] = parts;
  const stamp = new Date(startMs);
  const when = `${stamp.getUTCFullYear()}-${pad(stamp.getUTCMonth() + 1)}-${pad(stamp.getUTCDate())}:${pad(stamp.getUTCHours())}-${pad(stamp.getUTCMinutes())}`;
  return `${origin}/streaming/timeshift.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&stream=${streamId}&start=${when}&duration=${Math.ceil(duration / 60)}`;
}

/** Xtream Codes exposes a playlist, a guide and a JSON API from one host. */
export function xtreamEndpoints({ host, username, password }) {
  const base = webUrl(host);
  base.pathname = base.pathname.replace(/\/+$/, "");
  base.search = "";
  const credentials = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const origin = base.toString().replace(/\/$/, "");
  return {
    origin,
    playlist: `${origin}/get.php?${credentials}&type=m3u_plus&output=ts`,
    epg: `${origin}/xmltv.php?${credentials}`,
    api: (action) =>
      `${origin}/player_api.php?${credentials}&action=${encodeURIComponent(action)}`,
    stream: (id, extension = "ts") =>
      `${origin}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.${extension}`,
  };
}

/** Turns the Xtream JSON listing into the same channel shape as an M3U import. */
export function xtreamChannels(streams, categories, credentials) {
  const endpoints = xtreamEndpoints(credentials);
  const names = new Map(
    (Array.isArray(categories) ? categories : []).map((category) => [
      String(category.category_id),
      category.category_name || "بدون تصنيف",
    ]),
  );
  return (Array.isArray(streams) ? streams : [])
    .filter((stream) => stream && stream.stream_id !== undefined)
    .map((stream) => {
      const url = endpoints.stream(stream.stream_id);
      const name = stream.name || `قناة ${stream.stream_id}`;
      return {
        key: keyFor(`${url}|${name}`),
        name,
        url,
        logo: /^https?:\/\//i.test(stream.stream_icon || "")
          ? stream.stream_icon
          : "",
        group: names.get(String(stream.category_id)) || "بدون تصنيف",
        tvgId: stream.epg_channel_id || "",
        tvgName: stream.name || "",
        shift: Number(stream.tv_archive_duration) ? 0 : 0,
        catchup: Number(stream.tv_archive) ? "xtream" : "",
        catchupSource: "",
        catchupDays: Number(stream.tv_archive_duration) || 0,
        userAgent: "",
        referrer: "",
        attrs: {},
      };
    });
}

export function groupChannels(channels) {
  const groups = new Map();
  for (const channel of channels)
    groups.set(channel.group, (groups.get(channel.group) || 0) + 1);
  return [...groups.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar"));
}

/** Search that ignores Arabic diacritics and alef/ya/ta-marbuta spelling drift. */
export function searchChannels(channels, query) {
  const needle = foldArabic(query);
  if (!needle) return channels;
  return channels.filter(
    (channel) =>
      foldArabic(channel.name).includes(needle) ||
      foldArabic(channel.group).includes(needle),
  );
}
