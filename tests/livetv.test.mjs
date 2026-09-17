import test from "node:test";
import assert from "node:assert/strict";
import {
  parseM3U,
  parseXmltv,
  parseXmltvTime,
  indexProgrammes,
  nowNext,
  buildGuide,
  detectCatchup,
  buildCatchupUrl,
  xtreamEndpoints,
  xtreamChannels,
  groupChannels,
  searchChannels,
} from "../core/livetv.mjs";
import { LiveHub } from "../core/live-hub.mjs";

const PLAYLIST = `#EXTM3U url-tvg="https://guide.test/epg.xml"
#EXTINF:-1 tvg-id="mbc1" tvg-logo="https://logo.test/mbc1.png" group-title="ترفيه" catchup="shift",MBC 1
#EXTVLCOPT:http-user-agent=RiwaqTest/1.0
https://stream.test/mbc1/index.m3u8
#EXTGRP:أخبار
#EXTINF:-1 tvg-id="aljazeera",Al Jazeera
https://stream.test/aj.ts
#EXTINF:-1 tvg-id="broken",Broken
not-a-url
#EXTINF:-1 tvg-id="flu" catchup="flussonic",Flussonic Channel
https://fs.test/live/stream.m3u8
`;

const GUIDE = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="mbc1"><display-name lang="ar">إم بي سي 1</display-name><display-name lang="en">MBC 1</display-name><icon src="https://logo.test/mbc1.png"/></channel>
  <programme start="20260917100000 +0300" stop="20260917113000 +0300" channel="mbc1">
    <title lang="en">Morning Show</title><title lang="ar">برنامج الصباح</title>
    <desc lang="ar">حلقة اليوم &amp; ضيوفها</desc><category lang="ar">منوعات</category>
  </programme>
  <programme start="20260917113000 +0300" stop="20260917130000 +0300" channel="mbc1">
    <title lang="ar">نشرة الأخبار</title><desc><![CDATA[موجز <الأخبار>]]></desc>
  </programme>
