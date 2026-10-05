// Only native-dialog selections enter this library. Paths never reach React.
import { realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, extname } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { Readable } from "node:stream";

export const AUDIO_TYPES = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};
const label = (s, max = 100) =>
  String(s || "")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .trim()
    .slice(0, max);
export function audioRange(header, size) {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (!header) return { start: 0, end: size - 1, partial: false };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) return null;
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start <= end &&
    start < size
    ? { start, end, partial: true }
    : null;
}

export class MusicLibrary {
  constructor(client) {
    this.client = client;
    this.tokens = new Map();
  }
  gate(profileId) {
    this.client.profiles.gate("library");
    if (!profileId || profileId !== this.client.profiles.store.active)
      throw new Error("تغير الملف الشخصي؛ افتح موسيقاك من جديد");
  }
  bucket(profileId) {
    this.gate(profileId);
    const all = (this.client.state.localMusic ||= {});
    return (all[profileId] ||= { tracks: [], playlists: [], queue: [] });
  }
  view(profileId) {
    const b = this.bucket(profileId);
    return {
      tracks: b.tracks.map(({ id, title, favorite, format }) => ({
        id,
        title,
        favorite: !!favorite,
        format,
      })),
      playlists: b.playlists.map((p) => ({ ...p, ids: [...p.ids] })),
      queue: [...b.queue],
    };
  }
  revoke() {
    this.tokens.clear();
    this.generation = (this.generation || 0) + 1;
  }
  async importFiles(profileId, paths) {
    this.gate(profileId);
    const additions = [];
    let skipped = Math.max(0, paths.length - 200);
    for (const path of paths.slice(0, 200)) {
      try {
        const file = await realpath(path),
          ext = extname(file).toLowerCase();
        if (!AUDIO_TYPES[ext] || !(await stat(file)).isFile()) {
          skipped++;
          continue;
        }
        additions.push({
          path: file,
          title: label(basename(file, extname(file))),
          format: ext.slice(1).toUpperCase(),
        });
      } catch {
        skipped++;
      }
    }
    // The dialog and file checks may outlive a profile switch/lock.
    const b = this.bucket(profileId);
    let added = 0;
    for (const track of additions) {
      if (
        b.tracks.length >= 1000 ||
        b.tracks.some((t) => t.path.toLowerCase() === track.path.toLowerCase())
      ) {
        skipped++;
        continue;
      }
      b.tracks.push({ ...track, id: randomUUID(), favorite: false });
      added++;
    }
    this.client.persist();
    return { ...this.view(profileId), added, skipped };
  }
  edit({ profileId, action, id, name, ids }) {
    const b = this.bucket(profileId);
    const validIds = () =>
      [...new Set(Array.isArray(ids) ? ids : [])]
        .filter((i) => b.tracks.some((t) => t.id === i))
        .slice(0, 500);
    if (action === "favorite") {
      const t = b.tracks.find((t) => t.id === id);
      if (t) t.favorite = !t.favorite;
    } else if (action === "remove") {
      b.tracks = b.tracks.filter((t) => t.id !== id);
      b.queue = b.queue.filter((i) => i !== id);
      b.playlists.forEach((p) => (p.ids = p.ids.filter((i) => i !== id)));
      this.generation = (this.generation || 0) + 1;
      for (const [token, entry] of this.tokens)
        if (entry.id === id) this.tokens.delete(token);
    } else if (action === "queue") b.queue = validIds();
    else if (action === "playlist") {
      const title = label(name, 60);
      if (!title) throw new Error("اكتب اسم قائمة التشغيل");
      const found = b.playlists.find((p) => p.id === id);
      if (found) {
        found.name = title;
        found.ids = validIds();
      } else {
        if (b.playlists.length >= 40)
          throw new Error("وصلت إلى الحد الأقصى لقوائم الموسيقى");
        b.playlists.push({ id: randomUUID(), name: title, ids: validIds() });
      }
    } else if (action === "deletePlaylist")
      b.playlists = b.playlists.filter((p) => p.id !== id);
    else throw new Error("إجراء الموسيقى غير صالح");
    this.client.persist();
    return this.view(profileId);
  }
  async source({ profileId, id }) {
    const generation = (this.generation = (this.generation || 0) + 1);
    const t = this.bucket(profileId).tracks.find((t) => t.id === id);
    if (!t) throw new Error("الأغنية غير موجودة في هذا الملف الشخصي");
    try {
      if (!(await stat(t.path)).isFile()) throw new Error();
    } catch {
      throw new Error("ملف الأغنية غير موجود؛ أضفه من مكانه الجديد");
    }
    this.gate(profileId);
    if (generation !== this.generation) throw new Error("بدأ تشغيل أغنية أخرى");
    this.tokens.clear();
    const token = randomBytes(24).toString("hex");
    this.tokens.set(token, { profileId, id });
    return { url: `riwaq-audio://track/${token}` };
  }
  async respond(request) {
    try {
      const u = new URL(request.url),
        token = u.pathname.slice(1);
      if (
        u.hostname !== "track" ||
        u.search ||
        !["GET", "HEAD"].includes(request.method)
      )
        return new Response(null, { status: 403 });
      const entry = this.tokens.get(token);
      if (!entry) return new Response(null, { status: 403 });
      const track = this.bucket(entry.profileId).tracks.find(
        (t) => t.id === entry.id,
      );
      if (!track) return new Response(null, { status: 404 });
      const info = await stat(track.path);
      this.gate(entry.profileId);
      if (!info.isFile() || !this.tokens.has(token))
        return new Response(null, { status: 403 });
      const range = audioRange(request.headers.get("range"), info.size);
      if (!range)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${info.size}` },
        });
      const headers = {
        "Content-Type": AUDIO_TYPES[extname(track.path).toLowerCase()],
        "Accept-Ranges": "bytes",
        "Content-Length": String(range.end - range.start + 1),
        "Cache-Control": "no-store",
      };
      if (range.partial)
        headers["Content-Range"] =
          `bytes ${range.start}-${range.end}/${info.size}`;
      const body =
        request.method === "HEAD"
          ? null
          : Readable.toWeb(
              createReadStream(track.path, {
                start: range.start,
                end: range.end,
              }),
            );
      return new Response(body, { status: range.partial ? 206 : 200, headers });
    } catch {
      return new Response(null, { status: 403 });
    }
  }
}
