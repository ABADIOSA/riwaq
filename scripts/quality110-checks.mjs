import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

export async function qualityChecks({
  page,
  call,
  base,
  catalogRequests,
  site,
  baseline = false,
}) {
  const mode = baseline ? "before" : "after",
    output = resolve(".cache/quality110/" + mode);
  mkdirSync(output, { recursive: true });
  const original = (await call("init")).settings,
    results = [],
    geometry = [];
  const check = async (name, fn) => {
    try {
      await fn();
      results.push({ name, pass: true });
    } catch (e) {
      results.push({ name, pass: false, error: e.message });
      console.log("Quality check failed: " + name + ": " + e.message);
      await page
        .screenshot({
          path: join(output, "failed-" + results.length + ".png"),
        })
        .catch(() => {});
      if (await page.locator(".browse-page").count())
        await page.keyboard.press("Escape");
    }
  };
  const home = async () => {
    await page.locator(".riwaq-destinations > button").nth(0).click();
    await page.locator(".smart-shelf .poster-card").first().waitFor();
  };
  const close = async () => {
    if (await page.locator(".title-page").count())
      await page.locator(".title-page .back-button").click();
  };
  const reload = async () => {
    await page.reload();
    await page.locator(".app").waitFor();
    await page.locator(".smart-shelf .poster-card").first().waitFor();
  };
  let qualityKey;
  try {
    const installed = await call("install", {
      url: base + "/quality/manifest.json",
    });
    qualityKey = installed.addons.find(
      (a) => a.id === "riwaq.quality-fixture",
    )?.key;
    await call("settings", {
      uiLanguage: "ar",
      sidebarCollapsed: false,
      showSession: false,
      showShowcase: false,
      homeGrouping: "groups",
      homeSections: ["catalogs"],
      stremioBannerHidden: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await reload();
    await check("E: group All has a real See all action", async () => {
      const group = page.locator(".smart-shelf.group-movies");
      await group.locator(".smart-chips [role=tab]").nth(2).waitFor();
      assert.equal(await group.locator(".rail-tools .text-button").count(), 1);
      const button = group.locator(".rail-tools .text-button");
      await button.scrollIntoViewIfNeeded();
      const y = await page.evaluate(() => scrollY);
      await button.click();
      // #112: a page of the content area, never a dialog over it.
      const browser = page.locator(".browse-page");
      await browser.waitFor();
      assert.equal(await page.locator("dialog[open]").count(), 0);
      assert.equal(
        await browser.evaluate((el) => el === document.activeElement),
        true,
        "The page takes focus when it opens",
      );
      assert.deepEqual(
        await browser
          .locator(".poster-card strong")
          .allTextContents()
          .then((a) => a.slice(0, 3)),
        ["القطار الأخير", "Quality movie 0", "الساعة الزرقاء"],
      );
      // More pages come from the button or, at the end of the grid, by
      // themselves: either way each provider page is asked once, a repeated
      // page moves on, and the planted 503 keeps what had arrived.
      const quality = (skip) =>
        catalogRequests.filter(
          (r) => r.includes("/quality/catalog/") && r.includes("skip=" + skip),
        ).length;
      const loadMore = browser.locator(".load-more:not(:disabled)");
      for (let n = 0; n < 40 && !quality(60); n++) {
        if (await loadMore.isVisible()) await loadMore.click();
        else await page.waitForTimeout(100);
      }
      await browser.getByRole("alert").waitFor();
      assert.equal(quality(20), 1);
      assert.equal(quality(40), 1);
      assert.equal(quality(60), 1);
      assert(
        (await browser.locator(".poster-grid").textContent()).includes(
          "Quality movie 40",
        ),
      );
      assert.equal(await browser.locator(".poster-card").count(), 57);
      assert.equal(await browser.locator(".load-more").count(), 0);
      await browser
        .getByRole("alert")
        .getByRole("button", { name: "إعادة المحاولة" })
        .click();
      await browser.getByRole("alert").waitFor({ state: "detached" });
      await browser.locator(".load-more").waitFor({ state: "detached" });
      assert.equal(
        quality(60),
        2,
        "Explicit retry must reach the same failed provider page",
      );
      assert.equal(await browser.locator(".poster-card").count(), 57);
      await browser
        .getByRole("tab", { name: /Latest · Quality catalog/ })
        .click();
      assert.equal(await browser.locator(".poster-card").count(), 40);
      await browser.getByRole("tab", { name: /^الكل/ }).click();
      // Details from a scrolled grid, then Back to the same card and offset.
      const entry = browser.locator(".poster-card").nth(14);
      await entry.scrollIntoViewIfNeeded();
      const offset = await browser.evaluate((el) => el.scrollTop);
      assert(offset > 0, "the page scrolls on its own");
      assert.equal(await page.evaluate(() => scrollY), y);
      await entry.click();
      await page.locator(".title-page .back-button").waitFor();
      assert.equal(await browser.isVisible(), false);
      assert.equal(await browser.evaluate((el) => el.inert), true);
      await close();
      await browser.waitFor();
      await page.waitForFunction(
        () =>
          document.activeElement ===
          document.querySelectorAll(".browse-page .poster-card")[14],
      );
      assert.equal(await browser.evaluate((el) => el.scrollTop), offset);
      assert.equal(await page.evaluate(() => scrollY), y);
      await page.keyboard.press("Escape");
      await browser.waitFor({ state: "detached" });
      assert.equal(
        await page.evaluate(() =>
          [...document.querySelectorAll(".content > *")].some((el) => el.inert),
        ),
        false,
        "Nothing stays inert after Back",
      );
      assert.equal(
        await button.evaluate((el) => el === document.activeElement),
        true,
      );
      assert.equal(await page.evaluate(() => scrollY), y);
    });
    await check(
      "E: individual See all keeps catalog identity and returns its selection",
      async () => {
        const group = page.locator(".smart-shelf.group-movies");
        const tab = group.locator(".smart-chips [role=tab]").nth(2);
        await tab.click();
        await group.locator(".rail-tools .text-button").click();
        const browser = page.locator(".browse-page");
        await browser.waitFor();
        assert.equal(await browser.locator(".browse-tabs").count(), 0);
        assert.equal(await browser.locator("h1").innerText(), "Latest");
        assert.equal(await browser.locator(".poster-card").count(), 20);
        await page.keyboard.press("Escape");
        assert.equal(await tab.getAttribute("aria-selected"), "true");
        await group.locator(".smart-chips [role=tab]").first().click();
      },
    );
    await check(
      "E: a catalog's declared filters change its real requests on the page",
      async () => {
        await page
          .locator(".smart-shelf.group-movies .rail-tools .text-button")
          .click();
        const browser = page.locator(".browse-page");
        await browser.waitFor();
        await browser
          .getByRole("tab", { name: /أعمال تجريبية · Riwaq web fixture/ })
          .click();
        const language = browser.getByLabel("language", { exact: true });
        await language.waitFor();
        // A required filter offers no "All"; an optional one does.
        assert.deepEqual(
          await browser
            .getByLabel("sort", { exact: true })
            .locator("option")
            .allTextContents(),
          ["Popular", "Rating"],
        );
        const asked = catalogRequests.length;
        await language.selectOption("English");
        await browser
          .getByText("لا توجد نتائج لهذا الاختيار.", { exact: true })
          .waitFor();
        assert(
          catalogRequests
            .slice(asked)
            .some(
              (r) =>
                r.includes("/catalog/movie/webfix/") &&
                r.includes("language=English") &&
                r.includes("sort=Popular"),
            ),
        );
        await language.selectOption("");
        await browser.locator(".poster-card").first().waitFor();
        await page.keyboard.press("Escape");
        await browser.waitFor({ state: "detached" });
      },
    );
    await check(
      "E: explicit navigation dismisses a suspended catalog",
      async () => {
        await page
          .locator(".smart-shelf.group-movies .rail-tools .text-button")
          .click();
        await page.locator(".browse-page .poster-card").first().click();
        await page.locator(".title-page").waitFor();
        await page
          .locator(".riwaq-sidebar")
          .getByRole("button", { name: "الإعدادات", exact: true })
          .click();
        await page.locator(".title-page").waitFor({ state: "detached" });
        assert.equal(
          await page.locator(".browse-page").count(),
          0,
          "Changing destination must not reopen the suspended catalog",
        );
        await home();
      },
    );
    await check(
      "E: playback takes ownership from a suspended catalog",
      async () => {
        await page
          .locator(".smart-shelf.group-movies .rail-tools .text-button")
          .click();
        await page.locator(".browse-page .poster-card").first().click();
        await page.locator(".title-page").waitFor();
        const sources = await call("streams", {
          type: "movie",
          id: "webfix:last-train",
        });
        try {
          await call("play", {
            key: sources.streams[0].key,
            meta: {
              id: "webfix:last-train",
              type: "movie",
              name: "القطار الأخير",
            },
            videoId: "webfix:last-train",
          });
          await page.locator(".theater video.riwaq-video").waitFor();
          await page.locator(".title-page").waitFor({ state: "detached" });
          assert.equal(
            await page.locator(".browse-page").count(),
            0,
            "Playback takeover must not reopen the previous catalog",
          );
        } finally {
          await call("stop");
        }
        await home();
      },
    );
    await check(
      "B: Appearance applies identity immediately and survives restart",
      async () => {
        await page
          .locator(".riwaq-sidebar")
          .getByRole("button", { name: "الإعدادات", exact: true })
          .click();
        await page
          .getByRole("button", { name: "إعدادات متقدمة", exact: true })
          .click();
        await page
          .getByRole("textbox", { name: "البحث في الإعدادات" })
          .fill("الواجهة");
        await page
          .locator(".studio-index-pages")
          .getByRole("button", { name: "الواجهة", exact: true })
          .click();
        await page
          .locator(".identity-picker")
          .getByRole("radio")
          .nth(1)
          .click();
        await page.locator(".app.identity-classic").waitFor();
        assert.equal(
          (await call("init")).settings.appearance.identity,
          "classic",
        );
        await reload();
        await page.locator(".app.identity-classic").waitFor();
      },
    );
    for (const language of ["ar", "en"]) {
      const shapes = {};
      for (const identity of ["classic", "riwaq"]) {
        await call("settings", {
          uiLanguage: language,
          appearance: { identity },
        });
        await reload();
        await page.locator(".app.identity-" + identity).waitFor();
        shapes[identity] = await page
          .locator(".smart-shelf .poster-image")
          .first()
          .evaluate((el) => {
            const s = getComputedStyle(el),
              h = document.querySelector(".smart-shelf h2");
            return {
              corner: s.borderStartStartRadius,
              frame: getComputedStyle(el, "::before").borderStartStartRadius,
              ornament: getComputedStyle(h, "::before").display,
              font: getComputedStyle(h).fontFamily,
            };
          });
        for (const width of [1440, 980, 740, 390]) {
          await page.setViewportSize({
            width,
            height: width === 980 ? 680 : 900,
          });
          await page.screenshot({
            path: join(
              output,
              "home-" + language + "-" + identity + "-" + width + ".png",
            ),
          });
        }
        await page.setViewportSize({ width: 1440, height: 900 });
      }
      geometry.push({ language, shapes });
      await check(
        "B: " + language + " Riwaq and Classic render distinct arches",
        async () => {
          assert.notEqual(shapes.riwaq.corner, shapes.classic.corner);
          assert.equal(shapes.riwaq.corner, shapes.riwaq.frame);
          assert.notEqual(shapes.riwaq.ornament, "none");
        },
      );
      for (const view of ["home", "discover"]) {
        await home();
        if (view === "discover") {
          await page.locator(".riwaq-destinations > button").nth(1).click();
          await page.locator(".poster-card").first().waitFor();
        }
        const poster = page
          .locator(".poster-card")
          .filter({ has: page.locator('img[src*="/poster/series"]') })
          .first();
        await poster.scrollIntoViewIfNeeded();
        await poster.focus();
        const before = await page.evaluate(() => ({
          x: scrollX,
          y: scrollY,
          rails: [...document.querySelectorAll(".scroll-row")]
            .filter((e) => !e.closest(".title-page"))
            .map((e) => e.scrollLeft),
        }));
        await poster.click();
        await page.locator(".title-page .episode-card").first().waitFor();
        await page.screenshot({
          path: join(output, "details-" + language + "-" + view + ".png"),
        });
        await check(
          "A: " + language + " " + view + " owns detail scrolling",
          async () => {
            assert.deepEqual(
              await page.evaluate(() => ({ x: scrollX, y: scrollY })),
              { x: before.x, y: before.y },
              "Opening must preserve background offset",
            );
            const rect = await page.locator(".title-page").boundingBox();
            await page.mouse.move(
              rect.x + rect.width / 2,
              Math.max(rect.y, 0) + 150,
            );
            await page.mouse.wheel(0, 550);
            await page.waitForTimeout(150);
            assert(
              (await page
                .locator(".title-page")
                .evaluate((el) => el.scrollTop)) > 0,
              "Details must have its own scroll owner",
            );
            assert.deepEqual(
              await page.evaluate(() => ({
                x: scrollX,
                y: scrollY,
                rails: [...document.querySelectorAll(".scroll-row")]
                  .filter((e) => !e.closest(".title-page"))
                  .map((e) => e.scrollLeft),
              })),
              before,
            );
            await page
              .locator(".title-page")
              .evaluate((el) => (el.scrollTop = el.scrollHeight));
            await page.mouse.wheel(400, 1200);
            await page.waitForTimeout(150);
            assert.deepEqual(
              await page.evaluate(() => ({ x: scrollX, y: scrollY })),
              { x: before.x, y: before.y },
            );
          },
        );
        if (view === "home")
          await check(
            "A: " + language + " music bars leave the end of Details visible",
            async () => {
              // Stand-ins carry the real bars' classes and typical heights;
              // the page pads .content for them, and Details scrolls itself.
              for (const [name, height] of [
                ["music-bar", 62],
                ["local-music-bar", 110],
              ]) {
                const { end, bar } = await page.evaluate(
                  ({ name, height }) => {
                    const bar = document.createElement("div");
                    bar.className = name;
                    bar.style.height = height + "px";
                    document.querySelector(".app").append(bar);
                    const details = document.querySelector(".title-page");
                    details.scrollTop = details.scrollHeight;
                    const end = Math.round(
                      details.lastElementChild.getBoundingClientRect().bottom,
                    );
                    const top = Math.round(bar.getBoundingClientRect().top);
                    bar.remove();
                    return { end, bar: top };
                  },
                  { name, height },
                );
                assert(
                  end <= bar,
                  `${name} covers ${end - bar}px of the end of Details`,
                );
              }
            },
          );
        await close();
        await check(
          "A: " + language + " " + view + " returns focus and scroll",
          async () => {
            await page.waitForTimeout(80);
            assert.equal(
              await poster.evaluate((el) => el === document.activeElement),
              true,
            );
            assert.equal(await page.evaluate(() => scrollY), before.y);
          },
        );
      }
      await home();
      await page.setViewportSize({ width: 390, height: 840 });
      await page
        .locator(".poster-card")
        .filter({ has: page.locator('img[src*="/poster/series"]') })
        .first()
        .click();
      await page.locator(".title-page .episode-card").first().waitFor();
      await check(
        "A: " + language + " compact keyboard and touch stay in Details",
        async () => {
          const details = page.locator(".title-page");
          const before = await page.evaluate(() => ({
            x: scrollX,
            y: scrollY,
          }));
          await details.evaluate((el) => {
            el.scrollTop = 0;
            el.focus({ preventScroll: true });
          });
          await page.keyboard.press("PageDown");
          await page.waitForTimeout(180);
          assert((await details.evaluate((el) => el.scrollTop)) > 0);
          await details.evaluate((el) => (el.scrollTop = 0));
          await page.mouse.move(190, 220);
          await page.mouse.wheel(-350, -500);
          await page.waitForTimeout(120);
          const cdp = await page.context().newCDPSession(page);
          try {
            await cdp.send("Emulation.setTouchEmulationEnabled", {
              enabled: true,
            });
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchStart",
              touchPoints: [{ x: 190, y: 550 }],
            });
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ x: 190, y: 290 }],
            });
            await cdp.send("Input.dispatchTouchEvent", {
              type: "touchEnd",
              touchPoints: [],
            });
            await page.waitForTimeout(150);
            assert((await details.evaluate((el) => el.scrollTop)) > 0);
          } finally {
            await cdp.send("Emulation.setTouchEmulationEnabled", {
              enabled: false,
            });
            await cdp.detach();
          }
          assert.deepEqual(
            await page.evaluate(() => ({ x: scrollX, y: scrollY })),
            before,
          );
          assert.equal(
            await details.evaluate(
              (el) => el.scrollWidth <= el.clientWidth + 1,
            ),
            true,
          );
          await details.locator(".title-play").click();
          const sources = page.locator(".sources-modal[open]");
          await sources.locator(".stream-play").first().waitFor();
          try {
            const position = await details.evaluate((el) => el.scrollTop);
            const box = await sources.boundingBox();
            await page.mouse.move(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
            await page.mouse.wheel(0, 1200);
            await page.waitForTimeout(120);
            assert.equal(
              await details.evaluate((el) => el.scrollTop),
              position,
              "Nested source scrolling must not move Details underneath",
            );
            assert.deepEqual(
              await page.evaluate(() => ({ x: scrollX, y: scrollY })),
              before,
            );
          } finally {
            await page.keyboard.press("Escape");
          }
        },
      );
      await close();
      await page.setViewportSize({ width: 1440, height: 900 });
      await check(
        "E: " + language + " full catalog fits all requested widths",
        async () => {
          await home();
          await page
            .locator(".smart-shelf.group-movies .rail-tools .text-button")
            .click();
          const catalog = page.locator(".browse-page");
          await catalog.waitFor();
          for (const width of [1440, 980, 740, 390]) {
            await page.setViewportSize({
              width,
              height: width === 980 ? 680 : 900,
            });
            assert.equal(
              await catalog.evaluate(
                (el) => el.scrollWidth <= el.clientWidth + 1,
              ),
              true,
            );
            // Not only no overflow: the grid uses the content column (#112).
            const fill = await catalog.evaluate((el) => {
              const body = el.querySelector(".browse-body");
              const grid = el.querySelector(".poster-grid");
              const cs = getComputedStyle(body);
              const inner =
                body.clientWidth -
                parseFloat(cs.paddingLeft) -
                parseFloat(cs.paddingRight);
              return grid.getBoundingClientRect().width / inner;
            });
            assert(fill > 0.98, `grid fills ${fill} of the page body`);
            await page.screenshot({
              path: join(output, `catalog-${language}-${width}.png`),
            });
          }
          await page.keyboard.press("Escape");
          await page.setViewportSize({ width: 1440, height: 900 });
        },
      );
    }
    await call("settings", {
      uiLanguage: "ar",
      appearance: { identity: "riwaq" },
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await reload();
    const timings = [],
      startup = [];
    const requestStart = catalogRequests.length;
    await page.evaluate(() => {
      window.__qualityLong = [];
      window.__qualityObserver = new PerformanceObserver((list) =>
        window.__qualityLong.push(...list.getEntries().map((e) => e.duration)),
      );
      window.__qualityObserver.observe({ type: "longtask" });
    });
    for (let n = 0; n < 3; n++) {
      await page.locator(".riwaq-destinations > button").nth(1).click();
      await page.locator(".poster-card").first().waitFor();
      const t = performance.now();
      await home();
      timings.push(Math.round(performance.now() - t));
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = await cdp.send("Performance.getMetrics"),
      dom = await cdp.send("Memory.getDOMCounters");
    await cdp.detach();
    const longTasks = await page.evaluate(() => {
      window.__qualityObserver.disconnect();
      return window.__qualityLong;
    });
    const measuredRequests = catalogRequests.length - requestStart;
    for (let n = 0; n < 3; n++) {
      const t = performance.now();
      await reload();
      startup.push(Math.round(performance.now() - t));
    }
    const jsFiles = readdirSync(join(site, "assets")).filter((x) =>
      x.endsWith(".js"),
    );
    const report = {
      mode,
      fixture: "2 local addons + long series; external services offline",
      results,
      geometry,
      measurement: {
        homeNavigationMs: timings,
        reloadToHomeMs: startup,
        longTasksMs: longTasks,
        rendererHeap: metrics.metrics.find((x) => x.name === "JSHeapUsedSize")
          ?.value,
        dom,
        requestsSeen: measuredRequests,
        jsBundleBytes: jsFiles.reduce(
          (n, x) => n + statSync(join(site, "assets", x)).size,
          0,
        ),
      },
    };
    writeFileSync(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
    if (!baseline)
      assert.equal(
        results.filter((r) => !r.pass).length,
        0,
        "#110 behavior regressions",
      );
  } finally {
    await close();
    if (qualityKey) await call("removeAddons", { keys: [qualityKey] });
    await call("settings", original);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await page.locator(".app").waitFor();
  }
}
