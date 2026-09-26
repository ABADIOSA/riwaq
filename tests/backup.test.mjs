import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import {
  collectBackup,
  encryptBackup,
  decryptBackup,
  readBackupHeader,
  restoreState,
  isPlainAddon,
  BACKUP_VERSION,
} from "../core/backup.mjs";

const PASS = "عبارة-مرور-طويلة";
const manifest = (id) => ({
  id,
  name: id,
  version: "1.0.0",
  resources: ["stream"],
  types: ["movie"],
});

function client(load = {}) {
  let saved;
  const instance = new Client({
    load: () => structuredClone(load),
    save: (state) => {
      saved = structuredClone(state);
    },
  });
  return { instance, saved: () => saved };
}

function populated() {
  const { instance } = client();
  const c = instance;
  c.favorite({ id: "tt1", type: "movie", name: "ديون" });
  c.recordProgress(
    { id: "tt2", type: "series", name: "مسلسل" },
    "tt2:1:3",
    600,
    1200,
  );
  c.queueEdit({
    action: "add",
    meta: { id: "tt3", type: "movie", name: "التالي" },
    videoId: "tt3",
  });
  c.settings({ accent: "rose" });
  c.setHotkey({ id: "playPause", binding: "Ctrl+p" });
  c.state.settings.mpvPath = "C:/Users/someone/mpv/mpv.exe";
  c.state.addons.push(
    {
      transportUrl: "https://plain.test/manifest.json",
      enabled: true,
      manifest: manifest("plain"),
    },
    {
      transportUrl:
        "https://torrentio.test/realdebrid=SECRETKEY123/manifest.json",
      enabled: true,
      manifest: manifest("configured"),
    },
  );
  c.state.providers = { tmdb: { key: "TMDBSECRET", enabled: true } };
  c.state.auth = {
    authKey: "STREMIOAUTHKEY",
    email: "a@b.test",
    name: "عبدالإله",
  };
  c.state.integrations = {
    trakt: {
      clientId: "CID",
      clientSecret: "CSECRET",
      token: { access_token: "TRAKTTOKEN" },
    },
  };
  c.state.notify = {
    discord: { webhook: "https://discord.com/api/webhooks/1/HOOKSECRET" },
  };
  c.state.live = {
    sources: [
      {
        id: "a".repeat(24),
        kind: "xtream",
        name: "اشتراكي",
        enabled: true,
        host: "http://tv.test",
        username: "u",
        password: "XTREAMPASS",
      },
    ],
    favorites: ["b".repeat(24)],
  };
  c.profiles.create({ name: "الطفل" });
  const kid = c.publicState().profiles.list.find((p) => p.name === "الطفل").id;
  c.profiles.setPin({ id: kid, pin: "2468" });
  c.persist();
  return { c, kid };
}

const SECRETS =
  /SECRETKEY123|TMDBSECRET|STREMIOAUTHKEY|CSECRET|TRAKTTOKEN|HOOKSECRET|XTREAMPASS/;

test("a configured addon is recognised by its path or query", () => {
  assert.equal(
    isPlainAddon("https://v3-cinemeta.strem.io/manifest.json"),
    true,
  );
  assert.equal(
    isPlainAddon("https://a.test/realdebrid=KEY/manifest.json"),
    false,
  );
  assert.equal(isPlainAddon("https://a.test/manifest.json?token=KEY"), false);
  assert.equal(isPlainAddon("not a url"), false);
});

test("a data-only backup carries no secret and says what it left behind", () => {
  const { c } = populated();
  const { payload, left } = collectBackup(c.state, { includeSecrets: false });
  assert.ok(!SECRETS.test(JSON.stringify(payload)));
  assert.deepEqual(left, {
    configuredAddons: 1,
    liveSources: 1,
    providers: 1,
    integrations: 1,
    notify: 1,
    stremio: true,
  });
  assert.ok(
    payload.addons.some(
      (a) => a.transportUrl === "https://plain.test/manifest.json",
    ),
  );
  // The PIN hash travels, or a restore would strip the child's lock.
  assert.ok(payload.profiles.list.some((p) => p.pin?.hash));
  // A path on this PC means nothing on the next one.
  assert.ok(!JSON.stringify(payload).includes("someone"));
});

test("the file is sealed: ciphertext, not JSON of the library", () => {
  const { c } = populated();
  const { text } = c.exportBackup({
    passphrase: PASS,
    includeSecrets: true,
    app: "0.5.0",
  });
  assert.ok(!SECRETS.test(text));
  assert.ok(!text.includes("ديون"));
  const { header } = readBackupHeader(text);
  assert.equal(header.version, BACKUP_VERSION);
  assert.equal(header.includesSecrets, true);
  assert.equal(header.app, "0.5.0");
});

