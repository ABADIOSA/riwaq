// Browsing journeys in a real Chromium against the built web edition:
// Home → See all → Details → Back, Discover, the library and settings, in
// Arabic and English at desktop, compact and phone widths. A local addon
// serves several paged catalogs (one repeats a page, one fails once), mixed
// Arabic/English and long titles, and titles without artwork. Nothing here
// reaches the internet.
//
//   npm run build:web && node scripts/test-ui-browse.mjs
//
// UI_PHASE=before records geometry and screenshots without asserting the
// rebuilt See all page (for a baseline build in RIWAQ_WEB_DIST); the default
// phase "after" asserts it. Evidence lands in .cache/ui-rebuild/<phase>.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const candidates = [
    process.env.RIWAQ_PLAYWRIGHT,
    "playwright",
    (() => {
      try {
        return join(execSync("npm root -g").toString().trim(), "playwright");
      } catch {
        return "";
      }
    })(),
  ].filter(Boolean);
  for (const name of candidates) {
    try {
      return require(name);
    } catch {}
  }
  throw new Error(
    "Playwright not found: npm i -g playwright, or set RIWAQ_PLAYWRIGHT",
  );
}
const { chromium } = loadPlaywright();

const phase = process.env.UI_PHASE === "before" ? "before" : "after";
const strict = phase === "after";
const site = resolve(process.env.RIWAQ_WEB_DIST || "dist-web");
if (!existsSync(join(site, "index.html")))
  throw new Error("Build the site first: npm run build:web");
const output = resolve(".cache/ui-rebuild/" + phase);
mkdirSync(output, { recursive: true });
const shots = process.env.UI_SHOTS !== "0";

// --- The site, as GitHub Pages serves it --------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};
const siteServer = createServer((req, res) => {
  let path = join(
    site,
    decodeURIComponent(new URL(req.url, "http://x").pathname),
  );
  if (!path.startsWith(site)) path = site;
  if (existsSync(path) && statSync(path).isDirectory())
    path = join(path, "index.html");
  if (!existsSync(path)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    TYPES[extname(path)] || "application/octet-stream",
  );
  res.end(readFileSync(path));
});

