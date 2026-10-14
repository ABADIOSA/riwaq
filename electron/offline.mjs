import { mkdir, open, rename, rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { cleanMedia } from "../core/library.mjs";

const ID = /^[a-f0-9]{32}$/;
const MAX_BYTES = 500 * 1024 ** 3;
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
    let target = mediaUrl(url),
      sentHeaders = { ...headers };
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
        if (next.origin !== target.origin) sentHeaders = {};
        target = next;
        continue;
      }
      break;
    }
    if (
      response.status !== 200 ||
      !response.body ||
      UNSUPPORTED.test(response.headers.get("content-type") || "") ||
      /\.(m3u8|mpd)(\?|$)/i.test(target.href)
    )
      throw Error(
        "هذا المصدر يحتاج بثًا مباشرًا؛ اختر ملف فيديو أو تورنت للتنزيل",
      );
    total = Number(response.headers.get("content-length") || 0);
    if (!Number.isSafeInteger(total) || total < 0 || total > MAX_BYTES)
      throw Error("حجم التنزيل غير مدعوم");
    handle = await open(part, "wx");
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
  constructor(client, { root, resolveSource, request = fetch }) {
    this.client = client;
    this.root = root;
    this.resolveSource = resolveSource;
    this.request = request;
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
          status: x.status === "ready" ? "ready" : "interrupted",
        }));
    }
  }
  profile(profileId) {
    if (profileId !== this.client.profiles.store.active)
      throw Error("تغير الملف الشخصي؛ افتح التنزيلات مجددًا");
    this.client.profiles.gate("library");
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
  list(profileId) {
    const p = this.profile(profileId);
    return {
      items: this.bag(p).map((x) => ({
        id: x.id,
        meta: x.meta,
        videoId: x.videoId,
        at: x.at,
        status: x.status,
        bytes: this.job?.id === x.id ? this.job.bytes : x.bytes || 0,
        total: this.job?.id === x.id ? this.job.total : x.total || 0,
      })),
      busy: !!this.job,
    };
  }
  start({ profileId, stream, meta, videoId, settings }) {
    const profile = this.profile(profileId);
    if (this.job) throw Error("يوجد تنزيل جارٍ؛ انتظر اكتماله أو أوقفه");
    if (this.bag(profile).length >= 50)
      throw Error("أزل تنزيلًا قبل إضافة المزيد");
    const record = {
      id: randomBytes(16).toString("hex"),
      meta: cleanMedia(meta),
      videoId: String(videoId).slice(0, 1000),
      at: Date.now(),
      status: "downloading",
      bytes: 0,
      total: 0,
    };
    const job = {
      id: record.id,
      profile,
      bytes: 0,
      total: 0,
      abort: new AbortController(),
    };
    this.job = job;
    this.bag(profile).unshift(record);
    try {
      this.persist();
    } catch (error) {
      this.job = null;
      this.client.state.offline[profile] = this.bag(profile).filter(
        (x) => x !== record,
      );
      throw error;
    }
    job.done = (async () => {
      let source;
      try {
        await mkdir(this.root, { recursive: true });
        source = await this.resolveSource(stream, settings, job.abort.signal);
        if (job.abort.signal.aborted) throw Error("توقف التنزيل");
        const bytes = await downloadFile({
          ...source,
          part: this.path(record.id, true),
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
        record.bytes = bytes;
        record.total = bytes;
        this.persist();
      } catch {
        record.status = job.abort.signal.aborted ? "cancelled" : "error";
        await rm(this.path(record.id, true), { force: true }).catch(() => {});
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
    const path = this.path(id),
      info = await lstat(path).catch(() => null);
    if (!info?.isFile() || info.size !== item.bytes)
      throw Error("ملف التنزيل غير موجود أو غير مكتمل");
    return { path, item };
  }
  async remove(profileId, id) {
    const profile = this.profile(profileId),
      bag = this.bag(profile),
      item = bag.find((x) => x.id === id);
    if (!item) return this.list(profileId);
    if (id === this.playing) throw Error("أوقف مشاهدة التنزيل قبل حذفه");
    await this.cancel(profileId, id);
    await removeFile(this.path(id));
    await removeFile(this.path(id, true));
    this.client.state.offline[profile] = bag.filter((x) => x.id !== id);
    this.persist();
    return this.list(profileId);
  }
  /**
   * A removed profile's downloads go with it: its download stops and its
   * files and records are deleted (they can be gigabytes). Called after the
   * removal's own PIN check, so it does not ask for the active profile.
   */
  async forgetProfile(profileId) {
    const bag = this.client.state.offline?.[profileId];
    if (this.job?.profile === profileId) {
      this.job.abort.abort();
      await this.job.done;
    }
    for (const item of Array.isArray(bag) ? bag : []) {
      if (!ID.test(item?.id) || item.id === this.playing) continue;
      await removeFile(this.path(item.id)).catch(() => {});
      await removeFile(this.path(item.id, true)).catch(() => {});
    }
    delete this.client.state.offline?.[profileId];
  }
  async stop() {
    this.job?.abort.abort();
    await this.job?.done;
  }
}
