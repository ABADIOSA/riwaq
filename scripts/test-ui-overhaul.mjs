// The November 2026 overhaul in a real Chromium, against the built web
// edition and the local addon of scripts/fixtures/ui-browse-addon.mjs
// (nothing reaches the internet):
//
//   - settings in six rooms with no basic/advanced split (#127; the web
//     edition has five, downloads being desktop-only), every page opening
//     cleanly, English pages free of Arabic (#124 and the rest);
//   - light, dark and the system's mode (#126), live with the OS setting;
//   - the showcase's equal gutters (#125);
//   - row arrows as one adjacent pair, never at both ends (#122);
//   - mouse dragging up and down over poster grids and rows (#111).
//
//   npm run build:web && node scripts/test-ui-overhaul.mjs
//
// Screenshots land in .cache/ui-overhaul.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { loadPlaywright, startUiFixture } from "./fixtures/ui-browse-addon.mjs";

const { chromium } = loadPlaywright();
const site = resolve(process.env.RIWAQ_WEB_DIST || "dist-web");
if (!existsSync(join(site, "index.html")))
  throw new Error("Build the site first: npm run build:web");
const output = resolve(".cache/ui-overhaul");
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
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
    problems.push(`console: ${m.text()}`);
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
const settle = () => page.waitForTimeout(350);
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
const settingsPage = async () => {
  await go(
    '.riwaq-sidebar button[aria-label="الإعدادات"], .riwaq-sidebar button[aria-label="Settings"]',
  );
  await page.locator(".studio-index").waitFor();
};
const restart = async (settings) => {
  await call("settings", settings);
  await page.reload();
  await page.locator(".app").waitFor();
  if (await page.locator(".whats-new").count())
    await page.locator(".whats-new .primary").click();
  await page.locator(".poster-card").first().waitFor();
  await settle();
};
const appearance = async (patch) => {
  const now = (await call("init")).settings.appearance || {};
  await restart({ appearance: { ...now, ...patch } });
};

await page.goto(siteUrl);
await page.waitForFunction(() => window.riwaq?.platform === "web");
await call("onboardingComplete");
await call("install", { url: `${base}/manifest.json` });
await restart({
  uiLanguage: "ar",
  seenVersion: (await call("init")).update?.current,
});

// --- Settings (#127, #124) -------------------------------------------------
for (const lang of ["ar", "en"]) {
  await check(
    `${lang}: settings are rooms of pages with no basic/advanced split`,
    async () => {
      await restart({ uiLanguage: lang });
      await settingsPage();
      assert.equal(
        await page
          .locator("text=/إعدادات (أساسية|متقدمة)|(Basic|Advanced) settings/")
          .count(),
        0,
      );
      const rooms = page.locator(".studio-index-groups > button");
      // The web edition leaves out Downloads & files (desktop-only).
      assert.equal(await rooms.count(), 5);
      const seen = [];
      for (let i = 0; i < 5; i++) {
        await rooms.nth(i).click();
        const pages = page.locator(".studio-index-pages > button");
        const n = await pages.count();
        assert.ok(n > 0);
        for (let j = 0; j < n; j++) {
          await pages.nth(j).click();
          await page.locator(".studio-content > *").first().waitFor();
          seen.push((await pages.nth(j).textContent()).trim());
          if (lang === "en") {
            // Text the interface writes is English; names an addon or a
            // language carries (translate="no", dir="auto") stay as written.
            const arabic = await page.evaluate(() => {
              const out = [];
              const walk = document.createTreeWalker(
                document.querySelector(".studio-page"),
                NodeFilter.SHOW_TEXT,
              );
              while (walk.nextNode()) {
                const n = walk.currentNode;
                if (!/[؀-ۿ]/.test(n.nodeValue)) continue;
                const el = n.parentElement;
                if (
                  el.closest(
                    '[translate="no"], [dir="auto"], option, code, textarea',
                  )
                )
                  continue;
                if (el.closest(".theme-tile, .identity-options")) continue;
                out.push(n.nodeValue.trim().slice(0, 60));
              }
              return out;
            });
            assert.deepEqual(arabic, [], `Arabic on ${seen.at(-1)}`);
          }
        }
      }
      assert.ok(seen.length >= 35, `${seen.length} pages`);
      await shot(`settings-${lang}`);
    },
  );
}
await check(
  "en: a tracker's link button reads Link <service> (#124)",
  async () => {
    await settingsPage();
    await page.getByRole("textbox", { name: "Search settings" }).fill("Trakt");
    await page.locator(".studio-index-pages > button").first().click();
    for (const name of ["Trakt", "Simkl", "AniList"])
      await page
        .getByRole("button", { name: `Link ${name}`, exact: true })
        .waitFor();
    assert.equal(await page.locator("button:has-text('ربط')").count(), 0);
    await shot("connections-en");
  },
);
await check(
  "en: privacy page offers the policy and the statistics switch",
  async () => {
    await settingsPage();
    await page
      .getByRole("textbox", { name: "Search settings" })
      .fill("privacy");
    await page.locator(".studio-index-pages > button").first().click();
    await page
      .getByRole("button", { name: "Read the privacy policy" })
      .waitFor();
    await page.getByText("Optional usage statistics").waitFor();
    await shot("privacy-en");
  },
);

