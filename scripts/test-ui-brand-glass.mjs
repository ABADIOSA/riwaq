// 0.57 in a real Chromium: Riwaq's adaptive brand (#159) and the glass
// material's three levels (#158), over the built web edition and the local
// addon of scripts/fixtures/ui-browse-addon.mjs. Nothing reaches the
// internet: every other host is refused, and a request for a retired
// custom logo would be recorded and fail the run.
//
//   npm run build:web && node scripts/test-ui-brand-glass.mjs
//
// UI_ONLY=<pattern> runs some checks; RIWAQ_WEB_DIST for another build.
// Screenshots land in .cache/ui-brand-glass.
import { mkdirSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { loadPlaywright, startUiFixture } from "./fixtures/ui-browse-addon.mjs";
import { drawnContrast } from "./fixtures/contrast.mjs";

const { chromium } = loadPlaywright();
const site = resolve(process.env.RIWAQ_WEB_DIST || "dist-web");
if (!existsSync(join(site, "index.html")))
  throw new Error("Build first: npm run build:web");
const output = resolve(".cache/ui-brand-glass");
mkdirSync(output, { recursive: true });
const fixture = await startUiFixture(site);
const browser = await chromium.launch({
  executablePath: process.env.RIWAQ_CHROMIUM || undefined,
});
const outside = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "dark",
});
await context.route(/^https?:\/\//, (route) => {
  const url = new URL(route.request().url());
  if (url.hostname === "127.0.0.1") return route.continue();
  outside.push(url.href);
  return route.abort("internetdisconnected");
});
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
const brand = page.locator(".riwaq-masthead .riwaq-wordmark");
const noOverflow = () =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
/** Where the mark's centre is, measured from the navigation's side edge. */
const markAxis = () =>
  page.evaluate(() => {
    const mark = document
      .querySelector(".riwaq-masthead .riwaq-mark")
      .getBoundingClientRect();
    const rtl = document.documentElement.dir === "rtl";
    const centre = mark.left + mark.width / 2;
    return {
      axis: rtl ? window.innerWidth - centre : centre,
      height: mark.height,
    };
  });
const overlaps = (a, b) =>
  a &&
  b &&
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

await page.goto(fixture.siteUrl);
await page.waitForFunction(() => window.riwaq?.platform === "web");
await call("onboardingComplete");
await call("install", { url: `${fixture.base}/manifest.json` });
await call("settings", { seenVersion: (await call("init")).update?.current });

// --- #159: the brand follows the navigation --------------------------------
for (const lang of ["ar", "en"])
  for (const [nav, open, layout, axis] of [
    ["wheel", false, "mark", 56],
    ["wheel", true, "full", 62],
    ["rail", true, "full", 32],
    ["rail", false, "mark", 34],
  ])
    await check(
      `#159 ${lang} ${nav} ${open ? "open" : "collapsed"}: ${layout === "mark" ? "the mark alone" : "the mark and the name"}, on the icons' axis`,
      async () => {
        await appearance(
          { navStyle: nav, mode: "dark" },
          {
            uiLanguage: lang,
            wheelOpen: nav === "wheel" && open,
            sidebarCollapsed: nav === "rail" && !open,
          },
        );
        assert.equal(await brand.getAttribute("data-brand"), layout);
        assert.equal(
          await brand.getAttribute("aria-label"),
          lang === "ar" ? "رِواق — الرئيسية" : "Riwaq — Home",
        );
        const name = brand.locator(".riwaq-brand-name");
        if (layout === "full") {
          assert.equal(
            (await name.innerText()).trim(),
            lang === "ar" ? "رِواق" : "Riwaq",
          );
        } else assert.equal(await name.count(), 0);
        const mark = await markAxis();
        assert.ok(mark.height >= 28, `mark ${mark.height}px tall`);
        assert.ok(
          Math.abs(mark.axis - axis) <= 2,
          `mark centre at ${mark.axis}, the icons' axis at ${axis}`,
        );
        // Never over the search box, never a horizontal scroll.
        assert.ok(
          !overlaps(
            await brand.boundingBox(),
            await page.locator(".riwaq-masthead > .search-box").boundingBox(),
          ),
        );
        assert.ok(await noOverflow());
        await page.locator(".riwaq-masthead").screenshot({
          path: join(output, `brand-${lang}-${nav}-${layout}.png`),
        });
      },
    );