// --- A Stremio addon with several paged catalogs -------------------------
const NAMES = [
  "القطار الأخير",
  "Blue Hour",
  "مدينة هادئة على حافة البحر الأحمر في ليلة طويلة",
  "The Long Night Over Jeddah: An Unreasonably Long English Title",
  "الساعة الزرقاء",
  "Quiet City",
  "رِواق: حكاية",
  "Northern Lights",
];
const CATALOGS = {
  popular: { type: "movie", name: "Popular", total: 100 },
  fresh: { type: "movie", name: "New", total: 60, repeatAt: 20 },
  classics: { type: "movie", name: "Classics", total: 40, failAt: 20 },
  shows: { type: "series", name: "Series picks", total: 60 },
};
const failedOnce = new Set();
const catalogRequests = [];
let base;
const metaFor = (catalog, i) => {
  const c = CATALOGS[catalog];
  const id = `uifix:${catalog}-${i}`;
  return {
    id,
    type: c.type,
    name: `${NAMES[i % NAMES.length]} ${i}`,
    // Every eleventh title has no artwork at all.
    poster: i % 11 === 5 ? undefined : `${base}/poster/${catalog}-${i}.svg`,
    background:
      i % 11 === 5 ? undefined : `${base}/backdrop/${catalog}-${i}.svg`,
    releaseInfo: String(1990 + (i % 35)),
    imdbRating: (6 + (i % 4) * 0.7).toFixed(1),
    genres: [c.type === "series" ? "Drama" : i % 2 ? "Action" : "Drama"],
    description:
      "عنوان تجريبي لفحص التصفح في رِواق، بوصف عربي يكفي لسطرين أو ثلاثة.",
  };
};
const seriesMeta = (meta) => ({
  ...meta,
  videos: Array.from({ length: 24 }, (_, i) => ({
    id: `${meta.id}:${i < 12 ? 1 : 2}:${(i % 12) + 1}`,
    season: i < 12 ? 1 : 2,
    episode: (i % 12) + 1,
    title: `Episode ${(i % 12) + 1}`,
    released: "2025-01-01T00:00:00Z",
  })),
});
const svg = (w, h, seed, label) => {
  const hue = [...seed].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 360, 7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,32%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},40%,16%)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.62}" cy="${h * 0.3}" r="${Math.min(w, h) * 0.22}" fill="hsl(${(hue + 180) % 360},50%,60%)" opacity=".55"/><text x="${w * 0.08}" y="${h * 0.9}" fill="#f8eddf" font-size="${Math.round(h / 14)}" font-family="Georgia">${label}</text></svg>`;
};
const addon = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const url = decodeURIComponent(req.url);
  const json = (data) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  };
  if (url === "/manifest.json")
    return json({
      id: "riwaq.ui-fixture",
      name: "UI fixture",
      version: "1.0.0",
      resources: ["catalog", "meta", "stream"],
      types: ["movie", "series"],
      idPrefixes: ["uifix:"],
      catalogs: Object.entries(CATALOGS).map(([id, c]) => ({
        id,
        type: c.type,
        name: c.name,
        extra: [{ name: "skip" }],
      })),
    });
  const poster = /^\/(poster|backdrop)\/(.+)\.svg$/.exec(url);
  if (poster) {
    res.setHeader("Content-Type", "image/svg+xml");
    const wide = poster[1] === "backdrop";
    return res.end(
      svg(wide ? 1280 : 400, wide ? 720 : 600, poster[2], poster[2]),
    );
  }
  const cat =
    /^\/catalog\/(movie|series)\/([a-z]+)(?:\/skip=(\d+))?\.json$/.exec(url);
  if (cat) {
    catalogRequests.push(url);
    const id = cat[2],
      c = CATALOGS[id],
      skip = Number(cat[3] || 0);
    if (!c) return json({ metas: [] });
    const key = `${id}:${skip}`;
    if (c.failAt === skip && !failedOnce.has(key)) {
      failedOnce.add(key);
      res.writeHead(503);
      return res.end();
    }
    // A provider may repeat a page before it returns new titles.
    const from = c.repeatAt === skip ? 0 : skip;
    const count = Math.max(0, Math.min(20, c.total - skip));
    return json({
      metas: Array.from({ length: count }, (_, i) => metaFor(id, from + i)),
    });
  }
  const meta = /^\/meta\/(movie|series)\/uifix:([a-z]+)-(\d+)\.json$/.exec(url);
  if (meta) {
    const m = metaFor(meta[2], Number(meta[3]));
    return json({ meta: m.type === "series" ? seriesMeta(m) : m });
  }
  if (url.startsWith("/stream/"))
    return json({
      streams: [
        {
          url: `${base}/video.mp4`,
          name: "Fixture",
          title: "Fixture 1080p WEB-DL",
        },
      ],
    });
  json({});
});

const listen = (server) =>
  new Promise((r) =>
    server.listen(0, "127.0.0.1", () => r(server.address().port)),
  );
const siteUrl = `http://127.0.0.1:${await listen(siteServer)}/`;
base = `http://127.0.0.1:${await listen(addon)}`;

const browser = await chromium.launch({
  executablePath: process.env.RIWAQ_CHROMIUM || undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
await context.route(/^https?:\/\//, (route) =>
  new URL(route.request().url()).hostname === "127.0.0.1"
    ? route.continue()
    : route.abort("internetdisconnected"),
);
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
    problems.push(`console: ${m.text()}`);
});
const call = (method, args) =>
  page.evaluate(([m, a]) => window.riwaq.call(m, a), [method, args]);

const results = [];
const report = {
  phase,
  site,
  fixture: "1 local addon, 4 paged catalogs; external services offline",
  results,
  geometry: [],
  drag: [],
  timings: {},
  homeOrder: [],
};
const check = async (name, fn) => {
  const started = performance.now();
  try {
    await fn();
    results.push({
      name,
      pass: true,
      ms: Math.round(performance.now() - started),
    });
    console.log(`✔ ${name}`);
  } catch (e) {
    results.push({ name, pass: false, error: e.message.split("\n")[0] });
    console.log(`✗ ${name}: ${e.message.split("\n")[0]}`);
    await page.keyboard.press("Escape").catch(() => {});
  }
};
const shot = async (name, full = false) => {
  if (shots)
    await page.screenshot({
      path: join(output, name + ".png"),
      fullPage: full,
    });
};
const settle = () => page.waitForTimeout(350);
// The See all surface: the rebuilt page, or the 0.52 dialog it replaces.
const BROWSE = ".browse-page, .catalog-browser[open]";

