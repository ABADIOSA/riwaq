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

/**
 * Contrast of an element's text against what is actually drawn behind its
 * glyphs. The element is captured twice, as drawn and with its text made
 * transparent: the pixels that differ are the glyphs, the second capture is
 * the background under them (glass, sheen, artwork), and the text colour is
 * the element's own computed colour composited over that background. The
 * result is a low percentile over the glyph pixels, so one stray
 * anti-aliased pixel cannot decide it and a bright decoration elsewhere in
 * the box (a border, an icon) cannot stand in for the text.
 */
async function drawnContrast(locator) {
  const drawn = await locator.screenshot({ animations: "disabled" });
  const color = await locator.evaluate((el) => getComputedStyle(el).color);
  const style = await locator.evaluate((el) => {
    const s = document.createElement("style");
    s.dataset.contrastProbe = "";
    el.dataset.contrastProbe = "";
    s.textContent =
      "[data-contrast-probe], [data-contrast-probe] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }";
    document.head.append(s);
    return true;
  });
  assert.ok(style);
  const under = await locator.screenshot({ animations: "disabled" });
  await locator.evaluate((el) => {
    delete el.dataset.contrastProbe;
    document.querySelector("style[data-contrast-probe]")?.remove();
  });
  return page.evaluate(
    async ([a, b, color]) => {
      const pixels = async (data) => {
        const img = new Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, img.width, img.height).data;
      };
      const [pa, pb] = await Promise.all([pixels(a), pixels(b)]);
      const lum = (r, g, bl) => {
        const c = [r, g, bl].map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const [tr, tg, tb, ta = 1] = color.match(/[\d.]+/g).map(Number);
      const ratios = [];
      for (let i = 0; i < pa.length; i += 4) {
        const diff =
          Math.abs(pa[i] - pb[i]) +
          Math.abs(pa[i + 1] - pb[i + 1]) +
          Math.abs(pa[i + 2] - pb[i + 2]);
        if (diff < 24) continue;
        const [br, bg, bb] = [pb[i], pb[i + 1], pb[i + 2]];
        const text = lum(
          tr * ta + br * (1 - ta),
          tg * ta + bg * (1 - ta),
          tb * ta + bb * (1 - ta),
        );
        const back = lum(br, bg, bb);
        ratios.push(
          (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05),
        );
      }
      if (ratios.length < 8) return { ratio: 0, glyphs: ratios.length };
      ratios.sort((x, y) => x - y);
      return {
        ratio: Math.round(ratios[Math.floor(ratios.length * 0.05)] * 100) / 100,
        glyphs: ratios.length,
      };
    },
    [drawn.toString("base64"), under.toString("base64"), color],
  );
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
  "#135 a dialog keeps the page behind still and restores page scrolling",
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
    await page.keyboard.press("Escape");
    await page.locator("dialog.modal[open]").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => scrollY), before, "offset kept");
    assert.equal(
      await page.evaluate(() => document.documentElement.style.overflow),
      "",
      "the page scrolls again",
    );
    // Test the page, away from the wheel's own scroll capture.
    await page.mouse.move(1000, 450);
    await page.mouse.wheel(0, 200);
    await page.waitForFunction((offset) => scrollY > offset, before);
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

// A long list of sources, so the list really has to scroll (the fixture
// answers one stream).
const manyStreams = (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      streams: Array.from({ length: 40 }, (_, i) => ({
        url: `${base}/video.webm?n=${i}`,
        name: `Fixture ${i + 1}`,
        title: `Fixture ${i + 1} 1080p WEB-DL\n${(i + 1) * 100} MB`,
      })),
    }),
  });
