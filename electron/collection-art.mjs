/**
 * Collection pictures chosen from this computer, kept as files under
 * userData/collection-art (core/collection-art.mjs has the rules). Only
 * files named by a 32-hex ID are ever read or deleted; the page receives a
 * data URL, never a path.
 */
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { ArtStore, ART_TYPES, validArtId } from "../core/collection-art.mjs";

const EXT = Object.fromEntries(
  Object.entries(ART_TYPES).map(([ext, mime]) => [mime, ext]),
);
const MIME = Object.fromEntries(
  Object.entries(ART_TYPES).map(([ext, mime]) => [ext, mime]),
);
const NAME = /^([a-f\d]{32})\.(gif|png|jpeg|webp)$/;

export function fileArtStore(dir) {
  const find = async (id) => {
    if (!validArtId(id)) return null;
    for (const ext of Object.keys(MIME)) {
      const path = join(dir, `${id}.${ext}`);
      try {
        await stat(path);
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
      const path = join(dir, `${id}.${EXT[mime]}`);
      const tmp = `${path}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, path);
    },
    async read(id) {
      const found = await find(id);
      if (!found) return null;
      return { bytes: await readFile(found.path), mime: found.mime };
    },
    async remove(id) {
      const found = await find(id);
      if (found) await rm(found.path, { force: true });
    },
    async list() {
      let names = [];
      try {
        names = await readdir(dir);
      } catch {
        return [];
      }
      const out = [];
      for (const name of names) {
        const m = NAME.exec(name);
        if (!m) continue;
        try {
          out.push({ id: m[1], at: (await stat(join(dir, name))).mtimeMs });
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
