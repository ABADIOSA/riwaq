import test from "node:test";
import assert from "node:assert/strict";
import {
  THEINTRODB_API,
  introDbTarget,
  onlineSegments,
  parseTheIntroDb,
  theIntroDbUrl,
} from "../core/skip-online.mjs";
import { Client } from "../core/client.mjs";
import { collectBackup } from "../core/backup.mjs";

test("TheIntroDB is asked by IMDb title, with season and episode for a series", () => {
  assert.deepEqual(introDbTarget("tt0903747:1:3"), {
    imdb: "tt0903747",
    season: 1,
    episode: 3,
  });
  assert.deepEqual(introDbTarget("tt0111161"), { imdb: "tt0111161" });
  for (const id of [
    "kitsu:1:1",
    "tt12:1:1",
    "tt0903747:1",
    "tt0903747:x:1",
    "",
  ])
    assert.equal(introDbTarget(id), null, id);
  assert.equal(
    theIntroDbUrl({
      imdb: "tt0903747",
      season: 1,
      episode: 3,
      durationMs: 2820400.4,
    }),
    `${THEINTRODB_API}?imdb_id=tt0903747&season=1&episode=3&duration_ms=2820400`,
  );
  assert.equal(
    theIntroDbUrl({ imdb: "tt0111161" }),
    "https://api.theintrodb.org/v3/media?imdb_id=tt0111161",
  );
});

test("TheIntroDB's milliseconds become segments; an open end runs to the file's end", () => {
  const body = {
    intro: [{ start_ms: 62000, end_ms: 151500 }],
    recap: [{ start_ms: null, end_ms: 45000 }],
    credits: [{ start_ms: 2700000, end_ms: null }],
    preview: [{ start_ms: 0, end_ms: 0 }],
  };
  assert.deepEqual(parseTheIntroDb(body, 2820), [
    { kind: "recap", start: 0, end: 45, source: "theintrodb" },
    { kind: "intro", start: 62, end: 151.5, source: "theintrodb" },
    { kind: "outro", start: 2700, end: 2820, source: "theintrodb" },
  ]);
  // Without the duration, an open end cannot be placed and is left out.
  assert.equal(
    parseTheIntroDb(body, 0).some((s) => s.kind === "outro"),
    false,
  );
  assert.deepEqual(
    parseTheIntroDb(
      {
        intro: [
          { start_ms: "x", end_ms: 9 },
          { start_ms: 1000, end_ms: 3000 },
        ],
      },
      100,
    ),
    [],
    "bad numbers and blinks are refused",
  );
  assert.deepEqual(parseTheIntroDb(null), []);
});

test("the key goes as a Bearer token; 'none yet' is silence, a failure throws", async () => {
  const asked = [];
  const fetchJson = async (url, headers) => {
    asked.push({ url, headers });
    return { intro: [{ start_ms: 1000, end_ms: 60000 }] };
  };
  const segments = await onlineSegments("tt0903747:2:5", {
    fetchJson,
    introDbKey: "tidb_abc",
    duration: 1500,
  });
  assert.equal(segments.length, 1);
  assert.match(
    asked[0].url,
    /imdb_id=tt0903747&season=2&episode=5&duration_ms=1500000/,
  );
  assert.deepEqual(asked[0].headers, { Authorization: "Bearer tidb_abc" });
  await onlineSegments("tt0111161", { fetchJson });
  assert.deepEqual(asked[1].headers, {}, "no key, no header");
  const failing = (message) => async () => {
    throw new Error(message);
  };
  assert.deepEqual(
    await onlineSegments("tt0111161", { fetchJson: failing("HTTP 404") }),
    [],
  );
  await assert.rejects(
    onlineSegments("tt0111161", { fetchJson: failing("HTTP 429") }),
    /429/,
  );
});

test("the client sends the saved key, remembers answers and retries failures", async () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  c.state.settings.skipOnline = true;
  c.dataHub.save({ id: "theintrodb", key: "tidb_secret", enabled: true });
  const calls = [];
  const realFetch = globalThis.fetch;
  let status = 429;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(
      status === 200
        ? JSON.stringify({ intro: [{ start_ms: 5000, end_ms: 65000 }] })
        : "{}",
      { status },
    );
  };
  try {
    await assert.rejects(c.skipTimes("tt0903747:1:1", { duration: 3000 }));
    status = 200;
    const segments = await c.skipTimes("tt0903747:1:1", { duration: 3000 });
    assert.equal(segments.length, 1, "a failure was not remembered");
    await c.skipTimes("tt0903747:1:1", { duration: 3000 });
    assert.equal(calls.length, 2, "an answer is remembered");
    assert.equal(calls[1].init.headers.Authorization, "Bearer tidb_secret");
    assert.equal(calls[1].init.redirect, "error");
    c.state.settings.skipOnline = false;
    assert.deepEqual(await c.skipTimes("tt0903747:1:2"), []);
    assert.equal(calls.length, 2, "nothing is asked when it is off");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the key never reaches the interface, and travels only in a secrets backup", () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  c.dataHub.save({ id: "theintrodb", key: "tidb_secret", enabled: true });
  const card = c.publicState().providers.find((p) => p.id === "theintrodb");
  assert.equal(card.configured, true);
  assert.equal(card.group, "skip");
  assert.doesNotMatch(JSON.stringify(c.publicState()), /tidb_secret/);
  const plain = collectBackup(c.state).payload;
  assert.doesNotMatch(JSON.stringify(plain), /tidb_secret/);
  const secret = collectBackup(c.state, { includeSecrets: true }).payload;
  assert.equal(secret.providers.theintrodb.key, "tidb_secret");
});
