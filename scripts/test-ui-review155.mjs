// Codex's independent review of PR #155 (docs/REVIEW-PR-155.md), its
// findings re-run in a real Chromium against the built web edition and,
// for #147, the built HUD page over a stub bridge. Each check is the
// reviewer's own case through the interface: F1 Replace after a preview,
// F2's three late writes after a profile switch, F4 a short source list,
// F5 the facts read in the panel, F6 a custom 4K picture and Off, F8 a
// real two-frame GIF in a still slot (frozen, with and without Reduced
// Motion, refused from the computer, kept in IndexedDB for the moving
// slot) and the folder page's backdrop and logo, F9 editing a template
// query and the collection limit, F10 the title page and See all edges in
// Arabic and English from 390 to 1440 px, and #147's round level.
//
//   npm run build && npm run build:web && node scripts/test-ui-review155.mjs
//
// UI_ONLY=<pattern> runs some checks. Evidence lands in .cache/ui-review155.
// Local fixtures only: nothing reaches the internet.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { deflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { loadPlaywright, startUiFixture } from "./fixtures/ui-browse-addon.mjs";
import { bytesOf } from "./fixtures/moving-images.mjs";
import { FR_BASE } from "../core/badge-look.mjs";
import { DEFAULT_SETTINGS } from "../core/protocol.mjs";
import { publicHotkeys } from "../core/hotkeys.mjs";

const { chromium } = loadPlaywright();
const site = resolve(process.env.RIWAQ_WEB_DIST || "dist-web");
const dist = resolve(process.env.RIWAQ_DIST || "dist");
const output = resolve(".cache/ui-review155");
mkdirSync(output, { recursive: true });
const fixture = await startUiFixture(site);
const { siteUrl, base } = fixture;

// --- A stream addon whose answer the check chooses -------------------------
const LONG = [
  [
    "Remux 4K",
    "Film.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1 [RD+]",
  ],
  ["Web 1080", "Film.2024.1080p.WEB-DL.DDP5.1.H.264 eng subs"],
  ["Web 720", "Film 720p WEBRip AAC مترجم"],
  ["Bare", "Film"],
  ["SDR Blu", "Film 1080p SDR BluRay DTS-HD MA 5.1 [AD download]"],
  ["Dub", "Film 1080p WEB-DL AAC 2.0 مدبلج"],
];
const SHORT = [
  ["Short 4K", "Film 2160p WEB-DL [RD+]"],
  ["Short 1080", "Film 1080p WEB-DL [TB]"],
  ["Short 720", "Film 720p WEBRip"],
];
const FACTS = [
  ["Not cached", "[RD] Not cached Film 1080p WEB-DL"],
  ["Cached", "[RD+] Film 1080p BluRay"],
  ["DTSX", "Film 2160p DTS:X 7.1"],
  ["Five", "Film 1080p DTS 5.0"],
  ["Described", "Film.2160p.REMUX", "TrueHD 7.1 · English subs"],
  ["French", "Film 1080p FRENCH"],
];
let streams = LONG;
const streamsAddon = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const url = decodeURIComponent(req.url);
  if (url === "/manifest.json")
    return res.end(
      JSON.stringify({
        id: "riwaq.review155-streams",
        name: "Review streams",
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
        streams: streams.map(([name, title, description], i) => ({
          url: `${streamsBase}/video-${i}-${name.replace(/\W/g, "")}.webm`,
          name,
          title,
          ...(description ? { description } : {}),
        })),
      }),
    );
  res.end("{}");
});
await new Promise((r) => streamsAddon.listen(0, "127.0.0.1", r));
const streamsBase = `http://127.0.0.1:${streamsAddon.address().port}`;

function png(r, g, b, w = 48, h = 18) {
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
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 2;
  const rows = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      rows.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const FR_FROST = readFileSync(
  new URL("./fixtures/fr-badges-frost.json", import.meta.url),
);
const IMG = "https://img.example/";
const MOVING_GIF = `${IMG}moving.gif`;
const CUSTOM_4K = `${IMG}my-4k.png`;
const STILL = `${IMG}still.png`;
const BACKDROP = `${IMG}backdrop.png`;
const LOGO = `${IMG}logo.png`;
let holdFr = null;

const browser = await chromium.launch({
  executablePath: process.env.RIWAQ_CHROMIUM || undefined,
  ignoreDefaultArgs: ["--hide-scrollbars"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
});
const outside = [];
await context.route(/^https?:\/\//, async (route) => {
  const url = route.request().url();
  if (new URL(url).hostname === "127.0.0.1") return route.continue();
  if (url === MOVING_GIF)
    return route.fulfill({
      status: 200,
      contentType: "image/gif",
      body: bytesOf("gif2"),
    });
  if (url === CUSTOM_4K)
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: png(250, 200, 30),
    });
  if ([STILL, BACKDROP, LOGO].includes(url))
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: png(40, 120, url === LOGO ? 220 : 160, 120, 68),
    });
  if (url.startsWith(FR_BASE)) {
    const name = url.slice(FR_BASE.length);
    if (name === "badges-frost.json") {
      if (holdFr) await holdFr.promise;
      return route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: FR_FROST,
      });
    }
    if (name.endsWith(".png"))
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: png(30, 160, 220),
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
    const error = e.message.split("\n").slice(0, 6).join(" ");
    results.push({ name, pass: false, error });
    console.log(`✗ ${name}: ${error}`);
    await page
      .screenshot({ path: join(output, `failed-${results.length}.png`) })
      .catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  }
};
const shot = (name) =>
  page.screenshot({ path: join(output, name + ".png") }).catch(() => {});
