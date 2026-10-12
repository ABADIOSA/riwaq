/**
 * Song tags from a local audio file, for local music (electron/music-library.mjs
 * and web/music.js): title, artist, album, album artist, year, track number
 * and the cover picture.
 *
 * Formats: ID3v2.2–2.4 and ID3v1 (MP3, AAC and anything prefixed by ID3),
 * FLAC metadata blocks, Vorbis and Opus comments in Ogg, MP4/M4A `ilst`
 * atoms, and RIFF WAVE `LIST/INFO` or `id3 ` chunks.
 *
 * The file is read only through `read(offset, length)`, which resolves to a
 * Uint8Array (shorter at the end of the file). Large parts of a file (the
 * audio itself, padding, seek tables) are stepped over by offset, never read.
 * Nothing here throws: a file it cannot read gives `{}`. Browser-safe.
 */

/** The most one tag, chunk or atom may take before it is skipped. */
export const MAX_TAG = 8 * 1024 * 1024;
/** Pictures larger than this are not covers worth decoding. */
export const MAX_COVER = 4 * 1024 * 1024;

export const cleanTag = (value, max = 100) =>
  String(value ?? "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const utf8 = new TextDecoder("utf-8");
const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const utf16le = new TextDecoder("utf-16le");
let arabicPage = null;
try {
  arabicPage = new TextDecoder("windows-1256");
} catch {}

const ascii = (bytes) => String.fromCharCode(...bytes);
const latin1 = (bytes) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 4096)
    text += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return text;
};
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u24be = (b, i) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
const u32be = (b, i) =>
  ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const u32le = (b, i) =>
  ((b[i + 3] << 24) >>> 0) + ((b[i + 2] << 16) | (b[i + 1] << 8) | b[i]);
const syncsafe = (b, i) =>
  ((b[i] & 0x7f) << 21) |
  ((b[i + 1] & 0x7f) << 14) |
  ((b[i + 2] & 0x7f) << 7) |
  (b[i + 3] & 0x7f);
const starts = (b, text, at = 0) =>
  b.length >= at + text.length &&
  [...text].every((ch, i) => b[at + i] === ch.charCodeAt(0));

/**
 * Text in no declared encoding: plain ASCII as is; bytes that read as Arabic
 * in Windows' Arabic code page (as older tools wrote Arabic tags) as that;
 * anything else as ISO-8859-1, which is what such tags officially are.
 */
export function decodeLegacy(bytes) {
  if (bytes.every((c) => c < 0x80)) return ascii(bytes);
  try {
    return utf8Strict.decode(bytes);
  } catch {}
  if (arabicPage) {
    const text = arabicPage.decode(bytes);
    const high = [...text].filter((ch) => ch.charCodeAt(0) >= 0x80);
    const arabic = high.filter((ch) => /[؀-ۿ]/.test(ch)).length;
    if (high.length && arabic / high.length >= 0.6) return text;
  }
  return latin1(bytes);
}

function utf16(bytes, bigEndian) {
  let start = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) [bigEndian, start] = [false, 2];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff)
    [bigEndian, start] = [true, 2];
  const body = bytes.slice(start, start + ((bytes.length - start) & ~1));
  if (bigEndian)
    for (let i = 0; i < body.length; i += 2)
      [body[i], body[i + 1]] = [body[i + 1], body[i]];
  return utf16le.decode(body);
}

/** ID3 text: 0 ISO-8859-1, 1 UTF-16 with a byte order mark, 2 UTF-16BE, 3 UTF-8. */
function id3Text(encoding, bytes) {
  const text =
    encoding === 3
      ? utf8.decode(bytes)
      : encoding === 1 || encoding === 2
        ? utf16(bytes, encoding === 2)
        : decodeLegacy(bytes);
  // Several values are separated by NUL: the first one is the tag.
  return text.split("\0").find((part) => part.trim()) || "";
}