// --- Light, dark and system (#126) ----------------------------------------
const scheme = () =>
  page.evaluate(() => ({
    light: document.querySelector(".app").classList.contains("scheme-light"),
    bg: getComputedStyle(document.querySelector(".app")).backgroundColor,
    saved: document.documentElement.dataset.scheme,
  }));
// WCAG contrast of an element's text against the app background.
const readable = (selector) =>
  page.evaluate((sel) => {
    const rgb = (c) =>
      c
        .match(/\d+(\.\d+)?/g)
        .slice(0, 3)
        .map(Number);
    const lum = ([r, g, b]) =>
      [r, g, b]
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const el = document.querySelector(sel);
    if (!el) return null;
    const a = lum(rgb(getComputedStyle(el).color));
    const b = lum(
      rgb(getComputedStyle(document.querySelector(".app")).backgroundColor),
    );
    const [x, y] = a > b ? [a, b] : [b, a];
    return (x + 0.05) / (y + 0.05);
  }, selector);
for (const lang of ["ar", "en"]) {
  await check(
    `${lang}: light mode draws Pure White and stays readable`,
    async () => {
      await restart({ uiLanguage: lang });
      await appearance({ mode: "light" });
      const s = await scheme();
      assert.equal(s.light, true);
      assert.equal(s.bg, "rgb(255, 255, 255)");
      assert.equal(s.saved, "light");
      for (const sel of [
        ".riwaq-destinations button",
        ".section-heading h2",
        ".poster-card strong",
      ])
        assert.ok((await readable(sel)) >= 4.5, sel);
      await shot(`light-home-${lang}`);
      await go(".riwaq-destinations > button >> nth=1");
      await page.locator(".poster-card").first().waitFor();
      await settle();
      await shot(`light-discover-${lang}`);
      await home();
      await page
        .locator(".smart-shelf .rail-tools .text-button")
        .first()
        .click();
      await page.locator(".browse-page .poster-card").first().waitFor();
      await settle();
      await shot(`light-seeall-${lang}`);
      await page.keyboard.press("Escape");
      await page.locator(".poster-card").first().click();
      await page.locator(".title-page").waitFor();
      await settle();
      for (const sel of [".title-page .synopsis", ".title-page .hero-meta"])
        assert.ok(
          (await readable(sel)) >= 4.5,
          `${sel} contrast on light page`,
        );
      await shot(`light-details-${lang}`);
      await page.keyboard.press("Escape");
      await settingsPage();
      await shot(`light-settings-${lang}`);
      await go(".riwaq-destinations > button >> nth=2");
      await settle();
      await shot(`light-library-${lang}`);
    },
  );
}
await check("system mode follows the operating system live", async () => {
  await restart({ uiLanguage: "ar" });
  await appearance({ mode: "system" });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() =>
    document.querySelector(".app").classList.contains("scheme-light"),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() =>
    document.querySelector(".app").classList.contains("scheme-dark"),
  );
  await appearance({ mode: "dark" });
  const s = await scheme();
  assert.equal(s.light, false);
  assert.equal(s.saved, "dark");
});

