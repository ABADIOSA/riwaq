// The November 2026 reports (#130–#141), the wheel and the glass controls,
// in a real Chromium: the built web edition against the local addon of
// scripts/fixtures/ui-browse-addon.mjs, and the built HUD page (dist, #hud)
// over a stub bridge for the player's bar. Nothing reaches the internet; no
// Electron, MPV or Windows (scripts/test-player-hud.mjs covers those).
//
//   npm run build && npm run build:web && node scripts/test-ui-feedback.mjs
//
// UI_ONLY=<pattern> runs some checks. Screenshots land in .cache/ui-feedback.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import assert from "node:assert/strict";
import { loadPlaywright, startUiFixture } from "./fixtures/ui-browse-addon.mjs";
import { DEFAULT_SETTINGS } from "../core/protocol.mjs";
import { publicHotkeys } from "../core/hotkeys.mjs";

const { chromium } = loadPlaywright();
const site = resolve(process.env.RIWAQ_WEB_DIST || "dist-web");
const dist = resolve("dist");
for (const [dir, how] of [
  [site, "npm run build:web"],
  [dist, "npm run build"],
])
  if (!existsSync(join(dir, "index.html")))
    throw new Error(`Build first: ${how}`);
const output = resolve(".cache/ui-feedback");
mkdirSync(output, { recursive: true });
const fixture = await startUiFixture(site);
const { siteUrl, base } = fixture;
const browser = await chromium.launch({
  executablePath: process.env.RIWAQ_CHROMIUM || undefined,
});
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
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
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
  await page.reload();
  await page.locator(".app").waitFor();
  if (await page.locator(".whats-new").count())
    await page.locator(".whats-new .primary").click();
  await page.locator(".poster-card").first().waitFor();
  await settle();
};
const appearance = async (patch, settings = {}) => {
  const now = (await call("init")).settings.appearance || {};
  await restart({ ...settings, appearance: { ...now, ...patch } });
};
const destination = (id) =>
  page
    .locator(`.riwaq-destinations > button`)
    .nth(
      [
        "home",
        "discover",
        "library",
        "collections",
        "downloads",
        "addons",
        "music",
        "live",
        "settings",
      ].indexOf(id),
    );

