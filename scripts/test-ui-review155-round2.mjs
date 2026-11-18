// Codex's second review of PR #155 in Chromium (docs/REVIEW-PR-155.md,
// "Third pass"): R1 an open folder removed by a state update, R7 a remote
// APNG named ".png" in a still slot under Reduced Motion, R8 a broken logo
// next to a sibling's good one, R9 refused Discover values named in the
// form, and F2 a pasted preview imported after A → B → A.
//
//   npm run build:web
//   node scripts/test-ui-review155-round2.mjs
//
// RIWAQ_WEB_DIST=<older dist-web> records an older build. UI_ONLY=<pattern>
// runs some checks. Evidence lands in .cache/ui-review155-round2.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { loadPlaywright, startUiFixture } from "./fixtures/ui-browse-addon.mjs";
import { bytesOf } from "./fixtures/moving-images.mjs";

const { chromium } = loadPlaywright();
const site = resolve(process.env.RIWAQ_WEB_DIST || "dist-web");
const output = resolve(".cache/ui-review155-round2");
mkdirSync(output, { recursive: true });
const fixture = await startUiFixture(site);
const { siteUrl } = fixture;

const IMG = "https://img.example/";
const APNG = `${IMG}cover.png`;
const GOOD_LOGO = `${IMG}good-logo.png`;
const BROKEN_LOGO = `${IMG}missing-logo.png`;
const STILL = `${IMG}still.png`;
// Fourth pass (N7, N8, N10): an APNG at an address ending ".jpg", one
// reached through a ".jpg" redirect, a backdrop that fails, a large PNG.
const APNG_JPG = `${IMG}disguised.jpg`;
// A real redirect (a routed 302 is not followed for an image), from a
// local server, to a two-frame APNG.
const redirector = createServer((req, res) => {
  if (req.url === "/redirect.jpg") {
    res.writeHead(302, { Location: "/redirect-target.png" });
    return res.end();
  }
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Cache-Control": "no-store",
  });
  res.end(bytesOf("apng"));
});
await new Promise((r) => redirector.listen(0, "127.0.0.1", r));
const REDIRECT_JPG = `${IMG}redirect.jpg`;
const REDIRECT_TARGET = `http://127.0.0.1:${redirector.address().port}/redirect.jpg`;
const BROKEN_BACKDROP = `${IMG}backdrop-missing.png`;
const LARGE = (n) => `${IMG}large-${n}.png`;
const requested = [];

const browser = await chromium.launch({
  executablePath: process.env.RIWAQ_CHROMIUM || undefined,
});
const results = [];
const only = process.env.UI_ONLY ? new RegExp(process.env.UI_ONLY) : null;
let page;
let context;
const problems = [];
const reactErrors = [];

async function open({ reducedMotion = "no-preference" } = {}) {
  await context?.close().catch(() => {});
  context = await browser.newContext({
    viewport: { width: 1280, height: 860 },
    colorScheme: "dark",
    reducedMotion,
  });
  await context.route(/^https?:\/\//, async (route) => {
    const url = route.request().url();
    if (new URL(url).hostname === "127.0.0.1") return route.continue();
    requested.push(url);
    // The cover's own address (HTTPS, as covers must be) answers with a
    // redirect to the local server's ".jpg", which redirects again.
    if (url === REDIRECT_JPG)
      return route.fulfill({
        status: 302,
        headers: { Location: REDIRECT_TARGET },
      });
    if (url === APNG || url === APNG_JPG)
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: bytesOf("apng"),
      });
    if (url === GOOD_LOGO || url === STILL || url.startsWith(`${IMG}large-`))
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: bytesOf("png"),
      });
    return route.abort("internetdisconnected");
  });
  // The state event other windows and synced devices deliver, as the
  // reviewer's reproduction did (folder-delete-open.mjs).
  await context.addInitScript(() => {
    let bridge;
    Object.defineProperty(window, "riwaq", {
      configurable: true,
      get: () => bridge,
      set: (api) => {
        bridge = api;
        const on = api.on;
        api.on = (event, listener) => {
          if (event === "state") window.deliverState = listener;
          return on(event, listener);
        };
      },
    });
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (
      m.type() === "error" &&
      /Minified React error|Rendered (fewer|more) hooks/.test(m.text())
    )
      reactErrors.push(m.text());
  });
  await page.goto(siteUrl);
  await page.waitForFunction(() => window.deliverState);
  await call("onboardingComplete");
  await call("settings", {
    seenVersion: (await call("init")).update?.current,
    uiLanguage: "en",
  });
}
const call = (method, args) =>
  page.evaluate(([m, a]) => window.riwaq.call(m, a), [method, args]);
