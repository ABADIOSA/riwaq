/**
 * The shader library in main (core/shaders.mjs has the presets).
 *
 * Downloads are the pinned upstream releases in SHADER_PACKS, fetched only on
 * the viewer's click: every hop must be HTTPS on a GitHub release host, the
 * body may not exceed the pinned size, and its SHA-256 must match before a
 * byte is written. A zip yields only flat shader files the pack's presets
 * name. The pack lands in a temporary folder and is renamed into place, so a
 * failed download never leaves half a pack. The viewer's own folder is read
 * for shader file names only.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  SHADER_HOSTS,
  SHADER_PACKS,
  packFiles,
  shaderFamily,
  shaderFileName,
} from "../core/shaders.mjs";

const MAX_OWN = 200;
const MARKER = ".riwaq-pack";

/** A pinned address, or a redirect that stays on GitHub's release hosts. */
function releaseUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !SHADER_HOSTS.includes(url.hostname)
  )
    throw new Error("تحويل إلى عنوان غير موثوق");
  return url.toString();
}

/**
 * One pinned file: redirects re-checked, the size capped while reading and
 * the SHA-256 compared before anything is returned.
 */
export async function fetchPinned(
  { url, size, sha256 },
  { fetch: get = globalThis.fetch, timeout = 60000, onProgress } = {},
) {
  let address = releaseUrl(url);
  for (let hop = 0; hop < 5; hop++) {
    let response;
    try {
      response = await get(address, {
        redirect: "manual",
        headers: { "User-Agent": "Riwaq" },
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new Error("تعذّر الوصول إلى GitHub");
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      if (!next) throw new Error("تحويل بلا وجهة");
      address = releaseUrl(new URL(next, address).toString());
      continue;
    }
    if (!response.ok)
      throw new Error(`GitHub رفض التنزيل (HTTP ${response.status})`);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared && declared !== size)
      throw new Error("حجم الملف لا يطابق الإصدار المعروف");
    const chunks = [];
    let total = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > size) {
          reader.cancel().catch(() => {});
          throw new Error("الملف أكبر من الإصدار المعروف");
        }
        chunks.push(Buffer.from(value));
        onProgress?.(total / size);
      }
    } else {
      const body = Buffer.from(await response.arrayBuffer());
      total = body.length;
      if (total > size) throw new Error("الملف أكبر من الإصدار المعروف");
      chunks.push(body);
    }
    const bytes = Buffer.concat(chunks, total);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== size || digest !== sha256)
      throw new Error("بصمة الملف لا تطابق الإصدار المعروف، فلم يُحفظ");
    return bytes;
  }
  throw new Error("تحويلات كثيرة");
}

/**
 * The named entries of a zip, flat, each at most `max` bytes. Directories,
 * nested names and anything not asked for are skipped.
 */
export function zipFiles(buffer, wanted, { max = 1024 * 1024 } = {}) {
  const want = new Set(wanted);
  const buf = Buffer.from(buffer);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("ملف الشيدرات ليس zip صالحاً");
  const count = buf.readUInt16LE(end + 10);
  let offset = buf.readUInt32LE(end + 16);
  const out = new Map();
  for (let n = 0; n < Math.min(count, 2000); n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50)
      break;
    const method = buf.readUInt16LE(offset + 10);
    const compressed = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!want.has(name) || shaderFileName(name) !== name) continue;
    if (size > max || compressed > max) continue;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50)
      continue;
    const start =
      local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8)
      bytes = inflateRawSync(data, { maxOutputLength: max });
    else continue;
    if (bytes.length !== size) continue;
    out.set(name, Buffer.from(bytes));
  }
  return out;
}

/** Shader file names in a folder the viewer chose, at most 200, sorted. */
export function scanShaderFolder(dir) {
  if (!dir) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && shaderFileName(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en"))
      .slice(0, MAX_OWN);
  } catch {
    return [];
  }
}