const settle = (ms = 350) => page.waitForTimeout(ms);
const restart = async (settings = {}) => {
  await call("settings", settings);
  await page.goto(siteUrl);
  await page.locator(".app").waitFor();
  if (await page.locator(".whats-new").count())
    await page.locator(".whats-new .primary").click();
  await page.locator(".poster-card").first().waitFor();
  await settle();
};
const openSources = async (n) => {
  await page.locator(".riwaq-destinations > button").nth(1).click();
  await page.locator(".poster-card").nth(n).waitFor();
  await page.locator(".poster-card").nth(n).click();
  await page.locator(".title-page").waitFor();
  await page.locator(".title-page .title-play").click();
  await page.locator(".sources-modal[open] .stream").first().waitFor();
  await settle(400);
};
const closeAll = async () => {
  for (let i = 0; i < 3; i++) await page.keyboard.press("Escape");
  await settle(300);
};
const settingsPage = async (query) => {
  await page.locator(".riwaq-destinations > button").nth(8).click();
  await page.locator(".settings-search input").fill(query);
  await settle(400);
  await page
    .locator(".studio-index-pages button", { hasText: query })
    .first()
    .click();
  await settle(400);
};
const profilesDialog = async () => {
  await page
    .locator(".riwaq-sidebar-bottom .riwaq-destination")
    .first()
    .click();
  await page.locator(".profile-grid").waitFor();
};
// The interface's way to the other profile, as a viewer does it.
const switchProfile = async () => {
  await profilesDialog();
  await page.locator(".profile-card:not(.current) .profile-pick").click();
  await settle(500);
  await page.keyboard.press("Escape");
  await settle(300);
};
const deferred = () => {
  let release;
  const promise = new Promise((r) => (release = r));
  return { promise, release };
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
const A = (await call("init")).profiles.active;
await call("profileCreate", { name: "Second" });
const B = (await call("init")).profiles.list.find((p) => p.id !== A).id;
// What each profile holds, read in that profile (switching through main).
const settingsOf = async (id) => {
  const now = (await call("init")).profiles.active;
  if (now !== id) await call("profileSwitch", { id });
  const s = (await call("init")).settings;
  if (now !== id) await call("profileSwitch", { id: now });
  return s;
};
const seed = async (id, settings) => {
  const now = (await call("init")).profiles.active;
  if (now !== id) await call("profileSwitch", { id });
  await call("settings", settings);
  if (now !== id) await call("profileSwitch", { id: now });
};
const resetProfiles = async () => {
  await call("profileSwitch", { id: B });
  await call("settings", {
    uiLanguage: "en",
    seenVersion: (await call("init")).update?.current,
    stremioBannerHidden: true,
    sourcesPopup: true,
    streamFilters: [{ id: "b720", name: "B 720", resolution: ["720p"] }],
    activeFilter: "b720",
    badgeLook: "riwaq",
    badgesOn: true,
    badgeRules: [{ id: "mine-b", label: "Mine B", pattern: "Bare" }],
    sourceFacetsRemember: true,
    sourceFacets: { quality: ["720p"] },
  });
  await call("profileSwitch", { id: A });
  await call("settings", {
    streamFilters: [
      { id: "a4k", name: "A 4K", resolution: ["4K"] },
      { id: "a1080", name: "A 1080", resolution: ["1080p"] },
    ],
    activeFilter: "a4k",
    badgeLook: "riwaq",
    badgesOn: true,
    badgeRules: [{ id: "mine-a", label: "Mine A", pattern: "Remux" }],
    sourceFacetsRemember: false,
    sourceFacets: {},
  });
};
const pick = (s) => ({
  filters: s.streamFilters.map((f) => f.id),
  active: s.activeFilter,
  look: s.badgeLook,
  rules: s.badgeRules.map((r) => r.label),
  facets: s.sourceFacets,
});

// --- F2: three late writes after a profile switch ---------------------------
await check(
  "F2 Undo after leaving Settings and switching: B untouched",
  async () => {
    await resetProfiles();
    // Read before the page loads: settingsOf switches A → B → A behind the
    // page's back, which since the second review ends the page's
    // activation, as another window's switch would.
    const beforeB = pick(await settingsOf(B));
    await restart({});
    await settingsPage("Stream filters");
    await page
      .getByRole("button", { name: "Delete the filter “A 4K”" })
      .click();
    await page.locator(".toast-action").waitFor();
    await page.locator(".riwaq-destinations > button").nth(0).click();
    await switchProfile();
    assert.equal((await call("init")).profiles.active, B);
    await page.locator(".toast-action").click();
    await settle(600);
    assert.deepEqual(
      pick(await settingsOf(B)),
      beforeB,
      "B's filters stay B's",
    );
    assert.deepEqual(
      (await settingsOf(A)).streamFilters.map((f) => f.id),
      ["a1080"],
    );
    assert.match(
      (await page
        .locator(".toast")
        .textContent()
        .catch(() => "")) || "",
      /profile changed/i,
    );
    await shot("f2-undo-refused");
  },
);

await check(
  "F2 an FR download finishing after a switch changes neither profile",
  async () => {
    await resetProfiles();
    await restart({});
    const beforeA = pick(await settingsOf(A));
    const beforeB = pick(await settingsOf(B));
    holdFr = deferred();
    await settingsPage("Stream badges");
    await page.locator(".badge-look", { hasText: "FR Frost" }).click();
    await settle(300);
    await switchProfile();
    holdFr.release();
    holdFr = null;
    await settle(1200);
    assert.deepEqual(pick(await settingsOf(B)), beforeB);
    assert.deepEqual(pick(await settingsOf(A)), beforeA);
  },
);

await check(
  "F2 a remembered-filters save pending at a switch, or after Remember goes off",
  async () => {
    await resetProfiles();
    // No saved filter narrowing the list (A's "A 4K" would hide 1080p).
    await call("settings", {
      sourceFacetsRemember: true,
      sourceFacets: {},
      activeFilter: "",
    });
    await restart({});
    streams = LONG;
    await openSources(0);
    const modal = page.locator(".sources-modal[open]");
    await modal.locator(".facet-toggle").click();
    await modal.locator(".facet", { hasText: "4K" }).first().click();
    // The switch lands inside the 500 ms the save waits.
    await call("profileSwitch", { id: B });
    await settle(1000);
    assert.deepEqual((await settingsOf(B)).sourceFacets, { quality: ["720p"] });
    await call("profileSwitch", { id: A });
    await closeAll();
    // Remember off before the save: nothing remembered.
    await restart({});
    await openSources(0);
    await modal
      .locator(".facet-toggle")
      .click()
      .catch(() => {});
    await modal.locator(".facet", { hasText: "1080p" }).first().click();
    await modal.locator(".facet-remember input").uncheck();
    await settle(1000);
    const a = await settingsOf(A);
    assert.equal(a.sourceFacetsRemember, false);
    assert.deepEqual(a.sourceFacets, {});
    await closeAll();
  },
);

// --- F4, F5 -------------------------------------------------------------------
await check(
  "F4 the advanced filters are there with three sources",
  async () => {
    await resetProfiles();
    await restart({
      sourceFacetsRemember: false,
      sourceFacets: {},
      activeFilter: "",
    });
    streams = SHORT;
    await openSources(1);
    const modal = page.locator(".sources-modal[open]");
    // This addon's three, plus the fixture addon's own one: four in all.
    const ours = modal.locator(".stream", { hasText: "Short" });
    const all = await modal.locator(".stream").count();
    assert.equal(await ours.count(), 3);
    assert.ok(all <= 4, `${all} sources`);
    assert.equal(
      await modal.locator(".source-search").count(),
      0,
      "no search under five",
    );
    await modal.locator(".facet-toggle").click();
    await modal.locator(".facet", { hasText: "4K" }).first().click();
    assert.equal(await modal.locator(".stream").count(), 1);
    await shot("f4-three-sources");
    await modal.locator(".facet-clear").click();
    assert.equal(await modal.locator(".stream").count(), all);
    await closeAll();
  },
);

await check("F5 the panel reads the facts the sources state", async () => {
  await restart({
    sourceFacetsRemember: false,
    sourceFacets: {},
    activeFilter: "",
  });
  streams = FACTS;
  await openSources(2);
  const modal = page.locator(".sources-modal[open]");
  await modal.locator(".facet-toggle").click();
  const value = (group, label) =>
    modal
      .locator(".facet-group")
      .filter({ has: page.locator("legend", { hasText: group }) })
      .locator(".facet", { hasText: label });
  // The value's own label and count elements, matched exactly.
  const count = async (group, label) => {
    const v = modal
      .locator(".facet-group")
      .filter({ has: page.locator("legend", { hasText: group }) })
      .locator(".facet")
      .filter({
        has: page.locator("span", {
          hasText: new RegExp(`^${label.replace(/[.+:]/g, "\\$&")}$`),
        }),
      });
    if (!(await v.count())) return 0;
    return Number(await v.first().locator(".facet-count").textContent());
  };
  assert.equal(await count("Source type", "Debrid not cached"), 1);
  assert.equal(await count("Source type", "Cached debrid"), 1);
  assert.equal(await count("Audio format", "DTS:X"), 1);
  assert.equal(
    await count("Audio format", "DTS"),
    1,
    "plain DTS: the 5.0 one only",
  );
  assert.equal(await count("Audio format", "TrueHD"), 1);
  assert.equal(await count("Channels", "5.0"), 1);
  assert.equal(await count("Channels", "7.1"), 2);
  assert.equal(await count("Subtitles and language", "English subtitles"), 1);
  assert.equal(await count("Subtitles and language", "French mentioned"), 1);
  await value("Source type", "Cached debrid").first().click();
  assert.deepEqual(
    (await modal.locator(".stream .stream-info b").allTextContents()).map((t) =>
      t.trim(),
    ),
    ["Cached"],
  );
  await shot("f5-facts-en");
  await closeAll();
});

// --- F6 -------------------------------------------------------------------------
await check(
  "F6 a custom 4K picture survives FR Frost and the way back; Off hides FR's badges",
  async () => {
    await resetProfiles();
    await restart({
      badgeArt: { "4k": CUSTOM_4K },
      sourceFacetsRemember: false,
    });
    await settingsPage("Stream badges");
    await page.locator(".badge-look", { hasText: "FR Frost" }).click();
    await page.locator(".badge-look-card [role=status]").waitFor();
    let s = (await call("init")).settings;
    assert.equal(s.badgeArt["4k"], CUSTOM_4K);
    assert.ok(Object.keys(s.badgeStyleArt).length > 0);
    streams = LONG;
    await openSources(3);
    const remux = page.locator(".sources-modal[open] .stream", {
      hasText: "Remux 4K",
    });
    await remux.locator(`img.badge-art[src="${CUSTOM_4K}"]`).waitFor();
    assert.ok(
      await remux.locator(`img[src^="${FR_BASE}"]`).count(),
      "FR's rule pictures show",
    );
    await closeAll();
    for (const look of [
      "Riwaq default",
      "Liquid Glass",
      "FR Frost",
      "Minimal",
    ]) {
      await settingsPage("Stream badges");
      await page.locator(".badge-look", { hasText: look }).click();
      await settle(600);
      assert.equal(
        (await call("init")).settings.badgeArt["4k"],
        CUSTOM_4K,
        look,
      );
    }
    await settingsPage("Stream badges");
    await page.locator(".badge-look", { hasText: "No badges" }).click();
    await settle(400);
    await openSources(3);
    assert.equal(
      await remux.locator(`img[src^="${FR_BASE}"]`).count(),
      0,
      "no FR picture",
    );
    assert.equal(
      await remux
        .locator(".tag-fallback, .rule-badge")
        .filter({ hasText: /HEVC|Real-Debrid/ })
        .count(),
      0,
    );
    await remux.getByText("Mine A").waitFor();
    await shot("f6-off");
    await closeAll();
    s = (await call("init")).settings;
    assert.equal(s.badgeArt["4k"], CUSTOM_4K);
    await call("settings", {
      badgesOn: true,
      badgeLook: "riwaq",
      badgeArt: {},
    });
  },
);

// --- F8 ---------------------------------------------------------------------------
const collectionsRoom = async () => {
  if (await page.locator(".collection-view").count())
    await page.locator(".collection-hero .text-button").first().click();
  else if (!(await page.locator(".collections-page").count()))
    await page.locator(".riwaq-destinations > button").nth(3).click();
  await page.locator(".collections-page").waitFor();
  await settle();
};
const makeFolder = async (look) => {
  const before = (await call("init")).collections || [];
  for (const c of before)
    await call("collectionsEdit", { action: "remove", collectionId: c.id });
  let st = await call("collectionsEdit", {
    action: "create",
    title: "Moving test",
  });
  const c = st.collections.find((x) => x.title === "Moving test");
  st = await call("collectionsEdit", {
    action: "folderAdd",
    collectionId: c.id,
    title: "Frames",
  });
  const f = st.collections.find((x) => x.id === c.id).folders[0];
  await call("collectionsEdit", {
    action: "folderAdd",
    collectionId: c.id,
    title: "Other",
  });
  await call("collectionsEdit", {
    action: "folderUpdate",
    collectionId: c.id,
    folderId: f.id,
    ...look,
  });
  return { c, f };
};
const openCollection = async () => {
  await collectionsRoom();
  await page.mouse.move(5, 5);
  const open = page
    .locator(".collection-card", { hasText: "Moving test" })
    .locator(".collection-open");
  await open.focus();
  await page.keyboard.press("Enter");
  await page.locator(".folder-gallery .folder-tile").first().waitFor();
  await page.mouse.move(5, 5);
  await settle(600);
};
const frames = async (locator, gap = 400) => {
  const a = await locator.screenshot();
  await page.waitForTimeout(gap);
  const b = await locator.screenshot();
  return a.equals(b);
};

for (const reduceMotion of [false, true])
  await check(
    `F8 a two-frame GIF in the still slot stays still (Reduced Motion ${reduceMotion ? "on" : "off"})`,
    async () => {
      await makeFolder({ cover: MOVING_GIF, gif: "" });
      await restart({ reduceMotion });
      await openCollection();
      const tile = page.locator(".folder-gallery .folder-tile").first();
      const still = tile.locator(".art-still");
      await still.waitFor();
      assert.equal(await still.evaluate((el) => el.tagName), "CANVAS");
      await page.waitForFunction(
        () =>
          document.querySelector(".folder-tile .art-still")?.dataset.ready ===
          "1",
      );
      for (let i = 0; i < 3; i++)
        assert.ok(await frames(still), `frame ${i} unchanged`);
    },
  );

await check(
  "F8 control: the same GIF moves in the moving slot under the pointer",
  async () => {
    await makeFolder({ cover: STILL, gif: MOVING_GIF, gifOn: true });
    await restart({ reduceMotion: false });
    await openCollection();
    const tile = page.locator(".folder-gallery .folder-tile").first();
    await tile.hover();
    const gif = tile.locator(".art-gif");
    await gif.waitFor();
    let moved = false;
    for (let i = 0; i < 4 && !moved; i++) moved = !(await frames(gif, 180));
    assert.ok(moved, "the fixture really animates in Chromium");
  },
);

await check(
  "F8 from this computer: a moving file is refused for the still slot, kept for the moving one, and survives a reload",
  async () => {
    const { c, f } = await makeFolder({ cover: STILL, gif: "" });
    await restart({ uiLanguage: "ar", reduceMotion: false });
    await openCollection();
    await page
      .locator(".collection-hero .button-row .secondary")
      .first()
      .click();
    await page.locator(".folder-look").waitFor();
    const choose = async (label, name, bytes) => {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page
          .getByRole("button", { name: `${label}: اختر صورة من جهازك` })
          .click(),
      ]);
      await chooser.setFiles({ name, mimeType: "image/gif", buffer: bytes });
      await settle(700);
    };
    await choose("الغلاف الثابت", "moving.gif", bytesOf("gif2"));
    await page.locator(".toast", { hasText: "صورة متحركة" }).waitFor();
    let folder = (await call("init")).collections
      .find((x) => x.id === c.id)
      .folders.find((x) => x.id === f.id);
    assert.equal(folder.cover, STILL, "the still cover stays");
    await choose("الغلاف المتحرك (GIF)", "moving.gif", bytesOf("gif2"));
    folder = (await call("init")).collections
      .find((x) => x.id === c.id)
      .folders.find((x) => x.id === f.id);
    assert.match(folder.gif, /^local:[a-f\d]{32}$/);
    // A one-frame GIF is a still picture: accepted in the still slot.
    await choose("الغلاف الثابت", "still.gif", bytesOf("gif1"));
    folder = (await call("init")).collections
      .find((x) => x.id === c.id)
      .folders.find((x) => x.id === f.id);
    assert.match(folder.cover, /^local:[a-f\d]{32}$/);
    await restart({ uiLanguage: "en" });
    await openCollection();
    const tile = page.locator(".folder-gallery .folder-tile").first();
    await tile.hover();
    await tile.locator(".art-gif").waitFor();
    assert.match(await tile.locator(".art-gif").getAttribute("src"), /^blob:/);
    // The other profile cannot read these pictures by their IDs.
    await call("profileSwitch", { id: B });
    assert.equal(await call("collectionArt", { id: folder.gif }), "");
    await call("profileSwitch", { id: A });
    assert.match(await call("collectionArt", { id: folder.gif }), /^blob:/);
  },
);