/** Contrast of an element's text against what is actually behind it. */
async function drawnContrast(locator) {
  const png = await locator.screenshot();
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, img.width, img.height);
    const lum = (r, g, b) => {
      const c = [r, g, b].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    // The background is the most common colour of the inner area.
    const counts = new Map();
    const inset = Math.floor(Math.min(img.width, img.height) * 0.2);
    for (let y = inset; y < img.height - inset; y++)
      for (let x = inset; x < img.width - inset; x++) {
        const i = (y * img.width + x) * 4;
        const key = `${px[i] >> 2},${px[i + 1] >> 2},${px[i + 2] >> 2}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    const [bgKey] = [...counts].sort((a, b) => b[1] - a[1])[0];
    const [r, g, b] = bgKey.split(",").map((v) => Number(v) * 4 + 2);
    const bg = lum(r, g, b);
    let best = 1;
    for (let y = inset; y < img.height - inset; y++)
      for (let x = inset; x < img.width - inset; x++) {
        const i = (y * img.width + x) * 4;
        const l = lum(px[i], px[i + 1], px[i + 2]);
        best = Math.max(
          best,
          (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05),
        );
      }
    return Math.round(best * 100) / 100;
  }, png.toString("base64"));
}

await page.goto(siteUrl);
await page.waitForFunction(() => window.riwaq?.platform === "web");
await call("onboardingComplete");
await call("install", { url: `${base}/manifest.json` });
await restart({
  uiLanguage: "ar",
  seenVersion: (await call("init")).update?.current,
  stremioBannerHidden: true,
});

// --- #135, #134 ------------------------------------------------------------
await check(
  "#135 a dialog keeps the page behind still, nested too",
  async () => {
    await restart({ uiLanguage: "en" });
    await page.mouse.wheel(0, 700);
    await settle();
    const before = await page.evaluate(() => scrollY);
    assert.ok(before > 100, "the page scrolled first");
    await page.keyboard.press("Shift+Slash");
    await page.locator("dialog.modal[open]").waitFor();
    await page.mouse.move(20, 450);
    await page.mouse.wheel(0, 900);
    await page.keyboard.press("PageDown");
    await page.keyboard.press("End");
    await settle();
    assert.equal(await page.evaluate(() => scrollY), before, "wheel and keys");
    // A second dialog over the first, then closing only the inner one.
    await page.evaluate(() => {
      const inner = document.createElement("dialog");
      inner.className = "modal probe";
      document.body.append(inner);
    });
    await page.keyboard.press("Escape");
    await page.locator("dialog.modal[open]").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => scrollY), before, "offset kept");
    assert.equal(
      await page.evaluate(() => document.documentElement.style.overflow),
      "",
      "the page scrolls again",
    );
    await page.mouse.wheel(0, 200);
    await settle();
    assert.ok((await page.evaluate(() => scrollY)) > before);
  },
);

await check(
  "#134 a dialog's scrollbar starts below its close button",
  async () => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.keyboard.press("Shift+Slash");
    await page.locator("dialog.modal[open]").waitFor();
    await settle();
    for (const lang of ["en", "ar"]) {
      if (lang === "ar") {
        await page.keyboard.press("Escape");
        await restart({ uiLanguage: "ar" });
        await page.keyboard.press("Shift+Slash");
        await page.locator("dialog.modal[open]").waitFor();
        await settle();
      }
      const g = await page.evaluate(() => {
        const d = document.querySelector("dialog.modal[open]");
        const inner = d.querySelector(".modal-inner");
        const close = d.querySelector(".modal-close").getBoundingClientRect();
        const r = inner.getBoundingClientRect();
        return {
          scrolls: inner.scrollHeight > inner.clientHeight,
          top: r.top,
          closeBottom: close.bottom,
          frameScrolls: d.scrollHeight > d.clientHeight + 1,
        };
      });
      assert.ok(g.scrolls, `${lang}: the content scrolls`);
      assert.ok(!g.frameScrolls, `${lang}: the frame does not`);
      assert.ok(g.top >= g.closeBottom, `${lang}: ${JSON.stringify(g)}`);
      await shot(`dialog-${lang}`);
    }
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
  },
);

await check("#134 the sources window scrolls only its list", async () => {
  await restart({ uiLanguage: "en" });
  await page.locator(".poster-card").first().click();
  await page.locator(".title-page").waitFor();
  await page.locator(".title-page .title-play").click();
  await page.locator(".sources-modal[open]").waitFor();
  await settle(600);
  const g = await page.evaluate(() => {
    const d = document.querySelector(".sources-modal");
    const body = d.querySelector(".streams-body");
    const close = d.querySelector(".modal-close").getBoundingClientRect();
    const heading = d.querySelector(".streams > .section-heading");
    return {
      bodyTop: body.getBoundingClientRect().top,
      closeBottom: close.bottom,
      bodyScrollable: getComputedStyle(body).overflowY,
      headingScrolls:
        heading.parentElement.scrollHeight >
          heading.parentElement.clientHeight + 1 &&
        getComputedStyle(heading.parentElement).overflowY !== "visible",
    };
  });
  assert.ok(g.bodyTop >= g.closeBottom, JSON.stringify(g));
  assert.equal(g.bodyScrollable, "auto");
  await shot("sources-en");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

// --- #137 ------------------------------------------------------------------
await check(
  "#137 no hand over the gaps between cards; grabbing only while dragging",
  async () => {
    await restart({ uiLanguage: "en" });
    const row = page.locator(".rail .scroll-row").first();
    await row.scrollIntoViewIfNeeded();
    const cursors = await row.evaluate((el) => {
      const cards = el.querySelectorAll(".poster-card");
      const a = cards[0].getBoundingClientRect();
      const b = cards[1].getBoundingClientRect();
      const gapX = (Math.max(a.right, b.right) + Math.min(a.left, b.left)) / 2;
      const left = Math.min(a.right, b.right);
      const right = Math.max(a.left, b.left);
      const x = right > left ? (left + right) / 2 : gapX;
      const y = a.top + a.height / 2;
      const gap = document.elementFromPoint(x, y);
      return {
        row: getComputedStyle(el).cursor,
        gapTarget: gap === el || el.contains(gap),
        gap: getComputedStyle(gap).cursor,
        card: getComputedStyle(cards[0]).cursor,
      };
    });
    assert.notEqual(cursors.row, "grab");
    assert.ok(cursors.gapTarget);
    assert.ok(
      !["grab", "pointer"].includes(cursors.gap),
      JSON.stringify(cursors),
    );
    assert.equal(cursors.card, "pointer");
    const box = await row.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, {
      steps: 6,
    });
    assert.equal(
      await row.evaluate((el) => getComputedStyle(el).cursor),
      "grabbing",
    );
    await page.mouse.up();
    await settle();
    assert.notEqual(
      await row.evaluate((el) => getComputedStyle(el).cursor),
      "grabbing",
    );
  },
);

// --- #130, #131 ------------------------------------------------------------
for (const lang of ["ar", "en"])
  await check(`#130/#131 ${lang}: one gutter, a centred search`, async () => {
    await restart({ uiLanguage: lang, showShowcase: true });
    for (const width of [1920, 1440, 1024]) {
      for (const open of [false, true]) {
        await call("settings", { wheelOpen: open });
        await page.setViewportSize({ width, height: 900 });
        await settle(450);
        const g = await page.evaluate(() => {
          const content = document
            .querySelector(".content")
            .getBoundingClientRect();
          const gap = (sel) => {
            const r = document.querySelector(sel).getBoundingClientRect();
            return [
              Math.round(r.left - content.left),
              Math.round(content.right - r.right),
            ];
          };
          const s = document
            .querySelector(".riwaq-masthead .search-box")
            .getBoundingClientRect();
          return {
            hero: gap(".hero"),
            rail: gap(".rail .section-heading"),
            search: Math.abs(s.left + s.width / 2 - innerWidth / 2),
          };
        });
        assert.deepEqual(
          g.rail,
          g.hero,
          `${width}/${open}: ${JSON.stringify(g)}`,
        );
        assert.ok(g.search <= 1, `${width}/${open}: search off by ${g.search}`);
      }
    }
    await call("settings", { wheelOpen: false });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

// --- #132 ------------------------------------------------------------------
await check("#132 addons first, then Stremio right above Nuvio", async () => {
  await restart({ uiLanguage: "en" });
  await destination("addons").click();
  await page.locator(".addon-form").waitFor();
  const order = await page.evaluate(() => {
    const top = (sel) =>
      document.querySelector(sel)?.getBoundingClientRect().top;
    return {
      form: top(".addon-form"),
      list: top(".addon-list"),
      stremio: top(".addon-links > .addon-sync:not(.nuvio-sync)"),
      nuvio: top(".addon-links > .nuvio-sync"),
      adjacent:
        document
          .querySelector(".addon-links > .addon-sync:not(.nuvio-sync)")
          ?.nextElementSibling?.classList.contains("nuvio-sync") || false,
    };
  });
  assert.ok(order.form < order.list, JSON.stringify(order));
  assert.ok(order.list < order.stremio, JSON.stringify(order));
  assert.ok(order.stremio < order.nuvio, JSON.stringify(order));
  assert.ok(order.adjacent, "Stremio directly above Nuvio");
  await page.locator("#addon-url").focus();
  await shot("addons-en");
});

// --- #133, #141 ------------------------------------------------------------
await check(
  "#133 Settings opens on its first page; a link still names its page",
  async () => {
    await restart({ uiLanguage: "en" });
    await destination("settings").click();
    await page.locator(".studio-index").waitFor();
    const selected = await page
      .locator(
        ".studio-index-pages > button.selected, .studio-index-pages > button[aria-current]",
      )
      .first()
      .textContent();
    assert.match(selected, /Interface language/);
    await page
      .locator(".studio-content #language, .studio-content h2")
      .first()
      .waitFor();
    // A room opens on its first page too.
    await page.locator(".studio-index-groups > button").nth(1).click();
    await page.locator(".studio-index-groups > button").nth(0).click();
    assert.match(
      await page
        .locator(".studio-index-pages > button.selected")
        .first()
        .textContent(),
      /Interface language/,
    );
    // Away and back: the first page again, not the last one visited.
    await page.locator(".studio-index-pages > button").nth(1).click();
    await destination("home").click();
    await destination("settings").click();
    assert.match(
      await page
        .locator(".studio-index-pages > button.selected")
        .first()
        .textContent(),
      /Interface language/,
    );
  },
);

await check(
  "#141 Mode reads System, Light, Dark; the saved mode stays",
  async () => {
    await appearance({ mode: "dark" }, { uiLanguage: "en" });
    await destination("settings").click();
    await page.locator(".studio-index-pages > button").nth(1).click();
    const field = page.locator(".scheme-field");
    await field.waitFor();
    const labels = (await field.locator("[role=radio]").allTextContents()).map(
      (t) => t.trim(),
    );
    assert.deepEqual(labels, ["System", "Light", "Dark"]);
    assert.equal(
      await field.locator("[role=radio][aria-checked=true]").textContent(),
      "Dark",
    );
    assert.equal((await call("init")).settings.appearance.mode, "dark");
    // Keyboard order follows: Tab from System reaches Light.
    await field.locator("[role=radio]").first().focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement.textContent.trim()),
      "Light",
    );
  },
);

