// The November 2026 beta in a real Chromium (issues #144–#154, stream badge
// appearance, collections with moving covers): the built web edition
// against the local addon of scripts/fixtures/ui-browse-addon.mjs plus a
// second local addon with a varied source list. FR-Badges' pinned file and
// pictures are answered locally; nothing reaches the internet.
//
//   npm run build:web && node scripts/test-ui-beta.mjs
//
// UI_ONLY=<pattern> runs some checks. Screenshots land in .cache/ui-beta.
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { loadPlaywright, startUiFixture } from "./fixtures/ui-browse-addon.mjs";

const { chromium } = loadPlaywright();
const site = resolve(process.env.RIWAQ_WEB_DIST || "dist-web");
const output = resolve(".cache/ui-beta");
mkdirSync(output, { recursive: true });
const fixture = await startUiFixture(site);
const { siteUrl, base } = fixture;

// --- A second addon: many sources, each saying different things ----------
const SOURCES = [
  [
    "Remux 4K",
    "Film.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1 [RD+]",
  ],
  ["Web 1080", "Film.2024.1080p.WEB-DL.DDP5.1.H.264 eng subs"],
  ["Web 720", "Film 720p WEBRip AAC مترجم"],
  ["Bare", "Film"],
  ["SDR Blu", "Film 1080p SDR BluRay DTS-HD MA 5.1 [AD download]"],
  ["Dub", "Film 1080p WEB-DL AAC 2.0 مدبلج"],
  ["8K", "Film 4320p 8K HEVC HDR10+ [TB+]"],
  ["Multi", "Film 1080p WEB-DL MULTI AV1 Opus"],
];
const streamsAddon = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const url = decodeURIComponent(req.url);
  if (url === "/manifest.json")
    return res.end(
      JSON.stringify({
        id: "riwaq.beta-streams",
        name: "Beta streams",
        version: "1.0.0",
        resources: ["stream"],
        types: ["movie", "series"],
        idPrefixes: ["uifix:"],
        catalogs: [],
      }),
    );
  if (url.startsWith("/stream/"))
    return res.end(
      JSON.stringify({
        streams: SOURCES.map(([name, title], i) => ({
          // One address each: the engine folds identical links together.
          url: `${streamsBase}/video-${i}.webm`,
          name,
          title,
        })),
      }),
    );
  res.end("{}");
});
await new Promise((r) => streamsAddon.listen(0, "127.0.0.1", r));
const streamsBase = `http://127.0.0.1:${streamsAddon.address().port}`;

