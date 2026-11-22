// Before/after cost of the glass material (0.57, issue #158) on the same
// machine, fixture and build mode: Home with 100 catalogs of 60 titles each
// (one row per catalog, the CLAUDE.md benchmark), scrolled from top to
// bottom at a steady rate; the poster menu and a dialog opened and timed to
// their first painted frame; the renderer heap after GC. Builds alternate
// run by run, medians and ranges are reported, never a single sample.
//
//   npm run build:web
//   node scripts/measure-ui-glass.mjs <before dist-web> <after dist-web> [runs]
//
// Results go to .cache/ui-glass/measure.json. Headless Chromium with its
// software compositor on this machine: frame times, not a Windows GPU, and
// whole-process memory is not measured. Nothing reaches the internet.
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { loadPlaywright } from "./fixtures/ui-browse-addon.mjs";

const { chromium } = loadPlaywright();
const [before, after] = process.argv.slice(2, 4).map((p) => resolve(p));
const runs = Number(process.argv[4]) || 5;
if (!before || !after)
  throw new Error("usage: measure-ui-glass.mjs <before> <after> [runs]");
const CATALOGS = 100;
const TITLES = 60;
let chromiumVersion = "";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const listen = (server) =>
  new Promise((r) =>
    server.listen(0, "127.0.0.1", () => r(server.address().port)),
  );
function serveSite(site) {
  return createServer((req, res) => {
    let path = join(
      site,
      decodeURIComponent(new URL(req.url, "http://x").pathname),
    );
    if (!path.startsWith(site)) path = site;
    if (existsSync(path) && statSync(path).isDirectory())
      path = join(path, "index.html");
    if (!existsSync(path)) return res.writeHead(404).end();
    res.setHeader(
      "Content-Type",
      TYPES[extname(path)] || "application/octet-stream",
    );
    res.end(readFileSync(path));
  });
}
// 100 movie catalogs of 60 titles, each with its own poster colour.
function serveAddon() {
  let base = "";
  const server = createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    const url = decodeURIComponent(req.url);
    const json = (data) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    };
    if (url === "/manifest.json")
      return json({
        id: "riwaq.glass-measure",
        name: "Glass measure",
        version: "1.0.0",
        resources: ["catalog", "meta"],
        types: ["movie"],
        idPrefixes: ["gm:"],
        catalogs: Array.from({ length: CATALOGS }, (_, i) => ({
          id: `c${i}`,
          type: "movie",
          name: `Catalog ${i}`,
        })),
      });
    const poster = /^\/poster\/(\d+)-(\d+)\.svg$/.exec(url);
    if (poster) {
      const hue = (Number(poster[1]) * 37 + Number(poster[2]) * 11) % 360;
      res.setHeader("Content-Type", "image/svg+xml");
      return res.end(
        `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="hsl(${hue},40%,28%)"/><circle cx="190" cy="130" r="70" fill="hsl(${(hue + 160) % 360},45%,58%)" opacity=".6"/></svg>`,
      );
    }
    const cat = /^\/catalog\/movie\/c(\d+)(?:\/[^.]*)?\.json$/.exec(url);
    if (cat)
      return json({
        metas: Array.from({ length: TITLES }, (_, j) => ({
          id: `gm:${cat[1]}-${j}`,
          type: "movie",
          name: `Title ${cat[1]}-${j}`,
          poster: `${base}/poster/${cat[1]}-${j}.svg`,
          releaseInfo: String(1990 + (j % 30)),
        })),
      });
    json({ meta: null });
  });
  return {
    server,
    start: async () => (base = `http://127.0.0.1:${await listen(server)}`),
  };
}

const quantile = (list, q) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