// A destination by its place in the navigation; compact widths open the
// drawer first.
const go = async (selector) => {
  const trigger = page.locator(".riwaq-drawer-trigger");
  if (await trigger.isVisible()) {
    await trigger.click();
    await page.locator(".riwaq-nav-dialog[open]").waitFor();
  }
  await page.locator(selector).first().click();
};
const home = async () => {
  await go(".riwaq-destinations > button >> nth=0");
  await page.locator(".poster-card").first().waitFor();
};
const discover = async () => {
  await go(".riwaq-destinations > button >> nth=1");
  await page.locator(".poster-card").first().waitFor();
};
const language = async (lang) => {
  await call("settings", { uiLanguage: lang });
  await page.reload();
  await page.locator(".app").waitFor();
  await page.waitForFunction((l) => document.documentElement.lang === l, lang);
};
// What fills the See all surface, against the content area it sits in.
const browseGeometry = async (label, viewport) => {
  const g = await page.evaluate((sel) => {
    const box = document.querySelector(sel);
    const grid = box?.querySelector(".poster-grid");
    const content = document.querySelector(".content");
    const card = grid?.querySelector(".poster-card");
    if (!box || !grid || !content) return null;
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return {
        x: Math.round(b.x),
        w: Math.round(b.width),
        h: Math.round(b.height),
      };
    };
    const cs = getComputedStyle(content);
    const inner =
      content.clientWidth -
      parseFloat(cs.paddingLeft) -
      parseFloat(cs.paddingRight);
    return {
      surface: r(box),
      grid: r(grid),
      content: { ...r(content), inner: Math.round(inner) },
      columns: getComputedStyle(grid)
        .gridTemplateColumns.split(" ")
        .filter(Boolean).length,
      card: card ? r(card) : null,
      dialog: box.tagName === "DIALOG",
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  }, BROWSE);
  const entry = {
    label,
    viewport,
    ...g,
    fill: g ? +(g.grid.w / g.content.inner).toFixed(3) : 0,
  };
  report.geometry.push(entry);
  return entry;
};
// Each horizontal scroller on the page: does a mouse drag move it, and
// does the drag stay off the card under it?
const dragRows = async (where) => {
  const rows = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        ".scroll-row, .taste-row, .folder-row, .countdown-row, .credits-cast-row",
      ),
    ]
      .filter(
        (el) =>
          el.scrollWidth > el.clientWidth + 20 &&
          el.getBoundingClientRect().height > 60,
      )
      .map((el, i) => {
        el.dataset.dragProbe = String(i);
        return { i, cls: el.className };
      }),
  );
  for (const row of rows.slice(0, 6)) {
    const el = page.locator(`[data-drag-probe="${row.i}"]`);
    await el.scrollIntoViewIfNeeded();
    const box = await el.boundingBox();
    if (!box) continue;
    const before = await el.evaluate((n) => n.scrollLeft);
    const y = box.y + Math.min(box.height / 2, 120);
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let s = 1; s <= 8; s++) await page.mouse.move(x + s * 25, y);
    await page.mouse.up();
    await page.waitForTimeout(120);
    const after = await el.evaluate((n) => n.scrollLeft);
    const opened = await page.locator(".title-page").count();
    report.drag.push({
      where,
      cls: row.cls,
      moved: Math.abs(after - before),
      opened: !!opened,
    });
    if (opened) await page.locator(".title-page .back-button").click();
  }
};

