/**
 * Updates in the web edition. The site is rebuilt from the same source on
 * every release (.github/workflows/web.yml), so there is nothing to
 * download or install: a page that has been open a while only needs to
 * notice that a newer build is live and offer a reload. The build writes
 * version.json beside index.html; it carries the version and nothing else.
 */
import { compareVersions, parseVersion, REPO } from "../core/updates.mjs";

const CHECK_MS = 30 * 60 * 1000;

export class WebUpdates {
  constructor(client, { current, versionUrl = "./version.json", onChange }) {
    this.client = client;
    this.current = current;
    this.versionUrl = versionUrl;
    this.onChange = onChange || (() => {});
    this.status = "current";
    this.latest = null;
    this.checkedAt = null;
    this.error = "";
    this.announced = "";
  }
  get store() {
    const state = this.client.state;
    state.updates ||= { enabled: true };
    return state.updates;
  }
  publicState() {
    return {
      web: true,
      enabled: this.store.enabled !== false,
      current: this.current,
      status: this.status,
      latest: this.latest && { version: this.latest },
      available: this.status === "available",
      checkedAt: this.checkedAt,
      installed: true,
      error: this.error,
    };
  }
  async check({ force = false } = {}) {
    if (!force && this.store.enabled === false) return this.publicState();
    this.status = "checking";
    this.error = "";
    this.onChange();
    try {
      const response = await fetch(`${this.versionUrl}?t=${Date.now()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { version } = await response.json();
      if (!parseVersion(version)) throw new Error("bad version");
      this.latest = version;
      this.status =
        compareVersions(version, this.current) > 0 ? "available" : "current";
    } catch {
      this.status = "error";
      this.error = "تعذّر التحقق من نسخة الموقع. تحقق من الاتصال.";
    }
    this.checkedAt = Date.now();
    this.onChange();
    return this.publicState();
  }
  /** Checks now and then while the page stays open; tells the viewer once. */
  start(notice) {
    const run = async () => {
      if (document.visibilityState === "hidden") return;
      const state = await this.check();
      if (state.available && this.announced !== this.latest) {
        this.announced = this.latest;
        notice?.(
          `نسخة أحدث من رِواق (${this.latest}) منشورة على الموقع. حدّث الصفحة لتحصل عليها.`,
        );
      }
    };
    this.timer = setInterval(run, CHECK_MS);
    setTimeout(run, 60000);
  }
  stop() {
    clearInterval(this.timer);
  }
  setEnabled(enabled) {
    this.store.enabled = enabled === true;
    this.client.persist();
    return this.client.publicState();
  }
  configure(input = {}) {
    if (typeof input.enabled === "boolean") this.store.enabled = input.enabled;
    this.client.persist();
    return this.client.publicState();
  }
  /** Where the desktop edition is downloaded. */
  releaseUrl() {
    return `https://github.com/${REPO}/releases`;
  }
}