</tv>`;

test("M3U parsing reads attributes, groups, options and skips bad entries", () => {
  const { epgUrl, channels } = parseM3U(PLAYLIST);
  assert.equal(epgUrl, "https://guide.test/epg.xml");
  assert.equal(channels.length, 3);
  const [mbc, jazeera] = channels;
  assert.equal(mbc.name, "MBC 1");
  assert.equal(mbc.group, "ترفيه");
  assert.equal(mbc.tvgId, "mbc1");
  assert.equal(mbc.userAgent, "RiwaqTest/1.0");
  assert.equal(mbc.catchup, "shift");
  // #EXTGRP applies when the entry carries no group-title of its own.
  assert.equal(jazeera.group, "أخبار");
  assert.ok(mbc.key && mbc.key !== jazeera.key);
});

test("a playlist without the M3U header is rejected", () => {
  assert.throws(() => parseM3U("hello\nworld"), /M3U/);
});

test("XMLTV timestamps honour their UTC offset", () => {
  assert.equal(
    parseXmltvTime("20260917100000 +0300"),
    Date.UTC(2026, 8, 17, 7, 0, 0),
  );
  assert.equal(
    parseXmltvTime("20260917100000"),
    Date.UTC(2026, 8, 17, 10, 0, 0),
  );
  assert.equal(
    parseXmltvTime("20260917100000 -0500"),
    Date.UTC(2026, 8, 17, 15, 0, 0),
  );
  assert.equal(parseXmltvTime("nonsense"), null);
});

test("XMLTV parsing prefers the requested language and decodes entities", () => {
  const { channels, programmes } = parseXmltv(GUIDE, { language: "ar" });
  assert.equal(channels.get("mbc1").name, "إم بي سي 1");
  assert.equal(programmes.length, 2);
  assert.equal(programmes[0].title, "برنامج الصباح");
  assert.equal(programmes[0].description, "حلقة اليوم & ضيوفها");
  assert.equal(programmes[1].description, "موجز <الأخبار>");
  assert.equal(
    parseXmltv(GUIDE, { language: "en" }).programmes[0].title,
    "Morning Show",
  );
});

test("now and next come from the indexed guide", () => {
  const index = indexProgrammes(parseXmltv(GUIDE).programmes);
  const at = Date.UTC(2026, 8, 17, 8, 0, 0);
  const { now, next } = nowNext(index, "mbc1", at);
  assert.equal(now.title, "برنامج الصباح");
  assert.equal(next.title, "نشرة الأخبار");
  assert.equal(nowNext(index, "missing", at).now, null);
});

test("the guide grid positions each block inside the window", () => {
  const index = indexProgrammes(parseXmltv(GUIDE).programmes);
  const start = Date.UTC(2026, 8, 17, 7, 0, 0);
  const [row] = buildGuide(
    [{ key: "k", name: "MBC 1", logo: "", tvgId: "mbc1" }],
    index,
    {
      start,
      hours: 4,
    },
  );
  assert.equal(row.blocks.length, 2);
  assert.equal(row.blocks[0].offset, 0);
  assert.ok(Math.abs(row.blocks[0].width - 1.5 / 4) < 1e-9);
  assert.ok(Math.abs(row.blocks[1].offset - 1.5 / 4) < 1e-9);
});

test("catchup type is detected from the declaration or the URL shape", () => {
  assert.equal(
    detectCatchup({ catchup: "shift", url: "https://a.test/x" }),
    "shift",
  );
  assert.equal(
    detectCatchup({ catchup: "fs", url: "https://a.test/x" }),
    "flussonic",
  );
  assert.equal(
    detectCatchup({ catchup: "", catchupSource: "https://a.test/${start}" }),
    "default",
  );
  assert.equal(
    detectCatchup({ url: "https://a.test/live/user/pass/12.ts" }),
    "xtream",
  );
  assert.equal(detectCatchup({ url: "https://a.test/plain.m3u8" }), null);
});

test("catchup URLs follow each provider convention", () => {
  const start = Date.UTC(2026, 8, 17, 7, 0, 0);
  const stop = Date.UTC(2026, 8, 17, 8, 0, 0);
  const now = Date.UTC(2026, 8, 17, 10, 0, 0);
  assert.equal(
    buildCatchupUrl(
      { catchup: "shift", url: "https://a.test/live.m3u8" },
      start,
      stop,
      now,
    ),
    `https://a.test/live.m3u8?utc=${start / 1000}&lutc=${now / 1000}`,
  );
  assert.equal(
    buildCatchupUrl(
      { catchup: "flussonic", url: "https://fs.test/live/stream.m3u8" },
      start,
      stop,
      now,
    ),
    `https://fs.test/live/stream-${start / 1000}-3600.m3u8`,
  );
  assert.equal(
    buildCatchupUrl(
      {
        catchup: "default",
        catchupSource: "https://a.test/replay?t=${start}&d=${duration}",
      },
      start,
      stop,
      now,
    ),
    `https://a.test/replay?t=${start / 1000}&d=3600`,
  );
  assert.equal(
    buildCatchupUrl(
      {
        catchup: "default",
        catchupSource: "https://a.test/${start:Y-m-d_H-M}.ts",
      },
      start,
      stop,
      now,
    ),
    "https://a.test/2026-09-17_07-00.ts",
  );
  assert.equal(
    buildCatchupUrl({ url: "https://a.test/live/u/p/12.ts" }, start, stop, now),
    "https://a.test/streaming/timeshift.php?username=u&password=p&stream=12&start=2026-09-17:07-00&duration=60",
  );
  assert.equal(
    buildCatchupUrl({ url: "https://a.test/plain.m3u8" }, start, stop, now),
    null,
  );
});

test("Xtream endpoints and channel mapping", () => {
  const credentials = {
    host: "http://tv.test:8080/",
    username: "u s",
    password: "p&w",
  };
  const endpoints = xtreamEndpoints(credentials);
  assert.equal(endpoints.origin, "http://tv.test:8080");
  assert.ok(endpoints.playlist.includes("username=u%20s&password=p%26w"));
  assert.ok(
    endpoints.api("get_live_streams").endsWith("action=get_live_streams"),
  );
  const channels = xtreamChannels(
    [
      {
        stream_id: 12,
        name: "قناة",
        category_id: 3,
        tv_archive: 1,
        tv_archive_duration: 7,
        stream_icon: "https://l.test/a.png",
      },
      { name: "no id" },
    ],
    [{ category_id: "3", category_name: "رياضة" }],
    credentials,
  );
  assert.equal(channels.length, 1);
  assert.equal(channels[0].group, "رياضة");
  assert.equal(channels[0].catchup, "xtream");
  assert.ok(channels[0].url.endsWith("/live/u%20s/p%26w/12.ts"));
});

test("grouping counts and Arabic-tolerant search", () => {
  const { channels } = parseM3U(PLAYLIST);
  assert.deepEqual(
    groupChannels(channels)
      .map((g) => g.name)
      .sort(),
    ["أخبار", "بدون تصنيف", "ترفيه"],
  );
  // Same word, different alef and no diacritics.
  assert.equal(searchChannels(channels, "اخبار").length, 1);
  assert.equal(searchChannels(channels, "mbc").length, 1);
  assert.equal(searchChannels(channels, "").length, channels.length);
});