// A one-pixel PNG for FR-Badges' pictures, made here.
function png(r, g, b) {
  const crc = (buf) => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(48, 0);
  head.writeUInt32BE(18, 4);
  head[8] = 8;
  head[9] = 2;
  const rows = Buffer.alloc((48 * 3 + 1) * 18);
  for (let y = 0; y < 18; y++)
    for (let x = 0; x < 48; x++)
      rows.set([r, g, b], y * (48 * 3 + 1) + 1 + x * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const FR = "https://raw.githubusercontent.com/farizmohd70/FR-Badges/main/";
const frJson = (folder) =>
  JSON.stringify({
    filters: [
      ["res-4k", "resolution", "4K UHD", "(?i)\\b(2160p|4k)\\b", "4k-uhd"],
      ["dv", "dynamic-range", "Dolby Vision", "(?i)\\b(dv|dovi)\\b", "dv"],
      ["truehd", "audio-codec", "Dolby TrueHD", "(?i)\\btrue-?hd\\b", "truehd"],
      ["hevc", "video-codec", "HEVC / H.265", "(?i)\\b(hevc|x265)\\b", "hevc"],
      ["rd", "debrid", "Real-Debrid", "(?i)\\[rd\\+?\\]", "rd"],
      ["broken", "editions", "Broken Picture", "(?i)\\bremux\\b", "broken"],
    ].map(([id, groupId, name, pattern, file]) => ({
      id,
      groupId,
      name,
      pattern,
      imageURL: `${FR}${folder}/${file}.png`,
      tagColor: "#00000000",
      borderColor: "#00000000",
      textColor: "#00000000",
      tagStyle: "filled and bordered",
      isEnabled: true,
      type: "filter",
    })),
  });

// Kaptain's Reality TV folder (the task's example): its still and its
// moving cover, answered here. A 1×1 GIF is a real GIF.
const KBASE = "https://raw.githubusercontent.com/ImKaptain/nuvio-assets/main";
const STILL = `${KBASE}/Genres/Reality%20TV/Reality_TV_Base.png`;
const MOVING = `${KBASE}/Genres/Reality%20TV/Reality_TV_Hover.gif`;
const BROKEN_GIF = "https://broken.example/cover.gif";
const GIF = Buffer.from(
  "R0lGODlhAQABAPAAAP8AAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64",
);
const gifRequests = [];
const NUVIO_FILE = JSON.stringify([
  {
    id: "kaptain-genres",
    title: "Genres",
    backdropImageUrl: STILL,
    viewMode: "TABBED_GRID",
    folders: [
      {
        id: "folder-KQEZGAMF",
        title: "Reality TV",
        tileShape: "LANDSCAPE",
        hideTitle: true,
        focusGifEnabled: true,
        focusGifUrl: MOVING,
        coverImageUrl: STILL,
        focusGlowEnabled: true,
        sources: [
          {
            provider: "tmdb",
            tmdbSourceType: "DISCOVER",
            mediaType: "TV",
            title: "New Series",
            sortBy: "primary_release_date.desc",
            filters: { year: 2026, withGenres: "10764", voteCountGte: 10 },
          },
          { provider: "simkl", listId: 42, title: "Not here yet" },
        ],
      },
      { id: "folder-2", title: "Second", coverImageUrl: STILL, sources: [] },
    ],
  },
]);

const browser = await chromium.launch({
  executablePath: process.env.RIWAQ_CHROMIUM || undefined,
  // Real scrollbars, as on Windows (headless hides them by default).
  ignoreDefaultArgs: ["--hide-scrollbars"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
});
const outside = [];
await context.route(/^https?:\/\//, (route) => {
  const url = route.request().url();
  if (new URL(url).hostname === "127.0.0.1") return route.continue();
  if (url === STILL)
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: png(60, 120, 200),
    });
  if (url === MOVING) {
    gifRequests.push(url);
    return route.fulfill({ status: 200, contentType: "image/gif", body: GIF });
  }
  if (url === BROKEN_GIF) return route.abort("failed");
  if (url.startsWith(FR)) {
    const name = url.slice(FR.length);
    if (name === "badges-frost.json")
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: frJson("Badges-Frost"),
      });
    if (/broken\.png$/.test(name)) return route.abort("failed");
    if (name.endsWith(".png"))
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: png(200, 160, 60),
      });
  }
  outside.push(url);
  return route.abort("internetdisconnected");
});
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("dialog", (d) => {
  problems.push(`dialog: ${d.message()}`);
  d.dismiss().catch(() => {});
});
const call = (method, args) =>
  page.evaluate(([m, a]) => window.riwaq.call(m, a), [method, args]);

const results = [];
const only = process.env.UI_ONLY ? new RegExp(process.env.UI_ONLY) : null;
const check = async (name, fn) => {
  if (only && !only.test(name)) return;
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`✔ ${name}`);
  } catch (e) {
    const error = e.message.split("\n").slice(0, 4).join(" ");
    results.push({ name, pass: false, error });
    console.log(`✗ ${name}: ${error}`);
    await page
      .screenshot({ path: join(output, `failed-${results.length}.png`) })
      .catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
  }
};
const shot = (name) =>
  page.screenshot({ path: join(output, name + ".png") }).catch(() => {});
const settle = (ms = 350) => page.waitForTimeout(ms);
const restart = async (settings = {}) => {
  await call("settings", settings);
  // Start from Home whatever page the last check left open.
  await page.goto(siteUrl);
  await page.locator(".app").waitFor();
  if (await page.locator(".whats-new").count())
    await page.locator(".whats-new .primary").click();
  await page.locator(".poster-card").first().waitFor();
  await settle();
};
const openSources = async () => {
  await page.locator(".riwaq-destinations > button").first().click();
  await page.locator(".poster-card").first().waitFor();
  await page.locator(".poster-card").first().click();
  await page.locator(".title-page").waitFor();
  await page.locator(".title-page .title-play").click();
  await page.locator(".sources-modal[open] .stream").first().waitFor();
  await settle(400);
};
const closeAll = async () => {
  for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
  await settle(300);
};
// Settings, a page found through its search (the page's own button).
const settingsPage = async (query, open = true) => {
  await page.locator(".riwaq-destinations > button").nth(8).click();
  await page.locator(".settings-search input").fill(query);
  await settle(400);
  if (!open) return;
  await page
    .locator(".studio-index-pages button", { hasText: query })
    .first()
    .click();
  await settle(400);
};

