/**
 * Release blocker W4 (PR #155, seventh review): account sync while released
 * apps still sync. Every scenario runs the real released code: the
 * released client is the tag's own core/ (git archive), and the server is
 * the Worker released with v0.55.0 (the code production runs) on the
 * schema production has (migrations 0001–0002), over Node's SQLite. The
 * updated client is this checkout's core/, or another commit's with
 * RIWAQ_CANDIDATE=<ref> (the same script records the failure before the
 * fix). Synthetic accounts, sources, Stremio keys and addons only; nothing
 * leaves the process.
 *
 *   node scripts/test-accounts-mixed.mjs                       (this checkout)
 *   RIWAQ_CANDIDATE=dc07e73 node scripts/test-accounts-mixed.mjs  (before)
 *
 * Needs the tag: git fetch --no-tags origin tag v0.55.0. RIWAQ_LEGACY names
 * another released tag. Prints every check and a table of cloud
 * revisions, PUTs, device bases and counts; exits 1 if any check fails.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sqliteD1 } from "../server/accounts/local.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const LEGACY = process.env.RIWAQ_LEGACY || "v0.55.0";
const CANDIDATE = process.env.RIWAQ_CANDIDATE || "";
// Codex's boundary (final acceptance, 2026-11-21): the released client keeps
// the first 5000 Live TV favorites. RIWAQ_MIXED_FAVORITES gives the first
// device that many synthetic channel favorites before it signs up.
const FAVORITES = Number(process.env.RIWAQ_MIXED_FAVORITES || 0);
const cache = join(root, ".cache");
mkdirSync(cache, { recursive: true });
const work = mkdtempSync(join(cache, "riwaq-mixed-"));
const extract = (ref, into, paths) => {
  execFileSync("git", [
    "-C",
    root,
    "archive",
    "-o",
    `${into}.tar`,
    ref,
    ...paths,
  ]);
  mkdirSync(into, { recursive: true });
  execFileSync("tar", ["-xf", `${into}.tar`, "-C", into]);
};
const load = (dir, path) => import(pathToFileURL(join(dir, path)).href);

const origin = "https://riwaq-mixed.invalid";
const manifest = {
  id: "fixture.configured",
  name: "Configured fixture",
  version: "1.0.0",
  types: ["movie"],
  resources: ["stream"],
  catalogs: [],
};
const CONFIGURED = origin + "/token-synthetic/manifest.json";

const checks = [];
let scenario = "";
const check = (name, ok, detail = "") => {
  checks.push({ scenario, name, ok: !!ok });
  console.log(
    `${ok ? "PASS" : "FAIL"} [${scenario}] ${name}${detail ? " — " + detail : ""}`,
  );
};
/**
 * A limit: something the client cannot know, stated rather than counted
 * (docs/ACCOUNTS.md). Printed, listed at the end, never a pass.
 */
const limits = [];
const limit = (name, detail = "") => {
  limits.push({ scenario, name, detail });
  console.log(`LIMIT [${scenario}] ${name}${detail ? " — " + detail : ""}`);
};
const table = [];