export class ShaderStore {
  constructor({ dir, fetch } = {}) {
    this.dir = dir;
    this.fetch = fetch;
    this.busy = new Map();
  }
  folder(packId) {
    const pack = SHADER_PACKS[packId];
    return pack ? join(this.dir, `${pack.id}-${pack.version}`) : "";
  }
  /** The pack's folder when it is fully installed at the pinned version. */
  installed(packId) {
    const folder = this.folder(packId);
    if (!folder) return "";
    try {
      const marker = JSON.parse(readFileSync(join(folder, MARKER), "utf8"));
      if (marker.version !== SHADER_PACKS[packId].version) return "";
      return packFiles(packId).every((f) => existsSync(join(folder, f)))
        ? folder
        : "";
    } catch {
      return "";
    }
  }
  /**
   * What the presets need: installed pack folders and the viewer's folder
   * with its file names. Paths stay in main.
   */
  library(settings = {}) {
    const packs = {};
    for (const id of Object.keys(SHADER_PACKS)) {
      const folder = this.installed(id);
      if (folder) packs[id] = folder;
    }
    const dir =
      typeof settings.shaderDir === "string" && settings.shaderDir
        ? settings.shaderDir
        : "";
    let ownDir = "";
    try {
      if (dir && statSync(dir).isDirectory()) ownDir = dir;
    } catch {}
    return { packs, own: { dir: ownDir, files: scanShaderFolder(ownDir) } };
  }
  /** The library as the interface sees it: names, labels and sizes only. */
  describe(settings = {}) {
    const library = this.library(settings);
    return {
      packs: Object.values(SHADER_PACKS).map((pack) => ({
        id: pack.id,
        name: pack.name,
        version: pack.version,
        license: pack.license,
        home: pack.home,
        size:
          pack.archive?.size ||
          pack.files.reduce((sum, file) => sum + file.size, 0),
        installed: !!library.packs[pack.id],
        busy: this.busy.has(pack.id),
      })),
      own: {
        dir: library.own.dir || settings.shaderDir || "",
        missing: !!settings.shaderDir && !library.own.dir,
        files: library.own.files.map((name) => ({
          name,
          family: shaderFamily(name),
        })),
      },
      library,
    };
  }
  /** Downloads one pinned pack; a second click while it runs waits on it. */
  download(packId, { onProgress } = {}) {
    const pack = SHADER_PACKS[packId];
    if (!pack) return Promise.reject(new Error("حزمة غير معروفة"));
    if (this.busy.has(packId)) return this.busy.get(packId);
    const run = this.install(pack, onProgress).finally(() =>
      this.busy.delete(packId),
    );
    this.busy.set(packId, run);
    return run;
  }
  async install(pack, onProgress) {
    const needed = packFiles(pack.id);
    const files = new Map();
    if (pack.archive) {
      const zip = await fetchPinned(pack.archive, {
        fetch: this.fetch,
        onProgress,
      });
      for (const [name, bytes] of zipFiles(zip, needed)) files.set(name, bytes);
    } else {
      let done = 0;
      const total = pack.files.reduce((sum, f) => sum + f.size, 0);
      for (const file of pack.files) {
        const bytes = await fetchPinned(file, {
          fetch: this.fetch,
          onProgress: (part) => onProgress?.((done + part * file.size) / total),
        });
        done += file.size;
        files.set(file.name, bytes);
      }
    }
    if (!needed.every((name) => files.has(name)))
      throw new Error("الحزمة ناقصة، فلم تُثبّت");
    mkdirSync(this.dir, { recursive: true });
    const temp = join(this.dir, `.${pack.id}-${randomUUID()}`);
    const target = this.folder(pack.id);
    try {
      mkdirSync(temp);
      for (const [name, bytes] of files) writeFileSync(join(temp, name), bytes);
      writeFileSync(
        join(temp, MARKER),
        JSON.stringify({
          id: pack.id,
          version: pack.version,
          license: pack.license,
        }),
      );
      rmSync(target, { recursive: true, force: true });
      renameSync(temp, target);
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      throw error;
    }
    return target;
  }
  /** Removes a downloaded pack (never the viewer's own folder). */
  remove(packId) {
    const folder = this.folder(packId);
    if (!folder) return false;
    rmSync(folder, { recursive: true, force: true });
    return true;
  }
}
