// Before/after timings of the browsing journey on the same machine, fixture
// and build mode: a cold start to Home's first titles, Home ↔ Discover, See
// all opening, Details and Back, renderer heap after GC, long tasks, catalog
// requests and bundle bytes. Builds alternate run by run; medians and ranges
// are reported, never a single sample.
//
//   node scripts/measure-ui-browse.mjs <before dist-web> <after dist-web> [runs]
//
// Results go to .cache/ui-rebuild/measure.json. Coarse harness timings in
// headless Chromium, not Windows startup, FPS or whole-process memory.
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { loadPlaywright, startUiFixture } from "./fixtures/ui-browse-addon.mjs";

const { chromium } = loadPlaywright();
const [before, after] = process.argv.slice(2, 4).map((p) => resolve(p));
const runs = Number(process.argv[4]) || 5;
if (!before || !after)
  throw new Error("usage: measure-ui-browse.mjs <before> <after> [runs]");
const BROWSE = ".browse-page, .catalog-browser[open]";
let chromiumVersion = "";

const bundle = (site) =>
  readdirSync(join(site, "assets"))
    .filter((f) => /\.(js|css)$/.test(f))
    .reduce(
      (n, f) => {
        const size = statSync(join(site, "assets", f)).size;
        n[f.endsWith(".js") ? "js" : "css"] += size;
        return n;
      },
      { js: 0, css: 0 },
    );

async function sample(site) {
  const fixture = await startUiFixture(site);
  const browser = await chromium.launch();
  chromiumVersion = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.route(/^https?:\/\//, (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1"
      ? route.continue()
      : route.abort("internetdisconnected"),
  );
  const page = await context.newPage();
  const call = (method, args) =>
    page.evaluate(([m, a]) => window.riwaq.call(m, a), [method, args]);
  const time = async (fn) => {
    const t = performance.now();
    await fn();
    return Math.round(performance.now() - t);
  };
  const nav = (n) =>
    page.locator(".riwaq-destinations > button").nth(n).click();
  try {
    await page.goto(fixture.siteUrl);
    await page.waitForFunction(() => window.riwaq?.platform === "web");
    await call("onboardingComplete");
    await call("install", { url: `${fixture.base}/manifest.json` });
    await call("settings", {
      seenVersion: (await call("init")).update?.current,
    });
    await page.reload();
    await page.locator(".smart-shelf .poster-card").first().waitFor();
    // A cold load of the site with the addon installed.
    const cold = await time(async () => {
      await page.reload();
      await page.locator(".smart-shelf .poster-card").first().waitFor();
    });
    await page.evaluate(() => {
      window.__long = [];
      new PerformanceObserver((list) =>
        window.__long.push(...list.getEntries().map((e) => e.duration)),
      ).observe({ type: "longtask" });
    });
    const asked = fixture.catalogRequests.length;
    const discover = await time(async () => {
      await nav(1);
      await page.locator(".poster-card").first().waitFor();
    });
    const home = await time(async () => {
      await nav(0);
      await page.locator(".smart-shelf .poster-card").first().waitFor();
    });
    const seeAll = await time(async () => {
      await page
        .locator(".smart-shelf .rail-tools .text-button")
        .first()
        .click();
      await page.locator(`:is(${BROWSE}) .poster-card`).first().waitFor();
    });
    const details = await time(async () => {
      await page.locator(`:is(${BROWSE}) .poster-card`).nth(3).click();
      await page.locator(".title-page .back-button").waitFor();
    });
    const back = await time(async () => {
      await page.locator(".title-page .back-button").click();
      await page.locator(".title-page").waitFor({ state: "detached" });
      await page.locator(`:is(${BROWSE}) .poster-card`).first().waitFor();
    });
    const requests = fixture.catalogRequests.length - asked;
    const cdp = await context.newCDPSession(page);
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("Performance.enable");
    const metrics = await cdp.send("Performance.getMetrics");
    const dom = await cdp.send("Memory.getDOMCounters");
    const longTasks = await page.evaluate(() => window.__long);
    return {
      cold,
      discover,
      home,
      seeAll,
      details,
      back,
      heap: metrics.metrics.find((m) => m.name === "JSHeapUsedSize")?.value,
      nodes: dom.nodes,
      longTasks: longTasks.length,
      longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
      requests,
    };
  } finally {
    await browser.close();
    fixture.close();
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
  environment: `${process.platform} ${process.arch}, Node ${process.version}, headless Chromium ${chromiumVersion}`,
  before: { bundle: bundle(before), ...summary(samples.before) },
  after: { bundle: bundle(after), ...summary(samples.after) },
  samples,
};
mkdirSync(resolve(".cache/ui-rebuild"), { recursive: true });
writeFileSync(
  resolve(".cache/ui-rebuild/measure.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  "\n" +
    JSON.stringify({ before: report.before, after: report.after }, null, 1),
);