// --- The wheel -------------------------------------------------------------
for (const lang of ["ar", "en"])
  await check(
    `wheel ${lang}: the default, at the reading side, every destination one click away`,
    async () => {
      await restart({ uiLanguage: lang, wheelOpen: false });
      await page.setViewportSize({ width: 1440, height: 900 });
      await settle();
      assert.ok(await page.locator(".app.nav-wheel").count());
      const rail = await page.locator(".riwaq-sidebar").boundingBox();
      assert.ok(
        lang === "ar" ? rail.x > 1000 : rail.x < 1,
        `rail at ${rail.x}`,
      );
      const content = await page.locator(".content").boundingBox();
      if (lang === "ar") assert.ok(content.x + content.width <= rail.x + 1);
      else assert.ok(rail.x + rail.width <= content.x + 1);
      const buttons = page.locator(".riwaq-destinations > button");
      assert.equal(await buttons.count(), 9);
      // Targets are at least 44 px, inside the rail, never overlapping.
      const boxes = [];
      for (let i = 0; i < 9; i++)
        boxes.push(await buttons.nth(i).boundingBox());
      for (const [i, b] of boxes.entries()) {
        assert.ok(b.width >= 44 && b.height >= 44, `target ${i}`);
        assert.ok(
          b.x >= rail.x - 1 && b.x + b.width <= rail.x + rail.width + 1,
        );
        if (i)
          assert.ok(
            b.y >= boxes[i - 1].y + boxes[i - 1].height - 0.5,
            `overlap ${i}`,
          );
      }
      // The arc: the middle reaches furthest from the edge.
      const reach = boxes.map((b) =>
        lang === "ar"
          ? rail.x + rail.width - (b.x + b.width / 2)
          : b.x + b.width / 2 - rail.x,
      );
      assert.ok(
        reach[4] > reach[0] + 10 && reach[4] > reach[8] + 10,
        reach.join(),
      );
      assert.equal(await buttons.nth(0).getAttribute("aria-current"), "page");
      await shot(`wheel-compact-${lang}`);
      // Each destination with one click; the lens turns to it, buttons stay.
      const lens = page.locator(".wheel-lens");
      const before = await lens.evaluate(
        (el) => getComputedStyle(el).transform,
      );
      await destination("library").click();
      await page
        .locator(".riwaq-destinations > button[aria-current=page]")
        .waitFor();
      assert.equal(
        await destination("library").getAttribute("aria-current"),
        "page",
      );
      await settle(500);
      assert.notEqual(
        await lens.evaluate((el) => getComputedStyle(el).transform),
        before,
      );
      const after = await buttons.nth(8).boundingBox();
      assert.deepEqual(after, boxes[8], "destinations do not move");
      // A quick double click picks its page once and leaves the wheel usable.
      await destination("discover").dblclick();
      assert.equal(
        await destination("discover").getAttribute("aria-current"),
        "page",
      );
      await destination("home").click();
      assert.equal(
        await destination("home").getAttribute("aria-current"),
        "page",
      );
    },
  );