await page.goto(siteUrl);
await page.waitForFunction(() => window.riwaq?.platform === "web");
await call("onboardingComplete");
await call("install", { url: `${base}/manifest.json` });
await call("install", { url: `${streamsBase}/manifest.json` });
await restart({
  uiLanguage: "en",
  seenVersion: (await call("init")).update?.current,
  stremioBannerHidden: true,
  sourcesPopup: true,
});

// --- #154 ------------------------------------------------------------------
for (const lang of ["en", "ar"])
  await check(
    `#154 ${lang}: advanced filters narrow the list by facts`,
    async () => {
      await restart({ uiLanguage: lang, sourceFacetsRemember: false });
      await openSources();
      const modal = page.locator(".sources-modal[open]");
      const rows = modal.locator(".stream");
      const total = await rows.count();
      assert.ok(total >= 8, `${total} sources`);
      const toggle = modal.locator(".facet-toggle");
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      const facet = (group, label) =>
        modal
          .locator(".facet-group")
          .filter({ has: page.locator("legend", { hasText: group }) })
          .locator(".facet", { hasText: label })
          .first();
      const groups =
        lang === "en"
          ? {
              quality: "Resolution",
              release: "Release type",
              audio: "Audio format",
              range: "Dynamic range",
              link: "Source type",
              lang: "Subtitles and language",
            }
          : {
              quality: "الدقة",
              release: "نوع الإصدار",
              audio: "صيغة الصوت",
              range: "النطاق الديناميكي",
              link: "نوع المصدر",
              lang: "الترجمة واللغة",
            };
      // OR inside a group: 4K or 8K.
      const k4 = facet(groups.quality, "4K");
      assert.match(await k4.textContent(), /4K\s*1/);
      await k4.click();
      await facet(groups.quality, "8K").click();
      assert.equal(await rows.count(), 2);
      // AND across groups: and REMUX.
      await facet(groups.release, "REMUX").click();
      assert.equal(await rows.count(), 1);
      assert.match(await rows.first().textContent(), /Remux 4K/);
      // Pills show what is chosen; one removes itself.
      assert.equal(await modal.locator(".facet-pill").count(), 3);
      await modal.locator(".facet-pill").last().click();
      assert.equal(await rows.count(), 2);
      await shot(`facets-${lang}`);
      // Clear all.
      await modal.locator(".facet-clear").click();
      assert.equal(await rows.count(), total);
      // "Not reported" is its own value: no SDR without the word.
      await facet(groups.range, "SDR").click();
      assert.equal(await rows.count(), 1);
      await modal.locator(".facet-clear").click();
      // Cached only with the addon's mark; DD+ read from DDP5.1.
      await facet(
        groups.link,
        lang === "en" ? "Cached debrid" : "Debrid مخزّن",
      ).click();
      assert.equal(await rows.count(), 2);
      await modal.locator(".facet-clear").click();
      await facet(groups.audio, "Dolby Digital Plus").click();
      assert.equal(await rows.count(), 1);
      assert.match(await rows.first().textContent(), /Web 1080/);
      await modal.locator(".facet-clear").click();
      // Arabic subtitles and an Arabic dub are separate facts.
      await facet(
        groups.lang,
        lang === "en" ? "Arabic subtitles" : "ترجمة عربية",
      ).click();
      assert.equal(await rows.count(), 1);
      assert.match(await rows.first().textContent(), /Web 720/);
      await modal.locator(".facet-clear").click();
      // The keyboard reaches a facet and presses it.
      await k4.focus();
      await page.keyboard.press("Space");
      assert.equal(await k4.getAttribute("aria-pressed"), "true");
      await page.keyboard.press("Enter");
      assert.equal(await k4.getAttribute("aria-pressed"), "false");
      // Nothing was asked of the addons again.
      await closeAll();
    },
  );

await check("#154 remembered filters come back for the profile", async () => {
  await restart({ uiLanguage: "en", sourceFacetsRemember: false });
  await openSources();
  const modal = page.locator(".sources-modal[open]");
  await modal.locator(".facet-toggle").click();
  await modal.locator(".facet", { hasText: "4K" }).first().click();
  await modal.locator(".facet-remember input").check();
  await settle(900);
  await closeAll();
  await restart({});
  await openSources();
  assert.equal(await modal.locator(".stream").count(), 1);
  assert.equal(await modal.locator(".facet-pill").count(), 1);
  await modal.locator(".facet-clear").click();
  await settle(900);
  await closeAll();
  await call("settings", { sourceFacetsRemember: false, sourceFacets: {} });
});

