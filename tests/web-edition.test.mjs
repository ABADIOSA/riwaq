import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nodeCrypto from "node:crypto";
import nodeZlib from "node:zlib";
import * as webCrypto from "../web/shims/crypto.js";
import * as webZlib from "../web/shims/zlib.js";
import { Buffer as WebBuffer } from "../web/shims/buffer.js";
import { DESKTOP_ONLY } from "../web/desktop-only.js";
import { browserFetch, cleanError } from "../web/bridge.js";
import {
  blockedAsMixed,
  cueCss,
  isHlsUrl,
  playPlan,
  serverHlsUrl,
  WebPlayer,
} from "../web/player.js";
import { readCallback } from "../web/callback.js";
import { WebMusicLibrary } from "../web/music.js";

// The web edition (docs/WEB.md) answers the desktop's bridge with the same
// core/. These checks fail when the desktop gains something the website
// has not decided about, so no release reaches one edition only.

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");
test("web speed commands publish the applied rate before ratechange arrives", () => {
  const published = [];
  const player = new WebPlayer({
    onState: (state) => published.push(state.speed),
  });
  player.state = { active: true, speed: 1 };
  // No ratechange events: mirrors the browser's pending asynchronous event.
  player.video = { playbackRate: 1 };
  for (const value of [1.5, 2, 1.5, 99]) {
    player.command({ action: "speed", value });
    assert.equal(player.state.speed, player.video.playbackRate);
  }
  assert.deepEqual(published, [1.5, 2, 1.5, 4]);
});
const names = (text) =>
  new Set([...text.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]));

