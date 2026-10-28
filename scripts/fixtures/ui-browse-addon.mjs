// The local site and addon behind scripts/test-ui-browse.mjs and
// scripts/measure-ui-browse.mjs: the built web edition as GitHub Pages
// serves it, and a Stremio addon with several paged catalogs (one repeats a
// page, one fails once), mixed Arabic/English and long titles, titles
// without artwork, series with seasons and a recorded WebM to play.
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
export function loadPlaywright() {
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

/** Serves `site` and the addon on loopback; nothing reaches the internet. */
export async function startUiFixture(site) {
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
  // A short WebM recorded by Chromium itself, for a real continue-watching
  // record (Home's order with history).
  let video = Buffer.alloc(0);
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
    const hue = [...seed].reduce(
      (a, ch) => (a * 31 + ch.charCodeAt(0)) % 360,
      7,
    );
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
    const meta = /^\/meta\/(movie|series)\/uifix:([a-z]+)-(\d+)\.json$/.exec(
      url,
    );
    if (meta) {
      const m = metaFor(meta[2], Number(meta[3]));
      return json({ meta: m.type === "series" ? seriesMeta(m) : m });
    }
    if (url === "/video.webm") {
      res.setHeader("Content-Type", "video/webm");
      return res.end(video);
    }
    if (url.startsWith("/stream/"))
      return json({
        streams: [
          {
            url: `${base}/video.webm`,
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
  return {
    siteUrl,
    base,
    catalogRequests,
    setVideo: (bytes) => (video = bytes),
    close: () => {
      siteServer.close();
      addon.close();
    },
  };
}
