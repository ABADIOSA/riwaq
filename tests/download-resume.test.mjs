import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadFile, OfflineLibrary } from "../electron/offline.mjs";

test("HTTP resume appends only a matching entity and exact range; 200 restarts without mixed bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "riwaq-range-")),
    part = join(dir, "file.part"),
    signal = new AbortController().signal;
  const resume = { etag: '"v1"', total: 10 };
  try {
    await writeFile(part, "0123");
    const bytes = await downloadFile({
      url: "https://cdn.test/video",
      part,
      signal,
      resume,
      request: async (_url, args) => {
        assert.equal(args.headers.Range, "bytes=4-");
        assert.equal(args.headers["If-Range"], '"v1"');
        return new Response(Buffer.from("456789"), {
          status: 206,
          headers: {
            etag: '"v1"',
            "content-range": "bytes 4-9/10",
            "content-length": "6",
          },
        });
      },
    });
    assert.equal(bytes, 10);
    assert.equal(await readFile(part, "utf8"), "0123456789");
    await writeFile(part, "old!");
    await downloadFile({
      url: "https://cdn.test/video",
      part,
      signal,
      resume,
      request: async () =>
        new Response(Buffer.from("new-version"), {
          headers: { etag: '"v2"', "content-length": "11" },
        }),
    });
    assert.equal(await readFile(part, "utf8"), "new-version");
    for (const headers of [
      { "content-range": "bytes 3-9/10", etag: '"v1"' },
      { "content-range": "bytes 4-9/10", etag: '"v2"' },
    ]) {
      await writeFile(part, "0123");
      await assert.rejects(
        downloadFile({
          url: "https://cdn.test/video",
          part,
          signal,
          resume,
          request: async () =>
            new Response(Buffer.from("456789"), { status: 206, headers }),
        }),
      );
      assert.equal(await readFile(part, "utf8"), "0123");
    }
    await writeFile(part, "unsafe");
    await downloadFile({
      url: "https://cdn.test/video",
      part,
      signal,
      resume: { total: 10 },
      request: async (_url, args) => {
        assert.equal(args.headers.Range, undefined);
        return new Response(Buffer.from("safe"));
      },
    });
    assert.equal(await readFile(part, "utf8"), "safe");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pausing and restarting the app retains a private source and partial, then resumes without exposing them", async () => {
  const root = await mkdtemp(join(tmpdir(), "riwaq-resume-"));
  const client = {
    state: {},
    profiles: { store: { active: "p" }, gate() {}, capture() {} },
    saveData() {},
  };
  const opts = {
    root,
    resolveSource: async (stream) => ({ url: stream.url }),
    request: async (_url, args) => {
      if (args.headers.Range)
        return new Response(Buffer.from("456789"), {
          status: 206,
          headers: {
            etag: '"v1"',
            "content-range": "bytes 4-9/10",
            "content-length": "6",
          },
        });
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("0123"));
            args.signal.addEventListener(
              "abort",
              () => c.error(Error("paused")),
              { once: true },
            );
          },
        }),
        { headers: { etag: '"v1"', "content-length": "10" } },
      );
    },
  };
  let lib = new OfflineLibrary(client, opts);
  try {
    const result = lib.start({
      profileId: "p",
      stream: { url: "https://secret.test/video?token=private" },
      meta: { id: "m", type: "movie", name: "Movie" },
      videoId: "m",
      settings: {},
    });
    const id = result.items[0].id;
    for (let i = 0; i < 100; i++) {
      if ((await stat(lib.path(id, true)).catch(() => null))?.size === 4) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    await lib.stop();
    assert.equal(lib.list("p").items[0].bytes, 4);
    assert.ok(!JSON.stringify(lib.list("p")).includes("secret.test"));
    lib = new OfflineLibrary(client, opts);
    assert.equal(lib.list("p").items[0].status, "interrupted");
    lib.resume("p", id, {});
    await lib.job.done;
    assert.equal(lib.list("p").items[0].status, "ready");
    assert.equal(await readFile(lib.path(id), "utf8"), "0123456789");
    assert.ok(!JSON.stringify(client.state).includes("secret.test"));
    client.profiles.store.active = "other";
    assert.throws(() => lib.resume("p", id, {}));
  } finally {
    await lib.stop();
    await rm(root, { recursive: true, force: true });
  }
});
