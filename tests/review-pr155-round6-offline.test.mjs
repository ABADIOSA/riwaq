// Codex's fifth review of PR #155 (docs/REVIEW-PR-155.md, "Sixth pass"),
// V1: a profile removal whose encrypted write was refused had already
// deleted that profile's downloaded files. These run the real Client and
// Profiles with OfflineLibrary.removeProfile (what main's profileRemove
// calls) over real files: a store that writes profile.bin.tmp and renames
// it, as main's save() does, refused the way Codex refused it (a directory
// in the .tmp's place) or after the temporary file was written. JSON stands
// in for DPAPI; scripts/test-profile-remove-native.mjs runs the real app.
import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "../core/client.mjs";
import { collectBackup } from "../core/backup.mjs";
import { OfflineLibrary } from "../electron/offline.mjs";

const meta = { id: "tt1234567", type: "movie", name: "Fixture" };
const bytes = (id) => Buffer.from("disposable download " + id);

/** profile.bin written as main writes it: .tmp, then a rename. */
function fileStore(dir) {
  const file = join(dir, "profile.bin");
  const store = {
    file,
    tmp: file + ".tmp",
    afterTmp: 0,
    load: () =>
      existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {},
    save: (data) => {
      writeFileSync(store.tmp, JSON.stringify(data));
      if (store.afterTmp > 0) {
        store.afterTmp--;
        throw new Error("the rename was refused");
      }
      renameSync(store.tmp, file);
    },
    disk: () => JSON.parse(readFileSync(file, "utf8")),
    // Codex's blocker: a directory where the temporary file goes.
    block: () => mkdirSync(store.tmp),
    unblock: () => rmdirSync(store.tmp),
  };
  return store;
}

async function setup({ deleteFile, resolveSource, request } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "riwaq-v1-"));
  const root = join(dir, "offline");
  mkdirSync(root);
  const store = fileStore(dir);
  const boot = (options = {}) => {
    const client = new Client({ load: store.load, save: store.save });
    const offline = new OfflineLibrary(client, {
      root,
      resolveSource:
        resolveSource || (async () => Promise.reject(Error("no source"))),
      ...(request ? { request } : {}),
      ...(deleteFile ? { deleteFile } : {}),
      ...options,
    });
    return { client, offline };
  };
  let { client, offline } = boot();
  const idOf = (state, name) =>
    state.profiles.list.find((p) => p.name === name).id;
  const a = client.profiles.store.active;
  const b = idOf(client.profiles.create({ name: "B" }), "B");
  const c = idOf(client.profiles.create({ name: "C" }), "C");
  const t = {
    dir,
    root,
    store,
    a,
    b,
    c,
    get client() {
      return client;
    },
    get offline() {
      return offline;
    },
    /** A completed download for `profile`, its record written durably. */
    async seed(profile, id, extra = {}) {
      await writeFile(join(root, id + ".media"), bytes(id));
      await writeFile(join(root, id + ".poster.jpg"), Buffer.from([255, 216]));
      (client.state.offline[profile] ||= []).push({
        id,
        meta,
        videoId: meta.id,
        status: "ready",
        bytes: bytes(id).length,
        total: bytes(id).length,
        at: 1,
        ...extra,
      });
      client.persist();
    },
    media: (id) => join(root, id + ".media"),
    restart(options) {
      clearTimeout(offline.sweepTimer);
      ({ client, offline } = boot(options));
      return { client, offline };
    },
    async cleanup() {
      clearTimeout(offline.sweepTimer);
      await offline.stop().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    },
  };
  return t;
}
const hex = (n) => String(n).repeat(32);
const gone = (path) =>
  stat(path).then(
    () => false,
    (error) => error.code === "ENOENT",
  );