const check = async (name, fn) => {
  if (only && !only.test(name)) return;
  const before = problems.length + reactErrors.length;
  try {
    await fn();
    assert.equal(
      problems.length + reactErrors.length,
      before,
      [...problems, ...reactErrors].slice(before).join(" | "),
    );
    results.push({ name, pass: true });
    console.log(`✔ ${name}`);
  } catch (e) {
    const error = e.message.split("\n").slice(0, 6).join(" ");
    results.push({ name, pass: false, error });
    console.log(`✗ ${name}: ${error}`);
    await page
      ?.screenshot({ path: join(output, `failed-${results.length}.png`) })
      .catch(() => {});
  }
};
const shot = (name) =>
  page.screenshot({ path: join(output, `${name}.png`) }).catch(() => {});
const edit = (args) => call("collectionsEdit", args);
async function freshCollection(folders) {
  for (const c of (await call("init")).collections || [])
    await edit({ action: "remove", collectionId: c.id });
  let st = await edit({ action: "create", title: "Round two" });
  const c = st.collections.find((x) => x.title === "Round two");
  const ids = [];
  for (const look of folders) {
    st = await edit({
      action: "folderAdd",
      collectionId: c.id,
      title: look.title,
    });
    const f = st.collections.find((x) => x.id === c.id).folders.at(-1);
    ids.push(f.id);
    const { title, ...rest } = look;
    if (Object.keys(rest).length)
      await edit({
        action: "folderUpdate",
        collectionId: c.id,
        folderId: f.id,
        ...rest,
      });
  }
  return { collectionId: c.id, folderIds: ids };
}
async function openFolderPage(title = "Round two") {
  await page.goto(siteUrl);
  await page.locator(".app").waitFor();
  if (await page.locator(".whats-new").count())
    await page.locator(".whats-new .primary").click();
  await page.locator(".riwaq-destinations > button").nth(3).click();
  await page
    .locator(".collection-card", { hasText: title })
    .locator(".collection-open")
    .click();
  await page.locator(".folder-page-link").click();
  await page.locator(".folder-page").waitFor();
}
const fingerprint = async (locator) =>
  createHash("sha256")
    .update(await locator.screenshot())
    .digest("hex");

// --- R1 ------------------------------------------------------------------------
await open();
await check(
  "R1 an open folder removed by a state update shows its page, no crash",
  async () => {
    const { collectionId, folderIds } = await freshCollection([
      { title: "Doomed folder" },
    ]);
    await openFolderPage();
    await page
      .getByRole("heading", { name: "Doomed folder", exact: true })
      .waitFor();
    const saved = await edit({
      action: "folderRemove",
      collectionId,
      folderId: folderIds[0],
    });
    await page.evaluate((s) => window.deliverState(s), saved);
    await page.waitForTimeout(600);
    assert.equal(await page.locator(".folder-page").count(), 1);
    await page.getByText("The folder doesn't exist").waitFor();
    assert.deepEqual(reactErrors, []);
    await shot("r1-folder-removed");
    // Back still works from there.
    await page.locator(".folder-page .primary").click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator(".folder-page").count(), 0);
    assert.ok((await page.locator(".app").innerText()).length > 0);
  },
);
await check("R1 its whole collection removed by a state update", async () => {
  const { collectionId } = await freshCollection([{ title: "Gone too" }]);
  await openFolderPage();
  const saved = await edit({ action: "remove", collectionId });
  await page.evaluate((s) => window.deliverState(s), saved);
  await page.waitForTimeout(600);
  await page.getByText("The folder doesn't exist").waitFor();
  assert.deepEqual(reactErrors, []);
});

