import {
  mkdir,
  open,
  rename,
  rm,
  lstat,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { cleanMedia } from "../core/library.mjs";
import { offlineEpisode } from "../core/offline-media.mjs";
import {
  ARTWORK_HOST_BLOCKED,
  publicArtworkUrl,
  requestArtwork,
} from "./artwork-http.mjs";

const ID = /^[a-f0-9]{32}$/;
const MAX_BYTES = 500 * 1024 ** 3;
const POSTER_BYTES = 128 * 1024;
const ARTWORK_TRIES = 3;
const ARTWORK_RETRY_MS = 30000;
const IMAGE_INPUT_BYTES = 2 * 1024 ** 2;
// Some image hosts pick a format from Accept; JPEG and PNG are the ones
// Electron's nativeImage decodes (WebP is accepted only as a last resort).
const IMAGE_ACCEPT = "image/jpeg,image/png;q=0.9,image/webp;q=0.5,*/*;q=0.1";
const IMAGE_TYPE = /^image\/(jpeg|jpg|pjpeg|png|webp)(;|$)/i;
// Object stores often label images generically; the bytes then decide.
const GENERIC_TYPE = /^(application|binary)\/octet-stream(;|$)/i;
/** The picture format by its first bytes: jpeg, png, webp or "". */
export function imageKind(bytes) {
  if (!bytes || bytes.length < 4) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  return "";
}
/**
 * Where a download's poster may come from (issue #136), best first: the
 * title's own poster, metahub's by IMDb ID (the one Cinemeta uses; JPEG),
 * then its backdrop. HTTPS only: an http: address is asked over HTTPS
 * (never the other way). Private addresses and credentials are dropped.
 */
export function posterCandidates(meta = {}) {
  const list = [];
  const add = (value) => {
    if (typeof value !== "string" || value.length >= 4096) return;
    try {
      const url = new URL(value);
      if (url.protocol === "http:") url.protocol = "https:";
      if (!publicArtworkUrl(url)) return;
      if (!list.includes(url.href)) list.push(url.href);
    } catch {}
  };
  add(meta.poster);
  const imdb = /^tt\d{5,12}$/.test(meta.id || "") ? meta.id : "";
  if (imdb) add(`https://images.metahub.space/poster/medium/${imdb}/img`);
  add(meta.background);
  return list.slice(0, 3);
}
/**
 * One public HTTPS image (three redirects at most), at most 2 MiB, and only
 * JPEG, PNG or WebP bytes. The caller's timeout bounds the entire chain.
 * `fail` gets a fixed reason or status for the diagnostic's error log.
 */
async function posterBytes(url, request, signal, fail = () => {}) {
  let target = new URL(url);
  for (let redirects = 0; redirects < 4; redirects++) {
    if (!publicArtworkUrl(target)) return (fail("blocked address"), null);
    const response = await request(target.href, {
      signal,
      redirect: "manual",
      credentials: "omit",
      headers: { accept: IMAGE_ACCEPT },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      if (!next) return (fail("redirect without location"), null);
      target = new URL(next, target);
      continue;
    }
    const type = response.headers.get("content-type") || "";
    if (!response.ok) {
      await response.body?.cancel();
      return (fail(`status ${response.status}`), null);
    }
    if (type && !IMAGE_TYPE.test(type) && !GENERIC_TYPE.test(type)) {
      await response.body?.cancel();
      return (fail("unexpected content type"), null);
    }
    if (Number(response.headers.get("content-length")) > IMAGE_INPUT_BYTES) {
      await response.body?.cancel();
      return (fail("too large"), null);
    }
    const reader = response.body?.getReader();
    if (!reader) return (fail("empty"), null);
    let size = 0;
    const chunks = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > IMAGE_INPUT_BYTES) return (fail("too large"), null);
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      if (!imageKind(bytes)) return (fail("not an image"), null);
      return bytes;
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  return (fail("too many redirects"), null);
}
async function removeFile(path) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rm(path, { force: true });
      return;
    } catch (error) {
      if (attempt >= 10 || !["EPERM", "EBUSY", "EACCES"].includes(error.code))
        throw error;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
const UNSUPPORTED = /mpegurl|dash\+xml|text\/|json/i;
const mediaUrl = (value) => {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Error("المصدر لا يدعم التنزيل المباشر");
  return u;
};

/** Incremental disk write with cancellation, a body-idle deadline and no URL logs. */
export async function downloadFile({
  url,
  headers = {},
  part,
  signal,
  progress = () => {},
  request = fetch,
  idleMs = 45000,
  resume = null,
  checkpoint = () => {},
  identity = "",
}) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  let timer,
    handle,
    reader,
    response,
    bytes = 0,
    total = 0,
    last = 0;
  const pulse = () => {
    clearTimeout(timer);
    timer = setTimeout(cancel, idleMs);
    timer.unref?.();
  };
  try {
    const existing = await lstat(part).catch(() => null);
    if (existing && (!existing.isFile() || existing.isSymbolicLink()))
      throw Error("ملف التنزيل غير صالح");
    const etag = /^"[^\r\n]{1,250}"$/.test(resume?.etag || "")
      ? resume.etag
      : "";
    const modified =
      !etag && Number.isFinite(Date.parse(resume?.modified || ""))
        ? resume.modified
        : "";
    let offset = existing?.size || 0;
    const canResume =
      offset > 0 &&
      offset < resume?.total &&
      (etag || modified || (identity && identity === resume?.identity));
    if (!canResume) offset = 0;
    let target = mediaUrl(url),
      sentHeaders = {
        ...headers,
        ...(offset
          ? {
              Range: `bytes=${offset}-`,
              ...(etag || modified ? { "If-Range": etag || modified } : {}),
            }
          : {}),
      };
    for (let n = 0; n < 4; n++) {
      pulse();
      response = await request(target.href, {
        headers: sentHeaders,
        signal: abort.signal,
        redirect: "manual",
        credentials: "omit",
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || n === 3) throw Error("تعذر تنزيل المصدر");
        const next = mediaUrl(new URL(location, target).href);
        if (target.protocol === "https:" && next.protocol !== "https:")
          throw Error("تعذر تنزيل المصدر");
        if (next.origin !== target.origin)
          sentHeaders = offset
            ? {
                Range: `bytes=${offset}-`,
                ...(etag || modified ? { "If-Range": etag || modified } : {}),
              }
            : {};
        target = next;
        continue;
      }
      break;
    }
    if (
      ![200, 206].includes(response.status) ||
      !response.body ||
      UNSUPPORTED.test(response.headers.get("content-type") || "") ||
      /\.(m3u8|mpd)(\?|$)/i.test(target.href)
    )
      throw Error(
        "هذا المصدر يحتاج بثًا مباشرًا؛ اختر ملف فيديو أو تورنت للتنزيل",
      );
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
      response.headers.get("content-range") || "",
    );
    if (
      response.status === 206 &&
      (!offset ||
        !range ||
        Number(range[1]) !== offset ||
        Number(range[2]) !== Number(range[3]) - 1 ||
        Number(range[3]) !== resume.total ||
        (etag && response.headers.get("etag") !== etag) ||
        (modified && response.headers.get("last-modified") !== modified))
    )
      throw Error("تغيّر ملف المصدر؛ أعد التنزيل من البداية");
    if (response.status === 200) offset = 0;
    total =
      response.status === 206
        ? Number(range[3])
        : Number(response.headers.get("content-length") || 0);
    if (!Number.isSafeInteger(total) || total < 0 || total > MAX_BYTES)
      throw Error("حجم التنزيل غير مدعوم");
    if (existing && offset === 0) await removeFile(part);
    handle = await open(part, offset ? "r+" : "wx");
    bytes = offset;
    checkpoint({
      etag: response.headers.get("etag") || "",
      modified: response.headers.get("last-modified") || "",
      total,
      identity,
    });
    reader = response.body.getReader();
    pulse();
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      if (abort.signal.aborted) throw Error("توقف التنزيل");
      bytes += value.value.length;
      if (bytes > MAX_BYTES) throw Error("حجم التنزيل غير مدعوم");
      let offset = 0;
      while (offset < value.value.length) {
        const written = await handle.write(
          value.value,
          offset,
          value.value.length - offset,
          bytes - value.value.length + offset,
        );
        if (!written.bytesWritten) throw Error("تعذر حفظ التنزيل");
        offset += written.bytesWritten;
      }
      pulse();
      if (Date.now() - last > 500) {
        last = Date.now();
        progress(bytes, total);
      }
    }
    if (abort.signal.aborted || !bytes || (total && bytes !== total))
      throw Error("لم يكتمل ملف التنزيل");
    await handle.sync();
    progress(bytes, total || bytes);
    return bytes;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    if (reader) await reader.cancel().catch(() => {});
    else await response?.body?.cancel().catch(() => {});
    await handle?.close();
  }
}

