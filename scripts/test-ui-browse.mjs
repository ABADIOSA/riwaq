// Browsing journeys in a real Chromium against the built web edition:
// Home → See all → Details → Back, Discover, the library and settings, in
// Arabic and English at desktop, compact and phone widths, against the
// local addon in scripts/fixtures/ui-browse-addon.mjs. Nothing here reaches
// the internet.
//
//   npm run build:web && node scripts/test-ui-browse.mjs
//
// UI_PHASE=before records geometry and screenshots without asserting the
// rebuilt See all page (for a baseline build in RIWAQ_WEB_DIST); the default
// phase "after" asserts it. Evidence lands in .cache/ui-rebuild/<phase>.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { loadPlaywright, startUiFixture } from "./fixtures/ui-browse-addon.mjs";

const { chromium } = loadPlaywright();

const phase = process.env.UI_PHASE === "before" ? "before" : "after";
const strict = phase === "after";
const site = resolve(process.env.RIWAQ_WEB_DIST || "dist-web");
if (!existsSync(join(site, "index.html")))
  throw new Error("Build the site first: npm run build:web");
const output = resolve(".cache/ui-rebuild/" + phase);
mkdirSync(output, { recursive: true });
const shots = process.env.UI_SHOTS !== "0";
const fixture = await startUiFixture(site);
const { siteUrl, base, catalogRequests } = fixture;

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
// UI_ONLY=<pattern> runs the checks whose names match (and the set-up).
const only = process.env.UI_ONLY ? new RegExp(process.env.UI_ONLY) : null;
const check = async (name, fn) => {
  if (only && !only.test(name)) return;
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
    const error = e.message.split("\n").slice(0, 4).join(" ");
    results.push({ name, pass: false, error });
    console.log(`✗ ${name}: ${error}`);
    await page
      .screenshot({ path: join(output, `failed-${results.length}.png`) })
      .catch(() => {});
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
  // Forward then back (the reading direction decides which way is
  // forward), then a short click on a card still opens it.
  const drag = async (el, dx) => {
    const box = await el.boundingBox();
    const y = box.y + Math.min(box.height / 2, 120);
    const x = box.x + box.width / 2;
    const before = await el.evaluate((n) => n.scrollLeft);
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let s = 1; s <= 8; s++) await page.mouse.move(x + (s * dx) / 8, y);
    await page.mouse.up();
    await page.waitForTimeout(120);
    return Math.abs((await el.evaluate((n) => n.scrollLeft)) - before);
  };
  for (const row of rows.slice(0, 6)) {
    const el = page.locator(`[data-drag-probe="${row.i}"]`);
    await el.scrollIntoViewIfNeeded();
    if (!(await el.boundingBox())) continue;
    const rtl = await el.evaluate(
      (n) => getComputedStyle(n).direction === "rtl",
    );
    const forward = await drag(el, rtl ? 200 : -200);
    const openedByDrag = !!(await page.locator(".title-page").count());
    if (openedByDrag) await page.locator(".title-page .back-button").click();
    const back = await drag(el, rtl ? -200 : 200);
    const card = el.locator(".poster-card").first();
    let click = null;
    if (await card.count()) {
      await card.click();
      click = await page
        .locator(".title-page")
        .waitFor({ timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (click) {
        await page.locator(".title-page .back-button").click();
        await page.locator(".title-page").waitFor({ state: "detached" });
      }
    }
    report.drag.push({
      where,
      cls: row.cls,
      moved: Math.min(forward, back),
      opened: openedByDrag,
      click,
    });
  }
};

try {
  const recorder = await context.newPage();
  await recorder.goto(`${base}/manifest.json`);
  const recorded = await recorder.evaluate(async () => {
    const canvas = Object.assign(document.createElement("canvas"), {
      width: 160,
      height: 90,
    });
    const g = canvas.getContext("2d");
    const rec = new MediaRecorder(canvas.captureStream(15), {
      mimeType: "video/webm;codecs=vp8",
    });
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    let frame = 0;
    const timer = setInterval(() => {
      g.fillStyle = `hsl(${frame++ * 9}, 60%, 40%)`;
      g.fillRect(0, 0, 160, 90);
    }, 66);
    rec.start(500);
    await new Promise((r) => setTimeout(r, 14000));
    rec.stop();
    clearInterval(timer);
    await new Promise((r) => (rec.onstop = r));
    const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  fixture.setVideo(Buffer.from(recorded, "base64"));
  await recorder.close();
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
        await page.evaluate(() => scrollTo(0, 0));
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
            firstShelf: await page.evaluate(() =>
              Math.round(
                document.querySelector(".smart-shelf")?.getBoundingClientRect()
                  .top + scrollY,
              ),
            ),
            firstPoster: await page.evaluate(() =>
              Math.round(
                document.querySelector(".poster-card")?.getBoundingClientRect()
                  .top + scrollY,
              ),
            ),
          });
        // Without history, titles reach the first screen and the first
        // catalog shelf moves up (0.52.0 at 1440×900: first titles at
        // 1,496 px and the first shelf at 2,230 px, behind two set-up forms).
        if (strict && viewport.width === 1440) {
          const { firstShelf, firstPoster } = report.homeOrder.at(-1);
          assert(firstPoster < 900, `first titles at ${firstPoster}px`);
          assert(firstShelf < 1500, `first shelf at ${firstShelf}px`);
        }
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
    "Home with history: resuming comes before the session",
    async () => {
      const meta = await call("metadata", {
        type: "movie",
        id: "uifix:popular-1",
      });
      const sources = await call("streams", { type: "movie", id: meta.id });
      await call("play", {
        key: sources.streams[0].key,
        meta,
        videoId: meta.id,
      });
      await page.waitForFunction(
        () => document.querySelector("video.riwaq-video")?.currentTime > 0.3,
      );
      await call("playerCommand", { action: "seek", value: 11.5 });
      await page.waitForFunction(
        () => document.querySelector("video.riwaq-video")?.currentTime > 10.5,
        null,
        { timeout: 20000 },
      );
      await call("playerCommand", { action: "pause" });
      await call("stop");
      await page.waitForFunction(() => !document.querySelector(".theater"));
      await page.reload();
      await page.locator(".app").waitFor();
      await home();
      await page.evaluate(() => scrollTo(0, 0));
      await settle();
      await shot("home-ar-1440-history");
      const order = await page.evaluate(() =>
        [...document.querySelectorAll(".content > *, .page-body > *")]
          .filter((el) => el.matches(".session-home, .rail, .taste-discovery"))
          .map((el) =>
            el.matches(".session-home")
              ? "session"
              : el.matches(".taste-discovery")
                ? "taste"
                : el.querySelector("h2")?.textContent || "rail",
          ),
      );
      report.homeOrder.push({ lang: "ar", history: true, order });
      if (strict) {
        assert.equal(order[0], "نكمل الحكاية؟", JSON.stringify(order));
        assert.equal(order[1], "session", JSON.stringify(order));
      }
    },
  );
  await check(
    "Today's session widens and narrows, remembered per profile",
    async () => {
      await home();
      const session = page.locator(".session-home");
      assert.equal(await session.locator(".session-preview").count(), 0);
      await session.getByRole("button", { name: "عرض أوسع" }).click();
      await session.locator(".session-preview").waitFor();
      assert.equal((await call("init")).settings.sessionExpanded, true);
      await page.reload();
      await page.locator(".session-home .session-preview").waitFor();
      await shot("home-ar-1440-session-full");
      await page
        .locator(".session-home")
        .getByRole("button", { name: "عرض مختصر" })
        .click();
      await page
        .locator(".session-home .session-preview")
        .waitFor({ state: "detached" });
      assert.equal((await call("init")).settings.sessionExpanded, false);
    },
  );
  await check(
    "rows: mouse drag moves every horizontal row on Home",
    async () => {
      await home();
      await dragRows("home");
      // A chip replaces the shelf's row element (a late, replaced ref).
      await page.locator(".smart-shelf .smart-chips [role=tab]").nth(1).click();
      await dragRows("home, after a chip replaced the row");
      await page.locator(".smart-shelf .smart-chips [role=tab]").nth(0).click();
      await discover();
      await dragRows("discover");
      await language("en");
      await home();
      await dragRows("home, English");
      await language("ar");
      // The See all grid keeps the wheel's vertical scrolling, on its own
      // scroller, with the page underneath unmoved.
      await home();
      await page
        .locator(".smart-shelf .rail-tools .text-button")
        .first()
        .click();
      const grid = page.locator(".browse-page .poster-grid");
      await grid.waitFor();
      const y = await page.evaluate(() => scrollY);
      const box = await grid.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(300);
      const scrolled = await page
        .locator(".browse-page")
        .evaluate((el) => el.scrollTop);
      report.drag.push({ where: "see all grid wheel", moved: scrolled });
      if (strict) {
        assert(scrolled > 200, `See all grid scrolled ${scrolled}px`);
        assert.equal(await page.evaluate(() => scrollY), y);
      }
      await page.keyboard.press("Escape");
      const stuck = report.drag.filter(
        (d) => d.moved < 20 || d.opened || d.click === false,
      );
      if (strict) assert.deepEqual(stuck, [], JSON.stringify(stuck));
    },
  );
  if (strict) {
    const seeAll = page
      .locator(".smart-shelf .rail-tools .text-button")
      .first();
    const focused = (selector, index = 0) =>
      page.evaluate(
        ([s, i]) => document.activeElement === document.querySelectorAll(s)[i],
        [selector, index],
      );
    await check("keyboard only: See all, a title, and Back twice", async () => {
      await home();
      await seeAll.focus();
      await page.keyboard.press("Enter");
      await page.locator(".browse-page").waitFor();
      assert.equal(await focused(".browse-page"), true);
      await page.keyboard.press("Tab");
      assert.equal(await focused(".browse-back"), true, "Back comes first");
      // Back, the All tab and one tab per catalog, then the first title.
      const tabs = await page.locator(".browse-tabs [role=tab]").count();
      for (let n = 0; n < tabs + 1; n++) await page.keyboard.press("Tab");
      assert.equal(await focused(".browse-page .poster-card"), true);
      await page.keyboard.press("Enter");
      await page.locator(".title-page").waitFor();
      await page.keyboard.press("Escape");
      await page.locator(".title-page").waitFor({ state: "detached" });
      await page.waitForFunction(
        () =>
          document.activeElement ===
          document.querySelector(".browse-page .poster-card"),
      );
      await page.keyboard.press("Escape");
      await page.locator(".browse-page").waitFor({ state: "detached" });
      await page.waitForFunction(
        () =>
          document.activeElement ===
          document.querySelector(".smart-shelf .rail-tools .text-button"),
      );
    });
    // Both go through the Profiles dialog, as a viewer does: the bridge
    // hands a method's result to the interface that asked for it.
    const profilesDialog = async () => {
      await page
        .locator(".riwaq-sidebar-bottom .riwaq-destination")
        .first()
        .click();
      await page.locator(".profile-grid").waitFor();
    };
    await check("a profile switch closes See all for good", async () => {
      await call("profileCreate", { name: "Second" });
      await page.reload();
      await page.locator(".app").waitFor();
      await home();
      await seeAll.click();
      await page.locator(".browse-page").waitFor();
      await profilesDialog();
      await page.locator(".profile-card:not(.current) .profile-pick").click();
      await page.locator(".browse-page").waitFor({ state: "detached" });
      await page.locator(".profile-card:not(.current) .profile-pick").click();
      await page.keyboard.press("Escape");
      await page.locator(".smart-shelf .poster-card").first().waitFor();
      assert.equal(await page.locator(".browse-page").count(), 0);
      const state = await call("init");
      await call("profileRemove", {
        id: state.profiles.list.find((p) => p.id !== state.profiles.active).id,
      });
      await page.reload();
      await page.locator(".app").waitFor();
    });
    await check("locking the profile closes See all", async () => {
      await home();
      await profilesDialog();
      await page
        .locator(".profile-card.current")
        .getByRole("button", { name: "رمز حماية" })
        .click();
      await page.getByLabel(/الرمز الجديد/).fill("2468");
      await page.getByRole("button", { name: "حفظ", exact: true }).click();
      await page.getByRole("button", { name: "إعادة القفل الآن" }).waitFor();
      await page.keyboard.press("Escape");
      await seeAll.click();
      await page.locator(".browse-page").waitFor();
      await profilesDialog();
      await page.getByRole("button", { name: "إعادة القفل الآن" }).click();
      await page.locator(".browse-page").waitFor({ state: "detached" });
      await page.keyboard.press("Escape");
      const id = (await call("init")).profiles.active;
      await call("profileUnlock", { pin: "2468" });
      await call("profilePin", { id, pin: null, current: "2468" });
      await page.reload();
      await page.locator(".app").waitFor();
    });
    await check(
      "200% zoom and reduced motion keep the page usable",
      async () => {
        // A 1440×900 window at 200% zoom lays out as 720×450 CSS pixels.
        await page.setViewportSize({ width: 720, height: 450 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await home();
        await page.evaluate(() => scrollTo(0, 0));
        await seeAll.scrollIntoViewIfNeeded();
        await seeAll.click();
        const browse = page.locator(".browse-page");
        await browse.waitFor();
        await settle();
        await shot("seeall-ar-zoom200");
        const back = await page.locator(".browse-back").boundingBox();
        assert(back.y >= 0 && back.x >= 0 && back.x + back.width <= 720);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          true,
        );
        assert.equal(
          await browse.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          true,
        );
        assert.equal(
          await page.evaluate(() =>
            parseFloat(
              getComputedStyle(document.querySelector(".app")).getPropertyValue(
                "--motion-base",
              ),
            ),
          ),
          0,
        );
        await page.keyboard.press("Escape");
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await page.setViewportSize({ width: 1440, height: 900 });
      },
    );
  }
} finally {
  report.problems = problems;
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  fixture.close();
}
const failed = results.filter((r) => !r.pass);
console.log(
  `${results.length - failed.length}/${results.length} passed · evidence in ${output}`,
);
if (problems.length) console.log("Page problems:\n" + problems.join("\n"));
if (strict && (failed.length || problems.length)) process.exit(1);