// --- R8 ------------------------------------------------------------------------
await check("R8 a sibling's good logo shows after a broken one", async () => {
  await freshCollection([
    { title: "Broken logo", logo: BROKEN_LOGO },
    { title: "Good logo", logo: GOOD_LOGO },
  ]);
  await openFolderPage();
  await page
    .getByRole("heading", { name: "Broken logo", exact: true })
    .waitFor();
  await page
    .locator(".folder-siblings button", { hasText: "Good logo" })
    .click();
  const logo = page.locator(".folder-hero-logo img, .folder-hero-logo canvas");
  await logo.waitFor();
  await shot("r8-sibling-logo");
  // And back: the broken one falls back to its name again.
  await page
    .locator(".folder-siblings button", { hasText: "Broken logo" })
    .click();
  await page
    .getByRole("heading", { name: "Broken logo", exact: true })
    .waitFor();
});

// --- R7 ------------------------------------------------------------------------
for (const reducedMotion of ["reduce", "no-preference"])
  await check(
    `R7 a remote two-frame APNG named .png stays still (${reducedMotion})`,
    async () => {
      await open({ reducedMotion });
      await freshCollection([{ title: "APNG", cover: APNG, backdrop: APNG }]);
      await openFolderPage();
      const hero = page.locator(".folder-hero-backdrop");
      await hero.waitFor();
      assert.equal(await hero.evaluate((el) => el.tagName), "CANVAS");
      await page.waitForFunction(
        () =>
          document.querySelector(".folder-hero-backdrop")?.dataset.ready ===
          "1",
      );
      const seen = new Set();
      for (let i = 0; i < 6; i++) {
        seen.add(await fingerprint(hero));
        await page.waitForTimeout(150);
      }
      assert.equal(seen.size, 1, `${seen.size} different frames`);
    },
  );
// N7: a name or a redirect proves nothing about a picture's frames.
for (const [label, src] of [
  ["named .jpg", APNG_JPG],
  ["behind a .jpg redirect", REDIRECT_JPG],
])
  for (const reducedMotion of ["reduce", "no-preference"])
    await check(
      `N7 a remote two-frame APNG ${label} stays still (${reducedMotion})`,
      async () => {
        await open({ reducedMotion });
        await freshCollection([{ title: "APNG", cover: src, backdrop: src }]);
        await openFolderPage();
        const hero = page.locator(".folder-hero-backdrop");
        await hero.waitFor();
        assert.equal(await hero.evaluate((el) => el.tagName), "CANVAS");
        await page.waitForFunction(
          () =>
            document.querySelector(".folder-hero-backdrop")?.dataset.ready ===
            "1",
        );
        const seen = new Set();
        for (let i = 0; i < 6; i++) {
          seen.add(await fingerprint(hero));
          await page.waitForTimeout(150);
        }
        assert.equal(seen.size, 1, `${seen.size} different frames`);
      },
    );

// N10: a backdrop that fails leaves the hero's own background, never the
// previous folder's picture.
await check(
  "N10 a folder whose backdrop fails shows no picture of the folder before it",
  async () => {
    await open();
    await freshCollection([
      { title: "With backdrop", backdrop: STILL },
      { title: "Broken backdrop", backdrop: BROKEN_BACKDROP },
    ]);
    await openFolderPage();
    await page.waitForFunction(
      () =>
        document.querySelector(".folder-hero-backdrop")?.dataset.ready === "1",
    );
    await page
      .locator(".folder-siblings button", { hasText: "Broken backdrop" })
      .click();
    await page
      .getByRole("heading", { name: "Broken backdrop", exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector(".folder-hero-backdrop"),
      null,
      { timeout: 4000 },
    );
    assert.ok(requested.includes(BROKEN_BACKDROP));
    await shot("n10-broken-backdrop");
    // And back: the good one draws again.
    await page
      .locator(".folder-siblings button", { hasText: "With backdrop" })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector(".folder-hero-backdrop")?.dataset.ready === "1",
    );
  },
);