for (const [lang, width, height] of [
  ["en", 1440, 900],
  ["ar", 1440, 900],
  // A 1440×900 window at 200% zoom lays out as 720×450 CSS pixels.
  ["ar", 720, 450],
  ["en", 720, 450],
])
  await check(
    `#134 ${lang} ${width}×${height}: the sources window scrolls only its list`,
    async () => {
      await page.route(/\/stream\//, manyStreams);
      try {
        await page.setViewportSize({ width, height });
        await restart({ uiLanguage: lang });
        await page.locator(".poster-card").first().click();
        await page.locator(".title-page").waitFor();
        await page.locator(".title-page .title-play").click();
        await page.locator(".sources-modal[open]").waitFor();
        await settle(600);
        const read = () =>
          page.evaluate(() => {
            const d = document.querySelector(".sources-modal");
            const body = d.querySelector(".streams-body");
            const close = d.querySelector(".modal-close");
            const heading = d.querySelector(".streams > .section-heading");
            const scrollers = [...d.querySelectorAll("*"), d].filter(
              (el) =>
                el.scrollHeight > el.clientHeight + 1 &&
                /auto|scroll/.test(getComputedStyle(el).overflowY),
            );
            return {
              bodyTop: body.getBoundingClientRect().top,
              bodyScroll: body.scrollTop,
              bodyRoom: body.scrollHeight - body.clientHeight,
              closeTop: close.getBoundingClientRect().top,
              closeBottom: close.getBoundingClientRect().bottom,
              headingTop: heading.getBoundingClientRect().top,
              frameScroll: d.scrollTop,
              scrollers: scrollers.map((el) => el.className),
              pageY: window.scrollY,
            };
          });
        const g = await read();
        assert.ok(g.bodyTop >= g.closeBottom - 0.5, JSON.stringify(g));
        assert.ok(g.bodyRoom > 200, `a long list: ${JSON.stringify(g)}`);
        // Only the list can scroll: not the frame, not the heading's parent.
        assert.deepEqual(g.scrollers, ["streams-body"], JSON.stringify(g));
        // Wheel over the list, then the keyboard inside it: the list moves,
        // the close button, the heading and the page stay where they were.
        const box = await page
          .locator(".sources-modal .streams-body")
          .boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, 600);
        await settle(300);
        const after = await read();
        assert.ok(after.bodyScroll > 100, JSON.stringify(after));
        assert.equal(after.frameScroll, 0);
        assert.ok(Math.abs(after.closeTop - g.closeTop) < 0.5);
        assert.ok(Math.abs(after.headingTop - g.headingTop) < 0.5);
        assert.equal(after.pageY, g.pageY);
        // Wheel over the heading does not move the frame either.
        const head = await page
          .locator(".sources-modal .streams > .section-heading")
          .boundingBox();
        await page.mouse.move(
          head.x + head.width / 2,
          head.y + head.height / 2,
        );
        await page.mouse.wheel(0, 400);
        await settle(200);
        const still = await read();
        assert.equal(still.frameScroll, 0);
        assert.ok(Math.abs(still.closeTop - g.closeTop) < 0.5);
        await shot(`sources-${lang}-${width}`);
      } finally {
        await page.unroute(/\/stream\//, manyStreams);
      }
    },
  );

await check("#134/#135 closing the sources window, then Details", async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await restart({ uiLanguage: "en" });
  await page.locator(".poster-card").first().click();
  await page.locator(".title-page").waitFor();
  await page.locator(".title-page .title-play").click();
  await page.locator(".sources-modal[open]").waitFor();
  await settle(600);
  // The source dialog and its parent Details page each own a lock.
  await page.keyboard.press("Escape");
  await page.locator(".sources-modal[open]").waitFor({ state: "detached" });
  assert.equal(await page.locator(".title-page").count(), 1);
  assert.equal(
    await page.evaluate(() => document.documentElement.style.overflow),
    "hidden",
  );
  await page.keyboard.press("Escape");
  await page.locator(".title-page").waitFor({ state: "detached" });
  assert.equal(
    await page.evaluate(() => document.documentElement.style.overflow),
    "",
  );
});

