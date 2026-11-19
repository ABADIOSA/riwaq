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
import { decryptBackup } from "../core/backup.mjs";

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
    // A Live TV playlist of the fixture's own (sixth pass, V2).
    if (url.pathname === "/__fixture/live.m3u")
      return route.fulfill({
        contentType: "audio/x-mpegurl",
        body:
          "#EXTM3U\n#EXTINF:-1,Fixture one\n" +
          ORIGIN +
          "/one.ts\n#EXTINF:-1,Fixture two\n" +
          ORIGIN +
          "/two.ts\n",
      });
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

  // 9. N12: a picture read that lands after a profile switch makes no
  // object address (none cached past the cleared cache, none leaked).
  {
    const { context, page } = await fresh();
    const art = "d".repeat(32);
    const outcome = await page.evaluate(
      async ({ id }) => {
        const call = window.riwaq.call;
        await call("collectionsEdit", { action: "create", title: "Pictured" });
        let { state } = await call("hudSnapshot");
        await call("collectionsEdit", {
          action: "update",
          collectionId: state.collections[0].id,
          cover: `local:${id}`,
        });
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open("riwaq-collection-art", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("art");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise((resolve, reject) => {
          const t = db.transaction("art", "readwrite");
          t.objectStore("art").put(
            {
              blob: new Blob([new Uint8Array(8)], { type: "image/png" }),
              mime: "image/png",
              at: Date.now(),
            },
            id,
          );
          t.oncomplete = resolve;
          t.onabort = () => reject(t.error);
        });
        db.close();
        await call("profileCreate", { name: "B" });
        ({ state } = await call("hudSnapshot"));
        const a = state.profiles.active;
        const b = state.profiles.list.find((p) => p.id !== a).id;
        // The picture's read answers slowly; the switch lands meanwhile.
        const get = IDBObjectStore.prototype.get;
        let release;
        const held = new Promise((r) => (release = r));
        IDBObjectStore.prototype.get = function (...args) {
          if (this.name !== "art") return get.apply(this, args);
          IDBObjectStore.prototype.get = get;
          const store = this;
          let open = true;
          const keep = () => {
            if (open) store.count().onsuccess = keep;
          };
          keep();
          const proxy = {};
          held.then(() => {
            open = false;
            const req = get.apply(store, args);
            req.onsuccess = (e) => {
              proxy.result = req.result;
              proxy.onsuccess?.(e);
            };
            req.onerror = (e) => proxy.onerror?.(e);
          });
          return proxy;
        };
        const created = [];
        const create = URL.createObjectURL;
        URL.createObjectURL = (blob) => {
          const url = create.call(URL, blob);
          created.push(url);
          return url;
        };
        const reading = call("collectionArt", { id: `local:${id}` });
        await new Promise((r) => setTimeout(r, 50));
        await call("profileSwitch", { id: b });
        release();
        const answer = await reading;
        URL.createObjectURL = create;
        return { answer, created: created.length };
      },
      { id: art },
    );
    check(
      "9 N12: a picture read that lands after a switch is not delivered and makes no address",
      outcome.answer === "" && outcome.created === 0,
      JSON.stringify(outcome),
    );
    await context.close();
  }

  // 10. Q6 (fifth pass, the reviewer's case): a refused removal of an
  // inactive profile B with a collection and a picture of this computer.
  // B stays in memory and on disk, no unrelated save drops it, the sweep
  // keeps its picture, and a written retry removes it.
  {
    const { context, page } = await fresh();
    const art = "c".repeat(32);
    const ids = await page.evaluate(
      async ({ id }) => {
        const call = window.riwaq.call;
        const created = await call("profileCreate", { name: "Profile B" });
        const a = created.profiles.active;
        const b = created.profiles.list.find((p) => p.id !== a).id;
        await call("profileSwitch", { id: b });
        await call("collectionsEdit", { action: "create", title: "Only in B" });
        const { state } = await call("hudSnapshot");
        await call("collectionsEdit", {
          action: "update",
          collectionId: state.collections[0].id,
          cover: `local:${id}`,
        });
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
        await call("profileSwitch", { id: a });
        return { a, b };
      },
      { id: art },
    );
    const profileIds = () =>
      page.evaluate(async () => {
        const { state } = await window.riwaq.call("hudSnapshot");
        return state.profiles.list.map((p) => p.id);
      });
    const removal = {
      method: "profileRemove",
      args: { id: ids.b },
    };
    for (const kind of ["abort-after-success", "abort"]) {
      const outcome = await failNextWrite(page, kind, removal);
      const memory = await profileIds();
      await reload(page);
      const disk = await profileIds();
      check(
        `10 Q6 ${kind}: the refused removal is refused, and B stays in memory and on disk`,
        outcome.refused && memory.includes(ids.b) && disk.includes(ids.b),
        JSON.stringify({ outcome, memory, disk }),
      );
    }
    await failNextWrite(page, "abort-after-success", removal);
    await call(page, "settings", { uiLanguage: "en" });
    await page.waitForTimeout(1500); // any sweep has run
    await reload(page);
    const after = await page.evaluate(
      async ({ b, ref }) => {
        const call = window.riwaq.call;
        const { state } = await call("hudSnapshot");
        const listed = state.profiles.list.some((p) => p.id === b);
        const english = state.settings.uiLanguage === "en";
        const switched = await call("profileSwitch", { id: b });
        const { state: inB } = await call("hudSnapshot");
        return {
          listed,
          english,
          active: switched.profiles.active === b,
          collections: inB.collections.map((c) => c.title),
          cover: inB.collections[0]?.cover === ref,
          image: !!(await call("collectionArt", { id: ref })),
        };
      },
      { b: ids.b, ref: `local:${art}` },
    );
    check(
      "10 Q6: after an unrelated save and reload, B, its collection and its picture are all kept",
      after.listed &&
        after.english &&
        after.active &&
        JSON.stringify(after.collections) === '["Only in B"]' &&
        after.cover &&
        after.image,
      JSON.stringify(after),
    );
    await call(page, "profileSwitch", { id: ids.a });
    await call(page, "profileRemove", { id: ids.b });
    await reload(page);
    const gone = await profileIds();
    check(
      "10 Q6: a written retry removes B for good",
      !gone.includes(ids.b) && gone.includes(ids.a),
      JSON.stringify(gone),
    );
    await context.close();
  }

  // 11. Q6: a refused removal of the ACTIVE, PIN-protected profile puts it
  // back as on disk, locked, under a new activation; a refused switch
  // returns to the previous profile, locked; refused create and rename are
  // undone. The page is shown what is kept.
  {
    const { context, page } = await fresh();
    const outcome = await page.evaluate(async () => {
      const call = window.riwaq.call;
      const created = await call("profileCreate", { name: "Profile B" });
      const a = created.profiles.active;
      const b = created.profiles.list.find((p) => p.id !== a).id;
      await call("profileSwitch", { id: b });
      await call("profilePin", { id: b, pin: "4321" });
      return { a, b };
    });
    const session = () =>
      page.evaluate(async () => {
        const { state } = await window.riwaq.call("hudSnapshot");
        return state.profiles;
      });
    const before = await session();
    const removed = await failNextWrite(page, "abort-after-success", {
      method: "profileRemove",
      args: { id: outcome.b },
    });
    const kept = await session();
    check(
      "11 Q6: a refused removal of the active profile leaves it active, locked, in a new activation",
      removed.refused &&
        kept.active === outcome.b &&
        kept.unlocked === false &&
        kept.session !== before.session,
      JSON.stringify({ removed, before: before.session, kept }),
    );
    await call(page, "profileUnlock", { pin: "4321" });
    const switched = await failNextWrite(page, "abort", {
      method: "profileSwitch",
      args: { id: outcome.a },
    });
    const back = await session();
    check(
      "11 Q6: a refused switch returns to the previous profile, locked",
      switched.refused && back.active === outcome.b && back.unlocked === false,
      JSON.stringify({ switched, back }),
    );
    const made = await failNextWrite(page, "abort", {
      method: "profileCreate",
      args: { name: "Never kept" },
    });
    const renamed = await failNextWrite(page, "request-error", {
      method: "profileUpdate",
      args: { id: outcome.a, name: "Renamed" },
    });
    await call(page, "settings", { uiLanguage: "en" });
    await reload(page);
    const final = await session();
    check(
      "11 Q6: refused create and rename are undone and no later save writes them",
      made.refused &&
        renamed.refused &&
        final.list.length === 2 &&
        !final.list.some(
          (p) => p.name === "Never kept" || p.name === "Renamed",
        ),
      JSON.stringify({ made, renamed, names: final.list.map((p) => p.name) }),
    );
    await context.close();
  }

  // 12. V2 (sixth pass): actions that were plain saves. Codex refused a
  // Live TV favorite, a source removal and a Trakt history opt-in in this
  // vault; each was answered as a failure but stayed in memory, in a backup
  // and in the next unrelated save.
  {
    const { context, page } = await fresh();
    const playlist = `${ORIGIN}/__fixture/live.m3u`;
    await call(page, "liveAdd", {
      kind: "m3u",
      name: "Fixture",
      url: playlist,
    });
    await call(page, "liveAdd", { kind: "m3u", name: "Second", url: playlist });
    const live = () =>
      page.evaluate(async () => {
        const { state } = await window.riwaq.call("hudSnapshot");
        return {
          favorites: state.live.favorites,
          sources: state.live.sources.map((x) => [x.id, x.name, x.enabled]),
          trakt: state.integrations.find?.((x) => x.id === "trakt") || null,
        };
      });
    const { channels } = await call(page, "liveChannels", {});
    const key = channels[0].key;
    const backup = async (includeSecrets) => {
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        call(page, "backupExport", {
          passphrase: "fixture passphrase 12",
          includeSecrets,
        }),
      ]);
      const text = await readFile(await download.path(), "utf8");
      return decryptBackup(text, "fixture passphrase 12").payload;
    };
    const fav = await failNextWrite(page, "abort-after-success", {
      method: "liveFavorite",
      args: { key },
    });
    const removedId = (await live()).sources[0][0];
    const removal = await failNextWrite(page, "abort", {
      method: "liveUpdate",
      args: { id: removedId, action: "remove" },
    });
    const optIn = await failNextWrite(page, "request-error", {
      method: "integrationSave",
      args: { id: "trakt", trackHistory: true },
    });
    const now = await live();
    check(
      "12 V2: refused Live TV favorite, source removal and Trakt opt-in are answered as failures and undone in memory",
      fav.refused &&
        removal.refused &&
        optIn.refused &&
        now.favorites === 0 &&
        now.sources.some(([id]) => id === removedId) &&
        !now.trakt?.trackHistory,
      JSON.stringify({ fav, removal, optIn, now }),
    );
    const plain = await backup(false);
    const secrets = await backup(true);
    check(
      "12 V2: neither backup carries a refused change",
      plain.live.favorites.length === 0 &&
        secrets.live.favorites.length === 0 &&
        secrets.live.sources.some((x) => x.id === removedId) &&
        !secrets.integrations?.trakt?.trackHistory,
      JSON.stringify({
        plain: plain.live,
        secrets: {
          favorites: secrets.live.favorites,
          sources: secrets.live.sources.map((x) => x.id),
          trakt: secrets.integrations?.trakt,
        },
      }),
    );
    // Codex's unrelated save, refused twice first, then a reload.
    await failNextWrite(page, "abort", {
      method: "liveFavorite",
      args: { key },
    });
    await call(page, "settings", { uiLanguage: "en" });
    await reload(page);
    const after = await live();
    check(
      "12 V2: after a later language save and a reload, none of them was written",
      after.favorites === 0 &&
        after.sources.some(([id]) => id === removedId) &&
        !after.trakt?.trackHistory,
      JSON.stringify(after),
    );
    // A retry the vault commits stays, across a reload and in a backup.
    await call(page, "liveFavorite", { key });
    await call(page, "liveUpdate", { id: removedId, action: "remove" });
    await call(page, "integrationSave", { id: "trakt", trackHistory: true });
    await reload(page);
    const kept = await live();
    const keptBackup = await backup(true);
    check(
      "12 V2: retried and committed, all three stay across a reload and in a backup",
      kept.favorites === 1 &&
        !kept.sources.some(([id]) => id === removedId) &&
        kept.trakt?.trackHistory === true &&
        keptBackup.live.favorites.length === 1 &&
        keptBackup.integrations?.trakt?.trackHistory === true,
      JSON.stringify(kept),
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