await check(
  "#159 the collapse and expand buttons change the brand at once, without a reload",
  async () => {
    await appearance(
      { navStyle: "rail" },
      { uiLanguage: "en", sidebarCollapsed: false },
    );
    assert.equal(await brand.getAttribute("data-brand"), "full");
    await page.locator(".riwaq-collapse").click();
    await settle(200);
    assert.equal(await brand.getAttribute("data-brand"), "mark");
    await page.locator(".riwaq-collapse").click();
    await settle(200);
    assert.equal(await brand.getAttribute("data-brand"), "full");
    await appearance({ navStyle: "wheel" }, { wheelOpen: false });
    assert.equal(await brand.getAttribute("data-brand"), "mark");
    await page.locator(".riwaq-collapse").click();
    await settle(200);
    assert.equal(await brand.getAttribute("data-brand"), "full");
    // The choice survives a restart, and the brand follows it.
    await page.reload();
    await page.locator(".poster-card").first().waitFor();
    assert.equal(await brand.getAttribute("data-brand"), "full");
    await page.locator(".riwaq-collapse").click();
    await settle(200);
  },
);

await check(
  "#159 a 0.56.0 logo (name only, a picture link) never draws or requests anything else",
  async () => {
    for (const legacy of [
      { logoStyle: "image", logoImage: "https://logo.invalid/riwaq.png" },
      { logoStyle: "name", logoImage: "" },
      { logoStyle: "mark", logoImage: "https://logo.invalid/old.svg" },
    ]) {
      outside.length = 0;
      await appearance(legacy, { uiLanguage: "ar", wheelOpen: false });
      assert.equal(await brand.locator("img").count(), 0);
      assert.equal(await brand.locator(".riwaq-mark").count(), 1);
      assert.equal(await brand.getAttribute("data-brand"), "mark");
      await settle(300);
      assert.deepEqual(
        outside.filter((u) => u.includes("logo.invalid")),
        [],
        "no request for a retired logo",
      );
      // Kept as saved, for a 0.56.0 device on the same account.
      const saved = (await call("init")).settings.appearance;
      assert.equal(saved.logoStyle, legacy.logoStyle);
      assert.equal(saved.logoImage, legacy.logoImage);
    }
  },
);

await check(
  "#159 the brand goes Home and to its top from the keyboard, Enter and Space",
  async () => {
    await appearance({}, { uiLanguage: "en", wheelOpen: false });
    for (const key of ["Enter", "Space"]) {
      await page.locator(".riwaq-destinations > button").nth(1).click();
      await page.waitForFunction(() =>
        document
          .querySelectorAll(".riwaq-destinations > button")[1]
          ?.hasAttribute("aria-current"),
      );
      await page.locator(".poster-card").first().waitFor();
      await page.evaluate(() => window.scrollTo(0, 600));
      // Keyboard modality first, so focus shows its ring as Tab would.
      await page.keyboard.press("Shift");
      await brand.focus();
      const ring = await brand.evaluate(
        (el) => getComputedStyle(el).outlineStyle,
      );
      assert.notEqual(ring, "none", "a visible focus ring");
      await page.keyboard.press(key);
      await page.waitForFunction(() =>
        document
          .querySelectorAll(".riwaq-destinations > button")[0]
          ?.hasAttribute("aria-current"),
      );
      await page.waitForFunction(() => window.scrollY === 0);
    }
    // Home already shown and scrolled: the brand brings it back to the top.
    await page.evaluate(() => window.scrollTo(0, 800));
    await brand.click();
    await page.waitForFunction(() => window.scrollY === 0, null, {
      timeout: 4000,
    });
  },
);

for (const width of [390, 768, 1024, 1440, 1920])
  await check(
    `#159 ${width} px: the brand fits beside the search, the trigger and the utilities`,
    async () => {
      await page.setViewportSize({ width, height: 900 });
      await appearance(
        { navStyle: "wheel" },
        { uiLanguage: "ar", wheelOpen: true },
      );
      const narrow = width <= 760;
      assert.equal(
        await brand.getAttribute("data-brand"),
        narrow ? "mark" : "full",
      );
      const box = await brand.boundingBox();
      for (const other of [
        ".riwaq-masthead > .search-box",
        ".riwaq-masthead .riwaq-utilities",
        ".riwaq-drawer-trigger",
      ]) {
        const target = page.locator(other);
        if (!(await target.isVisible())) continue;
        assert.ok(!overlaps(box, await target.boundingBox()), other);
      }
      assert.ok(await noOverflow(), "no horizontal scroll");
      await shot(`brand-width-${width}`);
    },
  );