try {
  await page.goto(siteUrl);
  await page.waitForFunction(() => window.riwaq?.platform === "web");
  await call("onboardingComplete");
  await call("install", { url: `${base}/manifest.json` });
  await call("settings", {
    uiLanguage: "ar",
    seenVersion: (await call("init")).update?.current,
  });
  await page.reload();
  await page.locator(".app").waitFor();
  if (await page.locator(".whats-new").count())
    await page.locator(".whats-new .primary").click();
  await page.locator(".poster-card").first().waitFor();
  await settle();

  for (const lang of ["ar", "en"]) {
    await language(lang);
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 1280, height: 720 },
      { width: 980, height: 680 },
      { width: 740, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const tag = `${lang}-${viewport.width}`;
      await check(`${tag}: Home has no horizontal page overflow`, async () => {
        await home();
        await settle();
        await shot(`home-${tag}`);
        await shot(`home-${tag}-full`, viewport.width === 1440);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          true,
        );
        if (viewport.width === 1440)
          report.homeOrder.push({
            lang,
            sections: await page.evaluate(() =>
              [
                ...document.querySelectorAll(
                  ".page-body > *, .content > section, .content > .session-home",
                ),
              ]
                .filter((el) => el.getBoundingClientRect().height > 40)
                .slice(0, 8)
                .map((el) => ({
                  cls: el.className.split(" ").slice(0, 2).join(" "),
                  top: Math.round(el.getBoundingClientRect().top + scrollY),
                })),
            ),
            firstPoster: await page.evaluate(() =>
              Math.round(
                document.querySelector(".poster-card")?.getBoundingClientRect()
                  .top + scrollY,
              ),
            ),
          });
      });
      await check(
        `${tag}: See all for a group's All fills the content area`,
        async () => {
          await home();
          const shelf = page.locator(".smart-shelf").first();
          const more = shelf.locator(".rail-tools .text-button");
          await more.scrollIntoViewIfNeeded();
          const t0 = performance.now();
          await more.click();
          await page.locator(BROWSE).first().waitFor();
          await page.locator(`:is(${BROWSE}) .poster-card`).first().waitFor();
          report.timings[`seeAll-${tag}`] = Math.round(performance.now() - t0);
          await settle();
          await shot(`seeall-${tag}`);
          const g = await browseGeometry(`seeall-${tag}`, viewport);
          if (strict) {
            assert.equal(g.dialog, false, "See all is a page, not a dialog");
            assert.equal(g.overflow, false, "no horizontal page overflow");
            // Content-relative budget: the grid uses the content column.
            assert(g.fill >= 0.9, `grid fills ${g.fill} of the content width`);
            const expected =
              viewport.width >= 1920
                ? 8
                : viewport.width >= 1440
                  ? 6
                  : viewport.width >= 1280
                    ? 5
                    : viewport.width >= 980
                      ? 4
                      : viewport.width >= 740
                        ? 3
                        : 2;
            assert(
              g.columns >= expected,
              `${g.columns} columns at ${viewport.width}px, wanted ≥ ${expected}`,
            );
            assert(
              g.card.w >= 140 && g.card.w <= 260,
              `card width ${g.card.w}`,
            );
          }
          await page.keyboard.press("Escape");
          if (await page.locator(BROWSE).count())
            await page
              .locator(".browse-back, .catalog-browser .modal-close")
              .first()
              .click();
          await page.locator(BROWSE).first().waitFor({ state: "detached" });
        },
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await check(`${lang}: Discover renders sections`, async () => {
      await discover();
      await settle();
      await shot(`discover-${lang}-1440`);
      await shot(`discover-${lang}-1440-full`, true);
    });
    await check(`${lang}: Details opens and Back returns`, async () => {
      await home();
      await page.locator(".poster-card").first().click();
      await page.locator(".title-page").waitFor();
      await settle();
      await shot(`details-${lang}-1440`);
      await page.locator(".title-page .back-button").click();
      await page.locator(".title-page").waitFor({ state: "detached" });
    });
    await check(`${lang}: Library renders`, async () => {
      await go(".riwaq-destinations > button >> nth=2");
      await settle();
      await shot(`library-${lang}-1440`);
    });
    await check(`${lang}: Settings renders`, async () => {
      await go(".riwaq-sidebar-bottom .riwaq-destination:last-of-type");
      await settle();
      await shot(`settings-${lang}-1440`);
    });
  }

  await language("ar");
  await page.setViewportSize({ width: 1440, height: 900 });
  await check(
    "rows: mouse drag moves every horizontal row on Home",
    async () => {
      await home();
      await dragRows("home");
      await discover();
      await dragRows("discover");
      const stuck = report.drag.filter((d) => d.moved < 20 || d.opened);
      if (strict) assert.deepEqual(stuck, [], JSON.stringify(stuck));
    },
  );
} finally {
  report.problems = problems;
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  siteServer.close();
  addon.close();
}
const failed = results.filter((r) => !r.pass);
console.log(
  `${results.length - failed.length}/${results.length} passed · evidence in ${output}`,
);
if (problems.length) console.log("Page problems:\n" + problems.join("\n"));
if (strict && (failed.length || problems.length)) process.exit(1);