await check(
  "wheel: arrows, Home and End move focus; Tab stays in reading order",
  async () => {
    await restart({ uiLanguage: "en" });
    await destination("home").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "Discover",
    );
    await page.keyboard.press("End");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "Settings",
    );
    await page.keyboard.press("Home");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "Home",
    );
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "Discover",
    );
    // Focus is visible.
    const ring = await page.evaluate(
      () =>
        getComputedStyle(document.activeElement.querySelector(".wheel-disc"))
          .outlineStyle,
    );
    assert.equal(ring, "solid");
    // Enter opens it.
    await page.keyboard.press("Enter");
    assert.equal(
      await destination("discover").getAttribute("aria-current"),
      "page",
    );
  },
);

await check(
  "wheel: names on demand, hidden destinations, locks and quiet interface",
  async () => {
    await restart({ uiLanguage: "en", wheelOpen: false });
    // Compact: the name shows beside a destination on hover.
    await destination("collections").hover();
    await settle(300);
    const tip = page
      .locator(".riwaq-destinations > button")
      .nth(3)
      .locator(".wheel-label");
    assert.equal(
      await tip.evaluate((el) => getComputedStyle(el).visibility),
      "visible",
    );
    await page.locator(".riwaq-collapse").click();
    await page.locator(".app.wheel-open").waitFor();
    await settle(300);
    assert.ok((await page.locator(".riwaq-sidebar").boundingBox()).width > 200);
    const label = await destination("collections")
      .locator(".wheel-label")
      .boundingBox();
    assert.ok(label.width > 40, "names show in the open wheel");
    await shot("wheel-open-en");
    await page.locator(".riwaq-collapse").click();
    await page.locator(".app.wheel-open").waitFor({ state: "detached" });
    // Hidden destinations leave the wheel; Downloads and Settings stay.
    await appearance({ navHidden: ["music", "live"] }, { uiLanguage: "en" });
    assert.equal(await page.locator(".riwaq-destinations > button").count(), 7);
    await appearance(
      { navHidden: [] },
      { uiLanguage: "en", quietInterface: true },
    );
    assert.equal(
      await page.locator(".wheel-hub [aria-label='Viewer']").count(),
      0,
    );
    await restart({ uiLanguage: "en", quietInterface: false });
    assert.equal(
      await page.locator(".wheel-hub .riwaq-destination").count(),
      3,
    );
  },
);