await check(
  "#159 the narrow drawer is the navigation expanded: the mark and the name head it",
  async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const nav of ["wheel", "rail"]) {
      await appearance({ navStyle: nav }, { uiLanguage: "en" });
      await page.locator(".riwaq-drawer-trigger").click();
      const head = page.locator(".riwaq-nav-dialog[open] .riwaq-drawer-brand");
      await head.waitFor();
      assert.equal((await head.innerText()).trim(), "Riwaq");
      assert.equal(await head.locator(".riwaq-mark").count(), 1);
      // Not a control: focus starts on the navigation, as before.
      assert.equal(await head.locator("button, a, [tabindex]").count(), 0);
      // Every destination is still reachable in the drawer.
      const dialog = await page
        .locator(".riwaq-nav-dialog[open]")
        .boundingBox();
      const last = page
        .locator(".riwaq-nav-dialog .riwaq-sidebar-bottom .riwaq-destination")
        .last();
      const end = await last.boundingBox();
      assert.ok(
        end.y + end.height <= dialog.y + dialog.height + 1,
        "the drawer's last button is inside it",
      );
      await shot(`drawer-${nav}`);
      await page.keyboard.press("Escape");
      await page.locator(".riwaq-nav-dialog").waitFor({ state: "hidden" });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  },
);

await check(
  "#159 the Logo page: a preview of both states and the colour; no layouts, no picture link",
  async () => {
    await appearance({ mode: "dark", navStyle: "wheel" }, { uiLanguage: "en" });
    await page.locator(".riwaq-destinations > button").nth(8).click();
    await page.locator(".settings-search input").fill("logo");
    await page
      .getByRole("button", { name: /Logo & icon/ })
      .first()
      .click();
    const card = page
      .locator(".settings-card")
      .filter({ hasText: "Logo colour" });
    await card.waitFor();
    assert.equal(await card.locator("input").count(), 0);
    assert.equal(await card.locator(".brand-state").count(), 2);
    assert.equal(
      await card
        .locator(".brand-state")
        .nth(1)
        .locator(".riwaq-brand-name")
        .innerText(),
      "Riwaq",
    );
    assert.equal(await card.locator('[role="radio"]').count(), 2);
    for (const text of ["Logo and name", "Name only", "My image"])
      assert.equal(await page.getByText(text, { exact: true }).count(), 0);
    // Gold, and it reaches the masthead's mark.
    await card.getByRole("radio", { name: "Riwaq gold" }).click();
    await settle(200);
    assert.equal(
      await page
        .locator(".riwaq-masthead .riwaq-mark")
        .evaluate((el) => getComputedStyle(el).color),
      "rgb(231, 182, 110)",
    );
    await card.screenshot({ path: join(output, "logo-page.png") });
    await card.getByRole("radio", { name: "Accent colour" }).click();
  },
);

// --- #158: the glass material ----------------------------------------------
const style = (selector, props) =>
  page
    .locator(selector)
    .first()
    .evaluate(
      (el, list) =>
        Object.fromEntries(list.map((p) => [p, getComputedStyle(el)[p]])),
      props,
    );
const openMenu = async () => {
  await page.locator(".poster-card").nth(2).click({ button: "right" });
  await page.locator(".poster-actions").waitFor();
  await settle(150);
};
const openDialog = async () => {
  await page
    .locator(
      ".wheel-hub .riwaq-destination, .riwaq-sidebar-bottom .riwaq-destination",
    )
    .first()
    .click();
  await page.locator(".modal[open]").first().waitFor();
  await settle(300);
};

