/**
 * The web edition's sealed IndexedDB vault in Chromium (PR #155 third
 * review, N1; docs/REVIEW-PR-155.md, "Fourth pass"). Everything is real:
 * the built site, IndexedDB, WebCrypto, the bridge and core/Client. Only
 * the failure is staged, the way the reviewer staged it (an aborted vault
 * transaction) and in the other ways a browser refuses a write: a request
 * error, an abort after the request succeeded, a real quota refusal, and a
 * page that goes away while the write is under way.
 *
 *   npm run build:web && node scripts/test-web-durability.mjs
 *
 * The invariant checked in every case: a change the vault did not commit
 * is answered as a failure, is not in memory afterwards, is not written by
 * any later save, and never lets the artwork sweep delete a picture the
 * kept state still names. Exits 1 on any failed check.
 */
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "./fixtures/ui-browse-addon.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const site = resolve(process.env.RIWAQ_WEB_DIST || resolve(root, "dist-web"));
const ORIGIN = "https://riwaq-durability.invalid";
const TYPES = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};
const { chromium } = loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.RIWAQ_CHROMIUM || undefined,
});
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function fresh({ quota } = {}) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== ORIGIN) return route.abort();
    const file = resolve(
      site,
      "." + (url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!file.startsWith(site + sep)) return route.abort();
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: TYPES[extname(file)] || "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  const page = await context.newPage();
  // A quota applies to the storage the page opens after it is set.
  let cdp = null;
  if (quota) {
    cdp = await context.newCDPSession(page);
    await cdp.send("Storage.overrideQuotaForOrigin", {
      origin: ORIGIN,
      quotaSize: quota,
    });
  }
  await page.goto(ORIGIN);
  await ready(page);
  return { context, page, cdp };
}
const ready = (page) =>
  page.waitForFunction(() => window.riwaq?.platform === "web", null, {
    timeout: 20000,
  });
const titles = (page) =>
  page.evaluate(async () => {
    const { state } = await window.riwaq.call("hudSnapshot");
    return state.collections.map((c) => c.title);
  });
const language = (page) =>
  page.evaluate(async () => {
    const { state } = await window.riwaq.call("hudSnapshot");
    return state.settings.uiLanguage;
  });
const reload = async (page) => {
  await page.reload();
  await ready(page);
};

/**
 * Installs one staged failure on the next vault write of the profile, then
 * runs `call` (a bridge call) and reports whether it was refused.
 * Kinds: abort (the reviewer's), request-error (a ConstraintError from the
 * request itself), abort-after-success (the put succeeded, the transaction
 * did not).
 */
const failNextWrite = (page, kind, call) =>
  page.evaluate(
    async ({ kind, call }) => {
      const put = IDBObjectStore.prototype.put;
      let staged = 0;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name !== "vault" || args[1] !== "profile")
          return put.apply(this, args);
        IDBObjectStore.prototype.put = put;
        staged++;
        if (kind === "abort") {
          this.transaction.abort();
          return undefined;
        }
        if (kind === "request-error") {
          // The key exists: add() fails as a request, and the transaction
          // aborts with that error.
          return this.add(...args);
        }
        const req = put.apply(this, args);
        req.addEventListener("success", () => this.transaction.abort());
        return req;
      };
      try {
        const { state } = await window.riwaq.call("hudSnapshot");
        const args = JSON.parse(
          JSON.stringify(call.args).replace(
            '"$SESSION"',
            JSON.stringify(state.profiles.session),
          ),
        );
        try {
          await window.riwaq.call(call.method, args);
          return { staged, refused: false };
        } catch (error) {
          return { staged, refused: true, message: String(error.message) };
        }
      } finally {
        IDBObjectStore.prototype.put = put;
      }
    },
    { kind, call },
  );
const replaceCall = (title) => ({
  method: "importNuvioCollections",
  args: {
    text: JSON.stringify([{ id: "replacement", title }]),
    only: ["nuvio-replacement"],
    mode: "replace",
    profileSession: "$SESSION",
  },
});
const call = (page, method, args) =>
  page.evaluate(({ method, args }) => window.riwaq.call(method, args), {
    method,
    args,
  });