// --- #137 ------------------------------------------------------------------
for (const lang of ["ar", "en"])
  await check(
    `#137 ${lang}: no hand over the gaps between cards; a gap click opens nothing`,
    async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await restart({ uiLanguage: lang });
      // A row of posters (some rows hold chips or tabs).
      const index = await page
        .locator(".scroll-row")
        .evaluateAll((rows) =>
          rows.findIndex((r) => r.querySelectorAll(".poster-card").length > 2),
        );
      assert.ok(index >= 0, "a row of posters");
      const row = page.locator(".scroll-row").nth(index);
      await row.scrollIntoViewIfNeeded();
      const cursors = await row.evaluate((el) => {
        const cards = el.querySelectorAll(".poster-card");
        const a = cards[0].getBoundingClientRect();
        const b = cards[1].getBoundingClientRect();
        const gapX =
          (Math.max(a.right, b.right) + Math.min(a.left, b.left)) / 2;
        const left = Math.min(a.right, b.right);
        const right = Math.max(a.left, b.left);
        const x = right > left ? (left + right) / 2 : gapX;
        const y = a.top + a.height / 2;
        const gap = document.elementFromPoint(x, y);
        // Points across the gap and the card edges either side of it.
        const along = [-0.45, -0.2, 0, 0.2, 0.45].map((f) => {
          const px = x + f * Math.max(1, right - left);
          const hit = document.elementFromPoint(px, y);
          return {
            px,
            card: !!hit?.closest(".poster-card"),
            cursor: hit ? getComputedStyle(hit).cursor : "",
          };
        });
        return {
          x,
          y,
          width: right - left,
          row: getComputedStyle(el).cursor,
          gapTarget: gap === el || el.contains(gap),
          gapInCard: !!gap.closest(".poster-card"),
          gap: getComputedStyle(gap).cursor,
          card: getComputedStyle(cards[0]).cursor,
          along,
        };
      });
      assert.notEqual(cursors.row, "grab");
      assert.ok(cursors.gapTarget);
      assert.ok(cursors.width >= 4, `a real gap: ${JSON.stringify(cursors)}`);
      assert.ok(!cursors.gapInCard, JSON.stringify(cursors));
      assert.ok(
        !["grab", "pointer"].includes(cursors.gap),
        JSON.stringify(cursors),
      );
      // Inside the gap no point shows a hand; a hand means a card.
      for (const p of cursors.along)
        assert.equal(p.cursor === "pointer", p.card, JSON.stringify(p));
      assert.equal(cursors.card, "pointer");
      // A real click in the gap opens no title.
      await page.mouse.click(cursors.x, cursors.y);
      await settle(300);
      assert.equal(await page.locator(".title-page").count(), 0, "gap click");
      const box = await row.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 - 80,
        box.y + box.height / 2,
        {
          steps: 6,
        },
      );
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
    // Entering by keyboard keeps focus where the viewer is and reaches the
    // selected page within the page's own tab order.
    await destination("home").click();
    await destination("settings").focus();
    await page.keyboard.press("Enter");
    await page.locator(".studio-index").waitFor();
    assert.ok(
      await page.evaluate(
        () =>
          document.activeElement && document.activeElement !== document.body,
      ),
      "focus is not lost on entry",
    );
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() =>
        document.activeElement?.matches?.(
          ".studio-index-pages > button.selected, .studio-index-pages > button[aria-current]",
        ),
      );
    }
    assert.ok(reached, "Tab reaches the selected settings page");
    // A real link into Settings names its page: the shortcuts sheet's
    // "Customize" opens Keyboard shortcuts on the desktop. The web edition
    // has no MPV key map, so the same link lands on Player (WEB_HIDDEN in
    // SettingsStudio.jsx) — still the named page, not the first one.
    await destination("home").click();
    await page.locator(".poster-card").first().waitFor();
    await page.locator("body").press("?");
    await page.locator(".shortcuts-help").waitFor();
    await page.locator(".shortcuts-help .button-row .secondary").click();
    await page.locator(".studio-index").waitFor();
    assert.match(
      await page
        .locator(".studio-index-pages > button.selected")
        .first()
        .textContent(),
      /^\s*(Keyboard shortcuts|Player)\b/,
    );
    // And entering on its own afterwards starts at the first page again.
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

