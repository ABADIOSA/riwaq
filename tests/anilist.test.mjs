import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import {
  anilistAuthorize,
  anilistLists,
  anilistProblem,
  anilistTarget,
  anilistToken,
  armAnilist,
  armLookup,
  isAnime,
  nextListEntry,
  validTarget,
} from "../core/anime.mjs";

const create = (request, initial = {}) =>
  new Client({ load: () => structuredClone(initial), save: () => {}, request });

const jwt = (payload) =>
  [
    Buffer.from('{"alg":"RS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "c2lnbmF0dXJlLXBhcnQtb2YtdGhlLXRva2Vu",
  ].join(".");
const TOKEN = jwt({
  sub: "1",
  exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 300,
});

test("finished viewings name AniList, MAL or Kitsu works; IMDb only for a first anime season", () => {
  assert.deepEqual(
    anilistTarget({ id: "kitsu:1", type: "series" }, "kitsu:1:5"),
    {
      source: "kitsu",
      id: 1,
      episode: 5,
      movie: false,
    },
  );
  assert.equal(anilistTarget({}, "mal:5114:64").source, "mal");
  assert.equal(anilistTarget({}, "anilist:21:1").id, 21);
  assert.deepEqual(
    anilistTarget({ id: "anilist:199", type: "movie" }, "anilist:199"),
    {
      source: "anilist",
      id: 199,
      episode: 1,
      movie: true,
    },
  );
  const anime = {
    id: "tt0388629",
    type: "series",
    genres: ["Animation"],
    country: "Japan",
  };
  assert.deepEqual(anilistTarget(anime, "tt0388629:1:7"), {
    source: "imdb",
    id: "tt0388629",
    episode: 7,
    movie: false,
  });
  // A later season is another AniList entry; a drama is not anime at all.
  assert.equal(anilistTarget(anime, "tt0388629:2:1"), null);
  assert.equal(
    anilistTarget(
      { id: "tt0903747", type: "series", genres: ["Drama"] },
      "tt0903747:1:1",
    ),
    null,
  );
  assert.equal(anilistTarget({ id: "x" }, "live:abc"), null);
  assert.equal(anilistTarget({}, "kitsu:0:3"), null);
  assert.ok(validTarget({ source: "imdb", id: "tt0388629", episode: 2 }));
  assert.ok(!validTarget({ source: "imdb", id: "tt1;drop", episode: 2 }));
  assert.ok(!validTarget({ source: "kitsu", id: "1", episode: 2 }));
  assert.ok(isAnime({ id: "kitsu:1" }));
});

test("the pasted token may be the token or the redirect address; junk is refused", () => {
  const plain = anilistToken(`  ${TOKEN}\n`);
  assert.equal(plain.access_token, TOKEN);
  assert.ok(plain.expiresAt > Date.now());
  const fromUrl = anilistToken(
    `https://anilist.co/api/v2/oauth/pin#access_token=${TOKEN}&token_type=Bearer&expires_in=31536000`,
  );
  assert.equal(fromUrl.access_token, TOKEN);
  assert.equal(anilistToken("short"), null);
  assert.equal(anilistToken("has spaces in it but is long enough"), null);
  assert.equal(anilistToken("a".repeat(40)).expiresAt, null);
  assert.equal(
    anilistAuthorize("1234"),
    "https://anilist.co/api/v2/oauth/authorize?client_id=1234&response_type=token",
  );
  assert.throws(() => anilistAuthorize("12a"), /Client ID/);
});

test("ARM maps Kitsu and IMDb IDs, and an IMDb show with several entries is left alone", () => {
  assert.equal(
    armLookup({ source: "kitsu", id: 7 }),
    "https://arm.haglund.dev/api/v2/ids?source=kitsu&id=7&include=anilist",
  );
  assert.equal(
    armLookup({ source: "imdb", id: "tt0388629" }),
    "https://arm.haglund.dev/api/v2/imdb?id=tt0388629&include=anilist",
  );
  assert.equal(armLookup({ source: "imdb", id: "tt1&x=y" }), "");
  assert.equal(armAnilist({ anilist: 21 }), 21);
  assert.equal(armAnilist([{ anilist: 21 }, { anilist: null }]), 21);
  assert.equal(armAnilist([{ anilist: 21 }, { anilist: 1735 }]), 0);
  assert.equal(armAnilist(null), 0);
  assert.equal(armAnilist({ anilist: "21; drop" }), 0);
});

test("progress only rises, a finished show is untouched, the last episode completes", () => {
  const media = (entry, episodes = 12) => ({
    id: 5,
    episodes,
    mediaListEntry: entry,
  });
  assert.deepEqual(nextListEntry(media(null), { episode: 3 }), {
    mediaId: 5,
    progress: 3,
    status: "CURRENT",
  });
  assert.deepEqual(
    nextListEntry(media({ progress: 11, status: "CURRENT" }), { episode: 12 }),
    {
      mediaId: 5,
      progress: 12,
      status: "COMPLETED",
    },
  );
  assert.equal(
    nextListEntry(media({ progress: 8, status: "CURRENT" }), { episode: 5 }),
    null,
  );
  assert.equal(
    nextListEntry(media({ progress: 12, status: "COMPLETED" }), { episode: 3 }),
    null,
  );
  assert.equal(nextListEntry(media(null), { episode: 30 }), null);
  assert.equal(
    nextListEntry(media({ progress: 2, status: "REPEATING" }), { episode: 4 })
      .status,
    "REPEATING",
  );
  assert.equal(
    nextListEntry(media({ progress: 0, status: "PLANNING" }, 0), {
      episode: 900,
    }).status,
    "CURRENT",
  );
  assert.deepEqual(
    nextListEntry(
      { id: 9, episodes: 1, mediaListEntry: null },
      { movie: true },
    ),
    {
      mediaId: 9,
      progress: 1,
      status: "COMPLETED",
    },
  );
});

test("AniList lists become rows of anilist: titles with AniList's own covers only", () => {
  const rows = anilistLists({
    lists: [
      {
        status: "CURRENT",
        entries: [
          {
            media: {
              id: 21,
              format: "TV",
              startDate: { year: 1999 },
              title: { english: "One Piece", romaji: "ONE PIECE" },
              coverImage: {
                large:
                  "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/x.jpg",
              },
            },
          },
          {
            media: {
              id: 199,
              format: "MOVIE",
              title: { romaji: "Sen" },
              coverImage: { large: "https://evil.example/x.jpg" },
            },
          },
        ],
      },
      { status: "DROPPED", entries: [{ media: { id: 1 } }] },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "anilist-current");
  assert.deepEqual(rows[0].metas[0], {
    id: "anilist:21",
    type: "series",
    name: "One Piece",
    poster:
      "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/x.jpg",
    releaseInfo: "1999",
  });
  assert.equal(rows[0].metas[1].type, "movie");
  assert.equal(rows[0].metas[1].poster, undefined);
  assert.equal(anilistProblem({ status: 429 }).status, 429);
  assert.match(anilistProblem({ status: 401 }).message, /اربط الحساب/);
});

/** A fake AniList and ARM: records every GraphQL call it answers. */
function fakeAnilist({
  entry = null,
  episodes = 12,
  arm = { anilist: 21 },
} = {}) {
  const calls = [];
  const request = async (url, options = {}) => {
    if (url.startsWith("https://arm.haglund.dev/")) {
      calls.push({ arm: url });
      return arm;
    }
    assert.equal(url, "https://graphql.anilist.co");
    assert.equal(options.redirect, "error");
    const body = JSON.parse(options.body);
    calls.push({ auth: options.headers.Authorization, ...body });
    if (body.query.includes("Viewer"))
      return { data: { Viewer: { id: 77, name: "Abadi" } } };
    if (body.query.includes("SaveMediaListEntry"))
      return { data: { SaveMediaListEntry: { id: 1, ...body.variables } } };
    if (body.query.includes("MediaListCollection"))
      return { data: { MediaListCollection: { lists: [] } } };
    return {
      data: {
        Media: {
          id: body.variables.id || 21,
          episodes,
          format: "TV",
          mediaListEntry: entry,
        },
      },
    };
  };
  return { calls, request };
}

test("AniList signs in with a pasted token and records a finished episode only when asked", async () => {
  const fake = fakeAnilist({ entry: { progress: 2, status: "CURRENT" } });
  const c = create(fake.request);
  assert.throws(
    () => c.integrations.save({ id: "anilist", clientId: "abc" }),
    /أرقام/,
  );
  c.integrations.save({ id: "anilist", clientId: "4321" });
  assert.equal(
    c.integrations.anilistAuthorizeUrl().includes("client_id=4321"),
    true,
  );
  await assert.rejects(c.integrations.anilistConnect("nope"), /ليس رمز/);
  await c.integrations.anilistConnect(TOKEN);
  const view = c.publicState().integrations.find((i) => i.id === "anilist");
  assert.equal(view.connected, true);
  assert.equal(view.username, "Abadi");
  assert.ok(!JSON.stringify(c.publicState()).includes(TOKEN));
  assert.equal(fake.calls[0].auth, `Bearer ${TOKEN}`);
  // Tracking is off until the viewer turns it on.
  c.integrations.queueHistory(
    { id: "kitsu:1", type: "series" },
    "kitsu:1:3",
    1400,
    1440,
  );
  assert.deepEqual(c.state.integrations.anilist.pending, []);
  c.integrations.save({ id: "anilist", trackHistory: true });
  // Half an episode is not a finished one.
  c.integrations.queueHistory(
    { id: "kitsu:1", type: "series" },
    "kitsu:1:3",
    600,
    1440,
  );
  assert.equal((c.state.integrations.anilist.pending || []).length, 0);
  c.integrations.queueHistory(
    { id: "kitsu:1", type: "series" },
    "kitsu:1:3",
    1400,
    1440,
  );
  c.integrations.queueHistory(
    { id: "kitsu:1", type: "series" },
    "kitsu:1:3",
    1420,
    1440,
  );
  await c.integrations.flushAnilist();
  const save = fake.calls.find((call) =>
    call.query?.includes("SaveMediaListEntry"),
  );
  assert.deepEqual(save.variables, {
    mediaId: 21,
    progress: 3,
    status: "CURRENT",
  });
  assert.equal(
    fake.calls.filter((call) => call.query?.includes("SaveMediaListEntry"))
      .length,
    1,
  );
  assert.ok(fake.calls.some((call) => call.arm?.includes("source=kitsu&id=1")));
  assert.deepEqual(c.state.integrations.anilist.sent, ["kitsu:1:3"]);
  assert.equal(c.state.integrations.anilist.pending.length, 0);
});

test("a MAL episode is found by idMal, and an episode behind the list writes nothing", async () => {
  const fake = fakeAnilist({ entry: { progress: 10, status: "CURRENT" } });
  const c = create(fake.request);
  c.integrations.save({ id: "anilist", clientId: "1" });
  await c.integrations.anilistConnect(TOKEN);
  c.integrations.save({ id: "anilist", trackHistory: true });
  c.integrations.queueHistory(
    { id: "mal:5114", type: "series" },
    "mal:5114:4",
    1400,
    1440,
  );
  await c.integrations.flushAnilist();
  const media = fake.calls.find((call) => call.query?.includes("Media(id"));
  assert.deepEqual(media.variables, { idMal: 5114 });
  assert.ok(
    !fake.calls.some((call) => call.query?.includes("SaveMediaListEntry")),
  );
  assert.deepEqual(c.state.integrations.anilist.sent, ["mal:5114:4"]);
});

test("a rate limit pauses the queue, and an unmapped work is counted, not retried", async () => {
  let limited = true;
  const fake = fakeAnilist({ arm: [{ anilist: 1 }, { anilist: 2 }] });
  const c = create(async (url, options) => {
    if (
      url === "https://graphql.anilist.co" &&
      limited &&
      options.body.includes("idMal")
    )
      throw Object.assign(new Error("HTTP 429"), { status: 429 });
    return fake.request(url, options);
  });
  c.integrations.save({ id: "anilist", clientId: "1" });
  await c.integrations.anilistConnect(TOKEN);
  c.integrations.save({ id: "anilist", trackHistory: true });
  c.integrations.queueHistory(
    { id: "mal:1", type: "series" },
    "mal:1:1",
    1400,
    1440,
  );
  await c.integrations.flushAnilist();
  const s = c.state.integrations.anilist;
  assert.equal(s.pending.length, 1);
  assert.ok(s.retryAt > Date.now());
  limited = false;
  s.retryAt = 0;
  // ARM lists two AniList entries for this IMDb show: too uncertain.
  c.integrations.queueHistory(
    { id: "tt5370118", type: "series", genres: ["Anime"] },
    "tt5370118:1:2",
    1400,
    1440,
  );
  await c.integrations.flushAnilist();
  assert.equal(s.pending.length, 0);
  assert.equal(s.unmatched, 1);
  assert.deepEqual(s.sent, ["mal:1:1"]);
});

test("a reply never writes into an account connected after the request, and disconnect forgets everything", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fake = fakeAnilist();
  const c = create(async (url, options) => {
    if (
      url === "https://graphql.anilist.co" &&
      options.body.includes("Media(id")
    )
      await gate;
    return fake.request(url, options);
  });
  c.integrations.save({ id: "anilist", clientId: "1" });
  await c.integrations.anilistConnect(TOKEN);
  c.integrations.save({ id: "anilist", trackHistory: true });
  c.integrations.queueHistory(
    { id: "anilist:21", type: "series" },
    "anilist:21:1",
    1400,
    1440,
  );
  const flushing = c.integrations.flushAnilist();
  c.integrations.disconnect("anilist");
  assert.equal(c.state.integrations.anilist, undefined);
  c.integrations.save({ id: "anilist", clientId: "2" });
  await c.integrations.anilistConnect(TOKEN);
  release();
  await flushing;
  assert.ok(
    !fake.calls.some((call) => call.query?.includes("SaveMediaListEntry")),
  );
  const fresh = c.state.integrations.anilist;
  assert.deepEqual(fresh.sent, []);
  assert.deepEqual(fresh.pending, []);
  // Turning tracking off drops what is queued.
  fresh.trackHistory = true;
  fresh.pending = [{ key: "k", source: "anilist", id: 1, episode: 1 }];
  c.integrations.save({ id: "anilist", trackHistory: false });
  assert.deepEqual(fresh.pending, []);
});

test("syncing AniList imports its lists into the profile", async () => {
  const fake = fakeAnilist();
  const c = create(async (url, options) => {
    const body = JSON.parse(options.body || "{}");
    if (body.query?.includes("MediaListCollection"))
      return {
        data: {
          MediaListCollection: {
            lists: [
              {
                status: "PLANNING",
                entries: [
                  { media: { id: 5, format: "TV", title: { romaji: "X" } } },
                ],
              },
            ],
          },
        },
      };
    return fake.request(url, options);
  });
  c.integrations.save({ id: "anilist", clientId: "1" });
  await c.integrations.anilistConnect(TOKEN);
  await c.integrations.sync("anilist");
  const lists = c.state.connectedLists.filter((l) => l.service === "anilist");
  assert.equal(lists.length, 1);
  assert.equal(lists[0].metas[0].id, "anilist:5");
  c.integrations.disconnect("anilist");
  assert.equal(
    c.state.connectedLists.filter((l) => l.service === "anilist").length,
    0,
  );
});
