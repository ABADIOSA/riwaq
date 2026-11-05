// Issue #136: download cards showed the empty film icon instead of a poster.
// The flow was already there (OfflineLibrary.artwork); these tests pin the
// gaps found while tracing it: a single attempt per session, no fallback
// when the title's poster is refused or undecodable (Electron's nativeImage
// decodes JPEG and PNG only), http: posters, generic content types, and
// posters fetched only when the Downloads window happened to be open.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OfflineLibrary,
  imageKind,
  posterCandidates,
} from "../electron/offline.mjs";

const id = "c".repeat(32);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
]);

async function fixture(meta) {
  const root = await mkdtemp(join(tmpdir(), "riwaq-posters-"));
  const client = {
    state: {
      offline: {
        p: [{ id, meta, videoId: meta.id, status: "ready", bytes: 4 }],
      },
    },
    profiles: { store: { active: "p" }, gate() {}, capture() {} },
    saveData() {},
  };
  return {
    root,
    client,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test("poster candidates: the title's poster, metahub by IMDb ID, then the backdrop; HTTPS only", () => {
  assert.deepEqual(
    posterCandidates({
      id: "tt0903747",
      poster: "http://posters.example/p.jpg",
      background: "https://img.example/b.jpg",
    }),
    [
      "https://posters.example/p.jpg",
      "https://images.metahub.space/poster/medium/tt0903747/img",
      "https://img.example/b.jpg",
    ],
  );
  assert.deepEqual(
    posterCandidates({
      id: "kitsu:1",
      poster: "https://user:secret@x.example/p.jpg",
      background: "ftp://x.example/b.jpg",
    }),
    [],
  );
  assert.deepEqual(posterCandidates({ id: "film" }), []);
});

test("the picture's own bytes decide its format", () => {
  assert.equal(imageKind(JPEG), "jpeg");
  assert.equal(
    imageKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])),
    "png",
  );
  assert.equal(imageKind(WEBP), "webp");
  assert.equal(imageKind(Buffer.from("<html>nope</html>")), "");
});

test("a refused or undecodable poster falls through to the next candidate", async () => {
  const f = await fixture({
    id: "tt0111161",
    type: "movie",
    name: "Fixture",
    poster: "https://addon.example/poster.webp",
  });
  const asked = [];
  const reasons = [];
  const lib = new OfflineLibrary(f.client, {
    root: f.root,
    // Electron's nativeImage: JPEG and PNG only.
    thumbnail: (bytes) => (imageKind(bytes) === "jpeg" ? JPEG : null),
    onArtworkError: (reason) => reasons.push(reason),
    request: async (url, init) => {
      asked.push(url);
      assert.match(init.headers.accept, /^image\/jpeg/);
      return url.includes("metahub")
        ? new Response(JPEG, {
            // Object stores often label pictures generically.
            headers: { "content-type": "binary/octet-stream" },
          })
        : new Response(WEBP, { headers: { "content-type": "image/webp" } });
    },
  });
  try {
    const { image } = await lib.artwork("p", id);
    assert.equal(image, "data:image/jpeg;base64," + JPEG.toString("base64"));
    assert.deepEqual(asked, [
      "https://addon.example/poster.webp",
      "https://images.metahub.space/poster/medium/tt0111161/img",
    ]);
    // The diagnostic learns why, never where.
    assert.deepEqual(reasons, ["decode webp"]);
    assert.ok(!reasons.join().includes("addon.example"));
  } finally {
    await f.cleanup();
  }
});