await check(
  "F8 the folder page shows its own backdrop and title logo",
  async () => {
    await makeFolder({ cover: STILL, backdrop: BACKDROP, logo: LOGO });
    await restart({ uiLanguage: "en" });
    await openCollection();
    await page.locator(".folder-page-link").click();
    await page.locator(".folder-page").waitFor();
    await settle(500);
    // A PNG may be an APNG, so both are drawn as their first frame (second
    // review, R7): canvases, drawn once loaded.
    const backdrop = page.locator(".folder-hero-backdrop");
    assert.equal(await backdrop.evaluate((el) => el.tagName), "CANVAS");
    await page.waitForFunction(
      () =>
        document.querySelector(".folder-hero-backdrop")?.dataset.ready === "1",
    );
    const logo = page.locator(".folder-hero-logo canvas");
    await logo.waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".folder-hero-logo canvas")?.dataset.ready ===
        "1",
    );
    assert.equal(await logo.getAttribute("aria-label"), "Frames");
    await shot("f8-folder-page");
  },
);

// --- F1 ----------------------------------------------------------------------------
await check(
  "F1 Replace after a preview of a collection without an ID",
  async () => {
    await makeFolder({ cover: STILL });
    await restart({ uiLanguage: "en" });
    await collectionsRoom();
    await page.locator(".collections-page .page-heading .secondary").click();
    await page.locator(".nuvio-options button").nth(2).click();
    await page.locator(".nuvio-paste").fill(
      JSON.stringify([
        {
          title: "From the phone",
          folders: [
            {
              title: "Picks",
              sources: [
                {
                  provider: "addon",
                  addonId: "x.y",
                  type: "movie",
                  catalogId: "c",
                },
              ],
            },
          ],
        },
      ]),
    );
    await page.locator(".nuvio-modal .button-row .primary").click();
    await page.locator(".nuvio-preview").waitFor();
    assert.equal(await page.locator(".nuvio-pick input:checked").count(), 1);
    await page.locator(".nuvio-mode label").nth(2).click();
    await page.locator(".nuvio-modal .button-row .primary").click();
    await page.locator(".nuvio-report").waitFor();
    const titles = (await call("init")).collections.map((x) => x.title);
    assert.deepEqual(titles, ["From the phone"], "replaced, not emptied");
    await shot("f1-replace-report");
    await page.keyboard.press("Escape");
    // Nothing chosen: the import cannot start.
    await page.locator(".collections-page .page-heading .secondary").click();
    await page.locator(".nuvio-options button").nth(2).click();
    await page.locator(".nuvio-paste").fill('[{"title":"Only","folders":[]}]');
    await page.locator(".nuvio-modal .button-row .primary").click();
    await page.locator(".nuvio-pick input").uncheck();
    await page.locator(".nuvio-mode label").nth(2).click();
    assert.equal(
      await page.locator(".nuvio-modal .button-row .primary").isDisabled(),
      true,
    );
    await page.keyboard.press("Escape");
    assert.deepEqual(
      (await call("init")).collections.map((x) => x.title),
      ["From the phone"],
    );
  },
);