try {
  extract(LEGACY, join(work, "legacy"), ["core", "server", "package.json"]);
  const legacyDir = join(work, "legacy");
  let currentDir = root;
  if (CANDIDATE) {
    currentDir = join(work, "candidate");
    extract(CANDIDATE, currentDir, ["core", "package.json"]);
  }
  const { Client: Legacy } = await load(legacyDir, "core/client.mjs");
  const { Client: Current } = await load(currentDir, "core/client.mjs");
  const { openData } = await load(currentDir, "core/account.mjs");
  // Where the records travel (the carriers since the 5000-favorites fix);
  // an older candidate kept them in live.favorites and has no readClears.
  const { readClears, clearRecord, liftRecord } = await load(
    root,
    "core/sync-clears.mjs",
  );
  const worker =
    (await load(legacyDir, "server/accounts/worker.mjs").catch(() => null)) ||
    (await load(legacyDir, "server/accounts/service.mjs"));
  console.log(
    `Updated client: ${CANDIDATE || "this checkout"} · released client: ${LEGACY} · Worker: ${LEGACY} on 0001–0002`,
  );

  /** One account service with its own database and wire log. */
  function world() {
    const db = sqliteD1(":memory:", { upTo: "0002_usage.sql" });
    const env = { DB: db, AUTH_PEPPER: randomBytes(32).toString("hex") };
    const w = {
      db,
      puts: 0,
      conflicts: 0,
      failNext: null,
      beforeNextPut: null,
    };
    w.request = async (url, init = {}) => {
      if (new URL(url).origin !== origin) throw new Error("outside request");
      if (init.method === "PUT" && w.beforeNextPut) {
        const before = w.beforeNextPut;
        w.beforeNextPut = null;
        await before();
      }
      if (w.failNext && w.failNext.method === init.method) {
        const fail = w.failNext;
        w.failNext = null;
        if (fail.after) {
          // The server took the upload; the reply never arrived.
          await worker.handle(new Request(url, init), env);
          if (init.method === "PUT") w.puts++;
        }
        throw new Error("synthetic network failure");
      }
      const response = await worker.handle(new Request(url, init), env);
      if (init.method === "PUT") {
        w.puts++;
        if (response.status === 409) w.conflicts++;
      }
      return {
        status: response.status,
        revision: response.headers.get("X-Riwaq-Revision"),
        text: await response.text(),
      };
    };
    /** A device of `Type`, with a store that survives a restart. */
    w.device = (Type, name) => {
      let written = {};
      const config = {
        version: Type === Current ? "0.56.0" : LEGACY.replace(/^v/, ""),
        accountServer: origin,
        accountRequest: (url, init) => w.request(url, init),
        request: async () => {
          throw new Error("no provider request in this fixture");
        },
        requestText: async (url) => {
          if (new URL(url).origin !== origin) throw new Error("outside");
          return "#EXTM3U\n#EXTINF:-1,Fixture channel\n" + origin + "/v.ts\n";
        },
        api: async (op, payload) => {
          if (op !== "getUser") throw new Error("Stremio is out of scope");
          return { fullname: "Synthetic " + String(payload.authKey).slice(-1) };
        },
        load: () => structuredClone(written),
        save: (state) => {
          written = JSON.parse(JSON.stringify(state));
        },
      };
      const d = {
        name,
        legacy: Type === Legacy,
        client: new Type(config),
        async sync() {
          await d.client.account.sync();
          if (d.client.durable) await d.client.durable();
        },
        restart() {
          d.client = new Type(config);
          return d;
        },
        get state() {
          return d.client.state;
        },
        base() {
          return d.client.state.account?.revision ?? null;
        },
      };
      return d;
    };
    /** The account's copy, decrypted with a signed-in device's key. */
    w.cloud = async (d) => {
      const account = d.client.state.account;
      const response = await worker.handle(
        new Request(origin + "/v1/data", {
          headers: { Authorization: "Bearer " + account.token },
        }),
        env,
      );
      const revision = Number(response.headers.get("X-Riwaq-Revision")) || 0;
      const envelope = openData(
        Buffer.from(account.key, "base64"),
        account.username,
        await response.text(),
      );
      return { revision, envelope };
    };
    w.close = () => db.close();
    return w;
  }

  const account = (secrets = true) => ({
    username: "fixture-" + randomBytes(5).toString("hex"),
    password: randomBytes(24).toString("base64url"),
    secrets,
  });
  const realSources = (list) =>
    (list || []).filter((s) => /^[a-f\d]{24}$/.test(s?.id || ""));
  const count = (d) => realSources(d.state.live?.sources).length;
  const signedIn = (d) => d.state.auth?.authKey || null;
  const configured = (d) =>
    (d.state.addons || []).filter((a) => a.transportUrl === CONFIGURED).length;
  const add = (d, i) =>
    d.client.live.addSource({
      kind: "m3u",
      name: "Disposable " + i,
      url: `${origin}/p${i}.m3u`,
    });
  const durable = async (d) => {
    if (d.client.durable) await d.client.durable();
  };
  /** Synthetic channel favorites (24-hex keys, as channel keys are). */
  const seedFavorites = async (d, n = FAVORITES) => {
    const keys = Array.from({ length: n }, () =>
      randomBytes(12).toString("hex"),
    );
    d.state.live.favorites = keys;
    d.client.persist();
    await durable(d);
    return keys;
  };
  async function row(w, step, devices) {
    const { revision, envelope } = await w.cloud(devices[0]);
    const entry = {
      scenario,
      step,
      cloudRevision: revision,
      cloudWriter: envelope.app || "?",
      cloudSources: realSources(envelope.payload.live?.sources).length,
      cloudClearedList: (envelope.payload.live?.sources || []).some(
        (s) => s?.cleared,
      ),
      cloudStremio: envelope.payload.auth?.authKey ? "signed in" : "none",
      cloudRecords: readClears(envelope.payload).length,
      cloudFavorites: (envelope.payload.live?.favorites || []).length,
      puts: w.puts,
      conflicts: w.conflicts,
    };
    for (const d of devices) {
      entry[`${d.name}.base`] = d.base();
      entry[`${d.name}.sources`] = count(d);
      entry[`${d.name}.stremio`] = signedIn(d) ? "signed in" : "none";
      if (FAVORITES || scenario.startsWith("6"))
        entry[`${d.name}.favorites`] = (d.state.live?.favorites || []).length;
    }
    table.push(entry);
    return entry;
  }

  // ── Scenario 1: the last Live TV source ─────────────────────────────
  scenario = "1 last source";
  {
    const w = world();
    try {
      const acct = account();
      const A = w.device(Current, "A");
      const B = w.device(Legacy, "B");
      const D = w.device(Legacy, "D"); // offline after the first sync
      await add(A, 1);
      await durable(A);
      await seedFavorites(A);
      await A.client.account.signup(acct);
      await B.client.account.login(acct);
      await D.client.account.login(acct);
      await A.sync();
      await B.sync();
      await D.sync();
      await row(w, "synced on A, B (0.55) and D (0.55)", [A, B, D]);
      check(
        "A, B and D hold the source",
        count(A) === 1 && count(B) === 1 && count(D) === 1,
      );
      A.client.live.updateSource({
        id: A.state.live.sources[0].id,
        action: "remove",
      });
      await durable(A);
      check("the removal commits on A", count(A) === 0);
      await A.sync();
      let r = await row(w, "A removed and uploaded", [A, B, D]);
      check("the account's copy has no source", r.cloudSources === 0);
      await B.sync();
      r = await row(w, "B (0.55) synced", [A, B, D]);
      check(
        "B (0.55) drops its own copy of the last source",
        count(B) === 0,
        `B=${count(B)}`,
      );
      check(
        "the account's copy stays without the source after B",
        r.cloudSources === 0,
        `cloud=${r.cloudSources}`,
      );
      await A.sync();
      check(
        "A still has none after resyncing",
        count(A) === 0,
        `A=${count(A)}`,
      );
      const C = w.device(Current, "C");
      await C.client.account.login(acct);
      await durable(C);
      check("a new updated device C joins without it", count(C) === 0);
      for (const d of [A, B, C]) d.restart();
      for (const d of [A, B, C]) await d.sync();
      await row(w, "A, B, C restarted and synced", [A, B, C]);
      check(
        "after restarts A, B and C have none",
        count(A) + count(B) + count(C) === 0,
      );
      // An unrelated change on the released client travels; the clear holds.
      B.client.favorite({ id: "tt0111161", type: "movie", name: "Fixture" });
      await B.sync();
      await A.sync();
      await C.sync();
      check(
        "an unrelated change from B reaches A and C",
        A.client.isFavorite?.("movie", "tt0111161") ??
          (A.state.favorites || []).some((f) => f.id === "tt0111161"),
      );
      check(
        "the clear holds after the unrelated change",
        count(A) + count(B) + count(C) === 0,
      );
      // A 409: B moves between A's pull and push.
      w.beforeNextPut = async () => {
        B.client.favorite({ id: "tt0068646", type: "movie", name: "Second" });
        await B.sync();
      };
      A.client.favorite({ id: "tt0071562", type: "movie", name: "Third" });
      const conflictsBefore = w.conflicts;
      await A.sync();
      r = await row(w, "409 between A's pull and push, retried", [A, B, C]);
      const favs = (d) => (d.state.favorites || []).map((f) => f.id);
      check("the 409 happened and was retried", w.conflicts > conflictsBefore);
      await B.sync();
      await C.sync();
      check(
        "both sides' changes stand after the 409",
        ["tt0068646", "tt0071562"].every(
          (id) => favs(A).includes(id) && favs(B).includes(id),
        ),
      );
      check(
        "the clear holds after the 409",
        count(A) + count(B) + count(C) === 0,
      );
      // D (0.55) was offline throughout and comes back with the source.
      await D.sync();
      r = await row(w, "D (0.55) back after being offline", [A, B, C, D]);
      const C2 = w.device(Current, "C2");
      await C2.client.account.login(acct);
      await durable(C2);
      check(
        "a device joining right after D's upload does not get the source",
        count(C2) === 0,
        `C2=${count(C2)}`,
      );
      await A.sync();
      await C.sync();
      check(
        "updated devices never take D's copy back",
        count(A) + count(C) === 0,
      );
      await D.sync();
      await A.sync();
      await D.sync();
      r = await row(w, "updated device answered; D synced again", [A, D, C2]);
      check("D (0.55) drops it once it reads the clear", count(D) === 0);
      // Repeated syncs settle: no device keeps uploading.
      for (const d of [A, B, C, D, C2]) await d.sync();
      const settled = w.puts;
      for (let i = 0; i < 3; i++)
        for (const d of [A, B, C, D, C2]) await d.sync();
      r = await row(w, "three more rounds on every device", [A, B, C, D]);
      check(
        "repeated syncs upload nothing more",
        w.puts === settled,
        `${w.puts - settled} extra PUTs`,
      );
      // A new source on the released client is a new value and travels.
      await add(B, 2);
      await B.sync();
      await A.sync();
      check("a source added on B (0.55) reaches A", count(A) === 1);
    } finally {
      w.close();
    }
  }

  // ── Scenario 2: Stremio sign-out ────────────────────────────────────
  scenario = "2 Stremio";
  {
    const w = world();
    try {
      const acct = account();
      const A = w.device(Current, "A");
      const B = w.device(Legacy, "B");
      await A.client.authenticate("synthetic-stremio-key-1");
      await durable(A);
      await A.client.account.signup(acct);
      await B.client.account.login(acct);
      await A.sync();
      await B.sync();
      check(
        "A and B (0.55) share the synthetic sign-in",
        signedIn(A) && signedIn(B) === "synthetic-stremio-key-1",
      );
      A.client.logout();
      await durable(A);
      await A.sync();
      await B.sync();
      await A.sync();
      let r = await row(w, "A signed out; B (0.55) synced; A again", [A, B]);
      check("A stays signed out", !signedIn(A));
      console.log(
        `  B (0.55) keeps its own key: ${signedIn(B) ? "yes (released client)" : "no"}; account copy: ${r.cloudStremio}`,
      );
      const C = w.device(Current, "C");
      await C.client.account.login(acct);
      await durable(C);
      check("a new updated device is not signed in", !signedIn(C));
      for (const d of [A, C]) d.restart();
      for (let i = 0; i < 2; i++) for (const d of [A, B, C]) await d.sync();
      check(
        "after restarts and syncs, updated devices stay signed out",
        !signedIn(A) && !signedIn(C),
      );
      const settled = w.puts;
      for (let i = 0; i < 3; i++) for (const d of [A, B, C]) await d.sync();
      check(
        "no upload war with the released client",
        w.puts === settled,
        `${w.puts - settled} extra PUTs`,
      );
      // An explicit new sign-in is a new session and reaches everyone.
      await A.client.authenticate("synthetic-stremio-key-2");
      await durable(A);
      await A.sync();
      await B.sync();
      await C.sync();
      check(
        "an explicit new sign-in on A reaches B (0.55) and C",
        signedIn(B) === "synthetic-stremio-key-2" &&
          signedIn(C) === "synthetic-stremio-key-2",
      );
      // The same session linked again on an updated device on purpose.
      A.client.logout();
      await durable(A);
      await A.sync();
      await C.sync();
      check("signed out again on A and C", !signedIn(A) && !signedIn(C));
      await C.client.authenticate("synthetic-stremio-key-2");
      await durable(C);
      await C.sync();
      await A.sync();
      check(
        "linking that same session again on C, explicitly, reaches A",
        signedIn(A) === "synthetic-stremio-key-2",
      );
      // A sign-out made on the released client is not undone either.
      await B.sync();
      B.client.logout();
      await B.sync();
      await A.sync();
      await C.sync();
      check(
        "a sign-out made on B (0.55) reaches A and C",
        !signedIn(A) && !signedIn(C),
      );
      // Without secrets sync, sign-ins stay on their own device.
      const local = account(false);
      const P = w.device(Current, "P");
      const Q = w.device(Legacy, "Q");
      await P.client.authenticate("synthetic-local-key-p");
      await Q.client.authenticate("synthetic-local-key-q");
      await P.client.account.signup(local);
      await Q.client.account.login(local);
      await P.sync();
      await Q.sync();
      P.client.logout();
      await durable(P);
      await P.sync();
      await Q.sync();
      await P.sync();
      check(
        "without secrets sync, Q keeps its own sign-in and P stays out",
        signedIn(Q) === "synthetic-local-key-q" && !signedIn(P),
      );
      await P.client.authenticate("synthetic-local-key-p2");
      await P.sync();
      await Q.sync();
      check(
        "without secrets sync, a local sign-in is kept and not shared",
        signedIn(P) === "synthetic-local-key-p2" &&
          signedIn(Q) === "synthetic-local-key-q",
      );
    } finally {
      w.close();
    }
  }

  // ── Scenario 3: joining with no common ancestor ─────────────────────
  scenario = "3 join";
  {
    const w = world();
    try {
      // Never linked: the account has no sign-in and no clear record.
      const never = account();
      const A = w.device(Current, "A");
      await A.client.account.signup(never);
      const J1 = w.device(Current, "J1");
      await J1.client.authenticate("synthetic-own-key-j1");
      await J1.client.account.login(never);
      await durable(J1);
      await A.sync();
      check(
        "never linked: the joining device keeps its own sign-in and shares it",
        signedIn(J1) === "synthetic-own-key-j1" &&
          signedIn(A) === "synthetic-own-key-j1",
      );
      // Explicitly cleared: the joining device holds the very key that was
      // signed out, and the clear was last carried by a released client.
      const cleared = account();
      const S = w.device(Current, "S");
      const L = w.device(Legacy, "L");
      await S.client.authenticate("synthetic-shared-key");
      await S.client.account.signup(cleared);
      await L.client.account.login(cleared);
      await S.sync();
      await L.sync();
      S.client.logout();
      await durable(S);
      await S.sync();
      await L.sync(); // the released client uploads its copy of the key
      const J2 = w.device(Current, "J2");
      await J2.client.authenticate("synthetic-shared-key");
      await J2.client.account.login(cleared);
      await durable(J2);
      check(
        "explicitly cleared: the joining device's copy of that session is dropped",
        !signedIn(J2),
      );
      // A different, legitimate session of the joining device is kept.
      const J3 = w.device(Current, "J3");
      await J3.client.authenticate("synthetic-other-key-j3");
      await J3.client.account.login(cleared);
      await durable(J3);
      await S.sync();
      check(
        "a different local sign-in is kept and goes up",
        signedIn(J3) === "synthetic-other-key-j3" &&
          signedIn(S) === "synthetic-other-key-j3",
      );
      // Secrets off: the account says nothing about sign-ins.
      const off = account(false);
      const O = w.device(Current, "O");
      await O.client.account.signup(off);
      const J4 = w.device(Current, "J4");
      await J4.client.authenticate("synthetic-local-j4");
      await J4.client.account.login(off);
      await durable(J4);
      await O.sync();
      check(
        "secrets off: the joining device keeps its sign-in, unshared",
        signedIn(J4) === "synthetic-local-j4" && !signedIn(O),
      );
      // A source the account cleared does not come back with a joiner's
      // own sources; the joiner's other sources join the account.
      const src = account();
      const X = w.device(Current, "X");
      const Y = w.device(Legacy, "Y");
      await add(X, 7);
      await X.client.account.signup(src);
      await Y.client.account.login(src);
      await X.sync();
      await Y.sync();
      X.client.live.updateSource({
        id: X.state.live.sources[0].id,
        action: "remove",
      });
      await durable(X);
      await X.sync();
      const J5 = w.device(Current, "J5");
      await add(J5, 8);
      await J5.client.account.login(src);
      await durable(J5);
      await X.sync();
      await Y.sync();
      check(
        "a joiner's own source joins the account; the cleared one stays gone",
        count(J5) === 1 && count(X) === 1 && count(Y) === 1,
      );
    } finally {
      w.close();
    }
  }

  // ── Scenario 4: normal data keeps syncing ───────────────────────────
  scenario = "4 normal sync";
  {
    const w = world();
    try {
      const acct = account();
      const A = w.device(Current, "A");
      const B = w.device(Legacy, "B");
      await add(A, 1);
      await add(A, 2);
      A.state.addons.push({
        transportUrl: CONFIGURED,
        manifest,
        enabled: true,
      });
      A.state.discordAppId = "123456789012345678";
      A.client.persist();
      await durable(A);
      const { recoveryCode } = await A.client.account.signup(acct);
      await B.client.account.login(acct);
      await A.sync();
      await B.sync();
      check(
        "two sources, a configured addon and a Discord app ID reach B (0.55)",
        count(B) === 2 &&
          configured(B) === 1 &&
          B.state.discordAppId === "123456789012345678",
      );
      // Library, progress, collections and settings in both directions.
      A.client.favorite({ id: "tt0111161", type: "movie", name: "One" });
      A.client.settings({ uiLanguage: "en" });
      await durable(A);
      await A.sync();
      B.client.favorite({ id: "tt0068646", type: "movie", name: "Two" });
      await B.sync();
      await A.sync();
      const favs = (d) => (d.state.favorites || []).map((f) => f.id);
      const settings = (d) => d.state.settings || {};
      check(
        "favorites from both clients merge on both",
        ["tt0111161", "tt0068646"].every(
          (id) => favs(A).includes(id) && favs(B).includes(id),
        ),
      );
      check(
        "a profile setting from A reaches B (0.55)",
        settings(B).uiLanguage === "en",
      );
      // The active profile's data lives on the state itself.
      const progressOf = (d) => d.state.progress || {};
      B.state.progress = {
        ...progressOf(B),
        "movie:tt0111161": {
          meta: { id: "tt0111161", type: "movie", name: "One" },
          videoId: "tt0111161",
          position: 600,
          duration: 7200,
          updated: Date.now(),
        },
      };
      B.client.persist();
      await B.sync();
      await A.sync();
      check(
        "watch progress from B (0.55) reaches A",
        progressOf(A)["movie:tt0111161"]?.position === 600,
      );
      // Removing one of two sources, the addon and the Discord app ID on A.
      A.client.live.updateSource({
        id: A.state.live.sources[0].id,
        action: "remove",
      });
      A.state.addons = A.state.addons.filter(
        (x) => x.transportUrl !== CONFIGURED,
      );
      A.state.discordAppId = "";
      A.client.persist();
      await durable(A);
      await A.sync();
      await B.sync();
      await A.sync();
      const C = w.device(Current, "C");
      await C.client.account.login(acct);
      await durable(C);
      check(
        "one of two sources removed: A, B (0.55) and C hold one",
        count(A) === 1 && count(B) === 1 && count(C) === 1,
      );
      check(
        "the removed configured addon stays off A and C",
        configured(A) === 0 && configured(C) === 0,
        `B (0.55) keeps its copy: ${configured(B)}`,
      );
      check(
        "the cleared Discord app ID stays clear on A and C",
        !A.state.discordAppId && !C.state.discordAppId,
      );
      // Installing that addon again on an updated device is a new choice.
      A.state.addons.push({
        transportUrl: CONFIGURED,
        manifest,
        enabled: true,
      });
      A.client.persist();
      await durable(A);
      await A.sync();
      await C.sync();
      check(
        "installing the same addon again on A reaches C",
        configured(A) === 1 && configured(C) === 1,
      );
      // Recovery keeps the data and the clear.
      const R = w.device(Current, "R");
      await R.client.account.recover({
        username: acct.username,
        code: recoveryCode,
        password: randomBytes(24).toString("base64url"),
      });
      await durable(R);
      check(
        "account recovery restores the library without the cleared source",
        favs(R).includes("tt0111161") && count(R) === 1,
      );
      // An encrypted backup without secrets restores on an updated device
      // without touching its own sources.
      const exported = await A.client.exportBackup?.({
        passphrase: "synthetic backup passphrase 1",
      });
      if (exported) {
        const before = count(C);
        await C.client.restoreBackup?.({
          text: exported.text ?? exported,
          passphrase: "synthetic backup passphrase 1",
        });
        check(
          "a secrets-free encrypted backup keeps the device's own sources",
          count(C) === before,
        );
      } else
        console.log("  (backup export is exercised by tests/backup.test.mjs)");
    } finally {
      w.close();
    }
  }

  // ── Scenario 5: interrupted syncs ───────────────────────────────────
  scenario = "5 interrupted";
  {
    const w = world();
    try {
      const acct = account();
      const A = w.device(Current, "A");
      const A2 = w.device(Current, "A2");
      const B = w.device(Legacy, "B");
      await add(A, 1);
      await A.client.account.signup(acct);
      await A2.client.account.login(acct);
      await B.client.account.login(acct);
      for (const d of [A, A2, B]) await d.sync();
      A.client.live.updateSource({
        id: A.state.live.sources[0].id,
        action: "remove",
      });
      await durable(A);
      // The upload fails before it reaches the server.
      w.failNext = { method: "PUT" };
      await A.sync().catch(() => {});
      check("a failed upload leaves the removal on A", count(A) === 0);
      A.restart();
      await A.sync();
      await B.sync();
      await A.sync();
      check(
        "after a restart the removal goes up and holds against B (0.55)",
        count(A) === 0 && count(B) === 0,
      );
      // The server takes an upload but its reply is lost.
      await add(A, 2);
      await durable(A);
      w.failNext = { method: "PUT", after: true };
      await A.sync().catch(() => {});
      await A.sync();
      await B.sync();
      check(
        "an upload whose reply was lost settles",
        count(A) === 1 && count(B) === 1,
      );
      A.client.live.updateSource({
        id: A.state.live.sources[0].id,
        action: "remove",
      });
      await durable(A);
      w.failNext = { method: "PUT", after: true };
      await A.sync().catch(() => {});
      await B.sync();
      await A.sync();
      await B.sync();
      await A2.sync();
      check(
        "a removal whose reply was lost still holds against B (0.55)",
        count(A) === 0 && count(B) === 0 && count(A2) === 0,
      );
      // Two updated devices sync at once.
      await add(A, 3);
      await add(A2, 4);
      await Promise.all([A.sync(), A2.sync()]);
      await A.sync();
      await A2.sync();
      await B.sync();
      await A.sync();
      check(
        "concurrent updated devices both keep their additions",
        count(A) === 2 && count(A2) === 2 && count(B) === 2,
      );
      const settled = w.puts;
      for (let i = 0; i < 3; i++) for (const d of [A, A2, B]) await d.sync();
      check(
        "repeated syncs add no uploads",
        w.puts === settled,
        `${w.puts - settled} extra PUTs`,
      );
      await row(w, "end", [A, A2, B]);
    } finally {
      w.close();
    }
  }

  // ── Scenario 6: a full favorites list (Codex, final acceptance) ──────
  // The released client keeps its first 5000 Live TV favorites. At exactly
  // 5000 real favorites (and 4999, the control) every clear must hold and
  // every favourite must stay, through a full-capacity released upload,
  // several released devices, a deleted provider key on one of them,
  // multiple removals at once, favourites changed after a removal, a 409
  // between two updated devices, a lost reply, re-login, an encrypted
  // backup and repeated rounds.
  for (const full of [4999, 5000]) {
    scenario = `6 full favorites ${full}`;
    const w = world();
    try {
      const acct = account();
      const A = w.device(Current, "A");
      const A2 = w.device(Current, "A2");
      const B = w.device(Legacy, "B");
      const L = w.device(Legacy, "L"); // a second released device
      const D = w.device(Legacy, "D"); // offline after the first sync
      for (const i of [1, 2, 3]) await add(A, i);
      A.state.addons.push({
        transportUrl: CONFIGURED,
        manifest,
        enabled: true,
      });
      A.state.discordAppId = "123456789012345678";
      // Synthetic keys only; nothing here asks a provider for anything.
      A.state.providers = {
        tmdb: { key: "synthetic-tmdb-" + "0".repeat(16), enabled: true },
        fanart: { key: "synthetic-fanart-key", enabled: true },
      };
      A.client.settings({ tasteCompass: false });
      A.client.persist();
      await durable(A);
      let expected = await seedFavorites(A, full);
      // Every favourite the viewer has, and none they removed. Neutral to
      // where records travel (an older candidate kept them in this list),
      // so RIWAQ_CANDIDATE runs are compared on the viewer's data alone.
      const same5000 = (...devices) =>
        devices.every((d) => {
          const have = new Set(d.state.live?.favorites || []);
          return (
            expected.every((key) => have.has(key)) &&
            !removedFavorites.some((key) => have.has(key))
          );
        });
      const removedFavorites = [];
      const ids = (d) => realSources(d.state.live?.sources).map((x) => x.name);
      await A.client.account.signup(acct);
      for (const d of [A2, B, L, D]) await d.client.account.login(acct);
      for (const d of [A, A2, B, L, D]) await d.sync();
      await row(w, "five devices synced", [A, A2, B, L, D]);
      check(
        `every device holds the ${full} favourites, 3 sources and the addon`,
        same5000(A, A2, B, L, D) &&
          [A, A2, B, L, D].every((d) => count(d) === 3 && configured(d) === 1),
      );
      // Two removals at once, plus the configured addon, on A.
      const [s1, s2] = A.state.live.sources;
      A.client.live.updateSource({ id: s1.id, action: "remove" });
      A.client.live.updateSource({ id: s2.id, action: "remove" });
      A.state.addons = A.state.addons.filter(
        (x) => x.transportUrl !== CONFIGURED,
      );
      A.client.persist();
      await durable(A);
      await A.sync();
      let r = await row(w, "A removed two sources and the addon", [A, B, L]);
      check(
        "three records go up; the favourites list is untouched",
        r.cloudRecords >= 3 && r.cloudFavorites === full,
        `records=${r.cloudRecords} favourites=${r.cloudFavorites}`,
      );
      // A full-capacity upload from each released device.
      await B.sync();
      await L.sync();
      r = await row(w, "B and L (0.55) synced at capacity", [A, B, L]);
      check(
        "the records survive the released uploads at capacity",
        r.cloudRecords >= 3 && r.cloudWriter !== "0.56.0",
        `records=${r.cloudRecords} writer=${r.cloudWriter}`,
      );
      check(
        "B and L (0.55) hold one source and every favourite",
        count(B) === 1 && count(L) === 1 && same5000(B, L),
      );
      // The viewer deletes the TMDB key on L (0.55): that copy of the
      // records goes with it; the other carriers keep them.
      L.client.dataHub.save({ id: "tmdb", clear: true });
      await L.sync();
      r = await row(w, "L (0.55) deleted its TMDB key", [A, L]);
      check(
        "a provider key deleted on a released device keeps the records",
        r.cloudRecords >= 3,
        `records=${r.cloudRecords}`,
      );
      for (const d of [A, A2, B]) await d.sync();
      check(
        "that deletion still reaches the updated devices (an ordinary secret change)",
        !A.state.providers?.tmdb?.key && !A2.state.providers?.tmdb?.key,
      );
      // Favourites change after the removal: one goes on B (0.55), a new one
      // comes on A2, so both lists move and stay at the boundary.
      const gone = expected[7];
      B.client.live.favorite(gone);
      await B.sync();
      await A2.sync();
      const fresh = randomBytes(12).toString("hex");
      A2.client.live.favorite(fresh);
      await durable(A2);
      await A2.sync();
      expected = [...expected.filter((k) => k !== gone), fresh];
      removedFavorites.push(gone);
      for (const d of [A, B, L, A2]) await d.sync();
      check(
        "a favourite removed on B (0.55) and one added on A2 reach every device",
        same5000(A, A2, B, L),
        `A=${A.state.live.favorites.length} B=${B.state.live.favorites.length}`,
      );
      // D (0.55) comes back with all three sources and the addon; a new
      // updated device joins right after its upload.
      await D.sync();
      r = await row(w, "D (0.55) back after being offline", [A, D]);
      const C2 = w.device(Current, "C2");
      await C2.client.account.login(acct);
      await durable(C2);
      check(
        "a device joining right after D's upload gets neither removed source nor the addon",
        count(C2) === 1 && configured(C2) === 0,
        `C2 sources=${count(C2)} addon=${configured(C2)}`,
      );
      for (const d of [A, A2]) await d.sync();
      check(
        "updated devices never take D's copies back",
        [A, A2, C2].every((d) => count(d) === 1 && configured(d) === 0),
      );
      await D.sync();
      await A.sync();
      await D.sync();
      check("D (0.55) drops the two removed sources", count(D) === 1);
      // Restarts and repeated rounds: stable, no upload war.
      for (const d of [A, A2, B, L, D, C2]) d.restart();
      for (const d of [A, A2, B, L, D, C2]) await d.sync();
      const settled = w.puts;
      for (let i = 0; i < 3; i++)
        for (const d of [A, A2, B, L, D, C2]) await d.sync();
      r = await row(w, "restarted; three more rounds", [A, A2, B, L, D, C2]);
      check(
        "repeated mixed syncs upload nothing more",
        w.puts === settled,
        `${w.puts - settled} extra PUTs`,
      );
      check(
        "after restarts every device keeps every favourite",
        same5000(A, A2, B, L, D, C2),
      );
      check(
        "a 0.56 setting is not reset by the released devices",
        A.state.settings.tasteCompass === false &&
          A2.state.settings.tasteCompass === false,
      );
      // Two updated devices at once, with a 409: A removes the last source
      // while A2 adds a new one between A's pull and push.
      w.beforeNextPut = async () => {
        await add(A2, 4);
        await durable(A2);
        await A2.sync();
      };
      A.client.live.updateSource({
        id: A.state.live.sources[0].id,
        action: "remove",
      });
      await durable(A);
      const conflicts = w.conflicts;
      await A.sync();
      for (const d of [A2, B, L, C2, A]) await d.sync();
      r = await row(w, "409: A removed one, A2 added one", [A, A2, B, L, C2]);
      check("the 409 happened and was retried", w.conflicts > conflicts);
      check(
        "after the 409 every device holds only A2's new source",
        [A, A2, B, L, C2].every((d) => ids(d).join() === "Disposable 4"),
        [A, A2, B, L, C2].map((d) => d.name + "=" + ids(d).join("|")).join(" "),
      );
      // A lost reply on a removal at capacity.
      w.failNext = { method: "PUT", after: true };
      A.client.live.updateSource({
        id: A.state.live.sources[0].id,
        action: "remove",
      });
      await durable(A);
      await A.sync().catch(() => {});
      // A removed it: A never holds it again at any step; A2 drops it at
      // its own sync.
      let held = 0;
      for (const d of [A, B, L, A2]) {
        await d.sync();
        held += count(A);
      }
      check(
        "after a lost reply no updated device takes the source back",
        held === 0 && count(A2) === 0,
        `A held it ${held} times; A2=${count(A2)}`,
      );
      // L (0.55) read the account's empty list after B (0.55) wrote it, kept
      // its own source and uploaded it (the released limit in ACCOUNTS.md);
      // A2 answered with the cleared list, which L now reads.
      await L.sync();
      check(
        "a removal whose reply was lost holds against B and L (0.55)",
        [A, A2, B, L].every((d) => count(d) === 0),
        [A, A2, B, L].map((d) => d.name + "=" + count(d)).join(" "),
      );
      // An explicit re-install on an updated device lifts its record.
      A2.state.addons.push({
        transportUrl: CONFIGURED,
        manifest,
        enabled: true,
      });
      A2.client.persist();
      await durable(A2);
      for (const d of [A2, A, B, C2]) await d.sync();
      check(
        "re-installing the addon on A2 reaches A, C2 and B (0.55)",
        [A, A2, C2, B].every((d) => configured(d) === 1),
        [A, A2, C2, B].map((d) => d.name + "=" + configured(d)).join(" "),
      );
      // Signing out and in again takes the account's records.
      await A.client.account.logout();
      await A.client.account.login(acct);
      await durable(A);
      await D.sync();
      await A.sync();
      check(
        "after re-login A refuses D's (0.55) copies and keeps every favourite",
        count(A) === 0 && same5000(A),
        `A sources=${count(A)}`,
      );
      // An encrypted backup (with secrets) taken now and restored on A2.
      const exported = A2.client.exportBackup({
        passphrase: "synthetic backup passphrase 6",
        includeSecrets: true,
      });
      A2.client.restoreBackup({
        text: exported.text,
        passphrase: "synthetic backup passphrase 6",
      });
      await durable(A2);
      for (const d of [A2, D, A, A2]) await d.sync();
      check(
        "after a backup restore A2 keeps the clears and every favourite",
        count(A2) === 0 && same5000(A2) && count(A) === 0,
      );
      // A released device that lost every carrier (all five provider
      // entries gone: not reachable from its interface, forced here) and
      // uploads: an updated device puts the records back.
      for (const id of ["tmdb", "omdb", "mdblist", "fanart", "theintrodb"])
        delete L.state.providers?.[id];
      L.client.persist();
      L.state.live.favorites = [...L.state.live.favorites];
      B.client.favorite({ id: "tt0099685", type: "movie", name: "Nudge" });
      await B.sync();
      await L.sync();
      r = await row(w, "L (0.55) lost every carrier", [A, L]);
      await A.sync();
      r = await row(w, "A answered", [A, L]);
      check(
        "an updated device restores the records the released copy lost",
        r.cloudRecords >= 3,
        `records=${r.cloudRecords}`,
      );
      for (const d of [D, A, A2, C2]) await d.sync();
      check(
        "at the end no updated device holds a removed source or loses a favourite",
        [A, A2, C2].every((d) => count(d) === 0) && same5000(A, A2, C2, B),
      );
    } finally {
      w.close();
    }
  }

  // ── Scenario 7: every carrier lost, a new device first (Codex, release
  // acceptance 2026-11-21) ─────────────────────────────────────────────
  // Codex's exact sequence: A (updated) removes the only Live TV source
  // while D (0.55) is offline; B (0.55) takes the clear, then deletes all
  // five provider keys through its own DataHub (what its interface does),
  // so no copy of the record is left in the account; D comes back and
  // uploads its stale source; a brand-new updated device C signs in before
  // A syncs again, and uploads the source with an empty list of records.
  // Codex's two controls (9/9 before the fix): B deletes four keys, or A
  // syncs before C joins. A fourth run puts a 409 (D re-uploading in the
  // middle of A's repair) and a lost reply on A's repair. Every run then
  // restarts every device, idles, and restores on purpose, on C, a backup
  // that holds that very source: an explicit re-add lifts the record.
  const CARRIERS = ["tmdb", "omdb", "mdblist", "fanart", "theintrodb"];
  for (const v of [
    { name: "7 all five carriers lost, C before A", deleted: 5 },
    {
      name: "7 all five lost, 409 and lost reply in A's repair",
      deleted: 5,
      race: true,
    },
    { name: "7 control: four carriers lost", deleted: 4 },
    { name: "7 control: A repairs before C", deleted: 5, repairFirst: true },
  ]) {
    scenario = v.name;
    const w = world();
    try {
      const acct = account();
      const A = w.device(Current, "A");
      const B = w.device(Legacy, "B");
      const D = w.device(Legacy, "D"); // offline after the first sync
      await add(A, 1);
      await durable(A);
      const expected = await seedFavorites(A);
      const source = A.state.live.sources[0].id;
      const record = clearRecord("live", source);
      const lift = liftRecord ? liftRecord(record) : null;
      const cloudClears = async () =>
        readClears((await w.cloud(A)).envelope.payload);
      const favouritesKept = (...devices) =>
        devices.every((d) => {
          const have = new Set(d.state.live?.favorites || []);
          return expected.every((key) => have.has(key));
        });
      // Five synthetic keys, configured on the released client.
      for (const id of CARRIERS)
        B.client.dataHub.save({ id, key: `synthetic-${id}-key-0000` });
      await A.client.account.signup(acct);
      await B.client.account.login(acct);
      await D.client.account.login(acct);
      await A.sync();
      let r = await row(w, "configured and synced", [A, B, D]);
      check(
        "all five configured on old B",
        CARRIERS.every((id) => B.state.providers?.[id]?.key) &&
          count(A) === 1 &&
          count(B) === 1 &&
          count(D) === 1,
      );
      // The viewer's own encrypted backup, the source and keys in it.
      const kept = A.client.exportBackup({
        passphrase: "synthetic backup passphrase 7",
        includeSecrets: true,
      });
      const held = []; // A's count at every step after its removal
      A.client.live.updateSource({ id: source, action: "remove" });
      await durable(A);
      await A.sync();
      await B.sync();
      r = await row(w, "A removed, B took clear", [A, B, D]);
      held.push(count(A));
      check(
        "D holds source while A removes it",
        count(D) === 1 && count(A) === 0,
      );
      check(
        "A, B cleared; cloud has carrier",
        count(A) === 0 &&
          count(B) === 0 &&
          (await cloudClears()).includes(record),
      );
      check(
        "cloud source still removed before reconnect",
        r.cloudSources === 0,
      );
      // B (0.55) deletes its keys the way its interface does.
      for (const id of CARRIERS.slice(0, v.deleted))
        B.client.dataHub.save({ id, clear: true });
      await B.sync();
      r = await row(w, "legacy B clears configured keys via normal method", [
        A,
        B,
        D,
      ]);
      if (v.deleted === 5)
        check(
          "normal UI deletion removed all carriers",
          r.cloudRecords === 0,
          `records=${r.cloudRecords}`,
        );
      else
        check(
          "four ordinary deletions still leave the clear record",
          (await cloudClears()).includes(record),
        );
      await D.sync();
      r = await row(w, "offline legacy D reconnects before A", [A, B, D]);
      held.push(count(A));
      check("legacy D keeps stale benign source", count(D) === 1);
      const stale = (await w.cloud(A)).envelope.payload;
      if (v.deleted === 5)
        check(
          "stale source is in cloud without carrier",
          r.cloudSources === 1 && r.cloudRecords === 0,
        );
      else
        check(
          "stale source is in cloud with the surviving clear",
          r.cloudSources === 1 && readClears(stale).includes(record),
        );
      if (v.repairFirst) await A.sync();
      const C = w.device(Current, "C");
      await C.client.account.login(acct);
      await durable(C);
      r = await row(
        w,
        v.repairFirst
          ? "new C signs in after A's repair"
          : "new C signs in before A's repair",
        [A, B, D, C],
      );
      held.push(count(A));
      if (v.deleted === 5 && !v.repairFirst) {
        // Codex's check here asked C not to show the source. Nothing C can
        // read says it was ever removed: the account's copy is D's, and no
        // record or lift is left in it, nor anywhere in the payload. C may
        // show it until a device that still holds the record syncs; what
        // must hold is that C's first upload does not make it legitimate.
        limit(
          "new C does not display removed source",
          `C=${count(C)}: the account's copy C read carries no record (documented limit)`,
        );
        check(
          "the copy C read holds no trace of the record or a lift",
          !readClears(stale).length &&
            !JSON.stringify(stale).includes(record) &&
            !(lift && JSON.stringify(stale).includes(lift)),
        );
        const first = await cloudClears();
        check(
          "C's first upload lifts nothing",
          r.cloudWriter === "0.56.0" &&
            !first.includes(lift) &&
            !(C.state.account.clears || []).includes(lift),
          `writer=${r.cloudWriter} records=${first.length}`,
        );
      } else
        check(
          "new C does not display removed source",
          count(C) === 0,
          `C=${count(C)}`,
        );
      if (v.race) {
        // D (0.55) uploads again between A's pull and push (a 409), and the
        // server takes A's retry but its reply never arrives.
        w.beforeNextPut = async () => {
          await D.sync();
          w.beforeNextPut = async () => {
            w.failNext = { method: "PUT", after: true };
          };
        };
        const conflicts = w.conflicts;
        await A.sync().catch(() => {});
        held.push(count(A));
        check(
          "A's repair met a 409 from D (0.55) and lost its retry's reply",
          w.conflicts > conflicts && !w.beforeNextPut && !w.failNext,
        );
        // A device that never uploaded leaves the hooks armed: disarm them
        // (otherwise D's own next upload would wait on itself).
        w.beforeNextPut = null;
        w.failNext = null;
        A.restart();
      }
      await A.sync();
      await C.sync();
      r = await row(w, "A repairs and C syncs", [A, B, D, C]);
      held.push(count(A));
      check(
        "A repairs and C drops source",
        count(A) === 0 && count(C) === 0 && r.cloudSources === 0,
        `A=${count(A)} C=${count(C)} cloud=${r.cloudSources}`,
      );
      const repaired = await cloudClears();
      check(
        "the account's copy carries the record again, and no lift",
        repaired.includes(record) && !repaired.includes(lift),
      );
      for (const d of [D, B, A, D, B, C]) await d.sync();
      check(
        "D and B (0.55) drop the source once they read the clear",
        count(D) === 0 && count(B) === 0,
        `D=${count(D)} B=${count(B)}`,
      );
      for (const d of [A, B, D, C]) d.restart();
      for (const d of [A, B, D, C]) await d.sync();
      held.push(count(A));
      check(
        "after restarts no device holds the removed source",
        [A, B, D, C].every((d) => count(d) === 0),
      );
      check(
        "A never held the source again after removing it",
        held.every((n) => n === 0),
        held.join(","),
      );
      check(
        "every device keeps every live favourite",
        favouritesKept(A, B, D, C),
      );
      // Unrelated data still travels; the key B kept stays everywhere.
      B.client.favorite({ id: "tt0111161", type: "movie", name: "Fixture" });
      await B.sync();
      await A.sync();
      await C.sync();
      await D.sync();
      check(
        "an unrelated favourite from B (0.55) reaches A, C and D",
        [A, C, D].every((d) =>
          (d.state.favorites || []).some((f) => f.id === "tt0111161"),
        ),
      );
      if (v.deleted === 4)
        check(
          "the key B kept stays on every device",
          [A, B, C, D].every(
            (d) =>
              d.state.providers?.theintrodb?.key ===
              "synthetic-theintrodb-key-0000",
          ),
        );
      for (const d of [A, B, D, C]) await d.sync();
      let settled = w.puts;
      for (let i = 0; i < 3; i++) for (const d of [A, B, D, C]) await d.sync();
      r = await row(w, "restarted; three idle rounds", [A, B, D, C]);
      check(
        "idle rounds upload nothing more",
        w.puts === settled,
        `${w.puts - settled} extra PUTs`,
      );
      // The viewer restores, on purpose, the backup holding that very
      // source on C: a re-add made on an updated device lifts the record,
      // also through a released device relaying the list.
      C.client.restoreBackup({
        text: kept.text,
        passphrase: "synthetic backup passphrase 7",
      });
      await durable(C);
      for (const d of [C, B, A, D, C, A]) await d.sync();
      r = await row(w, "C restored that source on purpose", [A, B, D, C]);
      const lifted = await cloudClears();
      check(
        "an explicit re-add on C lifts the record and reaches A, B and D",
        [A, B, D, C].every((d) => count(d) === 1) &&
          !lifted.includes(record) &&
          (!liftRecord || lifted.includes(lift)),
        [A, B, D, C].map((d) => d.name + "=" + count(d)).join(" "),
      );
      for (const d of [A, B, D, C]) await d.sync();
      settled = w.puts;
      for (let i = 0; i < 3; i++) for (const d of [A, B, D, C]) await d.sync();
      check(
        "after the re-add, idle rounds upload nothing more",
        w.puts === settled && [A, B, D, C].every((d) => count(d) === 1),
        `${w.puts - settled} extra PUTs`,
      );
    } finally {
      w.close();
    }
  }
  // A receive followed by a failed upload must persist the received state and
  // its sync position together. Restarting must not turn it into a local edit.
  if (liftRecord) {
    scenario = "8 remote receive, failed upload and restart";
    const w = world();
    try {
      const acct = account();
      const A = w.device(Current, "A");
      const B = w.device(Legacy, "B");
      const C = w.device(Current, "C");
      const D = w.device(Legacy, "D");
      await add(A, 1);
      const id = A.state.live.sources[0].id;
      const record = clearRecord("live", id);
      const lift = liftRecord(record);
      for (const provider of CARRIERS)
        B.client.dataHub.save({
          id: provider,
          key: "synthetic-" + provider + "-key-0000",
        });
      await A.client.account.signup(acct);
      await B.client.account.login(acct);
      await D.client.account.login(acct);
      await A.sync();
      A.client.live.updateSource({ id, action: "remove" });
      await A.sync();
      await B.sync();
      for (const provider of CARRIERS)
        B.client.dataHub.save({ id: provider, clear: true });
      await B.sync();
      await C.client.account.login(acct);
      check(
        "C starts without the source or evidence of its earlier removal",
        count(C) === 0 &&
          readClears((await w.cloud(A)).envelope.payload).length === 0,
      );
      await D.sync();
      const incoming = await row(w, "D returned with the old source", [
        A,
        C,
        D,
      ]);
      C.client.favorite({ id: "tt0111161", type: "movie", name: "Fixture" });
      w.failNext = { method: "PUT", after: false };
      let refused;
      try {
        await C.sync();
      } catch (error) {
        if (error.message !== "synthetic network failure") throw error;
        refused = true;
      }
      check(
        "C received the source and the following upload failed before commit",
        refused &&
          count(C) === 1 &&
          (await w.cloud(A)).revision === incoming.cloudRevision,
      );
      C.restart();
      check(
        "C restored the received source and its matching sync position",
        count(C) === 1 &&
          C.base() === incoming.cloudRevision &&
          realSources(C.state.account.base?.live?.sources).some(
            (item) => item.id === id,
          ),
      );
      await C.sync();
      check(
        "C does not write a lift when retrying after restart",
        !readClears((await w.cloud(A)).envelope.payload).includes(lift),
      );
      await A.sync();
      await C.sync();
      const repaired = await row(w, "A repaired after C restarted", [A, C, D]);
      check(
        "the original deletion stands on A, C and the account",
        !count(A) &&
          !count(C) &&
          !repaired.cloudSources &&
          readClears((await w.cloud(A)).envelope.payload).includes(record),
      );
    } finally {
      w.close();
    }
  }
} catch (error) {
  checks.push({ scenario, name: "unexpected error", ok: false });
  console.error(`FAIL [${scenario}] unexpected error:`, error);
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log("\nState after each recorded step:");
console.table(table);
for (const l of limits)
  console.log(
    `Limit [${l.scenario}] ${l.name}${l.detail ? " — " + l.detail : ""}`,
  );
const failed = checks.filter((c) => !c.ok);
console.log(
  `Mixed versions (${CANDIDATE || "this checkout"} with ${LEGACY}): ${checks.length - failed.length}/${checks.length} checks passed`,
);
process.exit(failed.length ? 1 : 0);
