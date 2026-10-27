// Isolated real-component checks; never rebuilds or serves root dist-web.
import { createServer } from "vite";
import { createRequire } from "node:module";
import { execSync, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.RIWAQ_PLAYWRIGHT ||
    join(execSync("npm root -g").toString().trim(), "playwright"),
);
const label = process.env.QUALITY_PHASE || "current";
const output = resolve(".cache/quality-carousels", label);
mkdirSync(output, { recursive: true });
const baselineFiles = [
  "src/components/UI.jsx",
  "src/components/HomeHero.jsx",
  "src/components/TasteDiscovery.jsx",
  "src/lib/drag-scroll.js",
  "src/hero.css",
  "src/taste.css",
];
const server = await createServer({
  cacheDir: resolve(".cache/quality-carousels/vite"),
  // Keep the translating runtime and fixture on the same language module;
  // dependency prebundling would otherwise duplicate its module-local state.
  optimizeDeps: {
    exclude: ["riwaq-jsx/jsx-runtime", "riwaq-jsx/jsx-dev-runtime"],
  },
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "carousel-baseline",
      enforce: "pre",
      load(id) {
        if (!process.env.QUALITY_BASELINE) return;
        const file = baselineFiles.find((file) =>
          id.replaceAll("\\", "/").endsWith(`/${file}`),
        );
        if (file)
          return execFileSync(
            "git",
            ["show", `d79fec355bc56d7cd6e5474a9b0c922eba76388d:${file}`],
            { encoding: "utf8" },
          );
      },
    },
    {
      name: "carousel-fixture",
      configureServer(s) {
        s.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith("/__carousels")) return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await s.transformIndexHtml(
              req.url,
              '<html><div id="root"></div><script type="module" src="/scripts/fixtures/quality-carousels.jsx"></script></html>',
            ),
          );
        });
      },
    },
  ],
});
await server.listen();
const base = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.RIWAQ_CHROMIUM,
});
const results = [];
const geometry = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.log(`FAIL ${name}: ${e.message}`);
  }
};
const drag = async (page, row, direction, distance = 170) => {
  await row.scrollIntoViewIfNeeded();
  const b = await row.boundingBox();
  const x = b.x + b.width * (direction === "rtl" ? 0.3 : 0.7);
  await page.mouse.move(x, b.y + Math.min(65, b.height / 2));
  await page.mouse.down();
  await page.mouse.move(
    x + (direction === "rtl" ? distance : -distance),
    b.y + Math.min(65, b.height / 2),
    { steps: 14 },
  );
  await page.mouse.up();
};
try {
  for (const lang of ["ar", "en"]) {
    const direction = lang === "ar" ? "rtl" : "ltr";
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      hasTouch: true,
    });
    page.setDefaultTimeout(5000);
    await page.goto(`${base}__carousels?lang=${lang}`);
    await page.locator(".taste-pick").first().waitFor();
    for (const width of [1440, 980, 740, 390]) {
      await page.setViewportSize({ width, height: width === 980 ? 680 : 900 });
      await page.evaluate(() => scrollTo(0, 0));
      await check(
        `${lang} ${width}: hero actions fit inside the showcase`,
        async () => {
          const hero = await page.locator(".hero").boundingBox();
          for (const button of await page
            .locator(".hero-content button")
            .all()) {
            const rect = await button.boundingBox();
            assert(
              rect.x >= hero.x - 1 &&
                rect.x + rect.width <= hero.x + hero.width + 1,
              "A primary action must not be clipped by the showcase",
            );
          }
        },
      );
      await page.screenshot({
        path: join(output, `${lang}-${width}.png`),
        fullPage: false,
        animations: "disabled",
      });
      await page.locator(".taste-heading").screenshot({
        path: join(output, `taste-${lang}-${width}.png`),
        animations: "disabled",
      });
      geometry.push({
        lang,
        width,
        hero: await page.locator(".hero").boundingBox(),
        footer: await page.locator(".hero-footer").boundingBox(),
        controls: await page.locator(".hero-controls").boundingBox(),
        heading: await page.locator(".taste-heading").boundingBox(),
      });
    }
    await page.setViewportSize({ width: 980, height: 680 });
    await check(`${lang}: existing portrait row drags`, async () => {
      const row = page.locator(".rail .poster-row");
      await drag(page, row, direction);
      assert.ok(Math.abs(await row.evaluate((el) => el.scrollLeft)) > 100);
      assert.equal(await page.evaluate(() => window.actions.open), 0);
    });
    await check(`${lang}: Taste heading arrows and boundaries`, async () => {
      const heading = page.locator(".taste-heading .rail-arrows");
      assert.equal(
        await heading.locator("button").count(),
        2,
        "two adjacent shared heading arrows",
      );
      await heading.scrollIntoViewIfNeeded();
      assert.equal(await heading.locator("button").first().isDisabled(), true);
      await heading.locator("button").last().click();
      await page.waitForFunction(
        () => Math.abs(document.querySelector(".taste-row").scrollLeft) > 100,
      );
      assert.equal(await heading.locator("button").first().isDisabled(), false);
    });
    await check(`${lang}: hero navigation lives in footer`, async () => {
      assert.equal(await page.locator(".hero-footer .hero-arrow").count(), 2);
      await page.locator(".hero-footer .hero-arrow.next").click();
      assert.equal(await page.locator(".hero-count").innerText(), "2 / 3");
    });
    await check(
      `${lang}: hero horizontal gesture changes one slide`,
      async () => {
        await page.locator(".hero-pages button").first().click();
        await drag(page, page.locator(".hero"), direction);
        assert.equal(await page.locator(".hero-count").innerText(), "2 / 3");
        assert.deepEqual(
          await page.evaluate(() => ({
            open: window.actions.open,
            favorite: window.actions.favorite,
          })),
          { open: 0, favorite: 0 },
        );
      },
    );
    await check(
      `${lang}: delayed and replaced row ref attaches dragging`,
      async () => {
        await page.evaluate(() => window.fixture.setLate(true));
        const row = page.locator("#late-fixture .scroll-row");
        await row.waitFor();
        await drag(page, row, direction);
        assert.ok(
          Math.abs(await row.evaluate((el) => el.scrollLeft)) > 100,
          "late-mounted row drag listeners attach",
        );
        await page.evaluate(() => window.fixture.setRevision(1));
        await page.locator('#late-fixture [data-revision="1"]').waitFor();
        await drag(page, row, direction);
        assert.ok(
          Math.abs(await row.evaluate((el) => el.scrollLeft)) > 100,
          "replacement row drag listeners attach",
        );
      },
    );
    await check(
      `${lang}: row click, keyboard and poster menu remain available`,
      async () => {
        const row = page.locator("#late-fixture .scroll-row");
        await row.evaluate((el) => (el.scrollLeft = 0));
        const button = row.locator("button").first();
        await button.click();
        await button.press("Enter");
        assert.equal(
          await page.evaluate(() => window.actions.clicks),
          2,
          "only direct click and Enter activate row buttons",
        );
        const posters = page.locator(".rail .poster-row");
        await posters.evaluate((el) => (el.scrollLeft = 0));
        await posters
          .locator(".poster-card")
          .first()
          .click({ button: "right" });
        assert.equal(
          await page.evaluate(() => window.actions.menu),
          1,
          "right-click opens menu once",
        );
        await posters.locator(".poster-card").first().press("ContextMenu");
        assert.ok(
          await page.evaluate(() => window.actions.menu > 1),
          "dedicated Menu key opens menu",
        );
        const menus = await page.evaluate(() => window.actions.menu);
        await posters.locator(".poster-card").first().press("Shift+F10");
        assert.equal(
          await page.evaluate(() => window.actions.menu),
          menus,
          "Shift+F10 stays retired",
        );
        await posters.locator(".poster-remove").first().click();
        assert.equal(await page.evaluate(() => window.actions.remove), 1);
      },
    );
    await check(
      `${lang}: replaced rows release old global listeners`,
      async () => {
        const count = await page.evaluate(() => window.listenerCount());
        for (let i = 2; i <= 6; i++) {
          await page.evaluate((i) => window.fixture.setRevision(i), i);
          await page.locator(`#late-fixture [data-revision="${i}"]`).waitFor();
          assert.equal(
            await page.evaluate(() => window.listenerCount()),
            count,
          );
        }
        await page.evaluate(() => window.fixture.setLate(false));
        await page
          .locator("#late-fixture .scroll-row")
          .waitFor({ state: "detached" });
        await page.waitForFunction(
          (before) => window.listenerCount() === before - 4,
          count,
        );
      },
    );
    await check(
      `${lang}: hero keyboard follows physical direction`,
      async () => {
        await page.locator(".hero-pages button").first().click();
        await page.waitForFunction(
          () =>
            document.querySelector(".hero-count").textContent.trim() ===
            "1 / 3",
        );
        await page.locator(".hero .primary").focus();
        await page.keyboard.press(lang === "ar" ? "ArrowLeft" : "ArrowRight");
        assert.equal(await page.locator(".hero-count").innerText(), "2 / 3");
      },
    );
    await check(
      `${lang}: real touch swipe changes slide and vertical touch scrolls page`,
      async () => {
        await page.locator(".hero-pages button").first().click();
        const hero = page.locator(".hero");
        await hero.scrollIntoViewIfNeeded();
        const b = await hero.boundingBox();
        const session = await page.context().newCDPSession(page);
        const gesture = async (x, y, dx, dy) => {
          await session.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x, y, id: 1 }],
          });
          for (let i = 1; i <= 12; i++)
            await session.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [
                { x: x + (dx * i) / 12, y: y + (dy * i) / 12, id: 1 },
              ],
            });
          await session.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        };
        await gesture(
          b.x + b.width * (lang === "ar" ? 0.3 : 0.7),
          b.y + 65,
          lang === "ar" ? 170 : -170,
          0,
        );
        assert.equal(await page.locator(".hero-count").innerText(), "2 / 3");
        const before = await page.evaluate(() => scrollY);
        await gesture(b.x + b.width * 0.8, b.y + 300, 2, -150);
        await page.waitForFunction((before) => scrollY > before + 50, before);
        assert.equal(await page.locator(".hero-count").innerText(), "2 / 3");
        await session.detach();
      },
    );
    await check(
      `${lang}: hero buttons exclude gestures and keep activation`,
      async () => {
        const button = page.locator(".hero .primary");
        await button.scrollIntoViewIfNeeded();
        const b = await button.boundingBox();
        const before = await page.locator(".hero-count").innerText();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2, {
          steps: 10,
        });
        await page.mouse.up();
        assert.equal(await page.locator(".hero-count").innerText(), before);
        await button.click();
        await page.locator(".hero .secondary").click();
        assert.deepEqual(
          await page.evaluate(() => ({
            open: window.actions.open,
            favorite: window.actions.favorite,
          })),
          { open: 1, favorite: 1 },
        );
      },
    );
    await check(
      `${lang}: hero cancels short, vertical, capture-loss and blur gestures`,
      async () => {
        await page.locator(".hero-pages button").first().click();
        const hero = page.locator(".hero");
        await drag(page, hero, direction, 20);
        assert.equal(await page.locator(".hero-count").innerText(), "1 / 3");
        const b = await hero.boundingBox();
        const x = b.x + b.width * 0.8,
          y = b.y + 70;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 3, y + 80, { steps: 8 });
        await page.mouse.move(x + 120, y + 80, { steps: 8 });
        await page.mouse.up();
        assert.equal(await page.locator(".hero-count").innerText(), "1 / 3");
        for (const event of ["pointercancel", "lostpointercapture", "blur"]) {
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x - 100, y, { steps: 8 });
          await hero.evaluate(
            (el, event) =>
              event === "blur"
                ? window.dispatchEvent(new Event("blur"))
                : el.dispatchEvent(
                    new PointerEvent(event, { pointerId: 1, bubbles: true }),
                  ),
            event,
          );
          await page.mouse.up();
          assert.equal(await page.locator(".hero-count").innerText(), "1 / 3");
          assert.equal(
            await hero.evaluate((el) => el.classList.contains("is-dragging")),
            false,
          );
        }
      },
    );
    await check(
      `${lang}: hero hover and focus pause independently, reduced motion disables rotation`,
      async () => {
        const hero = page.locator(".hero");
        await page.locator(".hero .primary").focus();
        await hero.hover();
        await page.mouse.move(0, 0);
        assert.equal(
          await hero.evaluate((el) => el.classList.contains("turning")),
          false,
          "focus still holds rotation after pointer leaves",
        );
        await page.evaluate(() => document.activeElement.blur());
        await page.waitForFunction(() =>
          document.querySelector(".hero").classList.contains("turning"),
        );
        await page.locator(".hero-toggle").click();
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.activeElement.blur());
        assert.equal(
          await hero.evaluate((el) => el.classList.contains("turning")),
          false,
        );
        await page.locator(".hero-toggle").click();
        await page.evaluate(() =>
          window.fixture.settings({
            titleLogos: "text",
            heroAutoplay: true,
            reduceMotion: true,
          }),
        );
        await page.locator(".reduced-motion").waitFor();
        assert.equal(
          await hero.evaluate((el) => el.classList.contains("turning")),
          false,
        );
        assert.equal(await page.locator(".hero-toggle").count(), 0);
      },
    );
    await check(
      `${lang}: empty Taste removes stale heading arrows`,
      async () => {
        await page
          .locator(".taste-filters select")
          .first()
          .selectOption("series");
        await page.locator(".taste-empty").waitFor();
        assert.equal(
          await page.locator(".taste-heading .rail-arrows").count(),
          0,
        );
      },
    );
    await check(
      `${lang}: autoplay waits for visibility, active page and explicit preference`,
      async () => {
        await page.clock.install();
        await page.evaluate(() => {
          window.fixture.settings({ titleLogos: "text", heroAutoplay: true });
          document.activeElement?.blur();
        });
        await page.locator(".hero-pages button").first().click();
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.activeElement?.blur());
        await page.clock.fastForward(9100);
        assert.equal(await page.locator(".hero-count").innerText(), "2 / 3");
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.clock.fastForward(20000);
        assert.equal(await page.locator(".hero-count").innerText(), "2 / 3");
        assert.equal(
          await page
            .locator(".hero")
            .evaluate((el) => el.classList.contains("turning")),
          false,
        );
        await page.evaluate(() => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: false,
          });
          document.dispatchEvent(new Event("visibilitychange"));
          window.fixture.setRunning(false);
        });
        await page.clock.fastForward(20000);
        assert.equal(await page.locator(".hero-count").innerText(), "2 / 3");
        await page.evaluate(() => {
          window.fixture.setRunning(true);
          window.fixture.settings({ titleLogos: "text", heroAutoplay: false });
        });
        await page.clock.fastForward(20000);
        assert.equal(await page.locator(".hero-count").innerText(), "2 / 3");
        await page.evaluate(() => window.fixture.setItemCount(1));
        await page.waitForFunction(
          () =>
            document.querySelector(".hero-count").textContent.trim() ===
            "1 / 1",
        );
        assert.equal(await page.locator(".hero-arrow").count(), 0);
      },
    );
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2));
writeFileSync(join(output, "geometry.json"), JSON.stringify(geometry, null, 2));
assert.equal(
  results.filter((r) => !r.pass).length,
  0,
  "carousel behavior failures (see results.json)",
);