// --- Q8 (fifth pass) ---------------------------------------------------------------
for (const uiLanguage of ["ar", "en"])
  await check(
    `Q8 a b9d946e folder under a matching collection is asked about before Merge (${uiLanguage})`,
    async () => {
      for (const c of (await call("init")).collections)
        await call("collectionsEdit", { action: "remove", collectionId: c.id });
      // The viewer's collection "nuvio-parent" with its folder
      // "nuvio-riwaq-folder", as an earlier Nuvio import stored them.
      const st = await call("init");
      await call("importNuvioCollections", {
        text: JSON.stringify([
          {
            id: "parent",
            title: "My collection",
            folders: [
              {
                id: "nuvio-riwaq-folder",
                title: "My folder",
                sources: [
                  {
                    provider: "tmdb",
                    tmdbSourceType: "discover",
                    filters: { withGenres: "18" },
                  },
                ],
              },
            ],
          },
        ]),
        mode: "replace",
        profileSession: st.profiles.session,
      });
      await restart({ uiLanguage });
      await collectionsRoom();
      await page.locator(".collections-page .page-heading .secondary").click();
      await page.locator(".nuvio-options button").nth(2).click();
      // What b9d946e exported for it: "nuvio-riwaq-folder" as "riwaq-folder".
      await page.locator(".nuvio-paste").fill(
        JSON.stringify([
          {
            id: "parent",
            title: "My collection",
            folders: [
              {
                id: "riwaq-folder",
                title: "My folder",
                sources: [
                  {
                    provider: "tmdb",
                    tmdbSourceType: "discover",
                    filters: { withGenres: "18" },
                  },
                ],
              },
            ],
          },
        ]),
      );
      await page.locator(".nuvio-modal .button-row .primary").click();
      await page.locator(".nuvio-legacy").waitFor();
      const rows = page.locator(".nuvio-legacy [role=radiogroup]");
      assert.equal(await rows.count(), 1);
      assert.equal(
        await page
          .getByRole("radiogroup", { name: "My folder", exact: true })
          .count(),
        1,
        "the legacy choice names the folder in the accessibility tree",
      );
      const update = await rows.first().locator("label").first().innerText();
      assert.match(
        update,
        uiLanguage === "en"
          ? /Update my folder “My folder” in “My collection”/
          : /حدّث مجلدي «My folder» في «My collection»/,
      );
      const import_ = page.locator(".nuvio-modal .button-row .primary");
      assert.equal(await import_.isDisabled(), true, "unanswered: no import");
      await rows.first().scrollIntoViewIfNeeded();
      await shot(`q8-legacy-folder-${uiLanguage}`);
      await rows.first().locator("label").first().click();
      assert.equal(await import_.isDisabled(), false);
      await import_.click();
      await page.locator(".nuvio-report").waitFor();
      const [mine] = (await call("init")).collections;
      assert.deepEqual(
        mine.folders.map((f) => f.id),
        ["nuvio-riwaq-folder"],
        "updated, not copied",
      );
      await page.keyboard.press("Escape");
    },
  );