test("V1: a removal refused at the encrypted write keeps the profile, its records and every file, across a later save and a restart", async () => {
  const t = await setup();
  try {
    t.client.profiles.switch({ id: t.b });
    t.client.collectionsEdit({ action: "create", title: "B's collection" });
    t.client.profiles.switch({ id: t.a });
    await t.seed(t.b, hex(6));
    await t.seed(t.c, hex(7));
    const before = readFileSync(t.store.file);
    t.store.block();
    let stopped = 0;
    try {
      await assert.rejects(
        t.offline.removeProfile({ id: t.b }, { stop: async () => stopped++ }),
      );
    } finally {
      t.store.unblock();
    }
    // Refused: the file on disk, memory and the media are as before.
    assert.deepEqual(readFileSync(t.store.file), before);
    assert.equal(stopped, 0);
    assert.deepEqual(await readFile(t.media(hex(6))), bytes(hex(6)));
    assert.ok(t.client.profiles.store.list.some((p) => p.id === t.b));
    assert.equal(t.client.state.offline[t.b][0].id, hex(6));
    assert.deepEqual(t.client.state.offlineTrash, []);
    assert.equal(t.offline.removing.size, 0);
    // An unrelated save writes no part of the refused removal.
    t.client.settings({ uiLanguage: "en" });
    const disk = t.store.disk();
    assert.equal(disk.offline[t.b][0].id, hex(6));
    assert.deepEqual(disk.offlineTrash, []);
    // A restart reads it all back, and its sweep deletes nothing.
    const { client, offline } = t.restart();
    assert.deepEqual(await offline.sweep(), { pending: 0 });
    client.profiles.switch({ id: t.b });
    assert.equal(client.state.collections[0].title, "B's collection");
    const item = offline.list(t.b).items[0];
    assert.equal(item.id, hex(6));
    assert.equal(item.status, "ready");
    assert.equal((await offline.file(t.b, hex(6))).path, t.media(hex(6)));
    assert.deepEqual(await readFile(t.media(hex(6))), bytes(hex(6)));
    assert.deepEqual(await readFile(t.media(hex(7))), bytes(hex(7)));
  } finally {
    await t.cleanup();
  }
});

test("V1: a failure after the temporary file was written is a refusal too", async () => {
  const t = await setup();
  try {
    await t.seed(t.b, hex(6));
    const before = readFileSync(t.store.file);
    t.store.afterTmp = 1;
    await assert.rejects(t.offline.removeProfile({ id: t.b }), /rename/);
    assert.deepEqual(readFileSync(t.store.file), before);
    assert.deepEqual(await readFile(t.media(hex(6))), bytes(hex(6)));
    assert.equal(t.client.state.offline[t.b].length, 1);
    // Retried once the store writes again: removed, its files deleted.
    const state = await t.offline.removeProfile({ id: t.b });
    assert.ok(!state.profiles.list.some((p) => p.id === t.b));
    assert.equal(state.offlineCleanup, undefined);
    assert.ok(await gone(t.media(hex(6))));
    assert.ok(await gone(join(t.root, hex(6) + ".poster.jpg")));
    assert.equal(t.store.disk().offline[t.b], undefined);
    assert.deepEqual(t.store.disk().offlineTrash, []);
  } finally {
    await t.cleanup();
  }
});

test("V1: removing an inactive profile deletes only its files; other profiles' downloads stay", async () => {
  const t = await setup();
  try {
    await t.seed(t.b, hex(6));
    await t.seed(t.b, hex(5));
    await t.seed(t.c, hex(7));
    await t.seed(t.a, hex(8));
    await t.offline.removeProfile({ id: t.b });
    assert.ok(await gone(t.media(hex(6))));
    assert.ok(await gone(t.media(hex(5))));
    assert.deepEqual(await readFile(t.media(hex(7))), bytes(hex(7)));
    assert.deepEqual(await readFile(t.media(hex(8))), bytes(hex(8)));
    const disk = t.store.disk();
    assert.equal(disk.offline[t.b], undefined);
    assert.equal(disk.offline[t.c][0].id, hex(7));
    assert.equal(disk.offline[t.a][0].id, hex(8));
    // Neither list reaches a backup or an account.
    const payload = JSON.stringify(
      collectBackup(disk, { includeSecrets: true }),
    );
    assert.ok(!payload.includes("offline"));
    assert.ok(!payload.includes(hex(7)));
  } finally {
    await t.cleanup();
  }
});

test("V1: a held file keeps its durable clean-up entry, is reported, and is deleted by a sweep after a restart; a missing file is no failure", async () => {
  let held = "";
  const t = await setup({
    deleteFile: async (path) => {
      if (path === held) throw Object.assign(Error("busy"), { code: "EBUSY" });
      await rm(path, { force: true });
    },
  });
  try {
    await t.seed(t.b, hex(6));
    await t.seed(t.b, hex(5));
    await rm(t.media(hex(5))); // already gone (a partly cleaned profile)
    held = t.media(hex(6));
    const state = await t.offline.removeProfile({ id: t.b });
    // The removal stands, and the viewer is told what waits.
    assert.ok(!state.profiles.list.some((p) => p.id === t.b));
    assert.deepEqual(state.offlineCleanup, { pending: 1 });
    assert.deepEqual(await readFile(t.media(hex(6))), bytes(hex(6)));
    assert.deepEqual(
      t.store.disk().offlineTrash.map((x) => x.id),
      [hex(6)],
    );
    // Its poster went (the media, last, was refused).
    assert.ok(await gone(join(t.root, hex(6) + ".poster.jpg")));
    // A retry while it is still held changes nothing and is idempotent.
    assert.deepEqual(await t.offline.sweep(), { pending: 1 });
    assert.deepEqual(await t.offline.sweep(), { pending: 1 });
    // Restarted after the other program let go.
    held = "";
    const { offline } = t.restart();
    assert.deepEqual(await offline.sweep(), { pending: 0 });
    assert.ok(await gone(t.media(hex(6))));
    assert.deepEqual(t.store.disk().offlineTrash, []);
    assert.deepEqual(await offline.sweep(), { pending: 0 });
  } finally {
    await t.cleanup();
  }
});