test("a failed poster is asked again after a pause, a bounded number of times", async () => {
  const f = await fixture({
    id: "film",
    type: "movie",
    name: "Fixture",
    poster: "https://art.example/p.jpg",
  });
  let requests = 0;
  let online = false;
  const lib = new OfflineLibrary(f.client, {
    root: f.root,
    thumbnail: () => JPEG,
    artworkRetryMs: 0,
    request: async () => {
      requests++;
      if (!online) throw new TypeError("fetch failed");
      return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    },
  });
  try {
    assert.equal((await lib.artwork("p", id)).image, null);
    online = true;
    assert.ok((await lib.artwork("p", id)).image);
    assert.equal(requests, 2);
    // Cached on disk now: no further request.
    assert.ok((await lib.artwork("p", id)).image);
    assert.equal(requests, 2);
  } finally {
    await f.cleanup();
  }
  const g = await fixture({
    id: "film",
    type: "movie",
    name: "Fixture",
    poster: "https://art.example/p.jpg",
  });
  let tries = 0;
  const stubborn = new OfflineLibrary(g.client, {
    root: g.root,
    thumbnail: () => JPEG,
    artworkRetryMs: 0,
    request: async () => {
      tries++;
      return new Response("no", { status: 503 });
    },
  });
  try {
    for (let i = 0; i < 6; i++)
      assert.equal((await stubborn.artwork("p", id)).image, null);
    assert.equal(tries, 3);
  } finally {
    await g.cleanup();
  }
  const h = await fixture({
    id: "film",
    type: "movie",
    name: "Fixture",
    poster: "https://art.example/p.jpg",
  });
  let soon = 0;
  const patient = new OfflineLibrary(h.client, {
    root: h.root,
    thumbnail: () => JPEG,
    request: async () => {
      soon++;
      return new Response("no", { status: 503 });
    },
  });
  try {
    await patient.artwork("p", id);
    await patient.artwork("p", id);
    // The default pause keeps an open window from hammering the host.
    assert.equal(soon, 1);
  } finally {
    await h.cleanup();
  }
});

test("starting a download saves its poster while the title is online", async () => {
  const f = await fixture({ id: "x", type: "movie", name: "Seed" });
  f.client.state.offline.p = [];
  const meta = {
    id: "tt0133093",
    type: "movie",
    name: "Fixture",
    poster: "https://art.example/p.jpg",
  };
  let release;
  const held = new Promise((r) => (release = r));
  const lib = new OfflineLibrary(f.client, {
    root: f.root,
    thumbnail: () => JPEG,
    resolveSource: async (stream, settings, signal) => {
      await held;
      signal.throwIfAborted();
      return { url: "https://media.example/v.mp4" };
    },
    request: async (url) => {
      if (url.startsWith("https://art.example"))
        return new Response(JPEG, {
          headers: { "content-type": "image/jpeg" },
        });
      throw new Error("unexpected " + url);
    },
  });
  try {
    lib.start({
      profileId: "p",
      stream: { url: "https://media.example/v.mp4" },
      meta,
      videoId: meta.id,
      settings: {},
    });
    const started = f.client.state.offline.p[0].id;
    let files = [];
    for (let i = 0; i < 100; i++) {
      files = await readdir(f.root).catch(() => []);
      if (files.includes(`${started}.poster.jpg`)) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(files.includes(`${started}.poster.jpg`), files.join());
    // Offline afterwards: the saved poster still shows.
    lib.request = async () => {
      throw new TypeError("offline");
    };
    assert.ok((await lib.artwork("p", started)).image);
    release();
    await lib.stop();
  } finally {
    release();
    await f.cleanup();
  }
});

test("a poster still in flight never lands for a removed download", async () => {
  const f = await fixture({
    id: "film",
    type: "movie",
    name: "Fixture",
    poster: "https://art.example/p.jpg",
  });
  await writeFile(join(f.root, `${id}.media`), "test");
  let answer;
  const pending = new Promise((r) => (answer = r));
  const lib = new OfflineLibrary(f.client, {
    root: f.root,
    thumbnail: () => JPEG,
    request: async () => {
      await pending;
      return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    },
  });
  try {
    const art = lib.artwork("p", id).catch((e) => e);
    await new Promise((r) => setImmediate(r));
    const removal = lib.remove("p", id);
    answer();
    await removal;
    assert.match(String((await art)?.message), /غير متاح/);
    assert.deepEqual(await readdir(f.root), []);
  } finally {
    await f.cleanup();
  }
});