// --- #153 ------------------------------------------------------------------
await check(
  "#153 a filter deletes without a dialog; Undo brings it back",
  async () => {
    await call("settings", {
      streamFilters: [
        { id: "f4k", name: "4K only", resolution: ["4K"] },
        { id: "fhd", name: "1080p", resolution: ["1080p"] },
      ],
      activeFilter: "f4k",
    });
    await restart({ uiLanguage: "en" });
    await settingsPage("Stream filters");
    await page.locator(".filter-item").first().waitFor();
    const before = await page.locator(".filter-item").count();
    await page
      .getByRole("button", { name: "Delete the filter “4K only”" })
      .click();
    await page.locator(".toast-action").waitFor();
    assert.equal(await page.locator(".filter-item").count(), before - 1);
    assert.equal((await call("init")).settings.activeFilter, "");
    await shot("filter-undo-en");
    await page.locator(".toast-action").click();
    await settle(500);
    const after = await call("init");
    assert.deepEqual(
      after.settings.streamFilters.map((f) => f.id),
      ["f4k", "fhd"],
    );
    assert.equal(after.settings.activeFilter, "f4k");
    assert.ok(
      !problems.some((p) => p.startsWith("dialog")),
      "no confirm dialog",
    );
  },
);

// --- #152 and the badge appearance ----------------------------------------
await check(
  "#152 no badge packs page; the appearance picker instead",
  async () => {
    await restart({ uiLanguage: "en" });
    await settingsPage("badge packs", false);
    assert.equal(
      await page
        .locator(".studio-index-pages button", { hasText: /pack/i })
        .count(),
      0,
    );
    await settingsPage("Stream badges");
    await page.locator(".badge-looks").waitFor();
    assert.equal(await page.locator(".badge-look").count(), 6);
    assert.equal(
      await page
        .locator(".badge-look[aria-checked=true]")
        .textContent()
        .then((t) => /Riwaq default/.test(t)),
      true,
    );
    assert.equal(await page.getByText(/harbor/i).count(), 0);
    await shot("badge-looks-en");
  },
);

await check(
  "Liquid Glass badges, then FR Frost with a picture that fails",
  async () => {
    await restart({ uiLanguage: "en", badgeLook: "liquid", badgesOn: true });
    await openSources();
    const chip = page
      .locator(
        ".sources-modal[open] .stream-list.badges-liquid .stream-info small em",
      )
      .first();
    await chip.waitFor();
    const style = await chip.evaluate(
      (el) => getComputedStyle(el).borderRadius,
    );
    assert.match(style, /999px|9\d\dpx|px/);
    await shot("badges-liquid-en");
    await closeAll();
    // FR Frost: the pinned file, read and installed with a report.
    await settingsPage("Stream badges");
    await page.locator(".badge-look", { hasText: "FR Frost" }).click();
    await page.locator(".badge-look-card [role=status]").waitFor();
    const saved = (await call("init")).settings;
    assert.equal(saved.badgeLook, "fr-frost");
    assert.ok(saved.badgeRules.some((r) => r.pack === "FR-Badges Frost"));
    await openSources();
    const remux = page.locator(".sources-modal[open] .stream", {
      hasText: "Remux 4K",
    });
    // Pictures load; the broken one shows its name as a glass chip; the
    // built-in HEVC chip gives way to the HEVC picture.
    await remux.locator("img.badge-art").first().waitFor();
    await remux
      .locator("em.tag-fallback", { hasText: "Broken Picture" })
      .waitFor();
    const texts = await remux
      .locator(".stream-info small em")
      .allTextContents();
    assert.ok(!texts.includes("HEVC"), texts.join("|"));
    await shot("badges-fr-frost-en");
    await closeAll();
    // Back to Riwaq's own: the style's badges go, nothing else.
    await call("settings", { badgeLook: "riwaq" });
  },
);

