// Real React components, independent Vite fixture; no Electron or root builds.
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
const baseline = !!process.env.QUALITY_BASELINE;
const output = resolve(
  ".cache/downloads-quality",
  baseline ? "before" : "after",
);
mkdirSync(output, { recursive: true });
const files = [
  "src/components/OfflineLibrary.jsx",
  "src/components/PlayerMenu.jsx",
];
const server = await createServer({
  cacheDir: resolve(".cache/downloads-quality/vite"),
  server: { host: "127.0.0.1", port: 0 },
  plugins: [
    {
      name: "download-baseline",
      enforce: "pre",
      load(id) {
        if (!baseline) return;
        const file = files.find((f) =>
          id.replaceAll("\\", "/").endsWith("/" + f),
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
      name: "download-fixture",
      configureServer(s) {
        s.middlewares.use(async (req, res, next) => {
          if (!req.url.startsWith("/__downloads")) return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            await s.transformIndexHtml(
              req.url,
              '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/downloads-quality.jsx"></script></body></html>',
            ),
          );
        });
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.RIWAQ_CHROMIUM,
});
const results = [],
  errors = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.log("FAIL " + name + ": " + e.message);
  }
};
try {
  for (const lang of ["ar", "en"]) {
    const page = await browser.newPage({
      viewport: { width: 980, height: 680 },
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      window.riwaq = {
        platform: "win32",
        call: (...a) => window.__request(...a),
      };
    });
    const open = async () => {
      await page.goto(
        server.resolvedUrls.local[0] + "__downloads?lang=" + lang,
      );
      await page.locator(".offline-library article").first().waitFor();
    };
    await open();
    for (const width of [1440, 980, 740, 390]) {
      await page.setViewportSize({ width, height: width === 980 ? 680 : 900 });
      await page.screenshot({
        path: join(output, `downloads-${lang}-${width}.png`),
      });
      await check(`${lang} ${width}: downloads fit viewport`, async () => {
        const box = await page.locator(".offline-library").boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
        assert.equal(
          await page
            .locator(".offline-library")
            .evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          true,
        );
      });
    }
    if (process.env.QUALITY_SCREENSHOTS_ONLY) {
      await page.close();
      continue;
    }
    await page.setViewportSize({ width: 980, height: 680 });
    await check(`${lang}: locally supplied artwork renders`, async () => {
      assert.equal(await page.locator(".download-art img").count(), 4);
    });
    await check(
      `${lang}: reveal passes only selected opaque ID and does not play`,
      async () => {
        const reveal = page
          .locator(".offline-library article")
          .first()
          .locator("button")
          .filter({ has: page.locator("svg.lucide-folder-open") });
        await reveal.click({ timeout: 1800 });
        const calls = await page.evaluate(() =>
          window.__calls.filter((x) =>
            ["offlinePlay", "offlineReveal"].includes(x.method),
          ),
        );
        assert.deepEqual(calls, [
          {
            method: "offlineReveal",
            args: { id: "a".repeat(32), profileId: "p" },
          },
        ]);
      },
    );
    await check(
      `${lang}: deletion requires irreversible-media confirmation; Cancel keeps record`,
      async () => {
        await page
          .locator(".offline-library article")
          .first()
          .locator("button")
          .filter({ has: page.locator("svg.lucide-trash-2") })
          .click({ timeout: 1800 });
        await page.locator(".download-confirm").waitFor({ timeout: 1800 });
        assert.equal(
          await page.evaluate(
            () =>
              window.__calls.filter((x) => x.method === "offlineRemove").length,
          ),
          0,
        );
        assert.equal(
          await page
            .locator(".download-confirm button.secondary")
            .evaluate((e) => e === document.activeElement),
          true,
        );
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".offline-library article").count(), 4);
      },
    );
    await check(
      `${lang}: failed deletion is visible and retains selected record`,
      async () => {
        await page.evaluate(() => (window.__removeError = true));
        await page
          .locator(".offline-library article")
          .first()
          .locator("button")
          .filter({ has: page.locator("svg.lucide-trash-2") })
          .click({ timeout: 1800 });
        await page
          .locator(".download-confirm .danger")
          .click({ timeout: 1800 });
        await page.waitForFunction(() =>
          document
            .querySelector('[role="status"]')
            .textContent.includes("Could not delete"),
        );
        assert.equal(await page.locator(".offline-library article").count(), 4);
        await page.keyboard.press("Escape");
      },
    );
    await check(`${lang}: confirm deletes selected record only`, async () => {
      await page.evaluate(() => (window.__removeError = false));
      await page
        .locator(".offline-library article")
        .first()
        .locator("button")
        .filter({ has: page.locator("svg.lucide-trash-2") })
        .click({ timeout: 1800 });
      await page.locator(".download-confirm .danger").click({ timeout: 1800 });
      await page.waitForFunction(
        () =>
          document.querySelectorAll(".offline-library article").length === 3,
      );
      assert.equal(
        await page
          .locator(".offline-library article")
          .first()
          .innerText()
          .then((s) => s.includes("The Night Journey")),
        true,
      );
    });
    await open();
    await check(
      `${lang}: local-open remains a secondary discoverable action`,
      async () => {
        await page.locator(".download-local summary").click({ timeout: 1800 });
        await page.locator(".download-local button").click();
        assert.equal(
          await page.evaluate(() =>
            window.__calls.some((x) => x.method === "localVideo"),
          ),
          true,
        );
      },
    );
    await check(`${lang}: cancelled play keeps Downloads open`, async () => {
      await page.evaluate(() => (window.__cancelPlay = true));
      await page
        .locator(".offline-library article")
        .first()
        .locator("button")
        .first()
        .click();
      assert.equal(await page.locator(".offline-library").count(), 1);
    });
    await page.evaluate(() => window.__showDownloads(false));
    await page.locator("#open-menu").click();
    await page.locator(".player-menu").waitFor();
    await page.screenshot({ path: join(output, `menu-${lang}.png`) });
    await check(
      `${lang}: the menu is exactly #113's four items, without redundant controls`,
      async () => {
        const labels = await page
          .locator(".player-menu button")
          .evaluateAll((buttons) => buttons.map((b) => b.textContent.trim()));
        assert.deepEqual(
          labels,
          lang === "ar"
            ? [
                "التقط لقطة شاشة",
                "نسخ رابط التورنت",
                "نسخ رابط المغناطيس",
                "تنزيل الفيديو",
              ]
            : [
                "Take a screenshot",
                "Copy torrent link",
                "Copy magnet link",
                "Download video",
              ],
        );
        assert.equal(await page.locator(".player-menu .menu-note").count(), 0);
        assert.equal(
          await page.locator(".player-menu button:disabled").count(),
          0,
        );
        // The torrent link says what it is for, in the interface language.
        assert.match(
          await page
            .getByRole("menuitem", {
              name: lang === "ar" ? "نسخ رابط التورنت" : "Copy torrent link",
            })
            .getAttribute("title"),
          lang === "ar" ? /VLC/ : /another player such as VLC/,
        );
      },
    );
    await check(
      `${lang}: keyboard menu forwards full current-viewing identity`,
      async () => {
        await page.keyboard.press("Home");
        await page.keyboard.press("ArrowDown");
        const focused = await page.evaluate(
          () => document.activeElement.textContent,
        );
        const requests = await page.evaluate(
          () =>
            window.__calls.filter((x) => x.method === "playbackMenu").length,
        );
        await page.evaluate(() => window.__tick());
        await page.waitForTimeout(100);
        assert.equal(
          await page.evaluate(() => document.activeElement.textContent),
          focused,
          "Player ticks must not reset menu keyboard focus",
        );
        assert.equal(
          await page.evaluate(
            () =>
              window.__calls.filter((x) => x.method === "playbackMenu").length,
          ),
          requests,
          "An open menu keeps its original viewing snapshot",
        );
        await page.keyboard.press("Enter");
        const action = await page.evaluate(() =>
          window.__calls.find((x) => x.method === "playbackAction"),
        );
        assert.deepEqual(action?.args, {
          action: "copyTorrentLink",
          videoId: "film",
          sessionId: 4,
          profileId: "p",
        });
      },
    );
    await page.evaluate(() => {
      window.__menu = { ...window.__menu, torrentLink: false };
      window.__showMenu(true);
    });
    await page.locator(".player-menu").waitFor();
    await check(
      `${lang}: a torrent without a local link keeps the item and says why`,
      async () => {
        const item = page.getByRole("menuitem", {
          name: lang === "ar" ? "نسخ رابط التورنت" : "Copy torrent link",
        });
        assert.equal(await item.isDisabled(), true);
        const note = page.locator("#torrent-link-unavailable");
        assert.equal(
          await item.getAttribute("aria-describedby"),
          "torrent-link-unavailable",
        );
        assert.match(
          await note.innerText(),
          lang === "ar" ? /محرك على هذا الجهاز/ : /engine on this computer/,
        );
        assert.equal(
          await page
            .getByRole("menuitem", {
              name: lang === "ar" ? "نسخ رابط المغناطيس" : "Copy magnet link",
            })
            .isDisabled(),
          false,
        );
        await page.keyboard.press("Escape");
      },
    );
    await page.evaluate(() => {
      window.__menu = {
        ...window.__menu,
        torrent: false,
        download: false,
        downloadReason: "البث المباشر لا يدعم التنزيل",
      };
      window.__showMenu(true);
    });
    await page.locator(".player-menu").waitFor();
    await check(
      `${lang}: unavailable download explains why; Escape returns focus`,
      async () => {
        assert.equal(
          await page.locator(".player-menu button:disabled").count(),
          1,
        );
        assert.ok(
          (await page.locator(".download-unavailable").innerText()).length > 5,
        );
        await page.keyboard.press("Escape");
        assert.equal(await page.locator(".player-menu").count(), 0);
        assert.equal(
          await page
            .locator("#open-menu")
            .evaluate((e) => e === document.activeElement),
          true,
        );
      },
    );
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(
    join(output, "results.json"),
    JSON.stringify({ baseline, results, errors }, null, 2),
  );
  await browser.close();
  await server.close();
}
if (results.some((r) => !r.pass)) process.exitCode = 1;
