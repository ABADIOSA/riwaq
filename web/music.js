/**
 * Local music in the web edition: electron/music-library.mjs's rules (same
 * limits, same edits, the library PIN and the active profile on every call)
 * over files the viewer picks in the browser.
 *
 * A page cannot keep a path to a file, so the songs stay for this visit
 * only: they are held in memory, never uploaded and never written to the
 * encrypted store, and a reload or closed tab forgets them. Playback uses
 * one object URL at a time, revoked when the next song starts.
 */
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
const extOf = (name) =>
  (/(\.[a-z0-9]{2,5})$/i.exec(String(name || ""))?.[1] || "").toLowerCase();

export class WebMusicLibrary {
  constructor(client) {
    this.client = client;
    this.buckets = new Map();
    this.objectUrl = "";
  }
  gate(profileId) {
    this.client.profiles.gate("library");
    if (!profileId || profileId !== this.client.profiles.store.active)
      throw new Error("تغير الملف الشخصي؛ افتح موسيقاك من جديد");
  }
  bucket(profileId) {
    this.gate(profileId);
    if (!this.buckets.has(profileId))
      this.buckets.set(profileId, { tracks: [], playlists: [], queue: [] });
    return this.buckets.get(profileId);
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
    this.generation = (this.generation || 0) + 1;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = "";
  }
  importFiles(profileId, files) {
    this.gate(profileId);
    const b = this.bucket(profileId);
    let skipped = Math.max(0, files.length - 200);
    let added = 0;
    for (const file of files.slice(0, 200)) {
      const ext = extOf(file.name);
      const same = (t) =>
        t.file.name === file.name &&
        t.file.size === file.size &&
        t.file.lastModified === file.lastModified;
      if (!AUDIO_TYPES[ext] || b.tracks.length >= 1000 || b.tracks.some(same)) {
        skipped++;
        continue;
      }
      b.tracks.push({
        id: crypto.randomUUID(),
        file,
        title: label(file.name.slice(0, -ext.length)),
        format: ext.slice(1).toUpperCase(),
        favorite: false,
      });
      added++;
    }
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
        b.playlists.push({
          id: crypto.randomUUID(),
          name: title,
          ids: validIds(),
        });
      }
    } else if (action === "deletePlaylist")
      b.playlists = b.playlists.filter((p) => p.id !== id);
    else throw new Error("إجراء الموسيقى غير صالح");
    return this.view(profileId);
  }
  source({ profileId, id }) {
    const t = this.bucket(profileId).tracks.find((t) => t.id === id);
    if (!t) throw new Error("الأغنية غير موجودة في هذا الملف الشخصي");
    this.revoke();
    this.objectUrl = URL.createObjectURL(t.file);
    return { url: this.objectUrl };
  }
  /** A profile removed: its songs go with it. */
  forget(profileId) {
    this.buckets.delete(profileId);
  }
}
