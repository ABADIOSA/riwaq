// Actual Electron renderer and IPC; isolated profile and a local Stremio addon.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer } from "node:http";
import { createServer as createPort } from "node:net";
import assert from "node:assert/strict";

const output = resolve(".cache/session-ui");
mkdirSync(output, { recursive: true });
let base;
const titles = [
  ["last-train", "القطار الأخير", "LAST TRAIN", 55, "#af8660", "#25394b"],
  ["blue-hour", "الساعة الزرقاء", "THE BLUE HOUR", 30, "#79a2b6", "#152d44"],
  ["quiet-city", "مدينة هادئة", "A QUIET CITY", 80, "#a4a089", "#3d5145"],
  ["small-journey", "رحلة صغيرة", "SMALL JOURNEY", 35, "#d7af7c", "#613b2f"],
  ["elsewhere", "مكان آخر", "ELSEWHERE", 25, "#b6a2c9", "#372949"],
];
const metas = () =>
  titles.map(([id, name, , runtime]) => ({
    id: `session:${id}`,
    name,
    type: "movie",
    runtime,
    genres: ["Comedy", "Drama"],
    poster: `${base}/poster/${id}.svg`,
    releaseInfo: "2025",
    description: "عنوان تجريبي لاختبار تخطيط الجلسة في رِواق.",
  }));