test("the right passphrase opens it; a wrong one and any tampering do not", () => {
  const { c } = populated();
  const { text } = c.exportBackup({ passphrase: PASS });
  assert.ok(decryptBackup(text, PASS).payload.profiles);
  assert.throws(() => decryptBackup(text, "wrong-passphrase"), /غير صحيحة/);
  const header = JSON.parse(text);
  header.header.includesSecrets = true;
  assert.throws(() => decryptBackup(JSON.stringify(header), PASS), /غير صحيحة/);
  const body = JSON.parse(text);
  body.data = body.data.slice(0, -8) + "AAAAAAAA";
  assert.throws(() => decryptBackup(JSON.stringify(body), PASS), /غير صحيحة/);
});

test("an Arabic passphrase opens the file however the keyboard composed it", () => {
  const composed = "أمان-مضمون-2026";
  const decomposed = "\u0627\u0654مان-مضمون-2026";
  assert.notEqual(composed, decomposed);
  const text = encryptBackup({ profiles: {} }, composed);
  assert.ok(decryptBackup(text, decomposed).payload);
});

test("passphrases shorter than eight characters are refused", () => {
  assert.throws(() => encryptBackup({}, "short"), /8/);
  assert.throws(() => encryptBackup({}, ""), /8/);
});

test("the header is checked before any expensive work", () => {
  assert.throws(() => readBackupHeader("hello"), /ليس نسخة/);
  assert.throws(
    () => readBackupHeader(JSON.stringify({ header: { format: "other" } })),
    /ليس نسخة/,
  );
  const text = encryptBackup({ profiles: {} }, PASS);
  const future = JSON.parse(text);
  future.header.version = BACKUP_VERSION + 1;
  assert.throws(() => readBackupHeader(JSON.stringify(future)), /أحدث/);
  // A crafted file must not be able to ask scrypt for gigabytes of memory.
  const greedy = JSON.parse(text);
  greedy.header.kdf.N = 2 ** 24;
  assert.throws(() => readBackupHeader(JSON.stringify(greedy)), /تالف/);
});

test("restoring a full backup on a new machine brings everything back", () => {
  const { c, kid } = populated();
  const { text } = c.exportBackup({ passphrase: PASS, includeSecrets: true });
  const { instance: fresh } = client();
  fresh.restoreBackup({ text, passphrase: PASS });
  const state = fresh.publicState();
  assert.equal(state.favorites[0].name, "ديون");
  assert.equal(state.queue[0].videoId, "tt3");
  assert.equal(state.settings.accent, "rose");
  assert.equal(
    state.hotkeys.find((h) => h.id === "playPause").binding,
    "Ctrl+p",
  );
  assert.equal(fresh.state.providers.tmdb.key, "TMDBSECRET");
  assert.equal(fresh.state.auth.authKey, "STREMIOAUTHKEY");
  assert.equal(fresh.state.integrations.trakt.token.access_token, "TRAKTTOKEN");
  assert.equal(fresh.state.live.sources[0].password, "XTREAMPASS");
  assert.ok(
    fresh.state.addons.some((a) => a.transportUrl.includes("SECRETKEY123")),
  );
  // The child's profile is still behind its PIN.
  assert.throws(
    () => fresh.profiles.switch({ id: kid, pin: "0000" }),
    /رمز الحماية/,
  );
  fresh.profiles.switch({ id: kid, pin: "2468" });
});

test("a data-only restore keeps the keys this machine already has", () => {
  const { c } = populated();
  const { text } = c.exportBackup({ passphrase: PASS, includeSecrets: false });
  const { instance: here } = client({
    providers: { omdb: { key: "LOCALKEY" } },
    auth: { authKey: "LOCALAUTH", email: "", name: "" },
    addons: [
      {
        transportUrl: "https://local.test/cfg=LOCAL/manifest.json",
        enabled: true,
        manifest: manifest("local-configured"),
      },
    ],
    settings: { mpvPath: "D:/mpv/mpv.exe" },
  });
  here.restoreBackup({ text, passphrase: PASS });
  assert.equal(here.state.providers.omdb.key, "LOCALKEY");
  assert.equal(here.state.auth.authKey, "LOCALAUTH");
  assert.ok(
    here.state.addons.some((a) => a.transportUrl.includes("cfg=LOCAL")),
  );
  assert.ok(
    here.state.addons.some(
      (a) => a.transportUrl === "https://plain.test/manifest.json",
    ),
  );
  // This PC's MPV path wins over the path from the machine that made the backup.
  assert.equal(here.state.settings.mpvPath, "D:/mpv/mpv.exe");
  assert.equal(here.state.favorites[0].name, "ديون");
});