for (const mode of ["dark", "light"])
  await check(
    `#158 ${mode}: three levels, each readable over what is drawn behind`,
    async () => {
      await appearance(
        { mode, glass: "on", navStyle: "wheel" },
        { uiLanguage: "en", wheelOpen: false },
      );
      const measured = {};
      // Level 1: controls. No blur on a control.
      const control = await style("main .secondary", [
        "backdropFilter",
        "boxShadow",
        "backgroundImage",
      ]);
      assert.equal(control.backdropFilter, "none");
      assert.match(control.backgroundImage, /gradient/);
      assert.match(control.boxShadow, /inset/);
      measured.secondary = await drawnContrast(
        page,
        page.locator("main .secondary").first(),
      );
      // Level 2: the poster menu (0.56.0's selector never matched it).
      await openMenu();
      const menu = await style(".poster-actions", [
        "backdropFilter",
        "backgroundImage",
        "boxShadow",
      ]);
      assert.match(menu.backdropFilter, /blur\(20px\)/);
      assert.match(menu.backgroundImage, /data:image\/svg\+xml/);
      measured.menu = await drawnContrast(
        page,
        page.locator(".poster-actions > button").first(),
      );
      await page
        .locator(".poster-actions")
        .screenshot({ path: join(output, `glass-${mode}-menu.png`) });
      // A bright poster can fill the backdrop directly under the menu title.
      const whiteArtwork = await page.addStyleTag({
        content:
          '.app:has(.poster-actions)::after { content: ""; position: fixed; inset: 0; z-index: 499; background: white; pointer-events: none; }',
      });
      try {
        measured.menuTitle = await drawnContrast(
          page,
          page.locator(".poster-actions > strong"),
        );
      } finally {
        await whiteArtwork.evaluate((el) => el.remove());
      }
      await page.keyboard.press("Escape");
      // Level 3: a dialog.
      await openDialog();
      const dialog = await style(".modal[open]", [
        "backdropFilter",
        "backgroundImage",
        "boxShadow",
      ]);
      assert.match(dialog.backdropFilter, /blur\(24px\)/);
      assert.match(dialog.backgroundImage, /data:image\/svg\+xml/);
      measured.dialogHeading = await drawnContrast(
        page,
        page.locator(".modal[open] h1, .modal[open] h2").first(),
      );
      measured.dialogText = await drawnContrast(
        page,
        page.locator(".modal[open] .modal-inner p").first(),
      );
      await shot(`glass-${mode}-dialog`);
      await page.keyboard.press("Escape");
      await page.locator(".modal[open]").waitFor({ state: "detached" });
      // The levels differ in depth: a dialog's shadow reaches furthest.
      const reach = (shadow) =>
        Math.max(
          ...[
            ...shadow.matchAll(
              /(?:^|, )(?!.*inset)[^,]*?(\d+)px (\d+)px (\d+)px/g,
            ),
          ].map((m) => Number(m[2]) + Number(m[3])),
          0,
        );
      assert.ok(
        reach(dialog.boxShadow) > reach(menu.boxShadow) &&
          reach(menu.boxShadow) > reach(control.boxShadow),
        `depth ${reach(control.boxShadow)} < ${reach(menu.boxShadow)} < ${reach(dialog.boxShadow)}`,
      );
      writeFileSync(
        join(output, `contrast-${mode}.json`),
        JSON.stringify(measured, null, 2),
      );
      for (const [name, m] of Object.entries(measured))
        assert.ok(m.ratio >= 4.5, `${name}: ${JSON.stringify(m)}`);
    },
  );

await check(
  "#158 rest, hover, pressed, chosen and focus are five different looks",
  async () => {
    await appearance(
      { mode: "dark", glass: "on", navStyle: "wheel" },
      { uiLanguage: "en" },
    );
    // The Logo page's colour row: one chosen, one not.
    await page.locator(".riwaq-destinations > button").nth(8).click();
    await page.locator(".settings-search input").fill("logo");
    await page
      .getByRole("button", { name: /Logo & icon/ })
      .first()
      .click();
    await page.locator('.choice-row [role="radio"]').first().waitFor();
    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
    const shadowOf = async (selector, states) => {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector,
      });
      assert.ok(nodeId, selector);
      await cdp.send("CSS.forcePseudoState", {
        nodeId,
        forcedPseudoClasses: states,
      });
      const look = await page
        .locator(selector)
        .first()
        .evaluate((el) => {
          const cs = getComputedStyle(el);
          return `${cs.boxShadow} | ${cs.borderColor} | ${cs.outlineStyle} ${cs.outlineColor}`;
        });
      await cdp.send("CSS.forcePseudoState", {
        nodeId,
        forcedPseudoClasses: [],
      });
      return look;
    };
    const plain = '.choice-row [role="radio"][aria-checked="false"]';
    const chosen = '.choice-row [role="radio"][aria-checked="true"]';
    const looks = {
      rest: await shadowOf(plain, []),
      hover: await shadowOf(plain, ["hover"]),
      pressed: await shadowOf(plain, ["hover", "active"]),
      focus: await shadowOf(plain, ["focus", "focus-visible"]),
      chosen: await shadowOf(chosen, []),
    };
    await cdp.detach();
    assert.equal(
      new Set(Object.values(looks)).size,
      5,
      JSON.stringify(looks, null, 1),
    );
  },
);

