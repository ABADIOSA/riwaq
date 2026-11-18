/**
 * Collection pictures chosen from this computer, kept as files under
 * userData/collection-art (core/collection-art.mjs has the rules). Only
 * files named by a 32-hex ID are ever read or deleted; the page receives a
 * data URL, never a path.
 */
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { constants, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  ArtStore,
  ART_MAX_BYTES,
  ART_TYPES,
  validArtId,
} from "../core/collection-art.mjs";

const EXT = Object.fromEntries(
  Object.entries(ART_TYPES).map(([ext, mime]) => [mime, ext]),
);
const MIME = Object.fromEntries(
  Object.entries(ART_TYPES).map(([ext, mime]) => [ext, mime]),
);
const NAME = /^([a-f\d]{32})\.(gif|png|jpeg|webp)$/;

/**
 * Reads one picture file through a single handle (PR #155 review,
 * security): opened without following a final link where the system
 * allows it (O_NOFOLLOW; on Windows lstat refuses a link or junction
 * first), then checked through that same handle to be a regular file of
 * at most `max` bytes, and read from it. Nothing is read from a name
 * that changed between the check and the read.
 */
export async function readArtFile(path, max) {
  const link = await lstat(path);
  if (link.isSymbolicLink() || !link.isFile())
    throw new Error("اختر ملف صورة عادياً");
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("اختر ملف صورة عادياً");
    if (info.size > max) throw new Error("الصورة أكبر من 8 ميغابايت");
    const bytes = Buffer.alloc(info.size);
    let at = 0;
    while (at < info.size) {
      const { bytesRead } = await handle.read(bytes, at, info.size - at, at);
      if (!bytesRead) break;
      at += bytesRead;
    }
    return bytes.subarray(0, at);
  } finally {
    await handle.close();
  }
}

/**
 * The pictures' folder itself must be a real folder, never a link or a
 * junction put in its place (third review, N12): every read, write, list
 * and delete checks it first.
 */
async function realFolder(dir) {
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error("مجلد صور المجموعات ليس مجلداً عادياً");
}

export function fileArtStore(dir) {
  // Only a regular file directly in the folder counts: a link or a folder
  // under a picture's name is never followed, read or deleted.
  const find = async (id) => {
    if (!validArtId(id)) return null;
    try {
      await realFolder(dir);
    } catch {
      return null;
    }
    for (const ext of Object.keys(MIME)) {
      const path = join(dir, `${id}.${ext}`);
      try {
        const info = await lstat(path);
        if (info.isFile() && !info.isSymbolicLink())
          return { path, mime: MIME[ext] };
      } catch {
        /* next */
      }
    }
    return null;
  };
  return new ArtStore({
    async write(id, bytes, mime) {
      if (!validArtId(id) || !EXT[mime]) throw new Error("صورة غير صالحة");
      await mkdir(dir, { recursive: true });
      await realFolder(dir);
      const path = join(dir, `${id}.${EXT[mime]}`);
      const tmp = `${path}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, path);
    },
    async read(id) {
      const found = await find(id);
      if (!found) return null;
      try {
        return {
          bytes: await readArtFile(found.path, ART_MAX_BYTES),
          mime: found.mime,
        };
      } catch {
        return null;
      }
    },
    // The last reference check (`guard`) and the unlink run in one turn,
    // with nothing awaited between them (second review: sweep races). An
    // unlink removes a link itself, never what it points to.
    async remove(id, guard) {
      const found = await find(id);
      if (!found) return false;
      if (guard && !guard()) return false;
      try {
        unlinkSync(found.path);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return true;
    },
    async list() {
      let names = [];
      try {
        await realFolder(dir);
        names = await readdir(dir);
      } catch {
        return [];
      }
      const out = [];
      for (const name of names) {
        const m = NAME.exec(name);
        if (!m) continue;
        try {
          const info = await lstat(join(dir, name));
          if (info.isFile() && !info.isSymbolicLink())
            out.push({ id: m[1], at: info.mtimeMs });
        } catch {
          /* gone meanwhile */
        }
      }
      return out;
    },
  });
}

/** A stored picture as a data URL the page can show. */
export const dataUrl = ({ bytes, mime }) =>
  `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
