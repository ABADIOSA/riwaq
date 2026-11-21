// Codex's sixth review of PR #155 (docs/REVIEW-PR-155.md, "Seventh pass"),
// W1: two profile removals whose clean-ups overlapped. The second removal
// joined the first sweep's promise, which had read the clean-up list
// before the second removal added its entries: the second download stayed
// on disk, was reported as `pending: 0` and no retry was set. These run the
// real Client, Profiles and OfflineLibrary over real files.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "../core/client.mjs";
import { DurableWriter } from "../core/durable.mjs";
import { OfflineLibrary } from "../electron/offline.mjs";

const meta = { id: "tt1234567", type: "movie", name: "Fixture" };
const bytes = (id) => Buffer.from("disposable download " + id);
const hex = (n) => String(n).repeat(32);
const gone = (path) =>
  stat(path).then(
    () => false,
    (error) => error.code === "ENOENT",
  );

/**
 * A profile file written synchronously (the desktop's), or, with `durable`,
 * through a DurableWriter whose writes can be held and refused (the shape
 * of a store that answers later, as Codex's fixtures use).
 */
async function setup({ durable = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "riwaq-w1-"));
  const root = join(dir, "offline");
  mkdirSync(root);
  const file = join(dir, "profile.bin");
  const load = () =>
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const holds = [];
  let current;
  const writer = durable
    ? new DurableWriter({
        snapshot: () => ({ text: JSON.stringify(current) }),
        write: async (text) => {
          const gate = holds.shift();
          if (gate) {
            gate.started.resolve();
            await gate.finish.promise;
          }
          writeFileSync(file, text);
        },
      })
    : null;
  const save = durable
    ? (state, undo) => {
        current = state;
        return writer.request(undo);
      }
    : (state) => writeFileSync(file, JSON.stringify(state));
  const held = new Map(); // path → { started, release } or "locked"
  const deleteFile = async (path) => {
    const hold = held.get(path);
    if (hold === "locked")
      throw Object.assign(Error("held by another program"), { code: "EBUSY" });
    if (hold) {
      held.delete(path);
      hold.started.resolve();
      await hold.release.promise;
    }
    await rm(path, { force: true });
  };
  const boot = () => {
    const client = new Client({ load, save });
    const offline = new OfflineLibrary(client, {
      root,
      resolveSource: async () => Promise.reject(Error("no source")),
      deleteFile,
    });
    return { client, offline };
  };
  let { client, offline } = boot();
  const named = (name) =>
    client.profiles.create({ name }).profiles.list.find((p) => p.name === name)
      .id;
  const b = named("B");
  const c = named("C");
  const d = named("D");
  if (writer) await writer.settled();
  const t = {
    dir,
    root,
    b,
    c,
    d,
    a: client.profiles.store.active,
    writer,
    get client() {
      return client;
    },
    get offline() {
      return offline;
    },
    disk: () => JSON.parse(readFileSync(file, "utf8")),
    media: (id) => join(root, id + ".media"),
    /** The next delete of `path` waits until released. */
    pause(path) {
      const hold = {
        started: Promise.withResolvers(),
        release: Promise.withResolvers(),
      };
      held.set(path, hold);
      return {
        started: hold.started.promise,
        release: () => hold.release.resolve(),
      };
    },
    lock: (path) => held.set(path, "locked"),
    unlock: (path) => held.delete(path),
    /** The next durable write waits; resolve or reject its `finish`. */
    holdWrite() {
      const gate = {
        started: Promise.withResolvers(),
        finish: Promise.withResolvers(),
      };
      holds.push(gate);
      return gate;
    },
    async seed(profile, id) {
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
      });
      client.persist();
      if (writer) await writer.settled();
    },
    restart() {
      clearTimeout(offline.sweepTimer);
      ({ client, offline } = boot());
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
const removed = (state, id) => !state.profiles.list.some((p) => p.id === id);
const trashIds = (state) => (state.offlineTrash || []).map((x) => x.id);

test("W1: C removed while B's clean-up is paused mid-delete: both downloads go, each removal is answered for its own files", async () => {
  const t = await setup();
  try {
    await t.seed(t.b, hex(1));
    await t.seed(t.c, hex(2));
    await t.seed(t.a, hex(9)); // the active profile's: never touched
    const paused = t.pause(t.media(hex(1)));
    const first = t.offline.removeProfile({ id: t.b });
    await paused.started; // B's pass is inside its first media delete
    const second = t.offline.removeProfile({ id: t.c });
    // C's removal is written while B's pass still holds its old list.
    for (let i = 0; i < 50 && !removed(t.disk(), t.c); i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.ok(removed(t.disk(), t.c));
    assert.ok(existsSync(t.media(hex(2)))); // not deleted before asked
    paused.release();
    const [stateB, stateC] = await Promise.all([first, second]);
    assert.ok(removed(stateB, t.b) && removed(stateC, t.c));
    assert.equal(stateB.offlineCleanup, undefined);
    assert.equal(stateC.offlineCleanup, undefined);
    assert.ok(await gone(t.media(hex(1))));
    // Codex's finding: this file stayed, with `pending: 0` and no timer.
    assert.ok(await gone(t.media(hex(2))));
    assert.ok(await gone(join(t.root, hex(2) + ".poster.jpg")));
    assert.deepEqual(t.disk().offlineTrash, []);
    assert.equal(t.offline.sweepTimer, null);
    assert.deepEqual(await readFile(t.media(hex(9))), bytes(hex(9)));
  } finally {
    await t.cleanup();
  }
});

test("W1: C's held file during B's paused pass is reported to C, kept durably, retried by a timer and deleted once let go", async () => {
  const t = await setup();
  try {
    await t.seed(t.b, hex(1));
    await t.seed(t.c, hex(2));
    t.lock(t.media(hex(2)));
    const paused = t.pause(t.media(hex(1)));
    const first = t.offline.removeProfile({ id: t.b });
    await paused.started;
    const second = t.offline.removeProfile({ id: t.c });
    for (let i = 0; i < 50 && !removed(t.disk(), t.c); i++)
      await new Promise((r) => setTimeout(r, 5));
    paused.release();
    const [stateB, stateC] = await Promise.all([first, second]);
    // B's own files went: B is not told about C's.
    assert.equal(stateB.offlineCleanup, undefined);
    assert.deepEqual(stateC.offlineCleanup, { pending: 1 });
    assert.deepEqual(trashIds(t.disk()), [hex(2)]);
    assert.deepEqual(await readFile(t.media(hex(2))), bytes(hex(2)));
    assert.ok(t.offline.sweepTimer, "a retry is set");
    // The timer's sweep, once the other program let go.
    t.unlock(t.media(hex(2)));
    assert.deepEqual(await t.offline.sweep(), { pending: 0 });
    assert.ok(await gone(t.media(hex(2))));
    assert.deepEqual(t.disk().offlineTrash, []);
    assert.equal(t.offline.sweepTimer, null);
    // Idempotent.
    assert.deepEqual(await t.offline.sweep(), { pending: 0 });
  } finally {
    await t.cleanup();
  }
});

test("W1: three quick removals over one paused pass all finish; a locked file survives a restart and goes at the next start", async () => {
  const t = await setup();
  try {
    await t.seed(t.b, hex(1));
    await t.seed(t.c, hex(2));
    await t.seed(t.c, hex(3));
    await t.seed(t.d, hex(4));
    t.lock(t.media(hex(4)));
    const paused = t.pause(t.media(hex(1)));
    const first = t.offline.removeProfile({ id: t.b });
    await paused.started;
    const second = t.offline.removeProfile({ id: t.c });
    const third = t.offline.removeProfile({ id: t.d });
    paused.release();
    const [, stateC, stateD] = await Promise.all([first, second, third]);
    assert.equal(stateC.offlineCleanup, undefined);
    assert.deepEqual(stateD.offlineCleanup, { pending: 1 });
    for (const id of [hex(1), hex(2), hex(3)])
      assert.ok(await gone(t.media(id)), id);
    assert.deepEqual(trashIds(t.disk()), [hex(4)]);
    // Riwaq stops with the file still held: the entry is on disk.
    t.restart();
    assert.deepEqual(trashIds(t.client.state), [hex(4)]);
    assert.deepEqual(await t.offline.sweep(), { pending: 1 });
    t.unlock(t.media(hex(4)));
    assert.deepEqual(await t.offline.sweep(), { pending: 0 });
    assert.ok(await gone(t.media(hex(4))));
    assert.deepEqual(t.disk().offlineTrash, []);
  } finally {
    await t.cleanup();
  }
});

test("W1: a file held for good is retried a bounded number of times; a newer removal gets its own budget", async () => {
  const t = await setup();
  try {
    await t.seed(t.b, hex(1));
    t.lock(t.media(hex(1)));
    const state = await t.offline.removeProfile({ id: t.b });
    assert.deepEqual(state.offlineCleanup, { pending: 1 });
    let timers = t.offline.sweepTimer ? 1 : 0;
    // What the timers would do, run at once: each sets the next while the
    // budget lasts, then stops; the entry stays durable.
    for (let i = 0; i < 12; i++) {
      await t.offline.sweep();
      if (t.offline.sweepTimer) timers++;
    }
    assert.ok(timers <= 6, `at most the budget (${timers})`);
    assert.equal(t.offline.sweepTimer, null);
    assert.deepEqual(trashIds(t.disk()), [hex(1)]);
    // A later removal resets the budget for what it adds.
    await t.seed(t.c, hex(2));
    t.lock(t.media(hex(2)));
    const later = await t.offline.removeProfile({ id: t.c });
    assert.deepEqual(later.offlineCleanup, { pending: 1 });
    assert.ok(t.offline.sweepTimer);
  } finally {
    await t.cleanup();
  }
});

test("W1: a pass started by another removal never deletes the files of a removal whose write is still pending, and a refused write keeps them", async () => {
  const t = await setup({ durable: true });
  try {
    await t.seed(t.b, hex(1));
    await t.seed(t.c, hex(2));
    // C's removal waits for its write.
    const gate = t.holdWrite();
    const removingC = t.offline.removeProfile({ id: t.c });
    await gate.started.promise;
    assert.deepEqual(trashIds(t.client.state), [hex(2)]); // in memory only
    // B's removal (its write queued behind C's) and a timer-like sweep.
    const sweptMeanwhile = await t.offline.sweep();
    assert.deepEqual(sweptMeanwhile, { pending: 1 });
    assert.deepEqual(await readFile(t.media(hex(2))), bytes(hex(2)));
    gate.finish.reject(Error("the write was refused"));
    await assert.rejects(removingC);
    // C is back with its record and file, and nothing waits for it.
    assert.ok(t.client.state.profiles.list.some((p) => p.id === t.c));
    assert.deepEqual(
      t.client.state.offline[t.c].map((x) => x.id),
      [hex(2)],
    );
    assert.deepEqual(trashIds(t.client.state), []);
    assert.deepEqual(await readFile(t.media(hex(2))), bytes(hex(2)));
    assert.deepEqual(await t.offline.sweep(), { pending: 0 });
    assert.deepEqual(await readFile(t.media(hex(2))), bytes(hex(2)));
    // B's removal, written, still cleans its own.
    const stateB = await t.offline.removeProfile({ id: t.b });
    assert.equal(stateB.offlineCleanup, undefined);
    assert.ok(await gone(t.media(hex(1))));
    assert.deepEqual(await readFile(t.media(hex(2))), bytes(hex(2)));
  } finally {
    await t.cleanup();
  }
});

test("W1: an entry that a live record names again during a pass keeps its files; invalid and missing entries are dropped without touching anything else", async () => {
  const t = await setup();
  const outside = join(t.dir, "outside.bin");
  try {
    await t.seed(t.c, hex(7));
    await writeFile(outside, "not Riwaq's");
    await writeFile(t.media(hex(1)), bytes(hex(1)));
    await writeFile(t.media(hex(3)), bytes(hex(3)));
    t.client.state.offlineTrash = [
      { id: hex(1), at: 1 },
      { id: hex(3), at: 1 },
      { id: hex(5), at: 1 }, // its files are already gone
      { id: "../outside", at: 1 },
    ];
    t.client.persist();
    const { client, offline } = t.restart();
    const paused = t.pause(t.media(hex(1)));
    const sweeping = offline.sweep();
    await paused.started;
    // hex(3) is named by a live record before the pass reaches it.
    client.state.offline[t.c].push({
      id: hex(3),
      meta,
      videoId: meta.id,
      status: "ready",
      bytes: 1,
      total: 1,
      at: 2,
    });
    paused.release();
    assert.deepEqual(await sweeping, { pending: 0 });
    assert.ok(await gone(t.media(hex(1))));
    assert.deepEqual(await readFile(t.media(hex(3))), bytes(hex(3)));
    assert.deepEqual(await readFile(t.media(hex(7))), bytes(hex(7)));
    assert.equal(await readFile(outside, "utf8"), "not Riwaq's");
    assert.deepEqual(t.disk().offlineTrash, []);
  } finally {
    await t.cleanup();
  }
});

test("W1: forgetProfile answers for its own entries, not another removal's leftovers", async () => {
  const t = await setup();
  try {
    await t.seed(t.b, hex(1));
    await t.seed(t.c, hex(2));
    t.lock(t.media(hex(1)));
    const stateB = await t.offline.removeProfile({ id: t.b });
    assert.deepEqual(stateB.offlineCleanup, { pending: 1 });
    assert.deepEqual(await t.offline.forgetProfile(t.c), { pending: 0 });
    assert.ok(await gone(t.media(hex(2))));
    assert.deepEqual(trashIds(t.disk()), [hex(1)]);
  } finally {
    await t.cleanup();
  }
});