// --- #148, #149 -----------------------------------------------------------
await check(
  "#148 one separator above Discover's tabs; the compass can hide",
  async () => {
    await restart({ uiLanguage: "en", tasteCompass: true });
    await page.locator(".riwaq-destinations > button").nth(1).click();
    await page.locator(".discover-sections").waitFor();
    const lines = await page.evaluate(() => {
      const block = document.querySelector(".discover-sections");
      const tabs = block.querySelector(".discover-tabs");
      const first = block.querySelector(".rail");
      const css = (el) => getComputedStyle(el);
      return {
        block: css(block).borderTopWidth,
        tabs: css(tabs).borderBottomWidth,
        first: css(first).borderTopWidth,
        gap:
          first.getBoundingClientRect().top -
          tabs.getBoundingClientRect().bottom,
      };
    });
    assert.equal(lines.block, "1px");
    assert.equal(lines.tabs, "0px");
    assert.equal(lines.first, "0px");
    assert.ok(lines.gap < 30, JSON.stringify(lines));
    assert.ok(await page.locator(".taste-discovery").count());
    await restart({ tasteCompass: false });
    await page.locator(".riwaq-destinations > button").nth(1).click();
    await page.locator(".discover-sections").waitFor();
    assert.equal(await page.locator(".taste-discovery").count(), 0);
    await call("settings", { tasteCompass: true });
  },
);

for (const lang of ["en", "ar"])
  await check(
    `#149 ${lang}: no empty band beside the title page's scrollbar`,
    async () => {
      await restart({ uiLanguage: lang });
      const bar = await page.evaluate(
        () => innerWidth - document.documentElement.clientWidth,
      );
      const search = async () =>
        page.locator(".riwaq-masthead input").boundingBox();
      const before = await search();
      await page.locator(".poster-card").first().click();
      await page.locator(".title-page").waitFor();
      await settle(300);
      const geo = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        return {
          width: innerWidth,
          title: r(".title-page").right,
          titleLeft: r(".title-page").left,
          mast: r(".riwaq-masthead").right,
        };
      });
      if (lang === "en")
        assert.equal(Math.round(geo.title), geo.width, JSON.stringify(geo));
      assert.equal(Math.round(geo.mast), geo.width);
      const after = await search();
      assert.ok(
        Math.abs(after.x - before.x) < 1,
        `search moved ${before.x}→${after.x} (bar ${bar})`,
      );
      await shot(`title-edge-${lang}`);
      await closeAll();
    },
  );

// --- #146 ------------------------------------------------------------------
await check(
  "#146 the wheel has no ticks and its rim ends at the icons",
  async () => {
    await restart({ uiLanguage: "en", wheelOpen: false });
    assert.equal(await page.locator(".wheel-ticks").count(), 0);
    const ends = await page.evaluate(() => {
      const path = document.querySelector(".wheel-rim-line");
      const box = path.getBBox();
      const items = [...document.querySelectorAll(".wheel-item")].map((b) =>
        b.getBoundingClientRect(),
      );
      const rim = path.getBoundingClientRect();
      return {
        top: rim.top,
        bottom: rim.bottom,
        first: Math.min(...items.map((i) => i.top + i.height / 2)),
        last: Math.max(...items.map((i) => i.top + i.height / 2)),
        box: box.height,
      };
    });
    assert.ok(ends.top >= ends.first - 2, JSON.stringify(ends));
    assert.ok(ends.bottom <= ends.last + 2, JSON.stringify(ends));
    await shot("wheel-compact-en");
  },
);

// --- Collections: moving covers, the Nuvio import, templates ---------------
// The room's list: from an open collection through "All collections",
// from elsewhere through its destination.
const collectionsRoom = async () => {
  if (await page.locator(".collection-view").count())
    await page.locator(".collection-hero .text-button").first().click();
  else if (!(await page.locator(".collections-page").count()))
    await page.locator(".riwaq-destinations > button").nth(3).click();
  await page.locator(".collections-page").waitFor();
  await settle();
};
// Opened with the keyboard and the pointer parked in a corner, so no card
// starts its GIF just because the opening click left the pointer on it.
const openReality = async () => {
  await collectionsRoom();
  await page.mouse.move(5, 5);
  const open = page
    .locator(".collection-card", { hasText: "Genres" })
    .locator(".collection-open");
  await open.focus();
  await page.keyboard.press("Enter");
  await page.locator(".folder-gallery .folder-tile").first().waitFor();
  await page.mouse.move(5, 5);
  await settle();
};

