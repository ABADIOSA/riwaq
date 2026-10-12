// Only native-dialog selections enter this library. Paths never reach React.
import { open, realpath, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename, extname } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { namedTags, readAudioTags } from "../core/audio-tags.mjs";

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

/** Covers kept in memory (they are never written to disk or state). */
const COVER_CACHE = 300;
/** Songs from before 0.41 whose tags are read per library request. */
export const TAG_BATCH = 40;

/** A song's tags from its file, read in bounded pieces (core/audio-tags.mjs). */
export async function fileTags(path, { picture = false } = {}) {
  let handle;
  try {
    handle = await open(path, "r");
    const { size } = await handle.stat();
    const read = async (offset, length) => {
      const want = Math.max(0, Math.min(length, size - offset));
      const buffer = Buffer.alloc(want);
      if (!want) return new Uint8Array(0);
      const { bytesRead } = await handle.read(buffer, 0, want, offset);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    };
    return await readAudioTags({ read, size, picture });
  } catch {
    return {};
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** The fields a song keeps: its tags, or what its file name says. */
export function songFields(tags, fileName) {
  const named = namedTags(fileName);
  const fields = {
    title: label(tags.title || named.title),
    artist: label(tags.artist || tags.albumArtist || named.artist || ""),
    album: label(tags.album || ""),
    tagged: true,
  };
  if (tags.albumArtist) fields.albumArtist = label(tags.albumArtist);
  if (tags.year) fields.year = tags.year;
  if (tags.track) fields.track = tags.track;
  if (tags.cover) fields.cover = true;
  return fields;
}

export class MusicLibrary {
  /**
   * `thumbnail(bytes, mime)` turns a cover into a small data URL (main uses
   * Electron's nativeImage); without it there are no covers.
   */
  constructor(client, { thumbnail, readTags = fileTags } = {}) {
    this.client = client;
    this.tokens = new Map();
    this.thumbnail = thumbnail;
    this.readTags = readTags;
    this.covers = new Map();
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
      tracks: b.tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist || "",
        album: t.album || "",
        ...(t.albumArtist ? { albumArtist: t.albumArtist } : {}),
        ...(t.year ? { year: t.year } : {}),
        ...(t.track ? { track: t.track } : {}),
        cover: !!t.cover,
        favorite: !!t.favorite,
        format: t.format,
      })),
      playlists: b.playlists.map((p) => ({ ...p, ids: [...p.ids] })),
      queue: [...b.queue],
      untagged: b.tracks.filter((t) => !t.tagged).length,
    };
  }
  /**
   * Reads the tags of songs added before 0.41, a batch per library request,
   * so an old library fills in without one long wait.
   */
  async tagSome(profileId, limit = TAG_BATCH) {
    const waiting = this.bucket(profileId)
      .tracks.filter((t) => !t.tagged)
      .slice(0, limit)
      .map((t) => ({ id: t.id, path: t.path }));
    if (!waiting.length) return 0;
    const found = [];
    for (const t of waiting)
      found.push({ ...t, tags: await this.readTags(t.path) });
    // The reads may outlive a profile switch or a lock.
    const b = this.bucket(profileId);
    for (const { id, path, tags } of found) {
      const track = b.tracks.find((t) => t.id === id && t.path === path);
      if (track)
        Object.assign(track, songFields(tags, basename(path, extname(path))));
    }
    this.client.persist();
    return found.length;
  }
  /** A song's cover as a small data URL, or null. Kept in memory only. */
  async cover({ profileId, id }) {
    const track = this.bucket(profileId).tracks.find((t) => t.id === id);
    if (!track?.cover || !this.thumbnail) return null;
    // The songs of one album share one picture.
    const key = track.album
      ? `${profileId}|${track.artist || ""}|${track.album}`
      : `${profileId}|${track.id}`;
    if (this.covers.has(key)) return this.covers.get(key);
    const { picture } = await this.readTags(track.path, { picture: true });
    this.gate(profileId);
    let url = null;
    try {
      url = picture ? this.thumbnail(picture.data, picture.mime) : null;
    } catch {}
    this.covers.set(key, url);
    if (this.covers.size > COVER_CACHE)
      this.covers.delete(this.covers.keys().next().value);
    return url;
  }
  revoke() {
    this.tokens.clear();
    this.covers.clear();
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
          ...songFields(await this.readTags(file), basename(file, ext)),
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