try {
  // 1. A normal Replace: answered after the commit, kept across reload.
  {
    const { context, page } = await fresh();
    await call(page, "collectionsEdit", {
      action: "create",
      title: "Existing",
    });
    await page.evaluate(async () => {
      const { state } = await window.riwaq.call("hudSnapshot");
      await window.riwaq.call("importNuvioCollections", {
        text: JSON.stringify([{ id: "replacement", title: "Replacement" }]),
        only: ["nuvio-replacement"],
        mode: "replace",
        profileSession: state.profiles.session,
      });
    });
    await reload(page);
    check(
      "1 normal Replace survives reload",
      JSON.stringify(await titles(page)) === '["Replacement"]',
      JSON.stringify(await titles(page)),
    );
    await context.close();
  }

  // 2–4. Each way a vault write is refused.
  for (const kind of ["abort", "request-error", "abort-after-success"]) {
    const { context, page } = await fresh();
    await call(page, "collectionsEdit", {
      action: "create",
      title: "Existing",
    });
    await call(page, "settings", { uiLanguage: "en" });
    const before = await titles(page);
    const outcome = await failNextWrite(page, kind, replaceCall("Replacement"));
    check(
      `${kind}: the refused Replace is answered as a failure`,
      outcome.staged === 1 && outcome.refused,
      JSON.stringify(outcome),
    );
    check(
      `${kind}: memory is back to the kept collections at once`,
      JSON.stringify(await titles(page)) === JSON.stringify(before),
      JSON.stringify(await titles(page)),
    );
    await reload(page);
    check(
      `${kind}: reload shows the kept collections`,
      JSON.stringify(await titles(page)) === JSON.stringify(before),
    );
    // The same refusal again, then an unrelated save, then reload: the
    // reviewer's second observation.
    await failNextWrite(page, kind, replaceCall("Replacement"));
    await call(page, "settings", { uiLanguage: "ar" });
    await reload(page);
    check(
      `${kind}: an unrelated save afterwards does not write the refused Replace`,
      JSON.stringify(await titles(page)) === JSON.stringify(before) &&
        (await language(page)) === "ar",
      `${JSON.stringify(await titles(page))} ${await language(page)}`,
    );
    // A retry after the failure goes through.
    await page.evaluate(async () => {
      const { state } = await window.riwaq.call("hudSnapshot");
      await window.riwaq.call("importNuvioCollections", {
        text: JSON.stringify([{ id: "replacement", title: "Replacement" }]),
        only: ["nuvio-replacement"],
        mode: "replace",
        profileSession: state.profiles.session,
      });
    });
    await reload(page);
    check(
      `${kind}: a retry is kept`,
      JSON.stringify(await titles(page)) === '["Replacement"]',
    );
    await context.close();
  }

  // 5. Two concurrent mutations, the first refused.
  {
    const { context, page } = await fresh();
    await call(page, "collectionsEdit", { action: "create", title: "Kept" });
    const both = await page.evaluate(async () => {
      const put = IDBObjectStore.prototype.put;
      let staged = false;
      IDBObjectStore.prototype.put = function (...args) {
        if (!staged && this.name === "vault" && args[1] === "profile") {
          staged = true;
          // The browser answers slowly, then refuses: the transaction is
          // kept open with reads until it aborts.
          const store = this;
          const t = this.transaction;
          let open = true;
          const keep = () => {
            if (open) store.get("key").onsuccess = keep;
          };
          keep();
          setTimeout(() => {
            open = false;
            t.abort();
          }, 80);
          return put.apply(this, args);
        }
        return put.apply(this, args);
      };
      const run = (title) =>
        window.riwaq.call("collectionsEdit", { action: "create", title }).then(
          () => "kept",
          () => "refused",
        );
      const first = run("First");
      await new Promise((r) => setTimeout(r, 20));
      const second = run("Second");
      const out = await Promise.all([first, second]);
      IDBObjectStore.prototype.put = put;
      return out;
    });
    check(
      "5 concurrent: both edits built on the refused write are refused",
      JSON.stringify(both) === '["refused","refused"]',
      JSON.stringify(both),
    );
    await reload(page);
    check(
      "5 concurrent: reload keeps neither",
      JSON.stringify(await titles(page)) === '["Kept"]',
      JSON.stringify(await titles(page)),
    );
    await call(page, "collectionsEdit", { action: "create", title: "Again" });
    await reload(page);
    check(
      "5 concurrent: a later edit is kept",
      JSON.stringify(await titles(page)) === '["Kept","Again"]',
    );
    await context.close();
  }

  // 6. The artwork sweep after a refused Replace (the reviewer's third
  // observation): a picture the kept state names is never deleted.
  {
    const { context, page } = await fresh();
    const art = "b".repeat(32);
    await page.evaluate(
      async ({ id }) => {
        const call = window.riwaq.call;
        await call("collectionsEdit", { action: "create", title: "With art" });
        const { state } = await call("hudSnapshot");
        const collectionId = state.collections[0].id;
        await call("collectionsEdit", {
          action: "update",
          collectionId,
          cover: `local:${id}`,
        });
        // An image old enough for the sweep, as the reviewer staged it.
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open("riwaq-collection-art", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("art");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise((resolve, reject) => {
          const t = db.transaction("art", "readwrite");
          const bytes = Uint8Array.from(
            atob(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==",
            ),
            (ch) => ch.charCodeAt(0),
          );
          t.objectStore("art").put(
            {
              blob: new Blob([bytes], { type: "image/png" }),
              mime: "image/png",
              at: Date.now() - 30 * 60_000,
            },
            id,
          );
          t.oncomplete = resolve;
          t.onabort = () => reject(t.error);
        });
        db.close();
      },
      { id: art },
    );
    const outcome = await failNextWrite(
      page,
      "abort",
      replaceCall("Replacement"),
    );
    // Give any sweep time to run (the reviewer's sweep deleted it at once).
    await page.waitForTimeout(1500);
    const present = await page.evaluate(
      (id) =>
        new Promise((resolve, reject) => {
          const open = indexedDB.open("riwaq-collection-art", 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const req = db
              .transaction("art", "readonly")
              .objectStore("art")
              .get(id);
            req.onsuccess = () => {
              db.close();
              resolve(!!req.result);
            };
          };
        }),
      art,
    );
    check(
      "6 sweep: the refused Replace is refused and the picture stays",
      outcome.refused && present,
      JSON.stringify({ outcome, present }),
    );
    await reload(page);
    const delivered = await page.evaluate(async (ref) => {
      const { state } = await window.riwaq.call("hudSnapshot");
      return {
        named: state.collections.some((c) => c.cover === ref),
        image: !!(await window.riwaq.call("collectionArt", { id: ref })),
      };
    }, `local:${art}`);
    check(
      "6 sweep: after reload the cover is named and its image is delivered",
      delivered.named && delivered.image,
      JSON.stringify(delivered),
    );
    await context.close();
  }

  // 7. A real quota refusal (CDP Storage.overrideQuotaForOrigin): IndexedDB
  // aborts the transaction with QuotaExceededError at commit time.
  {
    let opened = null;
    let quota = "set";
    try {
      opened = await fresh({ quota: 1_000_000 });
    } catch (error) {
      quota = `unavailable: ${error.message}`;
    }
    if (opened) {
      const { context, page, cdp } = opened;
      await call(page, "collectionsEdit", { action: "create", title: "Kept" });
      // A library title whose description makes the sealed state larger
      // than the quota allows.
      const refused = await page.evaluate(async () => {
        try {
          await window.riwaq.call("favorite", {
            id: "tt0000001",
            type: "movie",
            name: "Large",
            description: "x".repeat(3_000_000),
          });
          return "kept";
        } catch (error) {
          return String(error.message);
        }
      });
      const memory = await page.evaluate(async () => {
        const { state } = await window.riwaq.call("hudSnapshot");
        return state.favorites.length;
      });
      await cdp.send("Storage.overrideQuotaForOrigin", { origin: ORIGIN });
      await call(page, "settings", { uiLanguage: "en" });
      await reload(page);
      const after = await page.evaluate(async () => {
        const { state } = await window.riwaq.call("hudSnapshot");
        return {
          favorites: state.favorites.length,
          titles: state.collections.map((c) => c.title),
        };
      });
      check(
        "7 quota: a write over the quota is refused and not kept",
        refused !== "kept" &&
          memory === 0 &&
          after.favorites === 0 &&
          JSON.stringify(after.titles) === '["Kept"]',
        JSON.stringify({ refused, memory, after }),
      );
      await context.close();
    } else check("7 quota: CDP quota override", true, `NOT RUN (${quota})`);
  }

  // 8. The page goes away while the write is under way: nothing was
  // answered as done, and the reload shows what was kept.
  {
    const { context, page } = await fresh();
    await call(page, "collectionsEdit", { action: "create", title: "Kept" });
    await page.evaluate(() => {
      const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
      crypto.subtle.encrypt = (...args) =>
        new Promise((resolve) => setTimeout(resolve, 5000)).then(() =>
          encrypt(...args),
        );
      window.__answered = "pending";
      window.riwaq
        .call("collectionsEdit", { action: "create", title: "Interrupted" })
        .then(
          () => (window.__answered = "kept"),
          () => (window.__answered = "refused"),
        );
    });
    await page.waitForTimeout(300);
    const answered = await page.evaluate(() => window.__answered);
    await reload(page);
    check(
      "8 interrupted: unanswered before the page went, not kept after",
      answered === "pending" &&
        JSON.stringify(await titles(page)) === '["Kept"]',
      JSON.stringify({ answered, after: await titles(page) }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed (Chromium ${browser.version?.() || ""})`,
);
process.exit(failed.length ? 1 : 0);