function hub(responses) {
  const client = {
    state: {
      settings: { metadataLanguage: "ar-SA" },
      live: { sources: [], favorites: [] },
    },
    persist() {},
    publicState() {
      return { live: this.live.publicState() };
    },
    request: async (url) => {
      if (!(url in responses)) throw new Error("HTTP 404");
      return responses[url];
    },
    requestText: async (url) => {
      if (!(url in responses)) throw new Error("HTTP 404");
      return responses[url];
    },
  };
  client.live = new LiveHub(client);
  return client;
}

test("adding an M3U source loads channels and its declared guide", async () => {
  const client = hub({
    "https://list.test/playlist.m3u": PLAYLIST,
    "https://guide.test/epg.xml": GUIDE,
  });
  await client.live.addSource({
    kind: "m3u",
    name: "منزلي",
    url: "https://list.test/playlist.m3u",
  });
  const state = client.live.publicState();
  assert.equal(state.sources.length, 1);
  assert.equal(state.sources[0].channels, 3);
  assert.equal(state.sources[0].programmes, 2);
  assert.equal(state.sources[0].host, "list.test");
  const listing = await client.live.list({});
  assert.equal(listing.total, 3);
  assert.ok(listing.channels.every((channel) => !("url" in channel)));
});

test("a missing guide does not cost the viewer their channels", async () => {
  const client = hub({ "https://list.test/playlist.m3u": PLAYLIST });
  await client.live.addSource({
    kind: "m3u",
    name: "منزلي",
    url: "https://list.test/playlist.m3u",
  });
  assert.equal(client.live.publicState().sources[0].channels, 3);
  assert.equal(client.live.publicState().sources[0].programmes, 0);
});

test("channel URLs and credentials never leave the hub, keys resolve inside it", async () => {
  const client = hub({
    "https://list.test/playlist.m3u": PLAYLIST,
    "https://guide.test/epg.xml": GUIDE,
  });
  await client.live.addSource({
    kind: "m3u",
    name: "منزلي",
    url: "https://list.test/playlist.m3u",
  });
  const listing = await client.live.list({ search: "MBC" });
  const resolved = client.live.resolve(listing.channels[0].key);
  assert.equal(resolved.url, "https://stream.test/mbc1/index.m3u8");
  assert.equal(resolved.headers["User-Agent"], "RiwaqTest/1.0");
  assert.throws(() => client.live.resolve("unknown"), /القناة/);
});

test("favourites toggle and filter", async () => {
  const client = hub({ "https://list.test/playlist.m3u": PLAYLIST });
  await client.live.addSource({
    kind: "m3u",
    name: "منزلي",
    url: "https://list.test/playlist.m3u",
  });
  const [first] = (await client.live.list({})).channels;
  client.live.favorite(first.key);
  const favorites = await client.live.list({ favoritesOnly: true });
  assert.equal(favorites.total, 1);
  assert.equal(favorites.channels[0].favorite, true);
  client.live.favorite(first.key);
  assert.equal((await client.live.list({ favoritesOnly: true })).total, 0);
});

test("a disabled source drops out of listings without being deleted", async () => {
  const client = hub({ "https://list.test/playlist.m3u": PLAYLIST });
  await client.live.addSource({
    kind: "m3u",
    name: "منزلي",
    url: "https://list.test/playlist.m3u",
  });
  const id = client.live.publicState().sources[0].id;
  client.live.updateSource({ id, action: "toggle" });
  assert.equal((await client.live.list({})).total, 0);
  assert.equal(client.live.publicState().sources.length, 1);
  client.live.updateSource({ id, action: "remove" });
  assert.equal(client.live.publicState().sources.length, 0);
});

test("an Xtream source builds channels from the JSON API", async () => {
  const endpoints = xtreamEndpoints({
    host: "http://tv.test",
    username: "u",
    password: "s3cr3t-pass",
  });
  const client = hub({
    [endpoints.api("get_live_streams")]: [
      { stream_id: 7, name: "beIN 1", category_id: "1" },
    ],
    [endpoints.api("get_live_categories")]: [
      { category_id: "1", category_name: "رياضة" },
    ],
    [endpoints.epg]: GUIDE,
  });
  await client.live.addSource({
    kind: "xtream",
    name: "اشتراكي",
    host: "http://tv.test",
    username: "u",
    password: "s3cr3t-pass",
  });
  const listing = await client.live.list({});
  assert.equal(listing.total, 1);
  assert.equal(listing.channels[0].group, "رياضة");
  // Neither the subscription credentials nor the stream URL may reach the interface.
  const published = JSON.stringify({
    state: client.live.publicState(),
    listing,
  });
  assert.ok(!published.includes("s3cr3t-pass"));
  assert.ok(!published.includes("/live/"));
  assert.ok(
    client.live.resolve(listing.channels[0].key).url.includes("s3cr3t-pass"),
  );
});