// --- F9 -----------------------------------------------------------------------------
await check("F9 a template query is edited through its form", async () => {
  for (const c of (await call("init")).collections)
    await call("collectionsEdit", { action: "remove", collectionId: c.id });
  await call("collectionsEdit", { action: "preset", preset: "based" });
  await restart({ uiLanguage: "en" });
  await collectionsRoom();
  await page
    .locator(".collection-card")
    .first()
    .locator(".collection-open")
    .click();
  await page.locator(".collection-hero .button-row .secondary").first().click();
  const edit = page.getByRole("button", { name: /^Edit the query:/ }).first();
  await edit.click();
  const form = page.locator(".discover-form");
  await form.waitFor();
  await form.getByLabel("Keywords (TMDB numbers)").fill("9672");
  await form.getByLabel("Year").fill("2015");
  await form.locator("select").nth(1).selectOption("vote_average.desc");
  await form.locator(".discover-genres input").first().check();
  await shot("f9-query-form");
  await form.getByRole("button", { name: "Save the query" }).click();
  await form.waitFor({ state: "detached" });
  const t = (await call("init")).collections[0].folders[0].tmdb[0];
  assert.equal(t.filters.withKeywords, "9672");
  assert.equal(t.filters.year, 2015);
  assert.equal(t.sort, "vote_average.desc");
  assert.ok(t.filters.withGenres);
  // A bad value is refused with its name; nothing changes.
  await edit.click();
  await form.getByLabel("Keywords (TMDB numbers)").fill("nine");
  await form.getByRole("button", { name: "Save the query" }).click();
  // Named in the form itself, where it was typed (second review, R9).
  await form
    .locator('[role="alert"]', { hasText: "Keywords (TMDB numbers)" })
    .waitFor();
  await form.getByRole("button", { name: "Cancel" }).click();
  assert.equal(
    (await call("init")).collections[0].folders[0].tmdb[0].filters.withKeywords,
    "9672",
  );
});