for (const lang of ["en", "ar"])
  await check(
    `collections ${lang}: a Nuvio file imports with a preview and a report`,
    async () => {
      await call("collectionsEdit", {
        action: "remove",
        collectionId: "nuvio-kaptain-genres",
      }).catch(() => {});
      await restart({ uiLanguage: lang, reduceMotion: false });
      await collectionsRoom();
      await page.locator(".collections-page .page-heading .secondary").click();
      await page.locator(".nuvio-options button").nth(2).click();
      await page.locator(".nuvio-paste").fill(NUVIO_FILE);
      await page.locator(".nuvio-modal .button-row .primary").click();
      await page.locator(".nuvio-preview").waitFor();
      assert.equal(await page.locator(".nuvio-pick input:checked").count(), 1);
      assert.equal(await page.locator(".nuvio-mode input:checked").count(), 1);
      assert.equal(
        await page
          .locator(".nuvio-mode label.selected input")
          .evaluate((el) => el.checked),
        true,
      );
      await shot(`nuvio-preview-${lang}`);
      await page.locator(".nuvio-modal .button-row .primary").click();
      await page.locator(".nuvio-report").waitFor();
      const report = await page.locator(".nuvio-report").textContent();
      assert.match(report, /1\s*(new|جديدة)/, report);
      await page.locator(".nuvio-unsupported summary").waitFor();
      await shot(`nuvio-report-${lang}`);
      await page.locator(".nuvio-modal .primary").last().click();
      const saved = (await call("init")).collections.find(
        (c) => c.id === "nuvio-kaptain-genres",
      );
      const folder = saved.folders[0];
      assert.equal(folder.cover, STILL);
      assert.equal(folder.gif, MOVING);
      assert.equal(folder.hideTitle, true);
      assert.equal(folder.unsupported.length, 1);
    },
  );

await check(
  "collections: the GIF plays only under the pointer or focus",
  async () => {
    await restart({ uiLanguage: "en", reduceMotion: false });
    gifRequests.length = 0;
    await openReality();
    const tile = page.locator(".folder-gallery .folder-tile").first();
    assert.equal(await tile.locator(".art-still").getAttribute("src"), STILL);
    assert.equal(await tile.locator(".art-gif").count(), 0);
    assert.equal(gifRequests.length, 0, "not loaded before it is wanted");
    // The name is hidden on the card but stays its accessible name.
    assert.equal(await tile.getAttribute("aria-label"), "Reality TV");
    assert.equal(await tile.locator("strong").count(), 0);
    await tile.hover();
    await tile.locator(".art-gif").waitFor();
    assert.equal(await tile.locator(".art-gif").getAttribute("src"), MOVING);
    assert.equal(
      await tile.locator(".art-still").count(),
      1,
      "the still stays under it",
    );
    await shot("folder-gif-hover-en");
    await page.mouse.move(5, 5);
    await settle(200);
    assert.equal(
      await tile.locator(".art-gif").count(),
      0,
      "it stops on leave",
    );
    // Keyboard focus plays it too; the other card stays still.
    await tile.focus();
    await tile.locator(".art-gif").waitFor();
    assert.equal(
      await page
        .locator(".folder-gallery .folder-tile")
        .nth(1)
        .locator(".art-gif")
        .count(),
      0,
    );
    await page.keyboard.press("Tab");
    await settle(200);
    assert.equal(await tile.locator(".art-gif").count(), 0);
  },
);

await check(
  "collections: reduced motion and a broken GIF keep the still",
  async () => {
    await restart({ uiLanguage: "en", reduceMotion: true });
    gifRequests.length = 0;
    await openReality();
    const tile = page.locator(".folder-gallery .folder-tile").first();
    await tile.hover();
    await settle(500);
    assert.equal(await tile.locator(".art-gif").count(), 0);
    assert.equal(gifRequests.length, 0);
    // A moving cover that fails to load: the still stays, nothing blanks.
    const saved = (await call("init")).collections.find(
      (c) => c.id === "nuvio-kaptain-genres",
    );
    await call("collectionsEdit", {
      action: "folderUpdate",
      collectionId: saved.id,
      folderId: saved.folders[0].id,
      gif: BROKEN_GIF,
    });
    await restart({ reduceMotion: false });
    await openReality();
    await tile.hover();
    await settle(600);
    assert.equal(await tile.locator(".art-gif").count(), 0);
    assert.equal(await tile.locator(".art-still").getAttribute("src"), STILL);
    await call("collectionsEdit", {
      action: "folderUpdate",
      collectionId: saved.id,
      folderId: saved.folders[0].id,
      gif: MOVING,
    });
  },
);