test("a restored installation starts locked and forgets derived state", () => {
  const { c } = populated();
  const { text } = c.exportBackup({ passphrase: PASS });
  const { instance: fresh, saved } = client();
  fresh.profiles.unlocked = true;
  fresh.streams.set("stale", {});
  fresh.restoreBackup({ text, passphrase: PASS });
  assert.equal(fresh.profiles.unlocked, false);
  assert.equal(fresh.streams.size, 0);
  assert.ok(saved().profiles.list.length === 2);
});

test("a crafted payload is cleaned, never trusted", () => {
  const { instance: fresh } = client();
  const next = restoreState(fresh.state, {
    profiles: {
      active: "nope",
      list: [
        { id: "ok", name: "صالح" },
        { id: "../../evil", name: "x" },
        { id: "nameless", name: "   " },
        { id: "ok", name: "مكرر" },
      ],
      data: {
        ok: {
          favorites: [
            { id: "tt1", type: "movie", name: "صالح" },
            { id: 5 },
            { id: "x", type: "local", name: "path" },
          ],
          progress: {
            "movie:tt1": {
              meta: { id: "tt1", type: "movie", name: "a" },
              videoId: "tt1",
              position: 5,
            },
            "movie:WRONGKEY": {
              meta: { id: "tt9", type: "movie", name: "b" },
              videoId: "tt9",
              position: 5,
            },
          },
          queue: [
            { meta: { id: "tt1", type: "movie", name: "a" }, videoId: "tt1" },
            { meta: {}, videoId: "x" },
          ],
          settings: {
            accent: "not-a-theme",
            quality: "1080",
            serverUrl: "javascript:alert(1)",
          },
        },
      },
    },
    hotkeys: { playPause: "Hyper+x", mute: "Ctrl+m", invented: "k" },
    addons: [
      { transportUrl: "javascript:alert(1)", manifest: manifest("bad") },
      {
        transportUrl: "https://ok.test/manifest.json",
        manifest: { id: "no-resources" },
      },
      {
        transportUrl: "https://ok.test/manifest.json",
        manifest: manifest("good"),
      },
    ],
    live: {
      sources: [
        {
          id: "c".repeat(24),
          kind: "m3u",
          name: "ملف",
          url: "file:///etc/passwd",
        },
        {
          id: "d".repeat(24),
          kind: "m3u",
          name: "صالح",
          url: "https://list.test/a.m3u",
        },
      ],
      favorites: ["e".repeat(24), "<script>"],
    },
    notify: { discord: { webhook: "https://evil.test/api/webhooks/1/x" } },
  });
  assert.deepEqual(
    next.profiles.list.map((p) => p.id),
    ["ok"],
  );
  assert.equal(next.profiles.active, "ok");
  const bucket = next.profiles.data.ok;
  assert.deepEqual(
    bucket.favorites.map((m) => m.id),
    ["tt1"],
  );
  assert.deepEqual(Object.keys(bucket.progress), ["movie:tt1"]);
  assert.equal(bucket.queue.length, 1);
  assert.equal(bucket.settings.accent, "amber");
  assert.equal(bucket.settings.quality, "1080");
  assert.equal(bucket.settings.serverUrl, "http://127.0.0.1:11470");
  assert.deepEqual(next.hotkeys, { mute: "Ctrl+m" });
  assert.deepEqual(
    next.addons.map((a) => a.manifest.id),
    ["good"],
  );
  assert.deepEqual(
    next.live.sources.map((s) => s.name),
    ["صالح"],
  );
  assert.deepEqual(next.live.favorites, ["e".repeat(24)]);
  assert.deepEqual(next.notify, {});
});

test("a backup without a single valid profile is refused", () => {
  const { instance: fresh } = client();
  assert.throws(
    () => restoreState(fresh.state, { profiles: { list: [] } }),
    /ملف شخصي/,
  );
  assert.throws(() => restoreState(fresh.state, null), /تالفة/);
});

test("a locked Settings room blocks backup export, preview and restore", () => {
  const { c } = populated();
  const { text } = c.exportBackup({ passphrase: PASS });
  c.profiles.setPin({ id: "default", pin: "1357" });
  c.profiles.update({ id: "default", lockedRooms: ["settings"] });
  c.profiles.lock();
  assert.throws(() => c.exportBackup({ passphrase: PASS }), /محمي/);
  assert.throws(() => c.inspectBackup({ text, passphrase: PASS }), /محمي/);
  assert.throws(() => c.restoreBackup({ text, passphrase: PASS }), /محمي/);
  c.profiles.unlock("1357");
  assert.ok(c.inspectBackup({ text, passphrase: PASS }).profiles.length);
});