await check(
  "F9 at the collection limit a template is refused, never announced as added",
  async () => {
    for (const c of (await call("init")).collections)
      await call("collectionsEdit", { action: "remove", collectionId: c.id });
    // The interface always names its activation (fourth pass, N12).
    await call("importNuvioCollections", {
      text: JSON.stringify(
        Array.from({ length: 60 }, (_, i) => ({
          id: `n${i}`,
          title: `Full ${i}`,
          folders: [],
        })),
      ),
      mode: "add",
      profileSession: (await call("init")).profiles.session,
    });
    assert.equal((await call("init")).collections.length, 60);
    await restart({ uiLanguage: "en" });
    await collectionsRoom();
    await page
      .locator(".preset-card", { hasText: "World cinema" })
      .locator("button")
      .click();
    await page.locator(".toast", { hasText: /maximum/i }).waitFor();
    assert.equal(
      await page.locator(".toast", { hasText: /added/i }).count(),
      0,
    );
    assert.equal((await call("init")).collections.length, 60);
    for (const c of (await call("init")).collections)
      await call("collectionsEdit", { action: "remove", collectionId: c.id });
  },
);

// --- F10 ------------------------------------------------------------------------------
for (const lang of ["ar", "en"])
  await check(
    `F10 ${lang}: the title page and See all reach the window's edges, 390–1440 px`,
    async () => {
      const out = [];
      for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 860 });
        await restart({ uiLanguage: lang });
        for (const layer of ["title", "browse"]) {
          if (layer === "title") {
            await page.locator(".poster-card").first().click();
            await page.locator(".title-page").waitFor();
          } else {
            await page
              .locator(".smart-shelf .rail-tools .text-button")
              .first()
              .click();
            await page.locator(".browse-page").waitFor();
          }
          await settle(400);
          const g = await page.evaluate(
            (sel) => {
              const r = (s) =>
                document.querySelector(s)?.getBoundingClientRect();
              const side = r(".app > .riwaq-sidebar");
              const shown =
                side &&
                side.width > 0 &&
                getComputedStyle(
                  document.querySelector(".app > .riwaq-sidebar"),
                ).display !== "none";
              return {
                w: innerWidth,
                layer: r(sel),
                side: shown ? { left: side.left, right: side.right } : null,
                mast: r(".riwaq-masthead"),
                dir: document.documentElement.dir,
              };
            },
            layer === "title" ? ".title-page" : ".browse-page",
          );
          out.push({ lang, width, layer, ...g });
          const near = (a, b) => Math.abs(a - b) <= 1;
          const { layer: box, side, w } = g;
          if (!side) {
            assert.ok(
              near(box.left, 0) && near(box.right, w),
              `${layer} ${width}: ${JSON.stringify(box)}`,
            );
          } else if (g.dir === "rtl") {
            assert.ok(
              near(box.left, 0),
              `${layer} ${width} rtl left: ${box.left}`,
            );
            assert.ok(
              near(box.right, side.left),
              `${layer} ${width} rtl: ${box.right} vs sidebar ${side.left}`,
            );
          } else {
            assert.ok(
              near(box.right, w),
              `${layer} ${width} ltr right: ${box.right}/${w}`,
            );
            assert.ok(
              near(box.left, side.right),
              `${layer} ${width} ltr: ${box.left} vs sidebar ${side.right}`,
            );
          }
          assert.ok(near(g.mast.right, w), `masthead ${width}`);
          if (width === 390) await shot(`f10-${layer}-${lang}-390`);
          await page.keyboard.press("Escape");
          await settle(300);
        }
      }
      writeFileSync(
        join(output, `f10-${lang}.json`),
        JSON.stringify(out, null, 2),
      );
    },
  );