await check(
  "collections: the editor previews the card and refuses a .gifv",
  async () => {
    await restart({ uiLanguage: "en", reduceMotion: false });
    await openReality();
    await page
      .locator(".collection-hero .button-row .secondary")
      .first()
      .click();
    await page.locator(".folder-look").waitFor();
    assert.equal(
      await page.locator(".folder-look-preview .folder-tile").count(),
      2,
    );
    // The "under the pointer" preview plays the GIF without a pointer.
    await page
      .locator(".folder-look-preview figure")
      .nth(1)
      .locator(".art-gif")
      .waitFor();
    const gifInput = page.getByRole("textbox", { name: "Moving cover (GIF)" });
    await gifInput.fill("https://i.imgur.com/clip.gifv");
    await gifInput.press("Enter");
    await page.locator(".art-error").waitFor();
    const folder = (await call("init")).collections.find(
      (c) => c.id === "nuvio-kaptain-genres",
    ).folders[0];
    assert.equal(folder.gif, MOVING, "the GIF already set stays");
    await shot("folder-editor-en");
  },
);

await check(
  "collections: templates add whole, and the gallery switches layout",
  async () => {
    await restart({ uiLanguage: "en" });
    await collectionsRoom();
    await page
      .locator(".preset-card", { hasText: "World cinema" })
      .locator("button")
      .click();
    await page.locator(".collection-hero").waitFor();
    const world = (await call("init")).collections.find(
      (c) => c.id === "riwaq-preset-international",
    );
    assert.equal(world.folders.length, 12);
    assert.ok(world.folders.every((f) => f.tmdb.length >= 3));
    // Added again: updated in place, never copied.
    await collectionsRoom();
    await page
      .locator(".preset-card", { hasText: "World cinema" })
      .locator("button")
      .click();
    await page.locator(".collection-hero").waitFor();
    assert.equal(
      (await call("init")).collections.filter(
        (c) => c.id === "riwaq-preset-international",
      ).length,
      1,
    );
    await collectionsRoom();
    assert.ok(
      (await page
        .locator(".collection-grid .collection-card.cinematic")
        .count()) >= 2,
    );
    await shot("collections-grid-en");
    await page.locator(".collections-toolbar [role=radio]").nth(1).click();
    await page.locator(".collection-row .collection-card").first().waitFor();
    await shot("collections-row-en");
    await call("settings", { collectionsLayout: "grid" });
  },
);

for (const lang of ["ar", "en"])
  for (const scheme of ["light", "dark"])
    await check(
      `collections ${lang} ${scheme}: cards stay readable at 390–1440 px`,
      async () => {
        await restart({
          uiLanguage: lang,
          appearance: {
            ...((await call("init")).settings.appearance || {}),
            mode: scheme,
          },
        });
        // Below 761 px the wheel lives in a drawer: arrive first, then
        // narrow the window.
        await collectionsRoom();
        for (const width of [1440, 1024, 768, 390]) {
          await page.setViewportSize({ width, height: 900 });
          await settle(300);
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          );
          assert.ok(overflow <= 0, `${width}px: ${overflow}px sideways`);
          const info = page.locator(".collection-card-info").first();
          const color = await info.evaluate((el) => getComputedStyle(el).color);
          assert.equal(color, "rgb(255, 255, 255)");
          if (width === 1440 || width === 390)
            await shot(`collections-${lang}-${scheme}-${width}`);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
      },
    );
await call("settings", {
  appearance: {
    ...((await call("init")).settings.appearance || {}),
    mode: "dark",
  },
});

const unexpected = outside.filter((u) => u.startsWith(FR));
if (unexpected.length) problems.push(`FR-Badges not answered: ${unexpected}`);
console.log(`${outside.length} background requests refused (offline)`);
console.log(
  problems.length ? `page problems:\n${problems.join("\n")}` : "no page errors",
);
const passed = results.filter((r) => r.pass).length;
writeFileSync(
  join(output, "results.json"),
  JSON.stringify({ results, problems, outside }, null, 2),
);
console.log(`${passed}/${results.length} passed · evidence in ${output}`);
await browser.close();
fixture.close();
streamsAddon.close();
// The app's own background requests (Cinemeta, the notice feed, theme
// songs) are refused like in the other checks; only FR-Badges must have
// been answered locally, which the route above does.
process.exit(passed === results.length && !problems.length ? 0 : 1);
