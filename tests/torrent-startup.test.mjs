import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  lstat,
  readdir,
  rm,
  mkdir,
  mkdtemp,
  writeFile,
  symlink,
  access,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { validHash } from "../core/torrent-engine.mjs";
import { startEngine } from "../electron/torrent-engine.mjs";

const main = readFileSync(
  new URL("../electron/main.mjs", import.meta.url),
  "utf8",
);
const source = main.slice(
  main.indexOf("async function sweepTorrentCache()"),
  main.indexOf("// TorrServer (core/torrserver.mjs)"),
);
const hash = "a".repeat(40);
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
async function fixture(t) {
  const parent = resolve(".cache/startup-cache-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "case-"));
  assert.ok(root.startsWith(parent + "\\") || root.startsWith(parent + "/"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function sweep(root, cache = "viewing", overrides = {}) {
  return runInNewContext(`(${source.trim()})`, {
    client: { state: { settings: { torrentCache: cache } } },
    app: { getPath: () => root },
    torrentHost: null,
    join,
    lstat,
    readdir,
    rm,
    validHash,
    logError: () => {},
    ...overrides,
  })();
}
test("startup cleanup never follows a junction at the cache root", async (t) => {
  const root = await fixture(t);
  const target = join(root, "external", hash);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "keep.txt"), "not a viewing cache");
  await symlink(
    join(root, "external"),
    join(root, "torrent-cache"),
    "junction",
  );
  await sweep(root);
  assert.equal(
    await exists(join(target, "keep.txt")),
    true,
    "root junction redirected deletion",
  );
});
test("startup cleanup removes only hash directories and preserves links and downloads", async (t) => {
  const root = await fixture(t);
  const cache = join(root, "torrent-cache");
  for (const dir of [
    join(cache, hash),
    join(cache, "not-a-hash"),
    join(root, "offline"),
    join(root, "offline-torrent-cache"),
    join(root, "external"),
  ]) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "keep.txt"), "fixture");
  }
  await symlink(
    join(root, "external"),
    join(cache, "b".repeat(40)),
    "junction",
  );
  await writeFile(
    join(cache, "c".repeat(40)),
    "a file is not a cache directory",
  );
  await sweep(root);
  assert.equal(await exists(join(cache, hash)), false);
  for (const dir of [
    join(cache, "not-a-hash"),
    join(root, "offline"),
    join(root, "offline-torrent-cache"),
    join(root, "external"),
  ])
    assert.equal(await exists(join(dir, "keep.txt")), true, dir);
  assert.equal(await exists(join(cache, "c".repeat(40))), true);
});
test("startup cleanup preserves retained caches and tolerates a missing directory", async (t) => {
  const root = await fixture(t);
  await sweep(root);
  await mkdir(join(root, "torrent-cache", hash), { recursive: true });
  await sweep(root, "5");
  assert.equal(await exists(join(root, "torrent-cache", hash)), true);
});
test("a locked cache logs its failure and does not stop other cleanup", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "torrent-cache", hash), { recursive: true });
  await mkdir(join(root, "torrent-cache", "b".repeat(40)), { recursive: true });
  const errors = [];
  await sweep(root, "viewing", {
    rm: (path, options) =>
      path.endsWith(hash)
        ? Promise.reject(
            Object.assign(new Error("fixture lock"), { code: "EPERM" }),
          )
        : rm(path, options),
    logError: (_, error) => errors.push(error.code),
  });
  assert.deepEqual(errors, ["EPERM"]);
  assert.equal(await exists(join(root, "torrent-cache", hash)), true);
  assert.equal(
    await exists(join(root, "torrent-cache", "b".repeat(40))),
    false,
  );
});
test("startup finishes cache deletion before exposing the application window", () => {
  const start = main.indexOf("await client.updates.restore()");
  const ready = main.indexOf("window = new BrowserWindow", start);
  assert.match(
    main.slice(start, ready),
    /await sweepTorrentCache\(\)/,
    "fire-and-forget removal can race new engine writes",
  );
});

test("the viewing engine cannot re-enter a cache root junction skipped at startup", async (t) => {
  const root = await fixture(t);
  const target = join(root, "external");
  await mkdir(join(target, hash), { recursive: true });
  await writeFile(join(target, hash, "keep.txt"), "outside cache");
  await symlink(target, join(root, "torrent-cache"), "junction");
  let engine;
  try {
    await assert.rejects(async () => {
      engine = await startEngine({
        cacheDir: join(root, "torrent-cache"),
        network: { dht: false, tracker: false, natUpnp: false },
      });
    }, /مجلد ذاكرة التورنت/);
  } finally {
    await engine?.close();
  }
  assert.equal(await exists(join(target, hash, "keep.txt")), true);
});

test("the engine neither prunes nor writes through a hash directory junction", async (t) => {
  const root = await fixture(t);
  const target = join(root, "external");
  const cache = join(root, "torrent-cache");
  await mkdir(target);
  await mkdir(cache);
  await writeFile(join(target, "keep.txt"), "outside cache");
  await symlink(target, join(cache, hash), "junction");
  const engine = await startEngine({
    cacheDir: cache,
    network: { dht: false, tracker: false, natUpnp: false },
  });
  try {
    assert.equal((await lstat(join(cache, hash))).isSymbolicLink(), true);
    assert.throws(() => engine.url({ infoHash: hash }), /مجلد ذاكرة التورنت/);
    assert.equal(await exists(join(target, "keep.txt")), true);
  } finally {
    await engine.close();
  }
});
