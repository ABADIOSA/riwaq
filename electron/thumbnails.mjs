import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  thumbnailArgs,
  thumbnailSlot,
  thumbnailsAllowed,
} from "../core/trickplay.mjs";

const TIMEOUT_MS = 12000;
const CACHE = 160;
const FAILURES = 3;

/**
 * Grabs seek-bar previews for the current viewing. The source address and
 * headers stay here in main; the HUD asks by time and gets back a JPEG data
 * URL. One grab runs at a time and a newer request replaces an older one,
 * frames are cached per slice, and after three failures in a row previews
 * stop for that viewing rather than keep hammering the source.
 */
export class Thumbnailer {
  constructor({ tmpDir, spawn = nodeSpawn } = {}) {
    this.tmpDir = tmpDir;
    this.spawn = spawn;
    this.source = null;
    this.cache = new Map();
    this.failures = 0;
    this.job = null;
  }
  /** A new viewing (or none): forget the previous source and its frames. */
  reset(source = null) {
    this.cancel();
    this.source = source;
    this.cache.clear();
    this.failures = 0;
  }
  cancel() {
    const job = this.job;
    this.job = null;
    if (job) {
      try {
        job.child.kill();
      } catch {
        /* Already gone. */
      }
      job.finish(null);
    }
  }
  async frame({ at, duration, executable, mode, serverUrl }) {
    const source = this.source;
    if (!thumbnailsAllowed(source, mode, serverUrl)) return null;
    if (this.failures >= FAILURES) return null;
    const slot = thumbnailSlot(at, duration);
    if (this.cache.has(slot)) return this.cache.get(slot);
    this.cancel();
    const outDir = join(this.tmpDir, randomUUID());
    mkdirSync(outDir, { recursive: true });
    const image = await new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      let child;
      try {
        child = this.spawn(
          executable,
          thumbnailArgs({
            url: source.url,
            headers: source.headers,
            at: slot,
            outDir,
          }),
          { windowsHide: true, stdio: "ignore", shell: false },
        );
      } catch {
        finish(undefined);
        return;
      }
      const job = { child, finish };
      this.job = job;
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* Already gone. */
        }
        finish(undefined);
      }, TIMEOUT_MS);
      child.once("error", () => finish(undefined));
      child.once("exit", () => {
        if (this.job === job) this.job = null;
        try {
          const file = readdirSync(outDir).find((f) => /\.jpe?g$/i.test(f));
          if (!file) return finish(undefined);
          const bytes = readFileSync(join(outDir, file));
          finish(
            bytes.length
              ? `data:image/jpeg;base64,${bytes.toString("base64")}`
              : undefined,
          );
        } catch {
          finish(undefined);
        }
      });
    });
    rmSync(outDir, { recursive: true, force: true });
    // null: replaced by a newer request; undefined: this grab failed.
    if (image === null) return null;
    if (this.source !== source) return null;
    if (!image) {
      this.failures++;
      return null;
    }
    this.failures = 0;
    if (this.cache.size >= CACHE)
      this.cache.delete(this.cache.keys().next().value);
    this.cache.set(slot, image);
    return image;
  }
}
