// Download artwork's network boundary (issue #136, PR #142 review, CWE-918)
// with Node's real HTTPS client and real sockets: an addon's poster or
// backdrop address must never reach a private, loopback, link-local or
// special-use destination, whether by its literal form, by DNS, by a mixed
// or changing DNS answer, or through a redirect.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  ARTWORK_HOST_BLOCKED,
  publicArtworkUrl,
  requestArtwork,
} from "../electron/artwork-http.mjs";

/** A local TCP listener that counts every connection it receives. */
async function listener() {
  let connections = 0;
  const server = createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return {
    port: server.address().port,
    get connections() {
      return connections;
    },
    close: () => new Promise((done) => server.close(done)),
  };
}

test("literal addresses that embed or mean a non-public host are refused", () => {
  for (const address of [
    "https://127.1/x",
    "https://2130706433/x",
    "https://0.0.0.0/x",
    "https://255.255.255.255/x",
    "https://224.0.0.1/x",
    "https://[::]/x",
    "https://[::1]/x",
    "https://[::127.0.0.1]/x",
    "https://[::ffff:7f00:1]/x",
    "https://[64:ff9b::7f00:1]/x",
    "https://[2002:7f00:1::1]/x",
    "https://[2001::7f00:1]/x",
    "https://[2001:db8::1]/x",
    "https://[fe80::1]/x",
    "https://[fec0::1]/x",
    "https://[fd12:3456::1]/x",
    "https://[ff02::1]/x",
    "http://8.8.8.8/x",
    "https://user:pass@art.example/x",
    "https://art.home.arpa/x",
    "https://box.localhost/x",
  ])
    assert.equal(publicArtworkUrl(new URL(address)), false, address);
  for (const address of [
    "https://8.8.8.8/x",
    "https://[2606:4700::1111]/x",
    "https://image.tmdb.org/t/p/w500/x.jpg",
  ])
    assert.equal(publicArtworkUrl(new URL(address)), true, address);
});

test("a name that resolves to loopback opens no socket", async () => {
  const local = await listener();
  try {
    for (const answers of [
      [{ address: "127.0.0.1", family: 4 }],
      [{ address: "::ffff:127.0.0.1", family: 6 }],
      [
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 },
      ],
    ]) {
      await assert.rejects(
        requestArtwork(
          `https://art.example:${local.port}/poster.jpg`,
          {},
          { lookup: (host, options, done) => done(null, answers) },
        ),
        (error) => error.code === ARTWORK_HOST_BLOCKED,
        JSON.stringify(answers),
      );
    }
    // Literal loopback never even asks DNS.
    let asked = 0;
    await assert.rejects(
      requestArtwork(
        `https://127.0.0.1:${local.port}/poster.jpg`,
        {},
        {
          lookup: (host, options, done) => {
            asked++;
            done(null, [{ address: "127.0.0.1", family: 4 }]);
          },
        },
      ),
      (error) => error.code === ARTWORK_HOST_BLOCKED,
    );
    assert.equal(asked, 0);
    assert.equal(local.connections, 0, "no connection reached loopback");
  } finally {
    await local.close();
  }
});

test("each request checks the answer it connects with (no rebinding window)", async () => {
  const local = await listener();
  try {
    // A resolver that answers public the first time and loopback after:
    // the check and the connection share one lookup, so the second request
    // (a redirect hop, a retry) is refused rather than connected.
    const seen = [];
    const answers = [
      [{ address: "93.184.216.34", family: 4 }],
      [{ address: "127.0.0.1", family: 4 }],
    ];
    const lookup = (host, options, done) => {
      const next = answers.shift() || [{ address: "127.0.0.1", family: 4 }];
      seen.push(next[0].address);
      done(null, next);
    };
    // The first answer would leave this machine; a fake transport stands in
    // for it, using the same lookup the real socket would.
    const offline = (url, options, receive) => {
      const handlers = {};
      const req = {
        once: (event, fn) => (handlers[event] = fn),
        end: () =>
          options.lookup("art.example", { all: true }, (error, list) => {
            if (error) return handlers.error?.(error);
            assert.deepEqual(list, [{ address: "93.184.216.34", family: 4 }]);
            const { PassThrough } = process.getBuiltinModule("node:stream");
            const body = new PassThrough();
            body.statusCode = 204;
            body.headers = {};
            receive(body);
            body.end();
          }),
      };
      return req;
    };
    const first = await requestArtwork(
      "https://art.example/a",
      {},
      { lookup, request: offline },
    );
    assert.equal(first.status, 204);
    await first.body.cancel();
    await assert.rejects(
      requestArtwork(`https://art.example:${local.port}/b`, {}, { lookup }),
      (error) => error.code === ARTWORK_HOST_BLOCKED,
    );
    assert.deepEqual(seen, ["93.184.216.34", "127.0.0.1"]);
    assert.equal(local.connections, 0);
  } finally {
    await local.close();
  }
});

test("the transport keeps TLS verification and adds no proxy or agent", async () => {
  let options;
  const request = (url, opts) => {
    options = opts;
    return { once() {}, end() {} };
  };
  // Never resolves (the fake request never answers); only its options matter.
  void requestArtwork(
    "https://art.example/x",
    { headers: { accept: "image/*" } },
    { request },
  );
  await new Promise((done) => setImmediate(done));
  assert.equal(options.agent, false);
  assert.equal(typeof options.lookup, "function");
  assert.equal("rejectUnauthorized" in options, false);
  assert.equal("checkServerIdentity" in options, false);
  assert.equal("servername" in options, false);
  assert.equal(options.headers["accept-encoding"], "identity");
  assert.equal("cookie" in options.headers, false);
  assert.equal("authorization" in options.headers, false);
});

test("main builds the offline library with the guarded artwork transport", async () => {
  // OfflineLibrary falls back to `request` for artwork when no
  // `artworkRequest` is given (tests inject one). In main neither may be
  // passed, or download artwork would leave the public-HTTPS boundary.
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const main = readFileSync(
    fileURLToPath(new URL("../electron/main.mjs", import.meta.url)),
    "utf8",
  );
  const start = main.indexOf("new OfflineLibrary(client, {");
  assert.ok(start > 0, "main constructs the offline library");
  const block = main.slice(start, main.indexOf("\n      });", start));
  assert.doesNotMatch(block, /^\s*(request|artworkRequest)\s*[:,]/m);
});