// N8: a still far off the screen is not asked for until it comes near.
await check(
  "N8 a collection card far off the screen is not downloaded before scrolling",
  async () => {
    await open();
    for (const c of (await call("init")).collections || [])
      await edit({ action: "remove", collectionId: c.id });
    for (let i = 0; i < 24; i++) {
      const st = await edit({ action: "create", title: `Card ${i}` });
      const c = st.collections.find((x) => x.title === `Card ${i}`);
      await edit({ action: "update", collectionId: c.id, cover: LARGE(i) });
    }
    await page.goto(siteUrl);
    await page.locator(".app").waitFor();
    if (await page.locator(".whats-new").count())
      await page.locator(".whats-new .primary").click();
    requested.length = 0;
    await page.locator(".riwaq-destinations > button").nth(3).click();
    await page.locator(".collection-card").first().waitFor();
    await page.waitForTimeout(800);
    const cards = page.locator(".collection-card");
    const total = await cards.count();
    assert.ok(total >= 24, `${total} cards`);
    const far = await cards.evaluateAll((list) => {
      const h = innerHeight;
      return list
        .map((el, i) => [i, el.getBoundingClientRect().top])
        .filter(([, top]) => top > h + 600)
        .map(([i]) => i);
    });
    assert.ok(far.length > 0, "some cards are far below the screen");
    const asked = new Set(requested);
    const early = far.filter((i) => asked.has(LARGE(i)));
    assert.deepEqual(early, [], "far cards were downloaded before scrolling");
    // Scrolled to, they load.
    await cards.nth(far.at(-1)).scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    assert.ok(requested.includes(LARGE(far.at(-1))));
  },
);

// The masthead with the prayer chip at every next prayer of a day (fourth
// pass: Codex's web smoke failed at 980 px in English whenever the chip
// read "Dhuhr 12:08 PM" or "Maghrib 5:41 PM"; it depended on the hour).
await check(
  "masthead controls never overlap, whatever the next prayer says",
  async () => {
    const bad = [];
    for (const language of ["en", "ar"])
      for (const hour of [1, 5, 9, 13, 16, 20]) {
        const ctx = await browser.newContext({
          viewport: { width: 1440, height: 840 },
        });
        await ctx.route(/^https?:\/\//, (route) =>
          new URL(route.request().url()).hostname === "127.0.0.1"
            ? route.continue()
            : route.abort("internetdisconnected"),
        );
        const p = await ctx.newPage();
        await p.clock.setFixedTime(new Date(Date.UTC(2026, 10, 18, hour, 7)));
        await p.goto(siteUrl);
        await p.waitForFunction(() => window.riwaq);
        await p.evaluate(async (lang) => {
          await window.riwaq.call("onboardingComplete");
          const st = await window.riwaq.call("init");
          await window.riwaq.call("settings", {
            seenVersion: st.update?.current,
            uiLanguage: lang,
            prayerOn: true,
          });
        }, language);
        await p.reload();
        await p.locator(".riwaq-masthead .prayer-chip").waitFor();
        for (const width of [1440, 1100, 980, 860, 780]) {
          await p.setViewportSize({ width, height: 840 });
          await p.waitForTimeout(120);
          const found = await p.locator(".riwaq-masthead").evaluate((h) => {
            const items = [...h.children].map((el) => ({
              name: String(el.className).split(" ")[0],
              r: el.getBoundingClientRect(),
            }));
            const out = [];
            for (let i = 0; i < items.length; i++)
              for (let j = i + 1; j < items.length; j++) {
                const a = items[i].r,
                  b = items[j].r;
                if (
                  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
                  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
                )
                  out.push(`${items[i].name}/${items[j].name}`);
              }
            return out;
          });
          if (found.length) bad.push({ language, hour, width, found });
        }
        await ctx.close();
      }
    assert.deepEqual(bad, []);
  },
);

await check("R7 control: the same APNG moves in an <img>", async () => {
  await open({ reducedMotion: "no-preference" });
  await page.goto(siteUrl);
  await page.locator(".app").waitFor();
  const seen = await page.evaluate(async (src) => {
    const img = document.createElement("img");
    img.src = src;
    img.style.cssText =
      "position:fixed;top:0;left:0;width:64px;height:64px;z-index:99999";
    img.id = "apng-control";
    document.body.append(img);
    await img.decode();
    return true;
  }, APNG);
  assert.ok(seen);
  const frames = new Set();
  for (let i = 0; i < 8; i++) {
    frames.add(await fingerprint(page.locator("#apng-control")));
    await page.waitForTimeout(120);
  }
  assert.ok(frames.size > 1, "the fixture really animates in Chromium");
});

