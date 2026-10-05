// Real Electron/IPC/custom media protocol; only the OS file chooser is stubbed.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import assert from "node:assert/strict";

const output = resolve(".cache/music-ui");
mkdirSync(output, { recursive: true });
const files = ["صباح هادئ", "رحلة المساء", "لحظة قصيرة"].map((name, i) => {
  const rate = 8000,
    seconds = i === 2 ? 2 : 45,
    bytes = rate * seconds * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write("RIFF");
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(bytes, 40);
  const file = join(output, name + ".wav");
  writeFileSync(file, wav);
  return file;
});
const bootstrap = join(output, "bootstrap.mjs");
const video = join(output, "handoff.y4m");
const videoHeader = Buffer.from("YUV4MPEG2 W64 H48 F10:1 Ip A1:1 C420jpeg\n");
const videoFrame = Buffer.concat([
  Buffer.from("FRAME\n"),
  Buffer.alloc(64 * 48, 100),
  Buffer.alloc((64 * 48) / 2, 128),
]);
writeFileSync(
  video,
  Buffer.concat([videoHeader, ...Array(100).fill(videoFrame)]),
);
writeFileSync(
  bootstrap,
  `import { dialog } from "electron"; dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: options.title.includes("فيديو") ? [${JSON.stringify(video)}] : ${JSON.stringify(files)} }); await import(${JSON.stringify(pathToFileURL(resolve("electron/main.mjs")).href)});`,
);
const portServer = createServer();
await new Promise((r) => portServer.listen(0, "127.0.0.1", r));
const port = portServer.address().port;
await new Promise((r) => portServer.close(r));
const env = {
  ...process.env,
  RIWAQ_DATA_DIR: join(output, `profile-${Date.now()}`),
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.RIWAQ_SMOKE;
const child = spawn(
  resolve("node_modules/electron/dist/electron.exe"),
  [bootstrap, `--remote-debugging-port=${port}`],
  { env, windowsHide: true, stdio: "ignore" },
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label) {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    try {
      if (await fn()) return;
    } catch {}
    await pause(100);
  }
  throw new Error(label);
}
let socket, send, evaluate;
try {
  let target;
  await wait(async () => {
    const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) =>
      r.json(),
    );
    target = tabs.find(
      (t) =>
        t.type === "page" &&
        t.url.includes("/dist/index.html") &&
        !t.url.endsWith("#hud"),
    );
    return target;
  }, "main renderer startup");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => socket.addEventListener("open", r, { once: true }));
  let serial = 0;
  const pending = new Map(),
    errors = [];
  socket.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.exceptionThrown")
      errors.push(
        m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text,
      );
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p?.reject(new Error(m.error.message)) : p?.resolve(m.result);
    }
  });
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const call = (method, args) =>
    evaluate(
      `window.riwaq.call(${JSON.stringify(method)},${JSON.stringify(args)})`,
    );
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const textClick = (text, selector = "button") =>
    evaluate(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`,
    );
  const screenshot = async (name) => {
    await pause(250);
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(output, name + ".png"), Buffer.from(r.data, "base64"));
  };
  await send("Runtime.enable");
  await wait(
    () => evaluate("!!document.querySelector('.riwaq-masthead')"),
    "app UI",
  );
  const initial = await call("init");
  const profileId = initial.profiles.active;
  await call("settings", { autoFullscreen: false });
  await textClick("موسيقى");
  await wait(
    () => evaluate("!!document.querySelector('.local-music')"),
    "music room",
  );
  await textClick("أضف ملفات صوتية", ".local-music button");
  await wait(
    () =>
      evaluate("document.querySelectorAll('.local-track-list li').length===3"),
    "three imported files",
  );
  const library = await call("musicLocalLibrary", { profileId });
  assert.equal(library.tracks.length, 3);
  assert.ok(!JSON.stringify(library).includes("path"));
  await textClick("شغّل المعروض", ".local-music button");
  await wait(
    () =>
      evaluate(
        "document.querySelector('.local-seek span')?.textContent==='0:01'",
      ),
    "actual audio playback time",
  );
  await click('[aria-label="أوقف الأغنية مؤقتاً"]');
  const stopped = await evaluate(
    "document.querySelector('.local-seek span').textContent",
  );
  await pause(700);
  assert.equal(
    await evaluate("document.querySelector('.local-seek span').textContent"),
    stopped,
  );
  await click('[aria-label="استأنف الأغنية"]');
  await click('[aria-label="الأغنية التالية"]');
  await wait(
    () =>
      evaluate(
        "document.querySelector('.local-bar-title b')?.textContent==='رحلة المساء'",
      ),
    "next song",
  );
  await evaluate(
    `(()=>{const el=document.querySelector('[aria-label="موضع الأغنية"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'15');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await wait(
    () =>
      evaluate(
        "Number(document.querySelector('[aria-label=\"موضع الأغنية\"]').value)>14",
      ),
    "seek via range requests",
  );
  await click('[aria-label="الأغنية التالية"]');
  await wait(
    () =>
      evaluate(
        "document.querySelector('.local-bar-title b')?.textContent==='لحظة قصيرة'",
      ),
    "short track",
  );
  await wait(
    () =>
      evaluate("!!document.querySelector('[aria-label=\"استأنف الأغنية\"]')"),
    "queue ends without looping",
  );
  await click(".track-start");
  await click('[aria-label="تشغيل عشوائي"]');
  await click('[aria-label="التكرار: متوقف"]');
  await click(`[aria-label="أحببت صباح هادئ"]`);
  await evaluate(
    `(()=>{const el=document.querySelector('[aria-label="اسم قائمة الموسيقى"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'جلسة المساء');el.dispatchEvent(new Event('input',{bubbles:true}));})()`,
  );
  await textClick("احفظ القائمة", ".local-music-actions button");
  await wait(
    async () =>
      (await call("musicLocalLibrary", { profileId })).playlists.length === 1,
    "playlist saved",
  );
  for (const [width, height] of [
    [1440, 1000],
    [980, 680],
  ]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await pause(200);
    await evaluate(
      "document.querySelector('.local-music').scrollIntoView({block:'start'})",
    );
    assert.ok(
      await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    );
    await screenshot(`music-${width}`);
  }
  await textClick("اكتشف", ".riwaq-masthead button");
  assert.ok(
    await evaluate("!!document.querySelector('.local-music-bar')"),
    "music continues when navigating",
  );
  await call("localVideo");
  await wait(
    () => evaluate("!document.querySelector('.local-music-bar')"),
    "video takes audio focus",
  );
  await assert.rejects(
    call("musicLocalSource", { profileId, id: library.tracks[0].id }),
  );
  await call("stop");
  await textClick("موسيقى", ".riwaq-masthead button");
  await wait(
    () => evaluate("!!document.querySelector('.track-start')"),
    "music after video",
  );
  await click(".track-start");
  await wait(
    () => evaluate("!!document.querySelector('.local-music-bar')"),
    "play again before profile switch",
  );
  await call("profileCreate", { name: "مستمع آخر" });
  const other = (await call("init")).profiles.list.at(-1).id;
  await call("profileSwitch", { id: other });
  await wait(
    () => evaluate("!document.querySelector('.local-music-bar')"),
    "switch stops playback",
  );
  assert.equal(
    (await call("musicLocalLibrary", { profileId: other })).tracks.length,
    0,
  );
  await call("profileSwitch", { id: profileId });
  await send("Page.reload");
  await wait(
    () => evaluate("!!document.querySelector('.riwaq-masthead')"),
    "reload",
  );
  await textClick("موسيقى");
  await wait(
    () =>
      evaluate("document.querySelectorAll('.local-track-list li').length===3"),
    "library after reload",
  );
  assert.ok(
    !(await evaluate("!!document.querySelector('.local-music-bar')")),
    "no autoplay on reload",
  );
  const persisted = await call("musicLocalLibrary", { profileId });
  assert.equal(persisted.playlists[0].name, "جلسة المساء");
  assert.equal(persisted.tracks[0].favorite, true);
  assert.equal(persisted.queue.length, 3);
  assert.deepEqual(errors, []);
  const results = {
    passed: true,
    checks: [
      "real Electron IPC import (file chooser stub only)",
      "custom protocol WAV decode and position progress",
      "pause/resume/next/seek/EOF",
      "shuffle/repeat controls",
      "favorites/playlists/queue persist on reload",
      "no autoplay on reload",
      "playback survives room navigation",
      "starting MPV video stops music and rejects new audio sources",
      "profile switch stops and isolates library",
      "1440x1000 and 980x680 without overflow",
    ],
    errors,
  };
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} catch (error) {
  console.error(error);
  if (send) {
    const r = await send("Page.captureScreenshot", { format: "png" }).catch(
      () => null,
    );
    if (r)
      writeFileSync(join(output, "failure.png"), Buffer.from(r.data, "base64"));
  }
  process.exitCode = 1;
} finally {
  if (evaluate)
    await evaluate("setTimeout(()=>window.close(),50);true").catch(() => {});
  socket?.close();
  setTimeout(() => child.kill(), 1500).unref();
}