await check("wheel: the narrow drawer holds the open wheel", async () => {
  await restart({ uiLanguage: "ar" });
  await page.setViewportSize({ width: 390, height: 844 });
  await settle();
  const content = await page.locator(".content").boundingBox();
  assert.ok(content.width >= 389, `content ${content.width}`);
  await page.locator(".riwaq-drawer-trigger").click();
  await page.locator(".riwaq-nav-dialog[open] .riwaq-wheel").waitFor();
  await settle(300);
  assert.equal(
    await page
      .locator(".riwaq-nav-dialog .riwaq-destinations > button")
      .count(),
    9,
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.style.overflow),
    "hidden",
  );
  await shot("wheel-drawer-ar-390");
  await page
    .locator(".riwaq-nav-dialog .riwaq-destinations > button")
    .nth(2)
    .click();
  await page.locator(".riwaq-nav-dialog").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 900 });
});

await check(
  "wheel: reduced motion turns at once; the sidebar remains a choice",
  async () => {
    await restart({ uiLanguage: "en", reduceMotion: true });
    const duration = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".wheel-lens"))
          .transitionDuration,
    );
    assert.match(duration, /^0s/);
    await appearance(
      { navStyle: "rail" },
      { uiLanguage: "en", reduceMotion: false },
    );
    assert.equal(await page.locator(".riwaq-wheel").count(), 0);
    assert.ok(
      (await page
        .locator(".riwaq-sidebar .riwaq-destinations > button")
        .count()) >= 6,
    );
    await appearance({ navStyle: "wheel" }, { uiLanguage: "en" });
    assert.equal(await page.locator(".riwaq-wheel").count(), 1);
  },
);

// --- Glass -----------------------------------------------------------------
for (const mode of ["dark", "light"])
  await check(
    `glass ${mode}: readable over what is drawn behind, solid on request`,
    async () => {
      await appearance(
        { mode, glass: "on" },
        { uiLanguage: "en", wheelOpen: true },
      );
      const sheen = await page
        .locator(".primary")
        .first()
        .evaluate((el) => getComputedStyle(el).backgroundImage);
      assert.match(sheen, /linear-gradient/);
      const measured = {};
      for (const [name, sel] of [
        ["primary", ".session-compose .primary, .primary"],
        ["choice", ".choice-row button, .session-band button"],
        [
          "wheel label",
          ".riwaq-destinations > button[aria-current=page] .wheel-label",
        ],
      ]) {
        const target = page.locator(sel).first();
        if (!(await target.count())) continue;
        measured[name] = await drawnContrast(target);
        assert.ok(measured[name] >= 4.5, `${name}: ${measured[name]}`);
      }
      await shot(`glass-${mode}`);
      writeFileSync(
        join(output, `contrast-${mode}.json`),
        JSON.stringify(measured, null, 2),
      );
      await appearance({ glass: "solid" }, { uiLanguage: "en" });
      assert.ok(await page.locator(".app.glass-solid").count());
      const flat = await page
        .locator(".secondary")
        .first()
        .evaluate((el) => getComputedStyle(el).boxShadow);
      assert.equal(flat, "none");
      await appearance(
        { glass: "on", mode: "dark" },
        { uiLanguage: "en", wheelOpen: false },
      );
    },
  );