// --- R9 ------------------------------------------------------------------------
await open();
await check(
  "R9 the Discover form names refused fields and saves nothing",
  async () => {
    for (const c of (await call("init")).collections || [])
      await edit({ action: "remove", collectionId: c.id });
    await edit({ action: "preset", preset: "based" });
    await page.goto(siteUrl);
    await page.locator(".app").waitFor();
    await page.locator(".riwaq-destinations > button").nth(3).click();
    await page
      .locator(".collection-card")
      .first()
      .locator(".collection-open")
      .click();
    await page
      .locator(".collection-hero .button-row .secondary")
      .first()
      .click();
    const before = (await call("init")).collections[0].folders[0].tmdb[0];
    await page
      .getByRole("button", { name: /^Edit the query:/ })
      .first()
      .click();
    const form = page.locator(".discover-form");
    await form.waitFor();
    const keywords = form.getByLabel("Keywords (TMDB numbers)");
    await keywords.fill("|");
    await form.getByLabel("From date").fill("2025-12-31");
    await form.getByLabel("To date").fill("2025-01-01");
    await form.getByRole("button", { name: "Save the query" }).click();
    const alert = form.locator('[role="alert"]');
    await alert.waitFor();
    const text = await alert.innerText();
    for (const label of ["Keywords (TMDB numbers)", "From date", "To date"])
      assert.ok(text.includes(label), `${label} named: ${text}`);
    assert.equal(await keywords.getAttribute("aria-invalid"), "true");
    assert.equal(await keywords.inputValue(), "|", "what was typed stays");
    await shot("r9-refused-fields");
    assert.deepEqual(
      (await call("init")).collections[0].folders[0].tmdb[0],
      before,
      "nothing saved",
    );
    // Correcting the field clears its mark; a valid query saves.
    await keywords.fill("9672");
    assert.equal(await keywords.getAttribute("aria-invalid"), null);
    await form.getByLabel("From date").fill("2025-01-01");
    await form.getByLabel("To date").fill("2025-12-31");
    await form.getByRole("button", { name: "Save the query" }).click();
    await form.waitFor({ state: "detached" });
    const saved = (await call("init")).collections[0].folders[0].tmdb[0];
    assert.equal(saved.filters.withKeywords, "9672");
  },
);

// --- F2: a pasted preview belongs to its activation ---------------------------------
await check(
  "F2 a Replace previewed before A → B → A is refused, nothing replaced",
  async () => {
    const { collectionId } = await freshCollection([{ title: "Keep me" }]);
    let st = await call("init");
    if (st.profiles.list.length < 2)
      st = await call("profileCreate", { name: "Second" });
    const a = st.profiles.active;
    const b = st.profiles.list.find((p) => p.id !== a).id;
    await page.goto(siteUrl);
    await page.locator(".app").waitFor();
    await page.locator(".riwaq-destinations > button").nth(3).click();
    await page.locator(".collections-page .page-heading .secondary").click();
    await page.locator(".nuvio-options button").nth(2).click();
    await page
      .locator(".nuvio-paste")
      .fill(JSON.stringify([{ title: "Pasted", folders: [] }]));
    await page.locator(".nuvio-modal .button-row .primary").click();
    await page.locator(".nuvio-preview").waitFor();
    await page.locator(".nuvio-mode label").nth(2).click();
    // Another window switches away and back while the preview is open.
    await call("profileSwitch", { id: b });
    await call("profileSwitch", { id: a });
    await page.locator(".nuvio-modal .button-row .primary").click();
    await page.waitForTimeout(600);
    const titles = (await call("init")).collections.map((c) => c.title);
    assert.deepEqual(titles, ["Round two"], "the old preview replaced nothing");
    assert.equal(
      (await call("init")).collections.find((c) => c.id === collectionId)
        .folders[0].title,
      "Keep me",
    );
    assert.equal(await page.locator(".nuvio-report").count(), 0);
  },
);

await browser.close();
fixture.close();
redirector.close();
const passed = results.filter((r) => r.pass).length;
writeFileSync(
  join(output, "results.json"),
  JSON.stringify(
    { site, passed, total: results.length, results, problems },
    null,
    2,
  ),
);
console.log(`\n${passed}/${results.length} passed`);
if (problems.length) console.log(problems.join("\n"));
process.exitCode = passed === results.length ? 0 : 1;