const server = createServer((req, res) => {
  if (req.url.startsWith("/poster/")) {
    const t = titles.find(([id]) => req.url.includes(id)) || titles[0];
    res.setHeader("Content-Type", "image/svg+xml");
    res.end(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><defs><linearGradient id="g" x2=".5" y2="1"><stop stop-color="${t[5]}"/><stop offset="1" stop-color="#10151b"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><circle cx="240" cy="175" r="94" fill="${t[4]}" opacity=".8"/><path d="M0 400L160 150 200 600H0M0 490L330 290 400 520V600H0" fill="${t[5]}"/><path d="M0 480Q190 320 400 440V600H0" fill="#111a20"/><path d="M40 600L300 280 100 600" fill="${t[4]}" opacity=".45"/><text x="30" y="60" fill="#eee5d6" font-size="13" font-family="Arial" letter-spacing="4">RIWAQ / TEST EDITION</text><text x="30" y="518" fill="#f8eddf" font-size="30" font-family="Georgia">${t[2]}</text><text x="30" y="552" fill="${t[4]}" font-size="12" font-family="Arial" letter-spacing="4">A STORY WORTH YOUR TIME</text></svg>`,
    );
    return;
  }
  let data;
  if (req.url === "/manifest.json")
    data = {
      id: "riwaq.session-fixture",
      name: "Session fixture",
      version: "1.0.0",
      resources: ["catalog", "meta", "stream"],
      types: ["movie"],
      idPrefixes: ["session:"],
      catalogs: [{ id: "sessions", type: "movie", name: "أعمال لجلستك" }],
    };
  else if (req.url.startsWith("/catalog/")) data = { metas: metas() };
  else if (req.url.startsWith("/meta/"))
    data = {
      meta: metas().find((m) => decodeURIComponent(req.url).includes(m.id)),
    };
  else data = { streams: [] };
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
base = `http://127.0.0.1:${server.address().port}`;
const portServer = createPort();
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
  [".", `--remote-debugging-port=${port}`],
  { env, windowsHide: false, stdio: "ignore" },
);
let socket,
  id = 0,
  evaluate,
  send;
const pause = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const wait = async (fn, message, ms = 40000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      if (await fn()) return;
    } catch {}
    await pause();
  }
  throw new Error(message);
};
try {
  let target;
  await wait(async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) =>
      r.json(),
    );
    target = targets.find(
      (t) =>
        t.type === "page" &&
        t.url.includes("/dist/index.html") &&
        !t.url.endsWith("#hud"),
    );
    return target;
  }, "main renderer");
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => socket.addEventListener("open", r, { once: true }));
  const pending = new Map(),
    errors = [];
  socket.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.method === "Runtime.exceptionThrown")
      errors.push(m.params.exceptionDetails.text);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p?.reject(new Error(m.error.message)) : p?.resolve(m.result);
    }
  });
  send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      pending.set(request, { resolve, reject });
      socket.send(JSON.stringify({ id: request, method, params }));
    });
  evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    return r.result.value;
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
    await pause(500);
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(output, name + ".png"), Buffer.from(r.data, "base64"));
  };
  await send("Runtime.enable");
  await wait(
    () => evaluate("!!document.querySelector('.riwaq-masthead')"),
    "new navigation",
  );
  const initial = await call("init");
  await call("install", { url: base + "/manifest.json" });
  for (const addon of initial.addons)
    if (addon.enabled)
      await call("updateAddon", { key: addon.key, action: "toggle" });
  await call("settings", {
    homeGrouping: "rows",
    homeSections: ["catalogs"],
    homeSeen: [
      "hero",
      "countdowns",
      "continue",
      "upnext",
      "suggestions",
      "collections",
      "services",
      "catalogs",
    ],
    autoFullscreen: false,
  });
  for (const meta of metas()) await call("favorite", meta);
  const seeded = await call("init");
  assert.equal(seeded.favorites.length, 5);
  assert.equal(seeded.settings.homeGrouping, "rows");
  await evaluate("window.__beforeSessionReload=true");
  await send("Page.reload");
  await wait(
    () =>
      evaluate(
        "!window.__beforeSessionReload && document.querySelectorAll('.session-poster-stack img').length===3 && [...document.querySelectorAll('.session-poster-stack img')].every(i=>i.src.includes('/poster/'))",
      ),
    "session seed posters after reload",
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
    await pause(300);
    assert.ok(
      await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
      `no overflow at ${width}`,
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.sidebar').length"),
      0,
    );
    await screenshot(`home-${width}`);
  }
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click(".session-build");
  await wait(
    () => evaluate("document.querySelectorAll('.session-pick').length>0"),
    "generated session",
  );
  const minutes = await evaluate(
    "document.querySelector('.session-total b').textContent",
  );
  assert.ok(parseInt(minutes) <= 90);
  assert.ok(
    await evaluate(
      `${JSON.stringify(titles.map((t) => t[1]))}.includes(document.querySelector('.session-pick-copy > button').textContent)`,
    ),
    "fixture metadata selected",
  );
  await evaluate(
    "document.querySelector('.session-result').scrollIntoView({block:'center'})",
  );
  await screenshot("session-result");
  const first = await evaluate(
    "document.querySelector('.session-pick-copy > button').textContent",
  );
  await click(".session-replace");
  await wait(
    () =>
      evaluate(
        `![...document.querySelectorAll('.session-pick-copy > button')].some(b=>b.textContent===${JSON.stringify(first)})`,
      ),
    "alternative selected",
  );
  await textClick("أضف الجلسة إلى الطابور", ".session-result button");
  await wait(
    async () => (await call("init")).queue.length > 0,
    "queue persisted",
  );
  await click(".session-pick-copy > button");
  await wait(
    () => evaluate("!!document.querySelector('.title-page')"),
    "title opens",
  );
  await click(".riwaq-wordmark");
  await click("[aria-label='مساحات وأدوات أخرى']");
  assert.equal(
    await evaluate("!!document.querySelector('#riwaq-tools')"),
    true,
  );
  await send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
  });
  await wait(
    () => evaluate("!document.querySelector('#riwaq-tools')"),
    "tools escape",
  );
  await click("[aria-label='الإعدادات']");
  await wait(
    () => evaluate("!!document.querySelector('.studio-page')"),
    "settings navigation",
  );
  await screenshot("settings-1440");
  assert.ok(
    await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    "settings no overflow",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 980,
    height: 680,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await screenshot("settings-980");
  assert.ok(
    await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),
    "small settings no overflow",
  );
  await textClick("الواجهة", ".studio-index-pages button");
  await textClick("التخطيط السابق", ".layout-choices button");
  await wait(
    () =>
      evaluate(
        "!!document.querySelector('.sidebar') && !document.querySelector('.riwaq-masthead')",
      ),
    "classic fallback",
  );
  await textClick("جلسة رِواق", ".layout-choices button");
  await wait(
    () =>
      evaluate(
        "!!document.querySelector('.riwaq-masthead') && !document.querySelector('.sidebar')",
      ),
    "new interface restored",
  );
  await click(".riwaq-wordmark");
  await textClick("60", ".session-budgets button");
  await wait(
    async () => (await call("init")).settings.sessionBudget === 60,
    "budget saved",
  );
  await evaluate("window.__beforeSessionReload=true");
  await send("Page.reload");
  await wait(
    () =>
      evaluate(
        "!window.__beforeSessionReload && document.querySelector('.session-budgets .chosen b')?.textContent==='60'",
      ),
    "budget survives reload",
  );
  const results = {
    passed: true,
    checks: [
      "1440×1000 and 980×680 home/settings layouts",
      "no legacy sidebar or horizontal overflow",
      "local addon metadata drives time-constrained session",
      "replacement changes selection",
      "queue saves via real IPC",
      "title navigation",
      "tools close with Escape",
      "settings reachable",
      "classic fallback and new design switch",
      "budget persists after reload",
    ],
    errors,
  };
  assert.deepEqual(errors, []);
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
  server.closeAllConnections();
  server.close();
  setTimeout(() => child.kill(), 1000).unref();
}