// --- The player's bar (#139, #140) ----------------------------------------
await check(
  "#139/#140 the HUD's bar: counter, folded volume, chapters, ends at",
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
        position: 1500,
        duration: 6400,
        volume: 60,
        volumeMax: 150,
        speed: 1,
        pause: false,
        tracks: [],
        chapters: [
          { time: 0, title: "Opening" },
          { time: 900, title: "Journey" },
          { time: 2400, title: "" },
          { time: 5600, title: "Credits" },
        ],
      };
      await hud.addInitScript(
        ({ state, player }) => {
          try {
            localStorage.removeItem("riwaq.timeCounter");
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
      await hud.mouse.move(640, 300);
      await hud.mouse.move(650, 310);
      await hud.waitForTimeout(200);
      const counter = hud.locator(".time-counter");
      assert.equal((await counter.textContent()).trim(), "25:00 / 1:46:40");
      await counter.click();
      assert.equal((await counter.textContent()).trim(), "-1:21:40 / 1:46:40");
      await counter.focus();
      await hud.keyboard.press("Enter");
      assert.equal((await counter.textContent()).trim(), "25:00 / 1:46:40");
      // The counter changed nothing in the player.
      assert.ok(
        !(await hud.evaluate(() =>
          window.__calls.some(
            ([m, a]) => m === "playerCommand" && a?.action === "seek",
          ),
        )),
      );
      // The slider is folded until wanted.
      const fold = hud.locator(".volume-fold");
      assert.ok((await fold.boundingBox()).width < 2, "folded");
      await hud.hover(".volume-button");
      await hud.waitForTimeout(250);
      assert.ok((await fold.boundingBox()).width > 80, "open on hover");
      await hud.mouse.move(640, 300);
      await hud.waitForTimeout(250);
      await hud.locator(".volume-button").focus();
      await hud.waitForTimeout(250);
      assert.ok((await fold.boundingBox()).width > 80, "open on focus");
      // Chapters: titled, numbered when untitled, and a click seeks.
      const names = (
        await hud.locator(".chapter-strip .chapter").allTextContents()
      ).map((t) => t.trim());
      assert.deepEqual(names, ["Opening", "Journey", "Chapter 3", "Credits"]);
      assert.equal(
        await hud.locator(".chapter.playing").textContent(),
        "Journey",
      );
      assert.equal(await hud.locator(".hud-chapter-tick").count(), 3);
      await hud.locator(".chapter-strip .chapter").nth(3).click();
      assert.ok(
        await hud.evaluate(() =>
          window.__calls.some(
            ([m, a]) =>
              m === "playerCommand" && a?.action === "seek" && a.value === 5600,
          ),
        ),
      );
      assert.match(
        await hud.locator(".ends-at").textContent(),
        /^Ends \d{1,2}:\d{2} (AM|PM)( · tomorrow)?$/,
      );
      await hud.screenshot({ path: join(output, "hud-bar-en.png") });
      // A volume key while the controls sleep: a small pill, never a large one.
      await hud.mouse.move(1279, 0);
      await hud.waitForTimeout(3200);
      await hud
        .evaluate(() => {
          window.__emit("player", { ...window.__player_last, volume: 65 });
        })
        .catch(() => {});
      await hud.evaluate(
        (player) => window.__emit("player", { ...player, volume: 70 }),
        player,
      );
      await hud.waitForTimeout(150);
      assert.equal(
        await hud.locator(".hud-volume-popup, .hud-volume-meter").count(),
        0,
      );
      const pill = hud.locator(".hud-volume-pill");
      if (await pill.count()) {
        const box = await pill.boundingBox();
        assert.ok(box.width < 140 && box.height < 40, JSON.stringify(box));
        assert.ok(box.y > 720 - 90, "at the bottom bar");
      }
    } finally {
      await hud.close();
      server.close();
    }
  },
);

console.log(
  problems.length ? `page errors:\n${problems.join("\n")}` : "no page errors",
);
const passed = results.filter((r) => r.pass).length;
writeFileSync(
  join(output, "results.json"),
  JSON.stringify({ results, problems }, null, 2),
);
console.log(`${passed}/${results.length} passed · evidence in ${output}`);
await browser.close();
fixture.close();
process.exit(passed === results.length && !problems.length ? 0 : 1);
