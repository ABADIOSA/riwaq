/**
 * TorrServer in main (core/torrserver.mjs has the rules): the pinned
 * download, its program and its API.
 *
 * - The download is TORRSERVER only, on the viewer's click: fetchPinned
 *   re-checks every redirect against GitHub's release hosts, caps the body at
 *   the pinned size and compares its SHA-256 before a byte is written; the
 *   file is renamed into place only then. Its size and SHA-256 are checked
 *   again before it first runs in each session.
 * - It runs with a fixed argument list and no shell: the web server on
 *   127.0.0.1 only, on a free port, and HTTP authentication with a random
 *   password written for each start (accs.db), so a web page or another
 *   program cannot add torrents or change its settings. Its settings file is
 *   written before each start (no Bonjour, LAN discovery or DLNA).
 * - MPV plays a torrent this host added, without the password: TorrServer
 *   streams a torrent it already holds to anyone on 127.0.0.1, and the
 *   password never leaves main or that folder.
 * - Only counts come back to the interface; a torrent is dropped when its
 *   viewing ends, and the program stops a few minutes after the last one.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  createReadStream,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { cleanFilename, magnetOf, validHash } from "../core/torrent-engine.mjs";
import {
  TORRSERVER,
  TORRSERVER_IDLE_MS,
  TORRSERVER_READY_MS,
  torrServerFile,
  torrServerFiles,
  torrServerSettings,
  torrServerStatus,
  torrServerStreamUrl,
} from "../core/torrserver.mjs";
import { fetchPinned } from "./shaders.mjs";

// What TorrServer needs from the environment on Windows; nothing else of
// Riwaq's environment reaches it.
const ENV_KEYS = [
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOME",
];
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A port nothing on 127.0.0.1 is listening on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** The SHA-256 of a file, read in pieces. */
function fileDigest(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

export class TorrServerHost {
  constructor({
    dir,
    release = TORRSERVER,
    exe,
    spawn = nodeSpawn,
    fetch = globalThis.fetch,
    memory = 0,
    log = () => {},
    readyMs = TORRSERVER_READY_MS,
    idleMs = TORRSERVER_IDLE_MS,
    echoMs = 15000,
    pollMs = 1000,
  } = {}) {
    if (!dir) throw new Error("مجلد TorrServer غير محدد");
    this.dir = dir;
    this.pin = release;
    this.exe = exe || join(dir, release.version, "TorrServer.exe");
    this.data = join(dir, "data");
    this.spawn = spawn;
    this.fetch = fetch;
    this.memory = memory;
    this.log = log;
    this.readyMs = readyMs;
    this.idleMs = idleMs;
    this.echoMs = echoMs;
    this.pollMs = pollMs;
    this.child = null;
    this.origin = "";
    this.auth = "";
    this.config = "";
    this.starting = null;
    this.stopping = null;
    this.installing = null;
    this.progress = 0;
    this.verified = false;
    // Each torrent's viewings (and starts) in progress: a torrent is dropped
    // only when the last one ends.
    this.active = new Map();
    this.idle = null;
  }

  get running() {
    return !!this.child && !!this.origin;
  }

  /** The pinned file is in place at its size (its digest is checked to run). */
  installed() {
    try {
      return statSync(this.exe).size === this.pin.size;
    } catch {
      return false;
    }
  }

  /** For the P2P page: flags, the version and progress only. */
  state() {
    return {
      installed: this.installed(),
      version: this.pin.version,
      size: this.pin.size,
      installing: !!this.installing,
      progress: this.installing ? this.progress : 0,
      running: this.running,
    };
  }

  /** Downloads the pinned release; one download at a time. */
  install() {
    this.installing ||= (async () => {
      this.progress = 0;
      const bytes = await fetchPinned(this.pin, {
        fetch: this.fetch,
        timeout: 20 * 60 * 1000,
        onProgress: (ratio) => {
          this.progress = Math.max(0, Math.min(1, ratio));
        },
      });
      const folder = join(this.dir, this.pin.version);
      mkdirSync(folder, { recursive: true });
      const part = join(folder, `.${randomBytes(6).toString("hex")}.part`);
      try {
        writeFileSync(part, bytes);
        renameSync(part, this.exe);
      } catch (error) {
        rmSync(part, { force: true });
        throw error;
      }
      // An older pinned release is not needed any more.
      for (const name of readdirSync(this.dir))
        if (name !== this.pin.version && name !== "data")
          rmSync(join(this.dir, name), { recursive: true, force: true });
      this.verified = true;
      return this.state();
    })().finally(() => {
      this.installing = null;
      this.progress = 0;
    });
    return this.installing;
  }

  /** Stops it and deletes the program and its folder. */
  async remove() {
    await this.stop();
    rmSync(this.dir, { recursive: true, force: true });
    this.verified = false;
    return this.state();
  }

  async verify() {
    if (this.verified) return;
    if (!this.installed()) throw new Error("نزّل TorrServer أولاً");
    if ((await fileDigest(this.exe)) !== this.pin.sha256) {
      rmSync(this.exe, { force: true });
      throw new Error("ملف TorrServer تغيّر بعد تنزيله، فحُذف. نزّله من جديد.");
    }
    this.verified = true;
  }

  /** One authenticated API call; JSON back, or null for an empty body. */
  async api(path, body, ms = 10000) {
    if (!this.origin) throw new Error("TorrServer متوقف");
    const response = await this.fetch(this.origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: this.auth,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(ms),
    });
    if (!response.ok) throw new Error(`TorrServer HTTP ${response.status}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /** Starts the program once; settings apply at the next start. */
  start(settings = {}) {
    if (this.stopping) return this.stopping.then(() => this.start(settings));
    const config = JSON.stringify(torrServerSettings(settings, this.memory));
    if (this.running && (this.config === config || this.active.size))
      return Promise.resolve(this.origin);
    if (this.starting) return this.starting;
    const starting = (async () => {
      if (this.running) await this.stop();
      await this.verify();
      let lastError;
      // A port taken between the check and TorrServer's start: once more.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          return await this.launch(config);
        } catch (error) {
          lastError = error;
          this.log(error);
        }
      }
      throw new Error(
        lastError?.code === "EACCES" || lastError?.code === "EPERM"
          ? "ويندوز منع تشغيل TorrServer؛ تحقق من برنامج الحماية"
          : "تعذّر تشغيل TorrServer",
      );
    })().finally(() => {
      if (this.starting === starting) this.starting = null;
    });
    this.starting = starting;
    return starting;
  }

  async launch(config) {
    mkdirSync(this.data, { recursive: true });
    const password = randomBytes(24).toString("hex");
    writeFileSync(
      join(this.data, "accs.db"),
      JSON.stringify({ riwaq: password }),
      { mode: 0o600 },
    );
    writeFileSync(join(this.data, "settings.json"), config);
    const port = await freePort();
    const env = {};
    for (const key of ENV_KEYS)
      if (typeof process.env[key] === "string") env[key] = process.env[key];
    const child = this.spawn(
      this.exe,
      ["-p", String(port), "-i", "127.0.0.1", "-d", this.data, "-a"],
      { cwd: this.data, env, stdio: "ignore", windowsHide: true, shell: false },
    );
    let exited = false;
    let failure = null;
    child.on("error", (error) => {
      failure = error;
      this.log(error);
    });
    child.on("exit", () => {
      exited = true;
      if (this.child !== child) return;
      this.child = null;
      this.origin = "";
      this.active.clear();
    });
    this.child = child;
    const origin = `http://127.0.0.1:${port}`;
    const auth = "Basic " + Buffer.from(`riwaq:${password}`).toString("base64");
    const until = Date.now() + this.echoMs;
    let up = false;
    while (Date.now() < until && !exited && !failure) {
      try {
        const response = await this.fetch(origin + "/echo", {
          redirect: "error",
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok && /^MatriX\./.test((await response.text()).trim())) {
          up = true;
          break;
        }
      } catch {}
      await wait(250);
    }
    if (!up || this.child !== child) {
      if (this.child === child) this.child = null;
      try {
        child.kill();
      } catch {}
      throw failure || new Error("TorrServer ما اشتغل");
    }
    this.origin = origin;
    this.auth = auth;
    // It must refuse a request without the password, and have read the
    // settings file: otherwise it stops rather than run open or on the LAN.
    const open = await this.fetch(origin + "/settings", {
      method: "POST",
      body: JSON.stringify({ action: "get" }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    const sets = await this.api("/settings", { action: "get" }).catch(
      () => null,
    );
    if (
      open?.status !== 401 ||
      !sets ||
      sets.EnableBonjour !== false ||
      sets.EnableLPD !== false ||
      sets.EnableDLNA !== false
    ) {
      await this.stop();
      throw new Error("TorrServer ما أخذ إعدادات رِواق");
    }
    this.config = config;
    return origin;
  }

  /**
   * The address MPV plays for a torrent, once TorrServer has its metadata
   * and knows which file to play (`files` is the torrent's own file list,
   * when the built-in engine read it). `onStatus` sees each poll.
   */
  async url(stream, settings, { files, onStatus } = {}) {
    if (!validHash(stream?.infoHash)) throw new Error("معرّف التورنت غير صالح");
    clearTimeout(this.idle);
    const origin = await this.start(settings);
    const hash = stream.infoHash.toLowerCase();
    this.active.set(hash, (this.active.get(hash) || 0) + 1);
    try {
      await this.api("/torrents", {
        action: "add",
        link: magnetOf(stream),
        save_to_db: false,
      });
      const until = Date.now() + this.readyMs;
      let stats = null;
      for (;;) {
        stats = await this.api("/torrents", { action: "get", hash }).catch(
          () => null,
        );
        onStatus?.(torrServerStatus(stats));
        if (torrServerFiles(stats).length || Date.now() >= until) break;
        await wait(this.pollMs);
      }
      if (!torrServerFiles(stats).length)
        throw new Error("ما وصلت بيانات التورنت إلى TorrServer");
      const id = torrServerFile(stats, {
        fileIdx: stream.fileIdx,
        filename: cleanFilename(stream.behaviorHints?.filename),
        files,
      });
      if (!id) throw new Error("ما عرفنا أي ملف في التورنت يشغّله TorrServer");
      const file = torrServerFiles(stats).find((f) => f.id === id);
      return torrServerStreamUrl(origin, hash, file);
    } catch (error) {
      await this.release(hash);
      throw error;
    }
  }

  /** How a torrent's start is going (counts only), or null. */
  async status(hash) {
    if (!this.running || !validHash(hash)) return null;
    const stats = await this.api("/torrents", {
      action: "get",
      hash: hash.toLowerCase(),
    }).catch(() => null);
    return torrServerStatus(stats);
  }

  /**
   * A viewing (or a failed start) of a torrent ended: the last one drops it,
   * and an idle program stops later.
   */
  async release(hash) {
    if (!validHash(hash)) return false;
    const key = hash.toLowerCase();
    const left = (this.active.get(key) || 0) - 1;
    if (left > 0) {
      this.active.set(key, left);
      return true;
    }
    this.active.delete(key);
    if (this.running)
      await this.api("/torrents", { action: "drop", hash: key }).catch(
        () => {},
      );
    if (!this.active.size && this.running) {
      clearTimeout(this.idle);
      this.idle = setTimeout(() => {
        if (!this.active.size) this.stop();
      }, this.idleMs);
      this.idle.unref?.();
    }
    return true;
  }

  /** Stops the program: its own shutdown first, then the process. */
  stop() {
    if (this.stopping) return this.stopping;
    clearTimeout(this.idle);
    const child = this.child;
    if (!child) return Promise.resolve();
    const stopping = (async () => {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      if (this.origin)
        await this.api("/shutdown", undefined, 1000).catch(() => {});
      await Promise.race([exited, wait(1500)]);
      try {
        child.kill();
      } catch {}
      if (this.child === child) this.child = null;
      this.origin = "";
      this.auth = "";
      this.active.clear();
    })().finally(() => {
      this.stopping = null;
    });
    this.stopping = stopping;
    return stopping;
  }
}