async function sample(site) {
  const siteServer = serveSite(site);
  const siteUrl = `http://127.0.0.1:${await listen(siteServer)}/`;
  const addon = serveAddon();
  const base = await addon.start();
  const browser = await chromium.launch();
  chromiumVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  await context.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort("internetdisconnected"),
  );
  const page = await context.newPage();
  const call = (method, args) =>
    page.evaluate(([m, a]) => window.riwaq.call(m, a), [method, args]);
  // The time from an action to the first frame painted after it shows.
  const painted = (selector) =>
    page.evaluate(
      (sel) =>
        new Promise((done) => {
          const start = performance.now();
          const look = () => {
            if (document.querySelector(sel))
              requestAnimationFrame(() =>
                requestAnimationFrame(() => done(performance.now() - start)),
              );
            else requestAnimationFrame(look);
          };
          look();
        }),
      selector,
    );
  try {
    await page.goto(siteUrl);
    await page.waitForFunction(() => window.riwaq?.platform === "web");
    await call("onboardingComplete");
    await call("install", { url: `${base}/manifest.json` });
    await call("settings", {
      seenVersion: (await call("init")).update?.current,
      homeGrouping: "rows",
      showSession: false,
    });
    await page.reload();
    await page.locator(".poster-card").first().waitFor();
    // Every row asked and drawn (rows are content-visibility: auto).
    await page.waitForFunction(
      (n) => document.querySelectorAll(".rail").length >= n,
      CATALOGS * 0.9,
      { timeout: 60000 },
    );
    await page.waitForTimeout(1500);
    const rows = await page.locator(".rail").count();
    const cards = await page.locator(".poster-card").count();

    // Scroll the page top to bottom at 1600 px a second, one step a frame,
    // and record every frame's interval.
    const scroll = await page.evaluate(
      () =>
        new Promise((done) => {
          const frames = [];
          let last = performance.now();
          const end =
            document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo(0, 0);
          const step = (now) => {
            frames.push(now - last);
            last = now;
            window.scrollBy(0, (1600 * frames.at(-1)) / 1000);
            if (window.scrollY >= end - 2 || frames.length > 1800)
              done({ frames: frames.slice(2), distance: window.scrollY });
            else requestAnimationFrame(step);
          };
          requestAnimationFrame((t) => {
            last = t;
            requestAnimationFrame(step);
          });
        }),
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    const budget = 1000 / 60;
    const frames = scroll.frames;
    const scrollStats = {
      frames: frames.length,
      meanMs: frames.reduce((a, b) => a + b, 0) / frames.length,
      p95Ms: quantile(frames, 0.95),
      dropped: frames.filter((f) => f > budget * 1.5).length,
      distance: Math.round(scroll.distance),
    };

    // The poster menu (a level-2 floating surface).
    const card = page.locator(".poster-card").nth(4);
    const menuWait = painted(".poster-actions");
    await card.click({ button: "right" });
    const menuMs = await menuWait;
    await page.keyboard.press("Escape");
    await page.locator(".poster-actions").waitFor({ state: "detached" });

    // A dialog (level 3): the profiles window from the navigation.
    const dialogWait = painted(".modal[open]");
    await page.locator(".wheel-hub .riwaq-destination").first().click();
    const dialogMs = await dialogWait;
    await page.keyboard.press("Escape");
    await page.locator(".modal[open]").waitFor({ state: "detached" });

    const cdp = await context.newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("Performance.enable");
    const metrics = await cdp.send("Performance.getMetrics");
    return {
      rows,
      cards,
      scrollMeanMs: Math.round(scrollStats.meanMs * 100) / 100,
      scrollP95Ms: Math.round(scrollStats.p95Ms * 100) / 100,
      scrollDropped: scrollStats.dropped,
      scrollFrames: scrollStats.frames,
      menuMs: Math.round(menuMs),
      dialogMs: Math.round(dialogMs),
      heapMB:
        Math.round(
          (metrics.metrics.find((m) => m.name === "JSHeapUsedSize")?.value ||
            0) / 10485.76,
        ) / 100,
    };
  } finally {
    await browser.close();
    siteServer.close();
    addon.server.close();
  }
}

const samples = { before: [], after: [] };
for (let i = 0; i < runs; i++)
  for (const [name, site] of [
    ["before", before],
    ["after", after],
  ]) {
    samples[name].push(await sample(site));
    process.stdout.write(".");
  }
const summary = (list) =>
  Object.fromEntries(
    Object.keys(list[0]).map((key) => {
      const values = list.map((x) => x[key]).sort((a, b) => a - b);
      return [
        key,
        {
          median: values[Math.floor(values.length / 2)],
          min: values[0],
          max: values.at(-1),
        },
      ];
    }),
  );
const report = {
  runs,
  catalogs: CATALOGS,
  titles: TITLES,
  environment: `${process.platform} ${process.arch}, Node ${process.version}, headless Chromium ${chromiumVersion} (software compositing)`,
  before: summary(samples.before),
  after: summary(samples.after),
  samples,
};
mkdirSync(resolve(".cache/ui-glass"), { recursive: true });
writeFileSync(
  resolve(".cache/ui-glass/measure.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  "\n" +
    JSON.stringify(
      {
        environment: report.environment,
        before: report.before,
        after: report.after,
      },
      null,
      1,
    ),
);
