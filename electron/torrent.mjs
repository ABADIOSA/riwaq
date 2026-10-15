/**
 * Main's handle on the built-in torrent engine (core/torrent-engine.mjs).
 * The engine runs in its own process, started the first time a torrent is
 * played with it and stopped when Riwaq quits; a crashed process is started
 * again on the next play. Only what MPV needs (the stream's info hash, file
 * index, file name and trackers) crosses into it, and only counts come back.
 */
import {
  cleanTorrentPath,
  engineOptions,
  publicStats,
  startStatus,
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
    this.epoch = 0;
    this.stopping = null;
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
      try {
        child.postMessage({ id, method, args });
      } catch (error) {
        this.calls.delete(id);
        clearTimeout(timer);
        reject(error);
      }
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
    if (this.stopping) return this.stopping.then(() => this.start(settings));
    if (this.running) return Promise.resolve(this.origin);
    if (this.starting) return this.starting;
    const epoch = this.epoch;
    const starting = (async () => {
      let child;
      try {
        child = this.fork();
      } catch (error) {
        this.log(error);
        throw new Error("تعذّر تشغيل محرك التورنت المدمج");
      }
      this.child = child;
      child.on("message", (message) => {
        if (this.child === child) this.receive(message);
      });
      child.on("exit", () => {
        if (this.child !== child) return;
        this.child = null;
        this.origin = "";
        this.settle(new Error("توقف محرك التورنت المدمج"));
      });
      try {
        const options = engineOptions(settings);
        // The router's port is opened when the engine starts; a change of
        // the setting starts it again on the next play (url below).
        this.incoming = options.incoming;
        const { origin } = await this.call("start", {
          cacheDir: this.cacheDir,
          options,
          ...(this.network ? { network: this.network } : {}),
        });
        if (this.child !== child || this.epoch !== epoch)
          throw new Error("توقف محرك التورنت المدمج");
        this.origin = origin;
        return origin;
      } catch (error) {
        if (this.epoch === epoch) this.log(error);
        if (this.child === child && !this.stopping) {
          this.child = null;
          this.origin = "";
          this.settle(error);
          try {
            child.kill();
          } catch {}
        }
        throw new Error("تعذّر تشغيل محرك التورنت المدمج");
      }
    })().finally(() => {
      if (this.starting === starting) this.starting = null;
    });
    this.starting = starting;
    return this.starting;
  }

  /** The address MPV plays for a torrent stream. */
  async url(stream, settings) {
    if (!validHash(stream?.infoHash)) throw new Error("معرّف التورنت غير صالح");
    if (this.running && this.incoming !== engineOptions(settings).incoming)
      await this.stop();
    await this.start(settings);
    return this.call("url", {
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx,
      filename: cleanTorrentPath(stream.behaviorHints?.filename),
      sources: Array.isArray(stream.sources) ? stream.sources : [],
    });
  }

  /**
   * What the network lets through (DHT nodes, UDP, HTTPS, incoming peers),
   * for the P2P page. It starts the engine when it is not running.
   */
  async netcheck(settings) {
    await this.start(settings);
    const found = await this.call("netcheck").catch(() => null);
    return {
      dhtNodes: Math.max(0, Math.round(Number(found?.dhtNodes) || 0)),
      udp: found?.udp === true,
      https: found?.https === true,
      incoming: found?.incoming === true,
    };
  }

  /**
   * A torrent's files in its own order, once known (paths and sizes only,
   * at most 5000), for TorrServer's fallback; null otherwise.
   */
  async files(hash) {
    if (!this.running || !validHash(hash)) return null;
    const list = await this.call("files", hash).catch(() => null);
    if (!Array.isArray(list)) return null;
    return list.slice(0, 5000).map((file) => ({
      path: typeof file?.path === "string" ? file.path.slice(0, 1024) : "",
      length: Number.isFinite(file?.length) ? file.length : 0,
    }));
  }

  release(hash) {
    if (!this.running || !validHash(hash)) return Promise.resolve(false);
    return this.call("release", hash).catch(() => false);
  }

  /** How a torrent's start is going (counts only), or null. */
  status(hash) {
    if (!this.running || !validHash(hash)) return Promise.resolve(null);
    return this.call("status", hash)
      .then(startStatus)
      .catch(() => null);
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

  stop() {
    if (this.stopping) return this.stopping;
    this.epoch++;
    const child = this.child;
    if (!child) return Promise.resolve();
    let timer;
    const stopping = (async () => {
      try {
        await Promise.race([
          this.call("close").catch(() => {}),
          new Promise((resolve) => {
            timer = setTimeout(resolve, 1500);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        if (this.child === child) {
          this.child = null;
          this.origin = "";
          this.settle(new Error("توقف محرك التورنت المدمج"));
          this.starting = null;
          try {
            child.kill();
          } catch {}
        }
      }
    })().finally(() => {
      if (this.stopping === stopping) this.stopping = null;
    });
    this.stopping = stopping;
    return stopping;
  }
}