test("V1: a crash after the removal's write (or halfway through its clean-up) is finished by the next start's sweep", async () => {
  const t = await setup();
  try {
    await t.seed(t.c, hex(7));
    // The removal of B was written, then Riwaq stopped: its entries are on
    // disk, one with all its files, one already half deleted.
    t.client.state.offlineTrash = [
      { id: hex(6), at: 1 },
      { id: hex(5), at: 1 },
    ];
    t.client.persist();
    await writeFile(t.media(hex(6)), bytes(hex(6)));
    await writeFile(join(t.root, hex(6) + ".part"), bytes(hex(6)));
    await writeFile(join(t.root, hex(5) + ".media"), bytes(hex(5)));
    const { offline } = t.restart();
    assert.deepEqual(await offline.sweep(), { pending: 0 });
    for (const name of [hex(6) + ".media", hex(6) + ".part", hex(5) + ".media"])
      assert.ok(await gone(join(t.root, name)), name);
    assert.deepEqual(t.store.disk().offlineTrash, []);
    assert.deepEqual(await readFile(t.media(hex(7))), bytes(hex(7)));
  } finally {
    await t.cleanup();
  }
});

test("V1: the clean-up never deletes a file a live record names, a bad name, or a link's target", async () => {
  const t = await setup();
  const outside = join(t.dir, "outside.bin");
  try {
    await t.seed(t.c, hex(7));
    await writeFile(outside, "not Riwaq's");
    await symlink(outside, t.media(hex(4)));
    t.client.state.offlineTrash = [
      { id: hex(7), at: 1 }, // still C's: never deleted, the entry goes
      { id: "../outside", at: 1 },
      { id: hex(4), at: 1 }, // a link: the link goes, never its target
    ];
    t.client.persist();
    const { offline } = t.restart();
    assert.deepEqual(
      t.client.state.offlineTrash.map((x) => x.id),
      [hex(7), hex(4)],
    );
    assert.deepEqual(await offline.sweep(), { pending: 0 });
    assert.deepEqual(await readFile(t.media(hex(7))), bytes(hex(7)));
    assert.equal(await readFile(outside, "utf8"), "not Riwaq's");
    assert.ok(await gone(t.media(hex(4))));
    assert.deepEqual(t.store.disk().offlineTrash, []);
  } finally {
    await t.cleanup();
  }
});