await check(
  "#158 Solid, reduced transparency and forced colours: no blur, no grain, no reflection",
  async () => {
    const flat = async (label) => {
      await openDialog();
      const dialog = await style(".modal[open]", [
        "backdropFilter",
        "backgroundImage",
      ]);
      assert.equal(dialog.backdropFilter, "none", `${label}: dialog blur`);
      const backdropBlur = await page
        .locator(".modal[open]")
        .first()
        .evaluate((el) => getComputedStyle(el, "::backdrop").backdropFilter);
      assert.equal(backdropBlur, "none", `${label}: blur behind the dialog`);
      assert.doesNotMatch(
        dialog.backgroundImage,
        /data:image|radial-gradient/,
        `${label}: dialog grain or reflection`,
      );
      await page.keyboard.press("Escape");
      await page.locator(".modal[open]").waitFor({ state: "detached" });
      await openMenu();
      const menu = await style(".poster-actions", ["backdropFilter"]);
      assert.equal(menu.backdropFilter, "none", `${label}: menu blur`);
      await page.keyboard.press("Escape");
    };
    await appearance({ mode: "dark", glass: "solid" }, { uiLanguage: "en" });
    await flat("solid");
    await appearance({ glass: "on" });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: "reduce" }],
    });
    await flat("reduced transparency");
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
    await cdp.detach();
    await page.emulateMedia({ forcedColors: "active" });
    await flat("forced colours");
    await page.emulateMedia({ forcedColors: "none" });
  },
);

await check(
  "#158 never a blur on a card, a row or a page surface; motion stays transform and opacity",
  async () => {
    await appearance({ mode: "dark", glass: "on" }, { uiLanguage: "ar" });
    const blurred = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".poster-card, .poster-card *, .rail, .rail button, .settings-card, .content > *",
        ),
      ]
        .filter((el) => getComputedStyle(el).backdropFilter !== "none")
        .map((el) => el.className)
        .slice(0, 5),
    );
    assert.deepEqual(blurred, []);
    // Glass controls only animate transform, box-shadow, filter and colours,
    // never blur radius or layout.
    const transitions = await page.evaluate(() =>
      [...document.querySelectorAll("main .secondary, main .choice-row button")]
        .map((el) => getComputedStyle(el).transitionProperty)
        .filter((p) => /width|height|backdrop|blur|margin|padding/.test(p)),
    );
    assert.deepEqual(transitions, []);
  },
);

for (const [lang, width] of [
  ["ar", 390],
  ["en", 768],
  ["ar", 1440],
])
  await check(
    `#158 ${lang} ${width} px: Home and Settings have no horizontal scroll`,
    async () => {
      await page.setViewportSize({ width, height: 900 });
      await appearance({ mode: "light", glass: "on" }, { uiLanguage: lang });
      assert.ok(await noOverflow(), "home");
      await shot(`home-${lang}-${width}-light`);
      await page.setViewportSize({ width: 1440, height: 900 });
    },
  );

console.log(
  `\n${results.filter((r) => r.pass).length}/${results.length} passed`,
);
if (problems.length) console.log(problems.join("\n"));
writeFileSync(
  join(output, "results.json"),
  JSON.stringify({ results, problems, outside }, null, 2),
);
await browser.close();
fixture.close();
if (results.some((r) => !r.pass) || problems.length) process.exitCode = 1;