// --- Showcase gutters (#125) ------------------------------------------------
await check(
  "the showcase keeps equal gutters on its top and sides",
  async () => {
    await restart({ showShowcase: true });
    for (const [width, height] of [
      [1920, 1080],
      [1440, 900],
      [980, 680],
      [740, 900],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await home();
      await page.evaluate(() => scrollTo(0, 0));
      await settle();
      const g = await page.evaluate(() => {
        const hero = document.querySelector(".hero").getBoundingClientRect();
        const bar = document
          .querySelector(".riwaq-masthead")
          .getBoundingClientRect();
        const side = document.querySelector(".riwaq-sidebar");
        const content = document
          .querySelector(".content")
          .getBoundingClientRect();
        const s = side?.getBoundingClientRect();
        const columnEnd =
          s && s.width && s.left > hero.right ? s.left : content.right;
        return {
          top: Math.round(hero.top - bar.bottom),
          start: Math.round(columnEnd - hero.right),
          end: Math.round(hero.left - content.left),
        };
      });
      assert.equal(g.start, g.top, `${width}: ${JSON.stringify(g)}`);
      assert.equal(g.end, g.top, `${width}: ${JSON.stringify(g)}`);
      if (width === 1440) await shot("showcase-1440");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await restart({ showShowcase: false });
  },
);

// --- Row arrows (#122) -------------------------------------------------------
// With rowArrows "header" (the default), no row draws an arrow at each end:
// every visible pair is two adjacent buttons.
const arrowAudit = () =>
  page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        getComputedStyle(el).visibility !== "hidden"
      );
    };
    const edges = [...document.querySelectorAll(".scroll-arrow")].filter(
      visible,
    ).length;
    const pairs = [...document.querySelectorAll(".rail-arrows")]
      .filter(visible)
      .map((p) => {
        const [a, b] = [...p.querySelectorAll("button")].map((x) =>
          x.getBoundingClientRect(),
        );
        return Math.round(
          Math.abs(a.left + a.width / 2 - (b.left + b.width / 2)),
        );
      });
    return { edges, pairs };
  });