/** Where a NUL-terminated string in this encoding ends (index after it). */
function afterTerminator(bytes, from, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let i = from; i + 1 < bytes.length; i += 2)
      if (bytes[i] === 0 && bytes[i + 1] === 0) return i + 2;
    return bytes.length;
  }
  const i = bytes.indexOf(0, from);
  return i < 0 ? bytes.length : i + 1;
}

/** The picture's type from its first bytes; only JPEG and PNG are kept. */
export function pictureType(bytes) {
  if (bytes?.[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes?.[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  return "";
}

/** Keeps the front cover (picture type 3) over any other picture. */
function offerPicture(out, data, kind) {
  const mime = pictureType(data);
  if (!mime || data.length > MAX_COVER) return;
  if (!out.picture || (kind === 3 && out.pictureKind !== 3)) {
    out.picture = { mime, data };
    out.pictureKind = kind;
  }
}

const removeUnsync = (bytes) => {
  const out = [];
  for (let i = 0; i < bytes.length; i++) {
    out.push(bytes[i]);
    if (bytes[i] === 0xff && bytes[i + 1] === 0x00) i++;
  }
  return Uint8Array.from(out);
};

const ID3_FIELDS = {
  TIT2: "title",
  TT2: "title",
  TPE1: "artist",
  TP1: "artist",
  TPE2: "albumArtist",
  TP2: "albumArtist",
  TALB: "album",
  TAL: "album",
  TRCK: "track",
  TRK: "track",
  TYER: "year",
  TYE: "year",
  TDRC: "year",
  TDOR: "year",
};

/** A whole ID3v2 tag, from its "ID3" header on. */
export function parseId3v2(tag) {
  const out = {};
  if (!starts(tag, "ID3") || tag.length < 10) return out;
  const major = tag[3],
    flags = tag[5];
  if (major < 2 || major > 4) return out;
  let body = tag.subarray(10, 10 + syncsafe(tag, 6));
  if (flags & 0x80 && major < 4) body = removeUnsync(body);
  let pos = 0;
  if (flags & 0x40 && major >= 3)
    pos = major === 4 ? syncsafe(body, 0) : u32be(body, 0) + 4;
  const idLength = major === 2 ? 3 : 4,
    headLength = major === 2 ? 6 : 10;
  while (pos + headLength <= body.length) {
    const id = ascii(body.subarray(pos, pos + idLength));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    const length =
      major === 2
        ? u24be(body, pos + 3)
        : major === 4
          ? syncsafe(body, pos + 4)
          : u32be(body, pos + 4);
    const format = major === 2 ? 0 : body[pos + 9];
    let data = body.subarray(pos + headLength, pos + headLength + length);
    pos += headLength + length;
    if (major === 3) {
      if (format & 0xc0) continue; // compressed or encrypted
      if (format & 0x20) data = data.subarray(1);
    } else if (major === 4) {
      if (format & 0x0c) continue;
      if (format & 0x40) data = data.subarray(1);
      if (format & 0x01) data = data.subarray(4);
      if (format & 0x02) data = removeUnsync(data);
    }
    if (!data.length) continue;
    const field = ID3_FIELDS[id];
    if (field && !out[field]) {
      out[field] = id3Text(data[0], data.subarray(1));
    } else if (id === "APIC" || id === "PIC") {
      const encoding = data[0];
      let at;
      if (id === "PIC") at = 4;
      else at = afterTerminator(data, 1, 0);
      const kind = data[at];
      at = afterTerminator(data, at + 1, encoding);
      offerPicture(out, data.subarray(at), kind);
    }
  }
  return out;
}

/** ID3v1: the last 128 bytes of an MP3. */
export function parseId3v1(tail) {
  if (tail.length < 128) return {};
  const tag = tail.subarray(tail.length - 128);
  if (!starts(tag, "TAG")) return {};
  const field = (from, length) => {
    const bytes = tag.subarray(from, from + length);
    const end = bytes.indexOf(0);
    return decodeLegacy(end < 0 ? bytes : bytes.subarray(0, end)).trim();
  };
  return {
    title: field(3, 30),
    artist: field(33, 30),
    album: field(63, 30),
    year: field(93, 4),
    track: tag[125] === 0 && tag[126] ? String(tag[126]) : "",
  };
}

/** A FLAC PICTURE block (also base64 in Vorbis METADATA_BLOCK_PICTURE). */
function flacPicture(out, b) {
  if (b.length < 32) return;
  const kind = u32be(b, 0);
  let at = 8 + u32be(b, 4);
  if (at + 4 > b.length) return;
  at += 4 + u32be(b, at) + 16;
  if (at + 4 > b.length) return;
  const length = u32be(b, at);
  offerPicture(out, b.subarray(at + 4, at + 4 + length), kind);
}

function base64Bytes(text) {
  try {
    const binary = atob(String(text).replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

const VORBIS_FIELDS = {
  TITLE: "title",
  ARTIST: "artist",
  ALBUM: "album",
  ALBUMARTIST: "albumArtist",
  "ALBUM ARTIST": "albumArtist",
  DATE: "year",
  YEAR: "year",
  TRACKNUMBER: "track",
};

/** A Vorbis comment block (FLAC, Ogg Vorbis, Opus): little-endian lengths. */
export function parseVorbisComments(b, out = {}) {
  if (b.length < 8) return out;
  let at = 4 + u32le(b, 0);
  if (at + 4 > b.length) return out;
  const count = Math.min(u32le(b, at), 10000);
  at += 4;
  for (let i = 0; i < count && at + 4 <= b.length; i++) {
    const length = u32le(b, at);
    const entry = b.subarray(at + 4, at + 4 + length);
    at += 4 + length;
    const eq = entry.indexOf(0x3d);
    if (eq < 1) continue;
    const key = ascii(entry.subarray(0, eq)).toUpperCase();
    const field = VORBIS_FIELDS[key];
    if (field) {
      if (!out[field]) out[field] = utf8.decode(entry.subarray(eq + 1));
    } else if (key === "METADATA_BLOCK_PICTURE") {
      const picture = base64Bytes(utf8.decode(entry.subarray(eq + 1)));
      if (picture) flacPicture(out, picture);
    }
  }
  return out;
}

async function parseFlac(read, start, out) {
  let pos = start + 4;
  for (let i = 0; i < 128; i++) {
    const head = await read(pos, 4);
    if (head.length < 4) break;
    const last = head[0] & 0x80,
      type = head[0] & 0x7f,
      length = u24be(head, 1);
    pos += 4;
    if (type === 4 && length <= MAX_TAG)
      parseVorbisComments(await read(pos, length), out);
    else if (type === 6 && length <= MAX_COVER + 4096)
      flacPicture(out, await read(pos, length));
    pos += length;
    if (last) break;
  }
  return out;
}

/** The first `count` packets of an Ogg stream that fit in `bytes`. */
export function oggPackets(bytes, count = 2) {
  const packets = [];
  let parts = [],
    pos = 0;
  while (pos + 27 <= bytes.length && packets.length < count) {
    if (!starts(bytes, "OggS", pos)) break;
    const segments = bytes[pos + 26];
    const table = bytes.subarray(pos + 27, pos + 27 + segments);
    let at = pos + 27 + segments;
    for (const lace of table) {
      parts.push(bytes.subarray(at, at + lace));
      at += lace;
      if (lace < 255) {
        const size = parts.reduce((n, p) => n + p.length, 0);
        const packet = new Uint8Array(size);
        let o = 0;
        for (const p of parts) packet.set(p, (o += p.length) - p.length);
        packets.push(packet);
        parts = [];
        if (packets.length >= count) break;
      }
    }
    pos = at;
  }
  return packets;
}

async function parseOgg(read, size, out) {
  // Tags usually fit in the first pages; a large embedded cover needs more.
  for (const length of [256 * 1024, MAX_TAG]) {
    const bytes = await read(0, Math.min(size || length, length));
    const comment = oggPackets(bytes, 2)[1];
    if (comment) {
      if (comment[0] === 3 && starts(comment, "vorbis", 1))
        parseVorbisComments(comment.subarray(7), out);
      else if (starts(comment, "OpusTags"))
        parseVorbisComments(comment.subarray(8), out);
      return out;
    }
    if (bytes.length >= (size || 0)) break;
  }
  return out;
}

const MP4_FIELDS = {
  "©nam": "title",
  "©ART": "artist",
  aART: "albumArtist",
  "©alb": "album",
  "©day": "year",
};

/** The boxes in [start, end): calls `visit(type, bodyStart, end)`. */
async function boxes(read, start, end, visit) {
  let pos = start;
  for (let i = 0; i < 1024 && pos + 8 <= end; i++) {
    const head = await read(pos, 16);
    if (head.length < 8) return;
    let size = u32be(head, 0),
      offset = 8;
    if (size === 1) {
      if (head.length < 16) return;
      size = u32be(head, 8) * 2 ** 32 + u32be(head, 12);
      offset = 16;
    } else if (size === 0) size = end - pos;
    if (size < offset) return;
    const type = latin1(head.subarray(4, 8));
    if ((await visit(type, pos + offset, Math.min(end, pos + size))) === false)
      return;
    pos += size;
  }
}

/** Items of an `ilst` atom held in memory. */
function parseIlst(b, out) {
  let pos = 0;
  while (pos + 8 <= b.length) {
    const size = u32be(b, pos);
    if (size < 8 || pos + size > b.length) break;
    const type = latin1(b.subarray(pos + 4, pos + 8));
    let inner = pos + 8;
    while (inner + 16 <= pos + size) {
      const length = u32be(b, inner);
      if (length < 16 || inner + length > pos + size) break;
      if (starts(b, "data", inner + 4)) {
        const kind = u32be(b, inner + 8) & 0xffffff;
        const value = b.subarray(inner + 16, inner + length);
        const field = MP4_FIELDS[type];
        if (field && !out[field]) out[field] = utf8.decode(value);
        else if (type === "trkn" && value.length >= 4 && !out.track)
          out.track = String(u16be(value, 2) || "");
        else if (type === "covr" && (kind === 13 || kind === 14 || kind === 0))
          offerPicture(out, value, 3);
      }
      inner += length;
    }
    pos += size;
  }
  return out;
}

async function parseMp4(read, size, out) {
  const end = size || Number.MAX_SAFE_INTEGER;
  const within = async (start, stop, path) => {
    await boxes(read, start, stop, async (type, body, boxEnd) => {
      if (type !== path[0]) return true;
      if (path.length === 1) {
        if (boxEnd - body <= MAX_TAG)
          parseIlst(await read(body, boxEnd - body), out);
        return false;
      }
      // An ISO `meta` box starts with version and flags; QuickTime's does not.
      let next = body;
      if (type === "meta") {
        const peek = await read(body, 8);
        if (!starts(peek, "hdlr", 4)) next += 4;
      }
      await within(next, boxEnd, path.slice(1));
      return false;
    });
  };
  await within(0, end, ["moov", "udta", "meta", "ilst"]);
  if (!out.title && !out.artist) await within(0, end, ["moov", "meta", "ilst"]);
  return out;
}

const INFO_FIELDS = {
  INAM: "title",
  IART: "artist",
  IPRD: "album",
  ICRD: "year",
  ITRK: "track",
  IPRT: "track",
};

async function parseWav(read, size, out) {
  let pos = 12;
  const end = size || Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < 256 && pos + 8 <= end; i++) {
    const head = await read(pos, 12);
    if (head.length < 8) break;
    const id = ascii(head.subarray(0, 4)),
      length = u32le(head, 4);
    if (id === "LIST" && starts(head, "INFO", 8) && length <= MAX_TAG) {
      const list = await read(pos + 12, length - 4);
      let at = 0;
      while (at + 8 <= list.length) {
        const sub = ascii(list.subarray(at, at + 4)),
          subLength = u32le(list, at + 4);
        const bytes = list.subarray(at + 8, at + 8 + subLength);
        const field = INFO_FIELDS[sub];
        const text = decodeLegacy(bytes).split("\0")[0];
        if (field && !out[field] && text.trim()) out[field] = text;
        at += 8 + subLength + (subLength & 1);
      }
    } else if ((id === "id3 " || id === "ID3 ") && length <= MAX_TAG) {
      const found = parseId3v2(await read(pos + 8, length));
      for (const [key, value] of Object.entries(found))
        if (out[key] === undefined) out[key] = value;
    }
    pos += 8 + length + (length & 1);
  }
  return out;
}

/** The tag fields in the shape local music keeps. */
export function tidyTags(raw = {}, { picture = false } = {}) {
  const year = /\d{4}/.exec(String(raw.year || ""))?.[0] || "";
  const track = Number.parseInt(String(raw.track || ""), 10);
  const tags = {};
  for (const key of ["title", "artist", "album", "albumArtist"]) {
    const value = cleanTag(raw[key]);
    if (value) tags[key] = value;
  }
  if (year) tags.year = Number(year);
  if (track > 0 && track < 10000) tags.track = track;
  if (raw.picture) {
    tags.cover = true;
    if (picture) tags.picture = raw.picture;
  }
  return tags;
}

/**
 * Reads the tags of one file. `size` is its length in bytes; `picture: true`
 * also returns the cover's bytes (`{ mime, data }`), otherwise only
 * `cover: true` says there is one.
 */
export async function readAudioTags({ read, size = 0, picture = false } = {}) {
  try {
    const out = {};
    const head = await read(0, 16);
    let start = 0;
    if (starts(head, "ID3") && head.length >= 10) {
      const length = syncsafe(head, 6) + 10 + (head[5] & 0x10 ? 10 : 0);
      if (length <= MAX_TAG)
        Object.assign(out, parseId3v2(await read(0, length)));
      start = length;
    }
    const at = start ? await read(start, 16) : head;
    if (starts(at, "fLaC")) {
      // FLAC's own comments outrank an ID3 tag stuck in front of it.
      const flac = await parseFlac(read, start, {});
      Object.assign(
        out,
        Object.fromEntries(Object.entries(flac).filter(([, v]) => v)),
      );
    } else if (starts(head, "OggS")) await parseOgg(read, size, out);
    else if (starts(head, "ftyp", 4)) await parseMp4(read, size, out);
    else if (starts(head, "RIFF") && starts(head, "WAVE", 8))
      await parseWav(read, size, out);
    else if (size >= 128) {
      // MPEG audio: an ID3v1 tag at the very end fills what ID3v2 left.
      const v1 = parseId3v1(await read(size - 128, 128));
      for (const [key, value] of Object.entries(v1))
        if (value && !out[key]) out[key] = value;
    }
    return tidyTags(out, { picture });
  } catch {
    return {};
  }
}

/**
 * A title and artist from a file name when the file has no tags:
 * "03 - Artist - Song" or "Artist – Song" become { artist, title }.
 */
export function namedTags(fileName) {
  const base = cleanTag(fileName).replace(/^\d{1,3}\s*[-._)]\s*(?=\S)/, "");
  const parts = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  return parts
    ? { artist: cleanTag(parts[1]), title: cleanTag(parts[2]) }
    : { title: base || cleanTag(fileName) };
}

/** A reader over bytes already in memory (tests, small files). */
export const memoryReader = (bytes) => async (offset, length) =>
  bytes.subarray(offset, offset + length);
