/**
 * Main's handle on the built-in torrent engine (core/torrent-engine.mjs).
 * The engine runs in its own process, started the first time a torrent is
 * played with it and stopped when Riwaq quits; a crashed process is started
 * again on the next play. Only what MPV needs (the stream's info hash, file
 * index and trackers) crosses into it, and only counts come back.
 */
import {
  engineOptions,
  publicStats,
  validHash,
} from "../core/torrent-engine.mjs";

const CALL_MS = 20000;

export class TorrentHost {
  /**
   * `fork()` starts the engine's process and returns an object with
   * postMessage, on("message"), on("exit") and kill (utilityProcess.fork).
   */
  constructor({ fork, cacheDir, log = () => {}, network }) {
    this.fork = fork;
    this.cacheDir = cacheDir;
    // Tests only: no DHT or public trackers on a machine without internet.
    this.network = network;
    this.log = log;
    this.child = null;
    this.starting = null;
    this.origin = "";
    this.calls = new Map();
    this.next = 1;
  }

  get running() {
    return !!this.child && !!this.origin;
  }

  call(method, ...args) {
    const child = this.child;
    if (!child) return Promise.reject(new Error("محرك التورنت متوقف"));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error("محرك التورنت لا يستجيب"));
      }, CALL_MS);
      this.calls.set(id, { resolve, reject, timer });
      child.postMessage({ id, method, args });
    });
  }

  receive(message) {
    if (message?.log) return this.log(new Error(message.log));
    const pending = this.calls.get(message?.id);
    if (!pending) return;
    this.calls.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result);
  }

  settle(error) {
    for (const pending of this.calls.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.calls.clear();
  }

  /** Starts the engine's process once; a failed start can be tried again. */
  start(settings) {
    if (this.running) return Promise.resolve(this.origin);
    this.starting ||= (async () => {
      let child;
      try {
        child = this.fork();
      } catch (error) {
        this.log(error);
        throw new Error("تعذّر تشغيل محرك التورنت المدمج");
      }
      this.child = child;
      child.on("message", (message) => this.receive(message));
      child.on("exit", () => {
        if (this.child !== child) return;
        this.child = null;
        this.origin = "";
        this.settle(new Error("توقف محرك التورنت المدمج"));
      });
      try {
        const { origin } = await this.call("start", {
          cacheDir: this.cacheDir,
          options: engineOptions(settings),
          ...(this.network ? { network: this.network } : {}),
        });
        this.origin = origin;
        return origin;
      } catch (error) {
        this.log(error);
        this.child = null;
        try {
          child.kill();
        } catch {}
        throw new Error("تعذّر تشغيل محرك التورنت المدمج");
      }
    })().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** The address MPV plays for a torrent stream. */
  async url(stream, settings) {
    if (!validHash(stream?.infoHash)) throw new Error("معرّف التورنت غير صالح");
    await this.start(settings);
    return this.call("url", {
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx,
      sources: Array.isArray(stream.sources) ? stream.sources : [],
    });
  }

  release(hash) {
    if (!this.running || !validHash(hash)) return Promise.resolve(false);
    return this.call("release", hash).catch(() => false);
  }

  configure(settings) {
    if (!this.running) return Promise.resolve(false);
    return this.call("configure", engineOptions(settings)).catch(() => false);
  }

  async stats() {
    if (!this.running) return publicStats({ running: false });
    return publicStats(await this.call("stats").catch(() => null));
  }

  async clear() {
    if (!this.running) return false;
    return this.call("clear");
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    await this.call("close").catch(() => {});
    if (this.child === child) {
      this.child = null;
      this.origin = "";
      try {
        child.kill();
      } catch {}
    }
  }
}
