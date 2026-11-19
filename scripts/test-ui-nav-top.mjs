// Issue #156 in a real Chromium against the built web edition: Home,
// Discover and the Riwaq logo open their page at its start, also when it is
// the page already shown and scrolled down, and also from a title page or
// See all opened over it; Back from those still returns to where the viewer
// was. Arabic and English at 1440, 768 and 390 px, with reduced motion and
// the keyboard. The document is the page's scroller (App saves and restores
// window.scrollY), so that is what is measured. Local addon only.
//
//   npm run build:web && node scripts/test-ui-nav-top.mjs
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { loadPlaywright, startUiFixture } from "./fixtures/ui-browse-addon.mjs";

const { chromium } = loadPlaywright();
const site = resolve(process.env.RIWAQ_WEB_DIST || "dist-web");
if (!existsSync(join(site, "index.html")))
  throw new Error("Build the site first: npm run build:web");
const output = resolve(".cache/ui-nav-top");
mkdirSync(output, { recursive: true });
const fixture = await startUiFixture(site);
const { siteUrl, base } = fixture;
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

const y = () => page.evaluate(() => Math.round(window.scrollY));
const view = async () => {
  // Narrow: the destinations live in the drawer, rendered while it is open.
  const drawer = await page.locator(".riwaq-drawer-trigger").isVisible();
  if (drawer) {
    await page.locator(".riwaq-drawer-trigger").click();
    await page.locator(".riwaq-nav-dialog[open]").waitFor();
  }
  const at = await page.evaluate(() => {
    const scope = document.querySelector(".riwaq-nav-dialog[open]") || document;
    const items = [...scope.querySelectorAll(".riwaq-destinations > button")];
    return items.findIndex((b) => b.getAttribute("aria-current"));
  });
  if (drawer) {
    await page.keyboard.press("Escape");
    await page
      .locator(".riwaq-nav-dialog[open]")
      .waitFor({ state: "detached" });
  }
  return at === 0 ? "home" : at === 1 ? "discover" : String(at);
};
/** Scrolls the page well down; fails if the page is too short to test. */
const scrollDown = async () => {
  const to = await page.evaluate(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollTo({ top: Math.min(1600, max), behavior: "instant" });
    return Math.round(scrollY);
  });
  assert(to > 300, `the page scrolled only ${to}px`);
  await page.waitForTimeout(80);
  return to;
};
/** Waits for the page to reach the top (a smooth glide takes a moment). */
const atTop = async (label) => {
  await page
    .waitForFunction(() => window.scrollY === 0, null, { timeout: 2500 })
    .catch(() => {});
  assert.equal(await y(), 0, `${label}: scrollY`);
};
const narrow = () => page.locator(".riwaq-drawer-trigger").isVisible();
/** A destination by its place in the navigation (the drawer when narrow). */
const navTo = async (index) => {
  if (await narrow()) {
    await page.locator(".riwaq-drawer-trigger").click();
    await page.locator(".riwaq-nav-dialog[open]").waitFor();
    await page
      .locator(".riwaq-nav-dialog .riwaq-destinations > button")
      .nth(index)
      .click();
    await page
      .locator(".riwaq-nav-dialog[open]")
      .waitFor({ state: "detached" });
  } else await page.locator(".riwaq-destinations > button").nth(index).click();
};
const home = () => navTo(0);
const discover = () => navTo(1);
const logo = () => page.locator(".riwaq-wordmark").click();
const cards = async () => {
  await page.locator(".poster-card").first().waitFor();
  await page.waitForTimeout(250);
};
/** Clicks an element where it is on screen (no scrolling by the click). */
const clickInPlace = async (locator) => {
  const box = await locator.boundingBox();
  assert(box, "the control is on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
/** Clicks a card where it shows now, so the click does not scroll the page. */
const clickVisibleCard = async () => {
  const point = await page.evaluate(() => {
    const top = 90;
    const bottom = innerHeight - 20;
    for (const el of document.querySelectorAll(".content .poster-card")) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.bottom < top + 60 || r.top > bottom - 60) continue;
      const y = (Math.max(r.top, top) + Math.min(r.bottom, bottom)) / 2;
      const x = r.left + r.width / 2;
      if (x < 0 || x > innerWidth) continue;
      if (document.elementFromPoint(x, y)?.closest(".poster-card") !== el)
        continue;
      return { x, y };
    }
    return null;
  });
  assert(point, "a card on screen");
  await page.mouse.click(point.x, point.y);
};
const noOverflow = async () =>
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
    "no horizontal page overflow",
  );

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
  await cards();

  for (const lang of ["ar", "en"]) {
    await call("settings", { uiLanguage: lang });
    await page.reload();
    await page.waitForFunction(
      (l) => document.documentElement.lang === l,
      lang,
    );
    await cards();
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 768, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const tag = `${lang}-${viewport.width}`;
      await check(
        `${tag}: Home on Home, scrolled down, returns to the top`,
        async () => {
          await home();
          await cards();
          await scrollDown();
          await home();
          await atTop("Home on Home");
          assert.equal(await view(), "home");
          await noOverflow();
        },
      );
      await check(
        `${tag}: Discover on Discover, scrolled down, returns to the top`,
        async () => {
          await discover();
          await cards();
          await scrollDown();
          await discover();
          await atTop("Discover on Discover");
          assert.equal(await view(), "discover");
        },
      );
      await check(
        `${tag}: Home → Discover and Discover → Home open at the start`,
        async () => {
          await home();
          await cards();
          await scrollDown();
          await discover();
          await cards();
          await atTop("Home → Discover");
          assert.equal(await view(), "discover");
          await scrollDown();
          await home();
          await cards();
          await atTop("Discover → Home");
          assert.equal(await view(), "home");
        },
      );
      await check(
        `${tag}: the logo goes to Home's start from Home and from Discover`,
        async () => {
          await home();
          await cards();
          await scrollDown();
          await logo();
          await atTop("logo on Home");
          assert.equal(await view(), "home");
          await discover();
          await cards();
          await scrollDown();
          await logo();
          await cards();
          await atTop("logo from Discover");
          assert.equal(await view(), "home");
        },
      );
      await check(
        `${tag}: from a title page, the logo and Home close it onto Home's start`,
        async () => {
          for (const how of ["logo", "home"]) {
            await home();
            await cards();
            await scrollDown();
            await clickVisibleCard();
            await page.locator(".title-page").waitFor();
            if (how === "logo") await logo();
            else await home();
            await page.locator(".title-page").waitFor({ state: "detached" });
            await atTop(`${how} from a title`);
            assert.equal(await view(), "home");
            assert.equal(
              await page.evaluate(
                () => !!document.querySelector(".content > [inert]"),
              ),
              false,
              "nothing is left inert",
            );
          }
        },
      );
      await check(
        `${tag}: from See all, Home closes it onto Home's start`,
        async () => {
          await home();
          await cards();
          const more = page
            .locator(".smart-shelf .rail-tools .text-button")
            .first();
          await scrollDown();
          await more.evaluate((el) =>
            el.scrollIntoView({ block: "center", behavior: "instant" }),
          );
          assert((await y()) > 200, "See all opens from a scrolled page");
          await clickInPlace(more);
          await page.locator(".browse-page").waitFor();
          await home();
          await page.locator(".browse-page").waitFor({ state: "detached" });
          await atTop("Home from See all");
        },
      );
      await check(
        `${tag}: Back from a title page still returns to where the viewer was`,
        async () => {
          await home();
          await cards();
          await scrollDown();
          const before = await y();
          await clickVisibleCard();
          await page.locator(".title-page").waitFor();
          await page.locator(".title-page .back-button").click();
          await page.locator(".title-page").waitFor({ state: "detached" });
          await page.waitForTimeout(150);
          assert(
            Math.abs((await y()) - before) <= 2,
            `Back kept ${await y()} (was ${before})`,
          );
        },
      );
      await check(
        `${tag}: Back from See all still returns to where the viewer was`,
        async () => {
          await home();
          await cards();
          const more = page
            .locator(".smart-shelf .rail-tools .text-button")
            .first();
          await scrollDown();
          await more.evaluate((el) =>
            el.scrollIntoView({ block: "center", behavior: "instant" }),
          );
          const before = await y();
          await clickInPlace(more);
          await page.locator(".browse-page").waitFor();
          await page.locator(".browse-back").click();
          await page.locator(".browse-page").waitFor({ state: "detached" });
          await page.waitForTimeout(150);
          assert(
            Math.abs((await y()) - before) <= 2,
            `Back kept ${await y()} (was ${before})`,
          );
        },
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await check(
      `${lang}: with reduced motion the same-page return is immediate`,
      async () => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await home();
        await cards();
        await scrollDown();
        await page.locator(".riwaq-destinations > button").first().click();
        // No glide: the next frame is already at the top.
        await page.evaluate(() => new Promise(requestAnimationFrame));
        assert.equal(await y(), 0);
        await page.emulateMedia({ reducedMotion: "no-preference" });
      },
    );
    await check(
      `${lang}: the keyboard (Enter on Home, Space on the logo) does the same and keeps focus on the control`,
      async () => {
        await home();
        await cards();
        await scrollDown();
        const homeButton = page.locator(".riwaq-destinations > button").first();
        await homeButton.focus();
        await page.keyboard.press("Enter");
        await atTop("Enter on Home");
        assert.equal(
          await homeButton.evaluate((el) => el === document.activeElement),
          true,
        );
        await scrollDown();
        await page.locator(".riwaq-wordmark").focus();
        await page.keyboard.press("Space");
        await atTop("Space on the logo");
        assert.equal(
          await page.evaluate(() =>
            document.activeElement?.classList.contains("riwaq-wordmark"),
          ),
          true,
        );
      },
    );
    await check(`${lang}: the logo is a named button`, async () => {
      const name = await page
        .locator(".riwaq-wordmark")
        .evaluate((el) => [el.tagName, el.getAttribute("aria-label")]);
      assert.equal(name[0], "BUTTON");
      assert.match(name[1], lang === "ar" ? /رِواق/ : /Riwaq/);
    });
  }
} finally {
  writeFileSync(
    join(output, "report.json"),
    JSON.stringify({ results, problems }, null, 2),
  );
  await browser.close();
  fixture.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (problems.length) console.log("Page problems:\n" + problems.join("\n"));
if (failed.length || problems.length) process.exit(1);