const preload = read("electron/preload.cjs");
const allowed = names(
  preload.slice(
    preload.indexOf("new Set(["),
    preload.indexOf("contextBridge.exposeInMainWorld"),
  ),
);
const events = names(
  preload.slice(
    preload.indexOf("on: (name, fn)"),
    preload.indexOf("const handler"),
  ),
);
const bridge = read("web/bridge.js");
const block = bridge.slice(
  bridge.indexOf("  const methods = {"),
  bridge.indexOf("\n  };\n", bridge.indexOf("  const methods = {")),
);
const webMethods = new Set(
  [...block.matchAll(/^\s{4}([A-Za-z]+)(?:\s*:|\s*\(|,)/gm)].map((m) => m[1]),
);

test("every desktop bridge method is answered on the web or named desktop-only", () => {
  assert.ok(allowed.size > 100, "the preload allowlist was read");
  const missing = [...allowed].filter(
    (m) => !webMethods.has(m) && !Object.hasOwn(DESKTOP_ONLY, m),
  );
  assert.deepEqual(missing, []);
  const both = [...webMethods].filter((m) => Object.hasOwn(DESKTOP_ONLY, m));
  assert.deepEqual(both, []);
  // Nothing on the web that the desktop's bridge would refuse.
  const extra = [...webMethods, ...Object.keys(DESKTOP_ONLY)].filter(
    (m) => !allowed.has(m),
  );
  assert.deepEqual(extra, []);
  for (const reason of Object.values(DESKTOP_ONLY))
    assert.match(reason, /[؀-ۿ]/, "the viewer reads why, in Arabic");
});

test("every event the desktop sends exists on the web bridge", () => {
  const web = names(
    bridge.slice(bridge.indexOf("const EVENTS"), bridge.indexOf("]);")),
  );
  assert.ok(events.size >= 8);
  assert.deepEqual(
    [...events].filter((e) => !web.has(e)),
    [],
  );
});

test("every Node module core/ imports has a browser version in the web build", () => {
  const config = read("vite.web.config.mjs");
  const desktopOnly = new Set(["update-package.mjs"]);
  const missing = [];
  for (const file of readdirSync(join(root, "core"))) {
    if (!file.endsWith(".mjs") || desktopOnly.has(file)) continue;
    for (const m of read(join("core", file)).matchAll(/from "(node:[a-z/]+)"/g))
      if (!config.includes(`"${m[1]}":`)) missing.push(`${file}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test("the shims give Node's own bytes, so backups cross between editions", async () => {
  const same = (a, b) =>
    assert.equal(Buffer.compare(Buffer.from(a), Buffer.from(b)), 0);
  same(
    webCrypto.createHash("sha256").update("رِواق").digest(),
    nodeCrypto.createHash("sha256").update("رِواق").digest(),
  );
  assert.equal(
    webCrypto.createHash("sha256").update("x").digest("base64url"),
    nodeCrypto.createHash("sha256").update("x").digest("base64url"),
  );
  same(
    webCrypto.scryptSync("1234", "salt", 32),
    nodeCrypto.scryptSync("1234", "salt", 32),
  );
  const key = nodeCrypto.randomBytes(32);
  const iv = nodeCrypto.randomBytes(12);
  const desktop = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  desktop.setAAD(Buffer.from("header"));
  const sealed = Buffer.concat([
    desktop.update(Buffer.from("مكتبتي")),
    desktop.final(),
  ]);
  const web = webCrypto.createDecipheriv("aes-256-gcm", key, iv);
  web.setAAD(Buffer.from("header"));
  web.setAuthTag(desktop.getAuthTag());
  assert.equal(
    Buffer.concat([web.update(sealed), web.final()]).toString(),
    "مكتبتي",
  );
  const forged = webCrypto.createDecipheriv("aes-256-gcm", key, iv);
  forged.setAAD(Buffer.from("other"));
  forged.setAuthTag(desktop.getAuthTag());
  forged.update(sealed);
  assert.throws(() => forged.final());
  // Accounts (core/account.mjs): HMAC and the callback scrypt.
  assert.equal(
    webCrypto.createHmac("sha256", "key").update("رِواق").digest("base64url"),
    nodeCrypto.createHmac("sha256", "key").update("رِواق").digest("base64url"),
  );
  await new Promise((resolve, reject) =>
    webCrypto.scrypt("pw", "salt", 32, { N: 1024, r: 8, p: 1 }, (e, key) => {
      if (e) return reject(e);
      same(
        key,
        nodeCrypto.scryptSync("pw", "salt", 32, { N: 1024, r: 8, p: 1 }),
      );
      resolve();
    }),
  );
  const text = Buffer.from("رِواق ".repeat(5000));
  same(webZlib.gunzipSync(nodeZlib.gzipSync(text)), text);
  same(nodeZlib.gunzipSync(webZlib.gzipSync(text)), text);
  same(webZlib.inflateRawSync(nodeZlib.deflateRawSync(text)), text);
  assert.throws(() =>
    webZlib.gunzipSync(nodeZlib.gzipSync(text), { maxOutputLength: 100 }),
  );
});

test("the browser's Buffer speaks base64url, which Spotify, Letterboxd and accounts use", () => {
  // The npm polyfill, not Node's own Buffer: 0.39.0 shipped without this,
  // so Spotify linking failed on the web only.
  assert.notEqual(WebBuffer, Buffer);
  const text = "رِواق ✓ ?>";
  assert.equal(
    WebBuffer.from(text).toString("base64url"),
    Buffer.from(text).toString("base64url"),
  );
  assert.equal(
    WebBuffer.from(
      Buffer.from(text).toString("base64url"),
      "base64url",
    ).toString(),
    text,
  );
  assert.ok(WebBuffer.isEncoding("base64url"));
  assert.equal(webCrypto.randomBytes(48).toString("base64url").length, 64);
  assert.ok(WebBuffer.isBuffer(WebBuffer.from("abc").subarray(1)));
});

test("a backup sealed with the web shims opens with the desktop's Node code", async () => {
  // core/backup.mjs as the web build bundles it, with the shims in place
  // of node:crypto and node:zlib.
  const source = read("core/backup.mjs")
    .replace(
      'from "node:crypto"',
      `from ${JSON.stringify(new URL("../web/shims/crypto.js", import.meta.url).href)}`,
    )
    .replace(
      'from "node:zlib"',
      `from ${JSON.stringify(new URL("../web/shims/zlib.js", import.meta.url).href)}`,
    )
    .replace(
      /from "\.\/([a-z-]+\.mjs)"/g,
      (_, f) =>
        `from ${JSON.stringify(new URL(`../core/${f}`, import.meta.url).href)}`,
    );
  const webBackup = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  );
  const desktopBackup = await import("../core/backup.mjs");
  const text = webBackup.encryptBackup({ hello: "عالم" }, "passphrase-1", {
    now: 0,
  });
  assert.deepEqual(desktopBackup.decryptBackup(text, "passphrase-1").payload, {
    hello: "عالم",
  });
  const back = desktopBackup.encryptBackup({ back: 1 }, "passphrase-1");
  assert.deepEqual(webBackup.decryptBackup(back, "passphrase-1").payload, {
    back: 1,
  });
});

test("the player chooses how to play an address, and says when it cannot", () => {
  assert.ok(blockedAsMixed("http://cdn.example/v.mp4", "https:"));
  assert.ok(!blockedAsMixed("http://127.0.0.1:11470/x/0", "https:"));
  assert.ok(!blockedAsMixed("https://cdn.example/v.mp4", "https:"));
  assert.ok(!blockedAsMixed("http://cdn.example/v.mp4", "http:"));
  assert.ok(isHlsUrl("https://x/live/index.m3u8?token=1"));
  assert.ok(!isHlsUrl("https://x/movie.mkv"));
  assert.deepEqual(playPlan("https://x/a.m3u8", { page: "https:" }), [
    { kind: "hls", url: "https://x/a.m3u8" },
  ]);
  // Plain HTTP on an HTTPS page goes only through the viewer's own server.
  assert.deepEqual(
    playPlan("http://x/a.mkv", {
      page: "https:",
      server: "http://127.0.0.1:11470",
    }),
    [{ kind: "convert", url: "http://x/a.mkv", mixed: true }],
  );
  assert.deepEqual(playPlan("http://x/a.mkv", { page: "https:" }), []);
  assert.equal(
    playPlan("https://x/a.mkv", {
      page: "https:",
      server: "http://127.0.0.1:11470",
    }).length,
    2,
  );
  const hls = new URL(
    serverHlsUrl("http://127.0.0.1:11470", "https://x/a b.mkv", {
      id: "abc",
      video: ["h264", "hevc"],
      audio: ["aac"],
    }),
  );
  assert.equal(hls.origin, "http://127.0.0.1:11470");
  assert.equal(hls.pathname, "/hlsv2/abc/master.m3u8");
  assert.equal(hls.searchParams.get("mediaURL"), "https://x/a b.mkv");
  assert.deepEqual(hls.searchParams.getAll("videoCodecs"), ["h264", "hevc"]);
  const css = cueCss(
    { color: "#FFFF00", backgroundOpacity: 50, bold: true },
    55,
  );
  assert.match(css, /color: #FFFF00/);
  assert.match(css, /rgba\(0, 0, 0, 0\.5\)/);
  assert.match(css, /font-weight: 700/);
  assert.match(css, /font-size: 125%/);
});

test("sign-in answers are taken only with this attempt's nonce", () => {
  const nonce = "a".repeat(48);
  assert.deepEqual(
    readCallback(`https://riwaq.example/?riwaq-login=${nonce}?authKey=k%2B1`),
    { kind: "stremio", nonce, authKey: "k+1" },
  );
  assert.deepEqual(
    readCallback(`https://riwaq.example/?riwaq-login=${nonce}&authKey=abc`)
      .authKey,
    "abc",
  );
  assert.deepEqual(
    readCallback(`https://riwaq.example/?code=xyz&state=${nonce}`),
    {
      kind: "spotify",
      state: nonce,
      code: "xyz",
      error: "",
    },
  );
  assert.equal(
    readCallback("https://riwaq.example/?code=xyz&state=short"),
    null,
  );
  assert.equal(readCallback("https://riwaq.example/"), null);
});

test("the bridge drops headers a browser refuses and keeps errors free of addresses", async () => {
  let seen;
  const fetcher = browserFetch(async (url, init) => {
    seen = init;
    return { ok: true };
  });
  await fetcher("https://api.trakt.tv/x", {
    headers: { "User-Agent": "Riwaq/1", "trakt-api-key": "k" },
  });
  assert.equal(seen.headers.get("user-agent"), null);
  assert.equal(seen.headers.get("trakt-api-key"), "k");
  assert.equal(cleanError(new Error("تعذّر الاتصال")), "تعذّر الاتصال");
  assert.match(cleanError(new Error("HTTP 404")), /404/);
  assert.doesNotMatch(
    cleanError(
      new Error("fetch https://addon.example/abc123/manifest.json failed"),
    ),
    /https?:/,
  );
});

test("web local music keeps the desktop's limits and profile gate", async () => {
  const client = {
    profiles: { gate() {}, store: { active: "p1" } },
  };
  const music = new WebMusicLibrary(client);
  const file = (name, size = 10) => ({ name, size, lastModified: 1 });
  // Picking reads each file's tags first (core/audio-tags.mjs).
  const added = await music.importFiles("p1", [
    file("a.mp3"),
    file("a.mp3"),
    file("b.txt"),
  ]);
  assert.equal(added.added, 1);
  assert.equal(added.skipped, 2);
  assert.equal(added.tracks[0].format, "MP3");
  assert.throws(() => music.view("p2"), /تغير الملف الشخصي/);
  const id = added.tracks[0].id;
  assert.equal(
    music.edit({ profileId: "p1", action: "favorite", id }).tracks[0].favorite,
    true,
  );
  assert.throws(() => music.edit({ profileId: "p1", action: "drop" }));
});

test("the site is built from package.json's version and published with each release", () => {
  const config = read("vite.web.config.mjs");
  assert.match(
    config,
    /"import\.meta\.env\.RIWAQ_VERSION": JSON\.stringify\(version\)/,
  );
  assert.match(config, /fileName: "version\.json"/);
  const page = read("web/index.html");
  // hls.js runs a worker from a blob; picked files play from blob URLs.
  assert.match(page, /worker-src 'self' blob:/);
  assert.match(page, /media-src [^;]*blob:/);
  assert.match(page, /object-src 'none'/);
  const release = read(".github/workflows/release.yml");
  assert.match(release, /uses: \.\/\.github\/workflows\/web\.yml/);
  const web = read(".github/workflows/web.yml");
  assert.match(web, /workflow_call:/);
  assert.match(web, /npm run build:web/);
  assert.match(web, /scripts\/test-web\.mjs/);
  assert.match(web, /actions\/deploy-pages/);
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /npm run build:web/);
});
