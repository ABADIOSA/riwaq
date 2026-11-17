/**
 * Pictures a viewer chooses from their own computer for a collection or a
 * folder (a still cover, a moving GIF, a backdrop or a logo).
 *
 * - The bytes decide what a file is: GIF, PNG, JPEG or WebP by their
 *   signature, with width and height read from the header. A name ending
 *   in ".gif" proves nothing, and a ".gifv" or a video is refused.
 * - At most 8 MB and 4096 px a side, read once.
 * - Riwaq keeps the file under a random ID and stores only "local:<id>"
 *   in the collection: never a path. The page gets the picture back from
 *   that ID alone; another device holding a backup or an account copy
 *   has no such file and shows the still cover or the placeholder.
 * - Files no profile's collections name any more are deleted, except very
 *   new ones (chosen a moment ago, not saved into a folder yet).
 *
 * The storage itself is injected: files under userData on Windows
 * (electron/collection-art.mjs), IndexedDB on the web
 * (web/collection-art.js). Browser-safe.
 */
import { LOCAL_ART } from "./collections.mjs";

export const ART_MAX_BYTES = 8 * 1024 * 1024;
export const ART_MAX_SIDE = 4096;
export const ART_GRACE_MS = 10 * 60 * 1000;
export const ART_TYPES = {
  gif: "image/gif",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
const ID = /^[a-f\d]{32}$/;

const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b, i) =>
  ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

/**
 * What the bytes are: { type, mime, width, height }, or an error in the
 * viewer's words. `bytes` is a Uint8Array (a Node Buffer is one).
 */
export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!b.length) throw new Error("الملف فارغ");
  if (b.length > ART_MAX_BYTES) throw new Error("الصورة أكبر من 8 ميغابايت");
  let type = "";
  let width = 0;
  let height = 0;
  if (b.length >= 10 && /^GIF8[79]a$/.test(ascii(b, 0, 6))) {
    type = "gif";
    width = u16le(b, 6);
    height = u16le(b, 8);
  } else if (
    b.length >= 24 &&
    b[0] === 0x89 &&
    ascii(b, 1, 3) === "PNG" &&
    ascii(b, 12, 4) === "IHDR"
  ) {
    type = "png";
    width = u32be(b, 16);
    height = u32be(b, 20);
  } else if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    type = "jpeg";
    // Walk the markers to the frame header (SOF0–SOF15 but DHT, JPG, DAC).
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (
        marker === 0xd8 ||
        marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        i += 2;
        continue;
      }
      const length = u16be(b, i + 2);
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc].includes(marker)
      ) {
        height = u16be(b, i + 5);
        width = u16be(b, i + 7);
        break;
      }
      if (length < 2) break;
      i += 2 + length;
    }
  } else if (
    b.length >= 30 &&
    ascii(b, 0, 4) === "RIFF" &&
    ascii(b, 8, 4) === "WEBP"
  ) {
    type = "webp";
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") {
      width = u24le(b, 24) + 1;
      height = u24le(b, 27) + 1;
    } else if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    } else if (chunk === "VP8 ") {
      width = u16le(b, 26) & 0x3fff;
      height = u16le(b, 28) & 0x3fff;
    }
  }
  if (!type)
    throw new Error("ليست صورة GIF أو PNG أو JPEG أو WebP؛ الفيديو لا يُقبل");
  if (!width || !height) throw new Error("تعذّرت قراءة أبعاد الصورة");
  if (width > ART_MAX_SIDE || height > ART_MAX_SIDE)
    throw new Error(`أبعاد الصورة أكبر من ${ART_MAX_SIDE} بكسل`);
  return { type, mime: ART_TYPES[type], width, height };
}

/** A fresh random ID for a stored picture. */
export function newArtId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** The stored ID inside "local:<id>", or "". */
export const artId = (ref) =>
  typeof ref === "string" && LOCAL_ART.test(ref) ? ref.slice(6) : "";
export const validArtId = (id) => typeof id === "string" && ID.test(id);

/** Every "local:" picture named by these collections. */
export function referencedArt(collections) {
  const found = new Set();
  const look = (value) => {
    const id = artId(value);
    if (id) found.add(id);
  };
  for (const c of Array.isArray(collections) ? collections : []) {
    look(c?.cover);
    look(c?.logo);
    for (const f of Array.isArray(c?.folders) ? c.folders : [])
      for (const key of ["cover", "gif", "backdrop", "logo"]) look(f?.[key]);
  }
  return found;
}

/**
 * The store over an injected backend:
 *   write(id, bytes, mime), read(id) → { bytes, mime } | null,
 *   remove(id), list() → [{ id, at }] (at: when it was written, ms).
 */
export class ArtStore {
  constructor(backend, { now = () => Date.now() } = {}) {
    this.backend = backend;
    this.now = now;
  }
  /** Checks and keeps the bytes; returns "local:<id>". */
  async add(bytes) {
    const found = sniffImage(bytes);
    const id = newArtId();
    await this.backend.write(id, bytes, found.mime);
    return { ref: `local:${id}`, ...found };
  }
  /** The picture for "local:<id>", or null (another device's, or gone). */
  async read(ref) {
    const id = artId(ref);
    if (!id) return null;
    return (await this.backend.read(id)) || null;
  }
  /** Deletes what `referenced` does not name, past the grace period. */
  async sweep(referenced) {
    const keep = referenced instanceof Set ? referenced : new Set(referenced);
    let removed = 0;
    for (const { id, at } of await this.backend.list()) {
      if (!validArtId(id) || keep.has(id)) continue;
      if (this.now() - (Number(at) || 0) < ART_GRACE_MS) continue;
      await this.backend.remove(id);
      removed++;
    }
    return removed;
  }
}
