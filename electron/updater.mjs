import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import {
  Updates,
  pickLatest,
  compareVersions,
  describeUpdateError,
  parseReleaseFeed,
  FEED_MAX,
  RELEASES_FEED,
  REPO,
} from "../core/updates.mjs";
import {
  assetUrl,
  installerName,
  verifyManifest,
  verifyInstaller,
  eligiblePackage,
  fetchUpdate,
  readManifest,
  MANIFEST_NAME,
  MAX_MANIFEST,
} from "../core/update-package.mjs";

const INTERVAL = 4 * 60 * 60 * 1000;
// After a failed check (a rate limit or a dropped connection), try again
// sooner than the regular interval.
const RETRY = 20 * 60 * 1000;
const busyStates = new Set([
  "checking",
  "downloading",
  "verifying",
  "installing",
]);
const quietError = (error) =>
  /[\u0600-\u06ff]/.test(error?.message || "") &&
  !/https?:|\\\\/.test(error.message)
    ? error.message
    : "تعذّر إكمال التحديث؛ تحقق من الاتصال والمساحة المتاحة ثم حاول مجدداً";

/** OS-independent coordinator; Electron supplies the installation context. */
export class DesktopUpdates extends Updates {
  constructor(
    client,
    {
      current,
      directory,
      publicKey,
      installed = false,
      onChange = () => {},
      fetcher = fetch,
      launch = launchInstaller,
      installDirectory = "",
    },
  ) {
    super(client);
    Object.assign(this, {
      current,
      directory,
      publicKey,
      installed,
      onChange,
      fetcher,
      launch,
      installDirectory,
    });
    this.runtime = {
      status: "idle",
      percent: 0,
      transferred: 0,
      total: 0,
      error: "",
      detail: "",
      verified: false,
    };
    this.manifest = null;
    this.envelope = null;
    this.downloading = null;
    this.controller = null;
    this.sessionEnding = false;
  }
  publicState(current = this.current) {
    return {
      ...super.publicState(current),
      ...this.runtime,
      installed: this.installed,
      autoDownload: this.store.autoDownload !== false,
      installOnExit: this.store.installOnExit !== false,
      channel: this.store.channel === "stable" ? "stable" : "beta",
      notes: this.manifest?.notes || "",
      packageVersion: this.manifest?.version || null,
      canDownload:
        this.installed &&
        !!this.manifest &&
        ["available", "error"].includes(this.runtime.status),
    };
  }
  set(patch) {
    Object.assign(this.runtime, patch);
    this.onChange(this.publicState());
  }
  async configure(values = {}) {
    this.client.profiles.gate("settings");
    if (this.runtime.status === "installing")
      throw new Error("التثبيت جارٍ الآن");
    if (
      values.channel !== undefined &&
      !["stable", "beta"].includes(values.channel)
    )
      throw new Error("قناة التحديث غير صالحة");
    if (values.channel && values.channel !== this.publicState().channel) {
      if (busyStates.has(this.runtime.status))
        throw new Error(
          "انتظر انتهاء العملية أو ألغِ التنزيل قبل تغيير القناة",
        );
      await this.clearPending();
      this.manifest = this.envelope = null;
      this.store.latest = null;
      this.store.checkedAt = null;
      this.set({ status: "idle", verified: false, percent: 0, error: "" });
    }
    for (const key of ["enabled", "autoDownload", "installOnExit"])
      if (typeof values[key] === "boolean") this.store[key] = values[key];
    if (values.channel) this.store.channel = values.channel;
    this.client.persist();
    if (values.enabled === false || values.autoDownload === false)
      this.cancel();
    this.onChange(this.publicState());
    return this.client.publicState();
  }
  setEnabled(enabled) {
    return this.configure({ enabled: enabled === true });
  }
  async clearPending() {
    await unlink(join(this.directory, "pending-update.json")).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    if (this.manifest)
      await unlink(
        join(this.directory, installerName(this.manifest.version)),
      ).catch(() => {});
  }
  async restore() {
    if (!this.installed) return;
    try {
      const buffer = await readFile(
        join(this.directory, "pending-update.json"),
      );
      if (buffer.length > MAX_MANIFEST)
        throw new Error("بيانات التحديث غير صالحة");
      const envelope = buffer.toString("utf8");
      const manifest = verifyManifest(envelope, this.publicKey, {
        channel: this.publicState().channel,
      });
      this.manifest = manifest;
      if (
        !eligiblePackage(manifest, this.current, this.publicState().channel)
      ) {
        await this.clearPending();
        this.manifest = null;
        return;
      }
      await verifyInstaller(join(this.directory, manifest.filename), manifest);
      this.envelope = envelope;
      this.store.latest = {
        version: manifest.version,
        name: `رِواق ${manifest.version}`,
        url: `https://github.com/${REPO}/releases/tag/v${manifest.version}`,
        prerelease: manifest.channel === "beta",
        publishedAt: manifest.publishedAt,
      };
      this.set({
        status: "ready",
        verified: true,
        percent: 100,
        total: manifest.size,
        transferred: manifest.size,
      });
    } catch (error) {
      this.manifest = this.envelope = null;
      if (error.code !== "ENOENT")
        this.set({
          status: "error",
          error: quietError(error),
          verified: false,
        });
    }
  }
  async check({ force = false, now = Date.now() } = {}) {
    if (this.checking) return this.checking;
    if (busyStates.has(this.runtime.status) || this.runtime.status === "ready")
      return this.publicState();
    const wait =
      this.store.failed || this.runtime.status === "error" ? RETRY : INTERVAL;
    if (
      !force &&
      (this.store.enabled === false ||
        (this.store.checkedAt && now - this.store.checkedAt < wait))
    )
      return this.publicState();
    this.checking = this.checkRelease(now).finally(() => {
      this.checking = null;
    });
    return this.checking;
  }
  /** The releases list: GitHub's API first, its website feed if refused. */
  async releaseList() {
    try {
      const releases = await this.client.request(
        `https://api.github.com/repos/${REPO}/releases?per_page=30`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `Riwaq/${this.current}`,
          },
        },
      );
      return { releases: Array.isArray(releases) ? releases : [], via: "api" };
    } catch (apiError) {
      const api = describeUpdateError(apiError, "GitHub API");
      try {
        const response = await this.fetcher(RELEASES_FEED, {
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            Accept: "application/atom+xml",
            "User-Agent": `Riwaq/${this.current}`,
          },
        });
        if (!response.ok) {
          await response.body?.cancel?.();
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }
        const text = await response.text();
        if (text.length > FEED_MAX) throw new Error("feed too large");
        return { releases: parseReleaseFeed(text), via: "feed", api };
      } catch (feedError) {
        const feed = describeUpdateError(feedError, "موجز الإصدارات");
        const error = new Error(api.message);
        error.detail = [api.code, feed.code].filter(Boolean).join(" · ");
        throw error;
      }
    }
  }
  async checkRelease(now) {
    this.manifest = this.envelope = null;
    this.set({
      status: "checking",
      error: "",
      detail: "",
      verified: false,
      percent: 0,
    });
    try {
      const { releases, via, api } = await this.releaseList();
      const channel = this.publicState().channel;
      const list = releases.filter(
        (r) =>
          channel !== "stable" ||
          (!r.prerelease && !String(r.tag_name).includes("-")),
      );
      const latest = pickLatest(list);
      this.store.latest = latest;
      this.store.failed = false;
      // Reached through the feed: say so quietly, it is not an error.
      const detail = via === "feed" ? `عبر موجز الإصدارات (${api.code})` : "";
      if (!latest || compareVersions(latest.version, this.current) <= 0)
        this.set({ status: "current", detail });
      else {
        const release = list.find((r) => r.tag_name === `v${latest.version}`);
        if (
          via === "api" &&
          !release?.assets?.some((a) => a.name === MANIFEST_NAME)
        )
          this.set({ status: "manual", detail });
        else {
          let envelope;
          try {
            envelope = await readManifest(assetUrl(latest.version), {
              signal: AbortSignal.timeout(20000),
              fetcher: this.fetcher,
            });
          } catch (error) {
            // The feed cannot list assets: a release without a signed
            // manifest is opened by hand, as with the API.
            if (via === "feed" && error.status === 404) {
              this.set({ status: "manual", detail });
              envelope = null;
            } else throw error;
          }
          if (envelope) {
            // The feed has no prerelease flag; the signed channel decides.
            const signed = verifyManifest(envelope, this.publicKey, {
              version: latest.version,
            });
            if (!eligiblePackage(signed, this.current, channel))
              this.set({ status: "current", detail });
            else {
              this.manifest = verifyManifest(envelope, this.publicKey, {
                version: latest.version,
                channel,
              });
              this.envelope = envelope;
              this.set({
                status: "available",
                verified: true,
                total: this.manifest.size,
                detail,
              });
            }
          }
        }
      }
    } catch (error) {
      this.store.failed = true;
      this.manifest = this.envelope = null;
      const described = describeUpdateError(error);
      this.set({
        status: "error",
        error: described.message,
        detail: error.detail || described.code,
        verified: false,
      });
    }
    this.store.checkedAt = now;
    this.client.persist();
    this.onChange(this.publicState());
    if (
      this.installed &&
      this.manifest &&
      this.store.enabled !== false &&
      this.store.autoDownload !== false
    )
      void this.download().catch(() => {});
    return this.publicState();
  }
  cancel() {
    this.controller?.abort();
    return this.publicState();
  }
  async download() {
    if (this.downloading) return this.downloading;
    if (!this.installed)
      throw new Error(
        "ثبّت رِواق باستخدام ملف Setup مرة واحدة لتفعيل التحديثات الداخلية",
      );
    if (!this.manifest || !["available", "error"].includes(this.runtime.status))
      throw new Error("تحقق من وجود تحديث صالح أولاً");
    this.downloading = this.downloadPackage().finally(() => {
      this.downloading = null;
      this.controller = null;
    });
    return this.downloading;
  }
  async downloadPackage() {
    const manifest = this.manifest;
    const path = join(this.directory, manifest.filename);
    const partial = path + ".part";
    this.controller = new AbortController();
    const signal = AbortSignal.any([
      this.controller.signal,
      AbortSignal.timeout(30 * 60 * 1000),
    ]);
    this.set({
      status: "downloading",
      percent: 0,
      transferred: 0,
      total: manifest.size,
      error: "",
    });
    try {
      await mkdir(this.directory, { recursive: true });
      const response = await fetchUpdate(
        assetUrl(manifest.version, manifest.filename),
        { signal, fetcher: this.fetcher },
      );
      const length = response.headers.get("content-length");
      if (length !== null && Number(length) !== manifest.size) {
        await response.body?.cancel();
        throw new Error("حجم ملف التحديث لا يطابق الحزمة الموقعة");
      }
      let received = 0,
        last = 0;
      const meter = new Transform({
        transform: (chunk, _encoding, done) => {
          received += chunk.length;
          if (received > manifest.size)
            return done(new Error("حجم ملف التحديث أكبر من الحزمة الموقعة"));
          if (Date.now() - last > 200) {
            last = Date.now();
            this.set({
              transferred: received,
              percent: Math.min(99, (received / manifest.size) * 100),
            });
          }
          done(null, chunk);
        },
      });
      await pipeline(response.body, meter, createWriteStream(partial), {
        signal,
      });
      signal.throwIfAborted();
      this.set({ status: "verifying", transferred: received });
      await verifyInstaller(partial, manifest);
      signal.throwIfAborted();
      await rename(partial, path);
      await writeFile(
        join(this.directory, "pending-update.json.tmp"),
        this.envelope,
      );
      await rename(
        join(this.directory, "pending-update.json.tmp"),
        join(this.directory, "pending-update.json"),
      );
      this.set({
        status: "ready",
        verified: true,
        percent: 100,
        transferred: received,
      });
    } catch (error) {
      await unlink(partial).catch(() => {});
      const described = describeUpdateError(error, "تنزيل الحزمة");
      this.set({
        status: this.controller.signal.aborted ? "available" : "error",
        error: this.controller.signal.aborted ? "" : described.message,
        detail: this.controller.signal.aborted ? "" : described.code,
        percent: 0,
        transferred: 0,
      });
    }
    return this.publicState();
  }
  async install({ automatic = false, relaunch = true } = {}) {
    if (
      !this.installed ||
      this.runtime.status !== "ready" ||
      this.sessionEnding
    )
      return false;
    if (
      automatic &&
      (this.store.enabled === false || this.store.installOnExit === false)
    )
      return false;
    this.set({ status: "installing", error: "" });
    try {
      // Read and validate again at the execution boundary; cached bytes may have changed.
      const envelope = await readFile(
        join(this.directory, "pending-update.json"),
        "utf8",
      );
      const manifest = verifyManifest(envelope, this.publicKey, {
        version: this.manifest.version,
        channel: this.publicState().channel,
      });
      if (!eligiblePackage(manifest, this.current, this.publicState().channel))
        throw new Error("التحديث لا يتجاوز الإصدار الحالي");
      const path = join(this.directory, manifest.filename);
      await verifyInstaller(path, manifest);
      if (this.sessionEnding) {
        this.set({ status: "ready" });
        return false;
      }
      await this.launch(path, { directory: this.installDirectory, relaunch });
      return true;
    } catch (error) {
      this.set({ status: "error", error: quietError(error), verified: false });
      return false;
    }
  }
  stop() {
    this.controller?.abort();
    clearTimeout(this.startTimer);
    clearInterval(this.timer);
  }
  start() {
    this.startTimer = setTimeout(() => void this.check(), 12000);
    this.timer = setInterval(() => void this.check(), INTERVAL);
    this.startTimer.unref?.();
    this.timer.unref?.();
  }
}

/** NSIS handles replacement. Paths are main-owned; no shell or elevation. */
export async function launchInstaller(path, { directory, relaunch }) {
  const args = [
    "/S",
    "--updated",
    ...(relaunch ? ["--force-run"] : []),
    `/D=${directory}`,
  ];
  const child = spawn(path, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}