/** Opaque IDs in the renderer; files and source URLs stay in main, outside sync/backups. */
export class OfflineLibrary {
  constructor(
    client,
    {
      root,
      resolveSource,
      request,
      artworkRequest = request ?? requestArtwork,
      deleteFile = removeFile,
      thumbnail,
      onArtworkError = () => {},
      artworkRetryMs = ARTWORK_RETRY_MS,
    },
  ) {
    this.client = client;
    this.root = root;
    this.resolveSource = resolveSource;
    this.request = request ?? fetch;
    this.artworkRequest = artworkRequest;
    this.deleteFile = deleteFile;
    this.thumbnail = thumbnail;
    this.onArtworkError = onArtworkError;
    this.artworkRetryMs = artworkRetryMs;
    this.artworkQueue = Promise.resolve();
    this.artworkJobs = new Map();
    // id → { tries, at }: a failed poster is asked again a little later
    // (ARTWORK_TRIES a session), never in a loop.
    this.artworkAttempted = new Map();
    this.artworkAbort = new AbortController();
    this.removing = new Set();
    this.using = new Set();
    this.deleting = new Set();
    this.job = null;
    this.playing = "";
    client.state.offline ||= {};
    for (const [profile, items] of Object.entries(client.state.offline)) {
      client.state.offline[profile] = (Array.isArray(items) ? items : [])
        .filter(
          (x) =>
            ID.test(x?.id) &&
            x.meta &&
            ["id", "type", "name"].every(
              (k) =>
                typeof x.meta[k] === "string" &&
                x.meta[k].trim() &&
                x.meta[k].length <= 1000,
            ) &&
            !["local", "live"].includes(x.meta.type),
        )
        .slice(0, 50)
        .map((x) => ({
          ...x,
          meta: cleanMedia(x.meta),
          episode: offlineEpisode(x.meta, x.videoId, x.episode),
          status: x.status === "ready" ? "ready" : "interrupted",
        }));
    }
  }
  profile(profileId) {
    if (profileId !== this.client.profiles.store.active)
      throw Error("تغير الملف الشخصي؛ افتح التنزيلات مجددًا");
    this.client.profiles.gate("library");
    if (this.removing.has(profileId))
      throw Error("جارٍ حذف تنزيلات هذا الملف الشخصي؛ انتظر انتهاء العملية");
    return profileId;
  }
  bag(profile) {
    return (this.client.state.offline[profile] ||= []);
  }
  persist() {
    this.client.profiles.capture();
    this.client.saveData(this.client.state);
  }
  path(id, partial = false) {
    if (!ID.test(id)) throw Error("التنزيل غير صالح");
    return join(this.root, id + (partial ? ".part" : ".media"));
  }
  posterPath(id) {
    this.path(id);
    return join(this.root, `${id}.poster.jpg`);
  }
  /** One bounded image request at a time; only local JPEG bytes cross IPC. */
  async artwork(profileId, id) {
    const generation = this.artworkAbort;
    const owned = () => {
      const profile = this.profile(profileId);
      const item = this.bag(profile).find((x) => x.id === id);
      if (!item || this.deleting.has(id) || generation.signal.aborted)
        throw Error("التنزيل غير متاح");
      return item;
    };
    const item = owned();
    const local = async () => {
      const path = this.posterPath(id);
      const info = await lstat(path).catch(() => null);
      if (!info?.isFile() || info.size > POSTER_BYTES) return null;
      const bytes = await readFile(path).catch(() => null);
      owned();
      return bytes?.length <= POSTER_BYTES &&
        bytes[0] === 255 &&
        bytes[1] === 216
        ? `data:image/jpeg;base64,${bytes.toString("base64")}`
        : null;
    };
    const cached = await local();
    owned();
    const candidates = posterCandidates(item.meta);
    if (cached || !this.thumbnail || !candidates.length)
      return { image: cached };
    const tried = this.artworkAttempted.get(id);
    const due =
      !tried ||
      (tried.tries < ARTWORK_TRIES &&
        Date.now() - tried.at >= this.artworkRetryMs);
    if (!this.artworkJobs.has(id) && due) {
      this.artworkAttempted.set(id, {
        tries: (tried?.tries || 0) + 1,
        at: Date.now(),
      });
      const job = this.artworkQueue
        .catch(() => {})
        .then(async () => {
          let temp;
          try {
            owned();
            let jpeg = null;
            // The title's poster first; the next candidate only when one
            // fails (refused, not a picture, or a format Electron cannot
            // decode, such as WebP).
            for (const url of candidates) {
              let reason = "";
              const bytes = await posterBytes(
                url,
                this.artworkRequest,
                AbortSignal.any([generation.signal, AbortSignal.timeout(8000)]),
                (why) => (reason = why),
              ).catch((error) => {
                reason =
                  error?.code === ARTWORK_HOST_BLOCKED
                    ? "blocked address"
                    : error?.name === "AbortError" ||
                        error?.name === "TimeoutError"
                      ? "timeout"
                      : "network";
                return null;
              });
              owned();
              const made = bytes ? this.thumbnail(bytes) : null;
              if (
                Buffer.isBuffer(made) &&
                made.length <= POSTER_BYTES &&
                made[0] === 255 &&
                made[1] === 216
              ) {
                jpeg = made;
                break;
              }
              if (bytes) reason = `decode ${imageKind(bytes)}`;
              this.onArtworkError(reason || "unknown");
            }
            if (!jpeg) return;
            await mkdir(this.root, { recursive: true });
            owned();
            temp = `${this.posterPath(id)}.tmp`;
            await rm(temp, { force: true });
            owned();
            await writeFile(temp, jpeg, { flag: "wx" });
            owned();
            await rename(temp, this.posterPath(id));
          } catch {
            // Artwork failure does not turn an otherwise usable video into an error.
          } finally {
            if (temp) await rm(temp, { force: true }).catch(() => {});
          }
        });
      this.artworkJobs.set(id, job);
      this.artworkQueue = job;
      job.finally(() => this.artworkJobs.delete(id));
    }
    await this.artworkJobs.get(id);
    owned();
    const image = await local();
    const last = this.artworkAttempted.get(id);
    if (image || !last || last.tries >= ARTWORK_TRIES) return { image };
    return {
      image,
      retryAfterMs: Math.max(1, last.at + this.artworkRetryMs - Date.now()),
    };
  }
  cancelArtwork() {
    this.artworkAbort.abort();
    this.artworkAbort = new AbortController();
    this.artworkAttempted.clear();
  }
  list(profileId) {
    const p = this.profile(profileId);
    return {
      items: this.bag(p).map((x) => ({
        id: x.id,
        meta: Object.fromEntries(
          Object.entries(x.meta).filter(
            ([key]) => !["poster", "background"].includes(key),
          ),
        ),
        videoId: x.videoId,
        episode: x.episode,
        at: x.at,
        status: x.status,
        bytes: this.job?.id === x.id ? this.job.bytes : x.bytes || 0,
        total: this.job?.id === x.id ? this.job.total : x.total || 0,
        playing: this.playing === x.id || this.using.has(x.id),
      })),
      busy: !!this.job,
    };
  }
  start({ profileId, stream, meta, videoId, settings, resumeId }) {
    const profile = this.profile(profileId);
    if (this.job) throw Error("يوجد تنزيل جارٍ؛ انتظر اكتماله أو أوقفه");
    if (!resumeId && this.bag(profile).length >= 50)
      throw Error("أزل تنزيلًا قبل إضافة المزيد");
    const record = resumeId
      ? this.bag(profile).find((x) => x.id === resumeId && x.status !== "ready")
      : {
          stream: structuredClone(stream),
          id: randomBytes(16).toString("hex"),
          meta: cleanMedia(meta),
          videoId: String(videoId).slice(0, 1000),
          episode: offlineEpisode(meta, videoId),
          at: Date.now(),
          status: "downloading",
          bytes: 0,
          total: 0,
        };
    if (!record || !record.stream)
      throw Error("اختر المصدر مجدداً لبدء تنزيل جديد");
    const previousStatus = record.status;
    record.status = "downloading";
    const job = {
      id: record.id,
      profile,
      bytes: 0,
      total: 0,
      abort: new AbortController(),
    };
    this.job = job;
    if (!resumeId) this.bag(profile).unshift(record);
    try {
      this.persist();
    } catch (error) {
      this.job = null;
      if (!resumeId)
        this.client.state.offline[profile] = this.bag(profile).filter(
          (x) => x !== record,
        );
      else record.status = previousStatus;
      throw error;
    }
    // The poster is saved while the title is still online (issue #136), so
    // its card shows it later, after a restart and without a network.
    if (this.thumbnail) this.artwork(profile, record.id).catch(() => {});
    job.done = (async () => {
      let source;
      try {
        await mkdir(this.root, { recursive: true });
        source = await this.resolveSource(
          record.stream,
          settings,
          job.abort.signal,
        );
        if (job.abort.signal.aborted) throw Error("توقف التنزيل");
        const bytes = await downloadFile({
          ...source,
          part: this.path(record.id, true),
          resume: record.resume,
          checkpoint: (value) => {
            record.resume = value;
            record.total = value.total;
            this.persist();
          },
          signal: job.abort.signal,
          request: this.request,
          progress: (b, t) => {
            job.bytes = b;
            job.total = t;
          },
        });
        if (job.abort.signal.aborted) throw Error("توقف التنزيل");
        await rename(this.path(record.id, true), this.path(record.id));
        if (job.abort.signal.aborted) {
          await rm(this.path(record.id), { force: true });
          throw Error("توقف التنزيل");
        }
        record.status = "ready";
        delete record.stream;
        delete record.resume;
        record.bytes = bytes;
        record.total = bytes;
        this.persist();
      } catch {
        record.status = job.pause
          ? "paused"
          : job.abort.signal.aborted
            ? "cancelled"
            : "error";
        const partial = await lstat(this.path(record.id, true)).catch(
          () => null,
        );
        record.bytes = partial?.isFile() ? partial.size : 0;
        if (record.status === "cancelled") {
          await rm(this.path(record.id, true), { force: true }).catch(() => {});
          record.bytes = 0;
        }
        await removeFile(this.path(record.id)).catch(() => {});
      } finally {
        await Promise.resolve()
          .then(() => source?.dispose?.())
          .catch(() => {});
        if (this.job === job) this.job = null;
        if (record.status !== "ready") {
          try {
            this.persist();
          } catch {
            record.status = "error";
          }
        }
      }
    })();
    this.artwork(profileId, record.id).catch(() => {});
    return this.list(profileId);
  }
  resume(profileId, id, settings) {
    const profile = this.profile(profileId);
    const record = this.bag(profile).find((x) => x.id === id);
    if (!record || record.status === "ready")
      throw Error("التنزيل غير قابل للاستئناف");
    return this.start({ profileId, settings, resumeId: id });
  }
  async pause(profileId, id) {
    const profile = this.profile(profileId);
    if (this.job?.profile === profile && this.job.id === id) {
      this.job.pause = true;
      this.job.abort.abort();
      await this.job.done;
    }
    return this.list(profileId);
  }
  async cancel(profileId, id) {
    const profile = this.profile(profileId);
    if (this.job?.profile === profile && (!id || id === this.job.id)) {
      this.job.abort.abort();
      await this.job.done;
    }
    return this.list(profileId);
  }
  async file(profileId, id) {
    const profile = this.profile(profileId),
      item = this.bag(profile).find((x) => x.id === id);
    if (item?.status !== "ready") throw Error("التنزيل غير جاهز للمشاهدة");
    if (this.deleting.has(id))
      throw Error("جارٍ حذف التنزيل؛ انتظر انتهاء العملية");
    const path = this.path(id),
      info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.size !== item.bytes)
      throw Error("ملف التنزيل غير موجود أو غير مكتمل");
    this.profile(profileId);
    if (this.deleting.has(id) || !this.bag(profile).includes(item))
      throw Error("التنزيل غير متاح");
    return { path, item };
  }
  /** Keep deletion out of the lookup → stop → start/reveal IO window. */
  async useFile(profileId, id, action) {
    this.profile(profileId);
    if (this.deleting.has(id) || this.using.has(id))
      throw Error("التنزيل قيد الاستخدام؛ حاول مجددًا");
    this.using.add(id);
    try {
      const file = await this.file(profileId, id);
      this.profile(profileId);
      return await action(file);
    } finally {
      this.using.delete(id);
    }
  }
  async remove(profileId, id) {
    const profile = this.profile(profileId),
      item = this.bag(profile).find((x) => x.id === id);
    if (!item) return this.list(profileId);
    const check = () => {
      this.profile(profileId);
      if (id === this.playing || this.using.has(id))
        throw Error("أوقف مشاهدة التنزيل قبل حذفه");
    };
    check();
    if (this.deleting.has(id))
      throw Error("جارٍ حذف التنزيل؛ انتظر انتهاء العملية");
    this.deleting.add(id);
    const erase = async (path) => {
      try {
        await this.deleteFile(path);
      } catch {
        throw Error(
          "تعذر حذف التنزيل؛ أغلق البرامج التي تستخدم الملف ثم حاول مجددًا",
        );
      }
    };
    try {
      await this.cancel(profileId, id);
      check();
      await erase(`${this.posterPath(id)}.tmp`);
      await erase(this.posterPath(id));
      check();
      await erase(this.path(id, true));
      check();
      await erase(this.path(id));
      this.client.state.offline[profile] = this.bag(profile).filter(
        (x) => x.id !== id,
      );
      try {
        this.persist();
      } catch {
        throw Error(
          "حُذفت الملفات، لكن تعذر حفظ قائمة التنزيلات. أعد فتح التنزيلات للتحقق.",
        );
      }
      this.artworkAttempted.delete(id);
      return this.list(profileId);
    } finally {
      this.deleting.delete(id);
    }
  }
  /**
   * A removed profile's downloads go with it: its download stops and its
   * files and records are deleted (they can be gigabytes). Called after the
   * removal's own PIN check, so it does not ask for the active profile.
   */
  async forgetProfile(profileId) {
    if (this.removing.has(profileId))
      throw Error("جارٍ حذف تنزيلات هذا الملف الشخصي؛ انتظر انتهاء العملية");
    this.removing.add(profileId);
    this.cancelArtwork();
    try {
      // A rename already submitted to the OS cannot be aborted. Let that
      // commit finish before cleanup, so it cannot recreate a deleted poster.
      await this.artworkQueue;
      if (this.job?.profile === profileId) {
        this.job.abort.abort();
        await this.job.done;
      }
      const bag = this.client.state.offline?.[profileId];
      for (const item of Array.isArray(bag) ? [...bag] : []) {
        if (!ID.test(item?.id)) throw Error("التنزيل غير صالح");
        if (
          item.id === this.playing ||
          this.using.has(item.id) ||
          this.deleting.has(item.id)
        )
          throw Error("أوقف مشاهدة التنزيل قبل حذفه");
        try {
          // Delete the partial first: a locked partial must not destroy an
          // otherwise playable complete copy or drop its owning record.
          await this.deleteFile(this.path(item.id, true));
          await this.deleteFile(this.path(item.id));
          await this.deleteFile(this.posterPath(item.id));
          await this.deleteFile(`${this.posterPath(item.id)}.tmp`);
        } catch {
          throw Error(
            "تعذر حذف بعض التنزيلات؛ أغلق البرامج التي تستخدم الملفات ثم حاول حذف الملف الشخصي مجددًا",
          );
        }
        this.client.state.offline[profileId] = this.bag(profileId).filter(
          (x) => x.id !== item.id,
        );
        this.artworkAttempted.delete(item.id);
      }
      delete this.client.state.offline?.[profileId];
    } finally {
      this.removing.delete(profileId);
      // Save partial progress too: failures keep the profile and every
      // undeleted file's record, so deletion can be retried after restart.
      this.persist();
    }
  }
  async stop() {
    this.cancelArtwork();
    if (this.job) this.job.pause = true;
    this.job?.abort.abort();
    await this.job?.done;
    await this.artworkQueue;
  }
}