for (const [lang, names] of [
  ["en", ["System", "Light", "Dark"]],
  ["ar", ["النظام", "فاتح", "داكن"]],
])
  await check(
    `#141 ${lang}: Mode reads System, Light, Dark in DOM, on screen and by Tab; the saved mode stays`,
    async () => {
      await appearance({ mode: "dark" }, { uiLanguage: lang });
      await destination("settings").click();
      await page.locator(".studio-index-pages > button").nth(1).click();
      const field = page.locator(".scheme-field");
      await field.waitFor();
      const radios = field.locator("[role=radio]");
      const labels = (await radios.allTextContents()).map((t) => t.trim());
      assert.equal(labels.length, 3);
      names.forEach((name, i) =>
        assert.ok(labels[i].includes(name), labels.join(",")),
      );
      assert.ok(
        (
          await field.locator("[role=radio][aria-checked=true]").textContent()
        ).includes(names[2]),
      );
      assert.equal((await call("init")).settings.appearance.mode, "dark");
      // On screen: reading order, right to left in Arabic.
      const xs = [];
      for (let i = 0; i < 3; i++)
        xs.push((await radios.nth(i).boundingBox()).x);
      const sorted = [...xs].sort((a, b) => (lang === "ar" ? b - a : a - b));
      assert.deepEqual(xs, sorted, `reading order on screen: ${xs}`);
      // Tab walks System → Light → Dark; Shift+Tab walks back.
      await radios.first().focus();
      const focused = () =>
        page.evaluate(() => document.activeElement.textContent.trim());
      for (const name of names.slice(1)) {
        await page.keyboard.press("Tab");
        assert.ok((await focused()).includes(name), `Tab → ${name}`);
      }
      for (const name of names.slice(0, 2).reverse()) {
        await page.keyboard.press("Shift+Tab");
        assert.ok((await focused()).includes(name), `Shift+Tab → ${name}`);
      }
      // Visiting the page and moving focus never changed the saved mode.
      assert.equal((await call("init")).settings.appearance.mode, "dark");
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
      const ordered = boxes.toSorted((a, b) => a.y - b.y);
      for (const [i, b] of ordered.entries()) {
        assert.ok(b.width >= 44 && b.height >= 44, `target ${i}`);
        assert.ok(
          b.x >= rail.x - 1 && b.x + b.width <= rail.x + rail.width + 1,
        );
        if (i)
          assert.ok(
            b.y >= ordered[i - 1].y + ordered[i - 1].height - 0.5,
            `overlap ${i}`,
          );
      }
      // The arc: the middle reaches furthest from the edge.
      const reach = ordered.map((b) =>
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
      // Direct clicks select their page and the destination moves to Home's
      // previous position, where the wheel always snaps.
      const anchor = boxes[0];
      await destination("library").click();
      await page
        .locator(".riwaq-destinations > button[aria-current=page]")
        .waitFor();
      assert.equal(
        await destination("library").getAttribute("aria-current"),
        "page",
        "direct Library click",
      );
      await settle(500);
      const library = await destination("library").boundingBox();
      assert.ok(Math.abs(library.x - anchor.x) < 1);
      assert.ok(Math.abs(library.y - anchor.y) < 1);
      const after = await buttons.nth(8).boundingBox();
      assert.notDeepEqual(after, boxes[8], "the other destinations move too");
      // A quick double click picks its page once and leaves the wheel usable.
      await destination("discover").dblclick();
      assert.equal(
        await destination("discover").getAttribute("aria-current"),
        "page",
        "quick double click on Discover",
      );
      await destination("home").click();
      assert.equal(
        await destination("home").getAttribute("aria-current"),
        "page",
        "next deliberate Home click",
      );
      // Every one of the nine, in turn: one click selects it (and only it),
      // and it settles at the anchor. Downloads is an action (it opens the
      // downloads window over the current page, RiwaqNav), so its click
      // must keep the current page and open that window instead.
      for (const id of [
        "discover",
        "library",
        "collections",
        "downloads",
        "addons",
        "music",
        "live",
        "settings",
        "home",
      ]) {
        const before = await page
          .locator(".riwaq-destinations > button[aria-current=page]")
          .getAttribute("aria-label");
        await destination(id).click();
        await settle(500);
        if (id === "downloads") {
          assert.equal(
            await page
              .locator(".riwaq-destinations > button[aria-current=page]")
              .getAttribute("aria-label"),
            before,
            "Downloads keeps the current page",
          );
          assert.ok(
            await page.locator("dialog[open], .modal[open]").count(),
            "Downloads opens its window",
          );
          await page.keyboard.press("Escape");
          await page
            .locator("dialog[open], .modal[open]")
            .first()
            .waitFor({ state: "detached" });
          continue;
        }
        assert.equal(
          await page
            .locator(".riwaq-destinations > button[aria-current=page]")
            .count(),
          1,
          `${id}: one current page`,
        );
        assert.equal(
          await destination(id).getAttribute("aria-current"),
          "page",
          `${id} selected by one click`,
        );
        const box = await destination(id).boundingBox();
        assert.ok(
          Math.abs(box.x - anchor.x) < 1 && Math.abs(box.y - anchor.y) < 1,
          `${id} at the anchor: ${JSON.stringify(box)}`,
        );
      }
    },
  );

await check(
  "wheel: mouse and trackpad rotate locally, then a drag snaps",
  async () => {
    await restart({ uiLanguage: "en", wheelOpen: false });
    const home = destination("home");
    const discover = destination("discover");
    const library = destination("library");
    const anchor = await home.boundingBox();
    const step = (await discover.boundingBox()).y - anchor.y;
    const { x, y } = anchor;
    await page.mouse.move(x + 22, y + 22);
    await page.mouse.wheel(0, 20);
    await page.mouse.wheel(0, 20);
    await page.mouse.wheel(0, 20);
    await settle(500);
    assert.ok(await discover.evaluate((el) => document.activeElement === el));
    assert.ok(Math.abs((await discover.boundingBox()).y - y) < 1);
    assert.equal(await home.getAttribute("aria-current"), "page");
    assert.equal(await page.evaluate(() => scrollY), 0);

    await page.mouse.down();
    await page.mouse.move(x + 22, y + 22 - step, { steps: 4 });
    await settle(100);
    assert.ok((await discover.boundingBox()).y < y - 10, "moves during drag");
    await page.mouse.up();
    await settle(500);
    assert.ok(await library.evaluate((el) => document.activeElement === el));
    assert.ok(Math.abs((await library.boundingBox()).y - y) < 1);
    assert.equal(
      await home.getAttribute("aria-current"),
      "page",
      "drag doesn't click",
    );
    await page.keyboard.press("Enter");
    assert.equal(await library.getAttribute("aria-current"), "page");

    await home.click();
    await settle(500);
    await page.mouse.move(700, 450);
    await page.mouse.wheel(0, 700);
    await settle();
    assert.ok((await page.evaluate(() => scrollY)) > 100, "page still scrolls");
  },
);

await check(
  "wheel: a long drag snaps to the same target as the preview",
  async () => {
    await page.setViewportSize({ width: 1440, height: 1600 });
    try {
      await restart({ uiLanguage: "en", wheelOpen: false });
      const home = destination("home");
      const settings = destination("settings");
      const anchor = await home.boundingBox();
      const step = (await destination("discover").boundingBox()).y - anchor.y;
      const x = anchor.x + anchor.width / 2;
      const y = anchor.y + anchor.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      try {
        // More than one full turn. Both preview and release stop one
        // destination short of Home rather than wrapping multiple times.
        await page.mouse.move(x, y - 10 * step, { steps: 10 });
        await settle(100);
        const preview = await settings.evaluate((button) => {
          const stage = button.closest(".wheel-stage");
          const lens = stage
            .querySelector(".wheel-lens")
            .getBoundingClientRect();
          const target = button.getBoundingClientRect();
          return {
            delta: target.y + target.height / 2 - (lens.y + lens.height / 2),
            angle: button.style.getPropertyValue("--wheel-angle"),
            classes: stage.className,
            transform: getComputedStyle(button).transform,
            transition: getComputedStyle(button).transitionDuration,
          };
        });
        assert.ok(
          Math.abs(preview.delta) < 1,
          `drag preview: ${JSON.stringify(preview)}; step ${step}`,
        );
      } finally {
        await page.mouse.up();
      }
      await settle(500);
      assert.ok(await settings.evaluate((el) => document.activeElement === el));
      const snapped = (await settings.boundingBox()).y;
      assert.ok(
        Math.abs(snapped - anchor.y) < 1,
        `snap: ${snapped} vs anchor ${anchor.y}`,
      );
      assert.equal(await home.getAttribute("aria-current"), "page");
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
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
  // An emulated touch drag snaps inside the open drawer without selecting
  // a route or moving the page behind it.
  const home = destination("home");
  const discover = destination("discover");
  const anchor = await home.locator(".wheel-disc").boundingBox();
  const step =
    (await discover.locator(".wheel-disc").boundingBox()).y - anchor.y;
  const x = anchor.x + anchor.width / 2;
  const y = anchor.y + anchor.height / 2;
  const cdp = await context.newCDPSession(page);
  try {
    const touch = (type, touchPoints) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    await touch("touchStart", [{ x, y }]);
    await touch("touchMove", [{ x, y: y - step / 2 }]);
    await touch("touchMove", [{ x, y: y - step }]);
    await touch("touchEnd", []);
  } finally {
    await cdp.detach();
  }
  await settle(500);
  assert.ok(
    await discover.evaluate((el) => document.activeElement === el),
    "touch centers the next destination",
  );
  assert.equal(await home.getAttribute("aria-current"), "page");
  assert.ok(
    Math.abs(
      (await discover.locator(".wheel-disc").boundingBox()).y - anchor.y,
    ) < 1,
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
    await page.setViewportSize({ width: 1440, height: 900 });
    await restart({ uiLanguage: "en", reduceMotion: true });
    const duration = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector(".wheel-item"))
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
        ["secondary", "main .secondary"],
        ["choice", "main .session-budgets button:not(.chosen)"],
        ["chosen", "main :is(.session-budgets, .session-moods) button.chosen"],
        [
          "wheel label",
          ".riwaq-destinations > button[aria-current=page] .wheel-label",
        ],
      ]) {
        // A missing control is a failure, never a skipped measurement.
        const target = page.locator(sel).first();
        assert.ok(await target.count(), `${name}: no element for ${sel}`);
        await target.scrollIntoViewIfNeeded();
        measured[name] = {
          ...(await drawnContrast(target)),
          element: await target.evaluate(
            (el) =>
              `${el.tagName}.${el.className} «${el.textContent.trim().slice(0, 30)}»`,
          ),
        };
        await target
          .screenshot({
            path: join(output, `glass-${mode}-${name.replace(/ /g, "-")}.png`),
          })
          .catch(() => {});
      }
      await shot(`glass-${mode}`);
      writeFileSync(
        join(output, `contrast-${mode}.json`),
        JSON.stringify(measured, null, 2),
      );
      for (const [name, m] of Object.entries(measured))
        assert.ok(m.ratio >= 4.5, `${name}: ${JSON.stringify(m)}`);
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
    // The HUD page has its own context: block the internet there too, and
    // record every request that is not the local build.
    const outside = [];
    await hud.context().route(/^https?:\/\//, (route) => {
      if (new URL(route.request().url()).hostname === "127.0.0.1")
        return route.continue();
      outside.push(route.request().url());
      return route.abort("internetdisconnected");
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
          { time: 20, title: "Opening" },
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
      assert.equal(await hud.locator(".hud-chapter-tick").count(), 4);
      await hud.locator(".chapter-strip .chapter").first().click();
      await hud.locator(".chapter-strip .chapter").nth(3).click();
      assert.deepEqual(
        await hud.evaluate(() =>
          window.__calls
            .filter(([m, a]) => m === "playerCommand" && a?.action === "seek")
            .map(([, a]) => a.value),
        ),
        [20, 5600],
      );
      assert.match(
        await hud.locator(".ends-at").textContent(),
        /^Ends \d{1,2}:\d{2} (AM|PM)( · tomorrow)?$/,
      );
      await hud.screenshot({ path: join(output, "hud-bar-en.png") });
      // A volume key while the controls sleep: a small pill, never a large one.
      await hud.mouse.move(1279, 0);
      await hud.locator(".hud-stage.asleep").waitFor({ timeout: 5000 });
      await hud.evaluate(
        (player) => window.__emit("player", { ...player, volume: 70 }),
        player,
      );
      const pill = hud.locator(".hud-volume-pill");
      await pill.waitFor({ timeout: 1000 });
      assert.equal(
        await hud.locator(".hud-volume-popup, .hud-volume-meter").count(),
        0,
      );
      const box = await pill.boundingBox();
      assert.ok(box.width < 140 && box.height < 40, JSON.stringify(box));
      assert.ok(box.y > 720 - 90, "at the bottom bar");
      assert.deepEqual(outside, [], "the HUD asked nothing of the internet");
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