// --- #147: the round level, by where the change came from -----------------------------
await check(
  "#147 a key right after the slider shows the round level; the slider alone does not",
  async () => {
    const TYPES = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".woff2": "font/woff2",
    };
    const server = createServer((req, res) => {
      let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (path === "/") path = "/index.html";
      const file = join(dist, path);
      if (!file.startsWith(dist + sep) || !existsSync(file)) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "" });
      res.end(readFileSync(file));
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const hud = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    try {
      const state = {
        settings: { ...DEFAULT_SETTINGS, uiLanguage: "en" },
        progress: {},
        hotkeys: publicHotkeys({}),
      };
      const player = {
        active: true,
        name: "Fixture",
        videoId: "tt0000001",
        mediaType: "movie",
        meta: { id: "tt0000001", type: "movie", name: "Fixture" },
        position: 100,
        duration: 6400,
        volume: 60,
        volumeMax: 150,
        speed: 1,
        pause: false,
        tracks: [],
        chapters: [],
      };
      await hud.addInitScript(
        ({ state, player }) => {
          try {
            localStorage.setItem("riwaq.language", "en");
          } catch {}
          window.__calls = [];
          const listeners = {};
          window.__emit = (event, value) =>
            listeners[event]?.forEach((fn) => fn(value));
          window.riwaq = {
            call: async (method, args) => {
              window.__calls.push([method, args]);
              if (method === "hudSnapshot") return { state, player };
              if (method === "subtitles") return [];
              if (method === "playerSources") return { streams: [] };
              return true;
            },
            on: (event, fn) => {
              (listeners[event] ||= []).push(fn);
              return () => {};
            },
          };
        },
        { state, player },
      );
      await hud.goto(`http://127.0.0.1:${server.address().port}/#hud`);
      await hud.waitForSelector(".hud-bottom");
      const emit = (patch) =>
        hud.evaluate((p) => window.__emit("player", p), {
          ...player,
          ...patch,
        });
      const osd = hud.locator(".volume-osd");
      // The slider (keyboard on it): no round level.
      await hud.mouse.move(640, 300);
      await hud.mouse.move(650, 310);
      await hud.waitForTimeout(200);
      await hud.hover(".volume-button");
      await hud.waitForTimeout(250);
      const slider = hud.getByRole("slider");
      await slider.focus();
      await hud.keyboard.press("ArrowUp");
      const sent = await hud.evaluate(
        () =>
          window.__calls
            .filter(([m, a]) => m === "playerCommand" && a?.action === "volume")
            .at(-1)?.[1]?.value,
      );
      await emit({ volume: sent });
      await hud.waitForTimeout(200);
      assert.equal(await osd.count(), 0, "the slider's own change");
      // A volume key 100 ms later (inside the old 800 ms window).
      await slider.blur();
      await hud.mouse.move(640, 300);
      await hud.keyboard.press("ArrowDown");
      await emit({ volume: sent - 5 });
      await osd.waitFor({ timeout: 800 });
      assert.equal((await osd.textContent()).trim(), `${sent - 5}%`);
      // Rapid keys: one level, following the last value.
      for (const v of [sent - 10, sent - 15, sent - 20]) {
        await hud.keyboard.press("ArrowDown");
        await emit({ volume: v });
      }
      await hud.waitForTimeout(100);
      assert.equal(await osd.count(), 1);
      assert.equal((await osd.textContent()).trim(), `${sent - 20}%`);
      // Mute from the key: shown; mute from the bar's button: not.
      await hud.waitForTimeout(1300);
      await hud.keyboard.press("m");
      await emit({ volume: sent - 20, muted: true });
      await osd.waitFor({ timeout: 800 });
      await hud.waitForTimeout(1300);
      // Wake the controls (they slept meanwhile), then the bar's button.
      await hud.mouse.move(640, 300);
      await hud.mouse.move(650, 310);
      await hud.waitForTimeout(200);
      await hud.hover(".volume-button");
      await hud.locator(".volume-button").click();
      await emit({ volume: sent - 20, muted: false });
      await hud.waitForTimeout(250);
      assert.equal(await osd.count(), 0, "the bar's own mute button");
    } finally {
      await hud.close();
      server.close();
    }
  },
);

console.log(`${outside.length} background requests refused (offline)`);
console.log(
  problems.length ? `page problems:\n${problems.join("\n")}` : "no page errors",
);
const passed = results.filter((r) => r.pass).length;
writeFileSync(
  join(output, "results.json"),
  JSON.stringify({ results, problems }, null, 2),
);
console.log(`${passed}/${results.length} passed · evidence in ${output}`);
await browser.close();
fixture.close();
streamsAddon.close();
process.exit(passed === results.length && !problems.length ? 0 : 1);