for (const [width, height] of [
  [1440, 900],
  [740, 900],
  [390, 844],
]) {
  await check(
    `${width}: rows show their arrows as one adjacent pair`,
    async () => {
      await page.setViewportSize({ width, height });
      await home();
      let a = await arrowAudit();
      assert.equal(a.edges, 0, "home");
      assert.ok(
        a.pairs.every((d) => d < 60),
        JSON.stringify(a.pairs),
      );
      await page
        .locator(".smart-shelf .rail-tools .text-button")
        .first()
        .click();
      await page.locator(".browse-page .poster-card").first().waitFor();
      await settle();
      a = await arrowAudit();
      assert.equal(a.edges, 0, "see all");
      assert.ok(
        a.pairs.every((d) => d < 60),
        JSON.stringify(a.pairs),
      );
      await shot(`arrows-seeall-${width}`);
      await page.keyboard.press("Escape");
      await go(".riwaq-destinations > button >> nth=1");
      await page.locator(".poster-card").first().waitFor();
      await settle();
      a = await arrowAudit();
      assert.equal(a.edges, 0, "discover");
      await shot(`arrows-discover-${width}`);
    },
  );
}
await check(
  "a series' episodes keep their arrows beside the season picker",
  async () => {
    await page.setViewportSize({ width: 980, height: 680 });
    await home();
    const opened = await page.evaluate(() => {
      const shelf = [...document.querySelectorAll(".smart-shelf, .rail")].find(
        (x) => /مسلسل|Series/.test(x.querySelector("h2")?.textContent || ""),
      );
      shelf?.querySelector(".poster-card")?.click();
      return !!shelf;
    });
    assert.ok(opened);
    await page.locator(".title-page .episode-list").waitFor();
    await settle();
    const a = await arrowAudit();
    assert.equal(a.edges, 0);
    const pair = page.locator(".title-page .rail-arrows");
    assert.equal(await pair.count(), 1);
    await shot("arrows-episodes-980");
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1440, height: 900 });
  },
);
await check("rowArrows: edges keeps the arrows over both ends", async () => {
  await appearance({ rowArrows: "edges" });
  await page.setViewportSize({ width: 740, height: 900 });
  await home();
  const a = await arrowAudit();
  assert.ok(a.edges > 0);
  // The Taste compass keeps its heading pair in either mode (issue #116).
  assert.equal(
    await page
      .locator(".rail-arrows:visible")
      .evaluateAll(
        (list) => list.filter((p) => !p.closest(".taste-discovery")).length,
      ),
    0,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await appearance({ rowArrows: "header" });
});

// --- Vertical dragging (#111) ---------------------------------------------
const drag = async (locator, dy) => {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, 200);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let s = 1; s <= 10; s++) await page.mouse.move(x + s, y + (s * dy) / 10);
  await page.mouse.up();
  await page.waitForTimeout(150);
};
await check(
  "dragging up over See all's grid scrolls it and opens nothing",
  async () => {
    await home();
    await page.locator(".smart-shelf .rail-tools .text-button").first().click();
    const grid = page.locator(".browse-page .poster-grid");
    await grid.locator(".poster-card").first().waitFor();
    await settle();
    const before = await page
      .locator(".browse-page")
      .evaluate((n) => n.scrollTop);
    await drag(grid, -260);
    const after = await page
      .locator(".browse-page")
      .evaluate((n) => n.scrollTop);
    assert.ok(after - before > 200, `${before} → ${after}`);
    assert.equal(
      await page.locator(".title-page").count(),
      0,
      "a drag opened a card",
    );
    // And back down.
    await drag(grid, 200);
    const back = await page
      .locator(".browse-page")
      .evaluate((n) => n.scrollTop);
    assert.ok(after - back > 150, `${after} → ${back}`);
    // A short click still opens the card.
    await grid.locator(".poster-card").first().click();
    await page.locator(".title-page").waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  },
);
await check("dragging up over a row moves the page, not a card", async () => {
  await home();
  await page.evaluate(() => scrollTo(0, 0));
  await settle();
  const row = page.locator(".smart-shelf .poster-row").first();
  await row.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  await drag(row, -220);
  const after = await page.evaluate(() => scrollY);
  assert.ok(after - before > 150, `${before} → ${after}`);
  assert.equal(await page.locator(".title-page").count(), 0);
});
await check(
  "dragging over the Discover catalog grid scrolls the page",
  async () => {
    await go(".riwaq-destinations > button >> nth=1");
    await page.locator(".poster-card").first().waitFor();
    const picker = page.locator("select").first();
    // Cinemeta is installed by default but external requests are refused.
    // Select this run's local catalog by its opaque key, not option order.
    const catalogs = await call("catalogPlan", { discover: true });
    const local = catalogs.find((catalog) => catalog.provider === "UI fixture");
    assert.ok(local, "local fixture catalog is available");
    await picker.selectOption(local.key);
    const grid = page.locator(".poster-grid").first();
    await grid.locator(".poster-card").first().waitFor();
    await grid.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => scrollY);
    await drag(grid, -240);
    const after = await page.evaluate(() => scrollY);
    assert.ok(after - before > 150, `${before} → ${after}`);
    assert.equal(await page.locator(".title-page").count(), 0);
  },
);

// --- Keyboard ------------------------------------------------------------------
await check(
  "settings rooms and pages are reachable with the keyboard",
  async () => {
    await settingsPage();
    const room = page.locator(".studio-index-groups > button").nth(1);
    await room.focus();
    await page.keyboard.press("Enter");
    await page
      .locator(".studio-index-groups > button.selected")
      .nth(0)
      .waitFor();
    assert.equal(
      await page
        .locator(".studio-index-groups > button")
        .nth(1)
        .getAttribute("class"),
      "selected",
    );
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(
        () => document.activeElement?.closest(".studio-index") !== null,
      ),
    );
  },
);

writeFileSync(
  join(output, "report.json"),
  JSON.stringify({ results, problems }, null, 1),
);
await browser.close();
fixture.close();
const failed = results.filter((r) => !r.pass);
if (problems.length) console.log("page problems:\n" + problems.join("\n"));
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length || problems.length) process.exit(1);