test("V1: a running download is paused, not cancelled, so a refused removal keeps its partial; a written one deletes it", async () => {
  const chunk = Buffer.alloc(64 * 1024, 1);
  let response;
  const server = createServer((_req, res) => {
    response = res;
    res.writeHead(200, {
      "content-type": "video/mp4",
      "content-length": String(chunk.length * 4),
    });
    res.write(chunk);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/video`;
  const t = await setup({ resolveSource: async () => ({ url }) });
  try {
    t.client.profiles.switch({ id: t.b });
    t.offline.start({
      profileId: t.b,
      stream: {},
      meta,
      videoId: meta.id,
      settings: {},
    });
    const id = t.offline.job.id;
    const part = join(t.root, id + ".part");
    for (let i = 0; i < 200 && !(await stat(part).catch(() => null))?.size; i++)
      await new Promise((r) => setTimeout(r, 10));
    t.client.profiles.switch({ id: t.a });
    t.store.block();
    try {
      await assert.rejects(t.offline.removeProfile({ id: t.b }));
    } finally {
      t.store.unblock();
    }
    assert.equal(t.offline.job, null);
    assert.equal((await stat(part)).size, chunk.length);
    const record = t.client.state.offline[t.b].find((x) => x.id === id);
    assert.ok(["paused", "error"].includes(record.status));
    t.client.settings({ uiLanguage: "en" });
    assert.ok(t.store.disk().offline[t.b].some((x) => x.id === id));
    // A paused one is removed with its partial once the write goes through.
    await t.offline.removeProfile({ id: t.b });
    assert.ok(await gone(part));
    assert.deepEqual(t.store.disk().offlineTrash, []);
  } finally {
    response?.destroy();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await t.cleanup();
  }
});

test("V1: removing the active profile stops playback first; with a PIN, a wrong one changes nothing and a refused write brings it back locked", async () => {
  const t = await setup();
  try {
    await t.seed(t.b, hex(6));
    t.client.profiles.setPin({ id: t.b, pin: "1234" });
    // A wrong PIN: nothing stopped, nothing moved.
    let stopped = 0;
    const stop = async () => stopped++;
    await assert.rejects(
      t.offline.removeProfile({ id: t.b, pin: "0000" }, { stop }),
      /رمز الحماية/,
    );
    assert.equal(stopped, 0);
    assert.equal(t.client.state.offline[t.b].length, 1);
    // B active and unlocked; its write refused.
    t.client.profiles.switch({ id: t.b, pin: "1234" });
    t.client.profiles.unlock("1234");
    const session = t.client.profiles.session();
    t.store.block();
    try {
      await assert.rejects(
        t.offline.removeProfile({ id: t.b }, { stop }),
        (error) => !/رمز الحماية/.test(error.message),
      );
    } finally {
      t.store.unblock();
    }
    assert.ok(stopped >= 1);
    assert.equal(t.client.profiles.store.active, t.b);
    assert.equal(t.client.profiles.unlocked, false);
    assert.notEqual(t.client.profiles.session(), session);
    assert.deepEqual(await readFile(t.media(hex(6))), bytes(hex(6)));
    assert.equal(t.client.state.offline[t.b][0].id, hex(6));
    // Written with the PIN: another profile takes over, the file goes.
    const state = await t.offline.removeProfile(
      { id: t.b, pin: "1234" },
      { stop },
    );
    assert.notEqual(state.profiles.active, t.b);
    assert.ok(await gone(t.media(hex(6))));
  } finally {
    await t.cleanup();
  }
});

test("V1: while a removal waits, the profile's downloads are frozen, A→B→A switches end their activations, and nothing is deleted before the write", async () => {
  const deleted = [];
  const t = await setup({
    deleteFile: async (path) => {
      deleted.push(path);
      await rm(path, { force: true });
    },
  });
  try {
    await t.seed(t.b, hex(6));
    // A poster rename still in flight holds the removal (prepareRetire).
    const hold = Promise.withResolvers();
    t.offline.artworkQueue = hold.promise;
    let stopped = 0;
    const removal = t.offline.removeProfile(
      { id: t.b },
      { stop: async () => stopped++ },
    );
    await new Promise((r) => setTimeout(r, 5));
    const first = t.client.profiles.session();
    t.client.profiles.switch({ id: t.b });
    assert.throws(() => t.offline.list(t.b), /جارٍ حذف تنزيلات/);
    assert.throws(
      () =>
        t.offline.start({ profileId: t.b, stream: {}, meta, videoId: meta.id }),
      /جارٍ حذف تنزيلات/,
    );
    await assert.rejects(
      t.offline.removeProfile({ id: t.b }),
      /جارٍ حذف تنزيلات/,
    );
    t.client.profiles.switch({ id: t.a });
    assert.notEqual(t.client.profiles.session(), first);
    assert.deepEqual(deleted, []);
    hold.resolve();
    const state = await removal;
    assert.ok(!state.profiles.list.some((p) => p.id === t.b));
    assert.equal(state.profiles.active, t.a);
    assert.equal(stopped, 0);
    assert.ok(await gone(t.media(hex(6))));
    assert.equal(t.offline.removing.size, 0);
    // B became active while it waited: playback is stopped before the write.
    await t.seed(t.c, hex(7));
    const hold2 = Promise.withResolvers();
    t.offline.artworkQueue = hold2.promise;
    const second = t.offline.removeProfile(
      { id: t.c },
      { stop: async () => stopped++ },
    );
    await new Promise((r) => setTimeout(r, 5));
    t.client.profiles.switch({ id: t.c });
    hold2.resolve();
    const after = await second;
    assert.equal(stopped, 1);
    assert.equal(after.profiles.active, t.a);
    assert.ok(await gone(t.media(hex(7))));
  } finally {
    await t.cleanup();
  }
});

test("V1: a file being played refuses the removal before anything is written", async () => {
  const t = await setup();
  try {
    await t.seed(t.b, hex(6));
    const before = readFileSync(t.store.file);
    t.offline.playing = hex(6);
    await assert.rejects(t.offline.removeProfile({ id: t.b }), /أوقف مشاهدة/);
    assert.deepEqual(readFileSync(t.store.file), before);
    assert.ok(t.client.profiles.store.list.some((p) => p.id === t.b));
    assert.deepEqual(await readFile(t.media(hex(6))), bytes(hex(6)));
    assert.equal(t.offline.removing.size, 0);
  } finally {
    await t.cleanup();
  }
});
