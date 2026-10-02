import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import assert from "node:assert/strict";

const sourceMode = process.argv.includes("--source");
const offlineMode = process.argv.includes("--offline");
const executable = resolve(
  sourceMode
    ? "node_modules/electron/dist/electron.exe"
    : process.argv[2] || "release/win-unpacked/Riwaq.exe",
);
// The build under test must report the version this checkout declares; a
// literal here goes stale with every release.
const expectedVersion = JSON.parse(
  readFileSync(resolve("package.json"), "utf8"),
).version;
const output = resolve(
  sourceMode ? ".cache/native-source-test" : ".cache/packaged-test",
);
mkdirSync(output, { recursive: true });
const listener = createServer();
await new Promise((r) => listener.listen(0, "127.0.0.1", r));
const port = listener.address().port;
await new Promise((r) => listener.close(r));
const env = {
  ...process.env,
  RIWAQ_DATA_DIR: join(output, "profile-" + Date.now()),
};
delete env.RIWAQ_SMOKE;
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  executable,
  [...(sourceMode ? ["."] : []), `--remote-debugging-port=${port}`],
  {
    env,
    // This is a GUI visibility test: SW_HIDE hides the first native window
    // on Windows, making IsWindowVisible fail even when the video decodes.
    windowsHide: false,
    stdio: "ignore",
  },
);
let websocket,
  id = 0;
let fixtureServer;
try {
  const start = Date.now();
  let targets;
  const mainPage = (target) =>
    target.type === "page" &&
    target.url.includes("/dist/index.html") &&
    !target.url.endsWith("#hud");
  while (Date.now() - start < 60000) {
    try {
      targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) =>
        r.json(),
      );
      if (targets.some(mainPage)) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const target = targets?.find(mainPage);
  assert.ok(target, "Packaged renderer started");
  websocket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    websocket.addEventListener("open", r, { once: true });
    websocket.addEventListener("error", j, { once: true });
  });
  const pending = new Map();
  websocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const p = pending.get(message.id);
      pending.delete(message.id);
      message.error
        ? p?.reject(new Error(message.error.message))
        : p?.resolve(message.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      websocket.send(JSON.stringify({ id: requestId, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  let loaded = false;
  for (let i = 0; i < 160; i++) {
    loaded = await evaluate(
      offlineMode
        ? `!!document.querySelector('.profile-button')`
        : `!!document.querySelector('.hero, .session-home') && document.querySelectorAll('.poster-card').length > 0`,
    );
    if (loaded) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(
    loaded,
    offlineMode ? "Application shell loads" : "Application loads live catalogs",
  );
  const diagnostics = await evaluate(`window.riwaq.call('diagnostics')`);
  assert.equal(diagnostics.mpv, true);
  assert.equal(diagnostics.encryption, true);
  assert.equal(diagnostics.video.embedded, true);
  assert.equal(diagnostics.version, expectedVersion);
  const state = await evaluate(`window.riwaq.call('init')`);
  assert.equal(state.user, null);
  assert.equal(state.addons.length, 1);
  assert.equal(state.addons[0].name, "Cinemeta");
  assert.deepEqual(state.queue, []);
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    join(output, "packaged-home.png"),
    Buffer.from(screenshot.data, "base64"),
  );
  const frame = Buffer.concat([
    Buffer.from("FRAME\n"),
    Buffer.alloc(320 * 180, 95),
    Buffer.alloc(160 * 90, 115),
    Buffer.alloc(160 * 90, 145),
  ]);
  const video = Buffer.concat([
    Buffer.from("YUV4MPEG2 W320 H180 F5:1 Ip A1:1 C420jpeg\n"),
    ...Array(100).fill(frame),
  ]);
  let base;
  fixtureServer = createHttpServer((req, res) => {
    if (req.url === "/video.y4m") {
      res.writeHead(200, {
        "Content-Type": "video/x-yuv4mpeg",
        "Content-Length": video.length,
      });
      res.end(video);
      return;
    }
    const data =
      req.url === "/manifest.json"
        ? {
            id: "riwaq.packaged-test",
            name: "Packaged test fixture",
            version: "1.0.0",
            resources: ["stream"],
            types: ["movie"],
            catalogs: [],
          }
        : {
            streams: [
              { name: "Packaged native test", url: base + "/video.y4m" },
            ],
          };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  });
  await new Promise((r) => fixtureServer.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${fixtureServer.address().port}`;
  await evaluate(`window.riwaq.on('player',p=>window.__packagedPlayer=p);true`);
  await evaluate(
    `window.riwaq.call('install',{url:${JSON.stringify(base + "/manifest.json")}})`,
  );
  const streams = await evaluate(
    `window.riwaq.call('streams',{type:'movie',id:'riwaq:packaged'})`,
  );
  await evaluate(
    `window.riwaq.call('queueEdit',{action:'add',meta:{id:'riwaq:packaged',type:'movie',name:'Packaged native verification'},videoId:'riwaq:packaged'})`,
  );
  await evaluate(
    `window.riwaq.call('play',{key:${JSON.stringify(streams.streams[0].key)},meta:{id:'riwaq:packaged',type:'movie',name:'Packaged native verification'},videoId:'riwaq:packaged'})`,
  );
  let decoded = false;
  for (let i = 0; i < 80; i++) {
    decoded = await evaluate(
      `window.__packagedPlayer?.tracks.some(t=>t.type==='video') && window.__packagedPlayer?.position>0`,
    );
    if (decoded) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(decoded, "Packaged MPV decodes actual video");
  // Keep the short fixture alive while inspecting window/HUD transitions.
  await evaluate(`window.riwaq.call('playerCommand',{action:'pause'})`);
  const afterPlay = await evaluate(`window.riwaq.call('init')`);
  assert.deepEqual(
    afterPlay.queue,
    [],
    "Loaded queue item is consumed in portable build",
  );
  // Decoding can start before React has committed the theater and reported
  // its rectangle. Wait for the actual native surface, as the source smoke does.
  let active;
  for (let i = 0; i < 80; i++) {
    active = await evaluate(`window.riwaq.call('diagnostics')`);
    if (active.video.nativeVisible && active.video.siblingsClipped) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(
    active.video.nativeVisible && active.video.siblingsClipped,
    JSON.stringify(active.video),
  );
  assert.ok(active.video.rectangle.width > 800);
  await evaluate(`window.riwaq.call('stop')`);
  const result = {
    passed: true,
    mode: sourceMode ? "source" : "packaged",
    packagedFile: executable.split(/[\\/]/).pop(),
    checks: [
      sourceMode
        ? "Electron application starts from source"
        : "Portable application starts",
      `Version ${expectedVersion} and per-profile queue are present`,
      "Loaded queue entry is consumed by the player",
      offlineMode
        ? "Application shell renders (external catalogs not asserted)"
        : "Live catalogs render",
      "Bundled MPV is found",
      "Windows encryption is available",
      "Fresh profile contains no test data",
      "Native module creates child video surface",
      "Bundled MPV decodes a real video fixture inside the application",
      "Native surface is visible and Chromium siblings clip correctly",
    ],
    diagnostics,
    activeVideo: active.video,
  };
  writeFileSync(join(output, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await evaluate("setTimeout(() => window.close(), 100); true").catch(() => {});
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  websocket?.close();
  fixtureServer?.closeAllConnections();
  fixtureServer?.close();
  setTimeout(() => child.kill(), 1000).unref();
}
