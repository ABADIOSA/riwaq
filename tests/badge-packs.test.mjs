import test from "node:test";
import assert from "node:assert/strict";
import {
  RULE_LIMIT,
  artKeyFor,
  badgeColor,
  chipArt,
  cleanBadgeArt,
  exportBadgePack,
  fetchPackText,
  importBadgePack,
  normalizePattern,
  packUrl,
  parsePackText,
  ruleBadges,
} from "../core/badges.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const IMG = "https://harbor.site/badges/harbor-light";

// Shaped like the Nuvio badge format Harbor's packs use: { filters, groups }.
const nuvioPack = {
  filters: [
    {
      id: "res-4k",
      groupId: "res",
      name: "4K",
      pattern: "(?i)\\b(2160p|4k)\\b",
      imageURL: `${IMG}/res-4k.webp`,
      isEnabled: true,
    },
    {
      id: "vis-dv",
      groupId: "vis",
      name: "Dolby Vision",
      pattern: "(?i)\\b(dv|dovi)\\b",
      imageURL: `${IMG}/vis-dv.webp`,
    },
    {
      id: "aud-atmos",
      groupId: "aud",
      name: "Atmos",
      pattern: "atmos",
      imageURL: `${IMG}/aud-atmos.webp`,
    },
    {
      id: "grp-framestor",
      groupId: "grp",
      name: "FraMeSToR",
      pattern: "(?i)\\bframestor\\b",
      imageURL: `${IMG}/grp-framestor.webp`,
      tagColor: "#FF112233",
      textColor: "#FFFFFFFF",
    },
    {
      id: "lang-ar",
      groupId: "lang",
      name: "Arabic",
      pattern: "(?i:arabic|\\bara\\b)",
      tagColor: "#2E7D32",
      tagStyle: "outlined",
    },
    {
      id: "evil",
      name: "Evil",
      pattern: "(a+)+$",
      imageURL: `${IMG}/evil.webp`,
    },
    { id: "off", name: "Off", pattern: "x", isEnabled: false },
    {
      id: "http",
      name: "Insecure",
      pattern: "insecure",
      imageURL: "http://example.com/x.png",
    },
  ],
  groups: [{ id: "res", name: "Resolution" }],
};

test("a Nuvio-format pack becomes badge art and rules", () => {
  const pack = importBadgePack(JSON.stringify(nuvioPack), undefined, {
    name: "harbor-light",
  });
  assert.deepEqual(pack.art, {
    "4k": `${IMG}/res-4k.webp`,
    dv: `${IMG}/vis-dv.webp`,
    atmos: `${IMG}/aud-atmos.webp`,
  });
  assert.deepEqual(
    pack.rules.map((r) => [r.id, r.label, r.pattern]),
    [
      ["harborlight-grp-framestor", "FraMeSToR", "\\bframestor\\b"],
      ["harborlight-lang-ar", "Arabic", "(?:arabic|\\bara\\b)"],
      ["harborlight-http", "Insecure", "insecure"],
    ],
  );
  const [group, arabic, insecure] = pack.rules;
  assert.equal(group.image, `${IMG}/grp-framestor.webp`);
  assert.equal(group.color, "#112233FF");
  assert.equal(group.textColor, "#FFFFFFFF");
  assert.equal(group.pack, "harbor-light");
  assert.equal(arabic.style, "outlined");
  assert.equal(insecure.image, undefined, "only HTTPS pictures");
  assert.equal(pack.total, 8);
  assert.equal(pack.disabled, 1);
  assert.equal(pack.skipped, 1, "the backtracking pattern is refused");
  // The same pack imported again carries the same IDs, so it replaces.
  const again = importBadgePack(nuvioPack, undefined, { name: "harbor-light" });
  assert.deepEqual(
    again.rules.map((r) => r.id),
    pack.rules.map((r) => r.id),
  );
});

test("a Harbor-format pack maps its kinds to badge art", () => {
  const pack = importBadgePack({
    app: "harbor",
    version: 1,
    overrides: {
      "4k-uhd": { image: `${IMG}/4k.webp` },
      "hdr10-plus": { image: `${IMG}/hdr10p.webp` },
      "dts-hd-ma": { image: `${IMG}/dtshdma.webp` },
      hevc: { hidden: true },
    },
    rules: [
      {
        id: "r1",
        name: "IMAX Enhanced",
        pattern: "imax",
        enabled: true,
        tagColor: "#123456",
      },
    ],
  });
  assert.deepEqual(Object.keys(pack.art).sort(), ["4k", "dts-hd-ma", "hdr10+"]);
  assert.equal(pack.rules[0].label, "IMAX Enhanced");
  assert.equal(pack.rules[0].color, "#123456");
});

test("pack names map to the built-in chips they stand for", () => {
  for (const [name, key] of [
    ["4K", "4k"],
    ["2160p", "4k"],
    ["Dolby Vision", "dv"],
    ["HDR10+", "hdr10+"],
    ["DTS-HD MA", "dts-hd-ma"],
    ["DD+", "ddp"],
    ["WEB-DL", "webdl"],
    ["5.1", "5.1"],
    ["FraMeSToR", ""],
  ])
    assert.equal(artKeyFor(name), key, name);
});

test("badge art replaces a chip only when every part has a picture", () => {
  const art = cleanBadgeArt({
    "4k": `${IMG}/4k.webp`,
    dv: `${IMG}/dv.webp`,
    hdr: `${IMG}/hdr.webp`,
    "dts-hd": `${IMG}/dtshd.webp`,
    bogus: `${IMG}/x.webp`,
    atmos: "http://insecure/x.png",
  });
  assert.deepEqual(Object.keys(art).sort(), ["4k", "dts-hd", "dv", "hdr"]);
  assert.deepEqual(chipArt(art, "resolution", 2160), [`${IMG}/4k.webp`]);
  assert.deepEqual(chipArt(art, "resolution", 1080), []);
  assert.deepEqual(chipArt(art, "hdr", "DV+HDR10"), [
    `${IMG}/dv.webp`,
    `${IMG}/hdr.webp`,
  ]);
  assert.deepEqual(chipArt(art, "hdr", "HDR10"), [`${IMG}/hdr.webp`]);
  assert.deepEqual(chipArt(art, "audio", "DTS-HD MA"), [`${IMG}/dtshd.webp`]);
  assert.deepEqual(chipArt(art, "audio", "Atmos"), []);
  assert.deepEqual(
    chipArt({ dv: `${IMG}/dv.webp` }, "hdr", "DV+HDR10"),
    [],
    "half a pair keeps the text",
  );
  assert.deepEqual(
    safeSettings(
      { badgeArt: { "4k": `${IMG}/4k.webp`, x: "y" } },
      DEFAULT_SETTINGS,
    ).badgeArt,
    { "4k": `${IMG}/4k.webp` },
  );
});

test("rules carry their picture and style into the picker", () => {
  const { rules } = importBadgePack(nuvioPack, undefined, { name: "p" });
  const badges = ruleBadges(
    { name: "Torrentio", title: "Film.2160p.REMUX-FraMeSToR arabic" },
    rules,
  );
  assert.deepEqual(
    badges.map((b) => [b.label, !!b.image, b.style || "filled"]),
    [
      ["FraMeSToR", true, "filled"],
      ["Arabic", false, "outlined"],
    ],
  );
});

test("Java patterns and Android colours are read the JavaScript way", () => {
  assert.equal(normalizePattern("(?i)\\bdv\\b"), "\\bdv\\b");
  assert.equal(normalizePattern("(?i:a|b)"), "(?:a|b)");
  assert.equal(normalizePattern("(?>x)y++"), "(?:x)y+");
  assert.equal(badgeColor("#80FF0000"), "#FF000080");
  assert.equal(badgeColor("#abcdef"), "#ABCDEF");
  assert.equal(badgeColor("red"), "");
});

test("shared JSON with small mistakes is still read", () => {
  assert.deepEqual(parsePackText('\uFEFF{"a":1}'), { a: 1 });
  assert.deepEqual(parsePackText('{"a":"line\nbreak"}'), { a: "line\nbreak" });
  assert.deepEqual(parsePackText('{\n"a": 1\n"b": 2\n}'), { a: 1, b: 2 });
  assert.throws(() => parsePackText("{nope"), /JSON/);
});

test("a large pack stays within the rule limit and imports quickly", () => {
  const filters = Array.from({ length: 300 }, (_, i) => ({
    id: `g${i}`,
    name: `Group ${i}`,
    pattern: `\\bgroup${i}\\b`,
    imageURL: `${IMG}/g${i}.webp`,
  }));
  const started = Date.now();
  const pack = importBadgePack({ filters }, undefined, { name: "big" });
  assert.equal(pack.rules.length, RULE_LIMIT);
  const title = "x".repeat(300) + " group249";
  assert.equal(ruleBadges({ title }, pack.rules)[0].label, "Group 249");
  assert.ok(Date.now() - started < 1500);
});

test("a Riwaq export carries rules, art and hidden kinds", () => {
  const settings = {
    badgeRules: importBadgePack(nuvioPack, undefined, { name: "p" }).rules,
    badgeArt: { dv: `${IMG}/dv.webp` },
    badgesHidden: ["size"],
  };
  const data = JSON.parse(exportBadgePack(settings));
  assert.equal(data.format, "riwaq-badges");
  assert.deepEqual(data.art, { dv: `${IMG}/dv.webp` });
  assert.ok(!("pack" in data.rules[0]) && !("id" in data.rules[0]));
  const back = importBadgePack(JSON.stringify(data), (i) => `n${i}`);
  assert.equal(back.rules.length, settings.badgeRules.length);
  assert.deepEqual(back.art, { dv: `${IMG}/dv.webp` });
});

test("pack links must be public HTTPS addresses", () => {
  assert.equal(
    packUrl(" https://harbor.site/badges/harbor-light.json#x "),
    "https://harbor.site/badges/harbor-light.json",
  );
  for (const bad of [
    "http://harbor.site/badges/x.json",
    "https://user:pass@harbor.site/x.json",
    "https://localhost/x.json",
    "https://192.168.1.5/x.json",
    "https://10.0.0.2/x.json",
    "https://[::1]/x.json",
    "https://nas/x.json",
    "https://printer.local/x.json",
    "file:///C:/x.json",
    "not a url",
  ])
    assert.throws(() => packUrl(bad), undefined, bad);
});

const reply = (status, body = "", headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => body,
});

test("fetching a pack follows safe redirects only", async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push([url, init.redirect]);
    if (url === "https://gist.github.com/u/abc/raw")
      return reply(302, "", {
        location: "https://gist.githubusercontent.com/u/abc/raw/badges.json",
      });
    if (url.startsWith("https://gist.githubusercontent.com"))
      return reply(200, JSON.stringify(nuvioPack));
    if (url === "https://bad.example/x.json")
      return reply(301, "", { location: "http://bad.example/x.json" });
    if (url === "https://lan.example/x.json")
      return reply(302, "", { location: "https://192.168.1.2/x.json" });
    if (url === "https://big.example/x.json")
      return reply(200, "", { "content-length": "9999999" });
    return reply(404);
  };
  const got = await fetchPackText("https://gist.github.com/u/abc/raw", {
    fetch,
  });
  assert.equal(got.name, "gist.githubusercontent.com");
  assert.equal(JSON.parse(got.text).filters.length, 8);
  assert.ok(seen.every(([, redirect]) => redirect === "manual"));
  await assert.rejects(
    fetchPackText("https://bad.example/x.json", { fetch }),
    /https/,
  );
  await assert.rejects(
    fetchPackText("https://lan.example/x.json", { fetch }),
    /شبكتك/,
  );
  await assert.rejects(
    fetchPackText("https://big.example/x.json", { fetch }),
    /أكبر/,
  );
  await assert.rejects(
    fetchPackText("https://gone.example/x.json", { fetch }),
    /404/,
  );
});

test("a real-world shape imports whole, and matching respects a deadline", () => {
  // Release-tier rules in shared packs repeat "(?:[^.]*\.)" runs, which are
  // safe; nested repetition such as "(a+)+" is still refused.
  const pack = importBadgePack(
    {
      filters: [
        {
          id: "t1",
          name: "Atmos+DV",
          pattern: "(?i)^(?=(?:[^.]*\\.){2,})(?=.*atmos)(?=.*\\bdv\\b)",
        },
        { id: "t2", name: "Bad", pattern: "(\\w+)+$" },
      ],
    },
    undefined,
    { name: "tiers" },
  );
  assert.deepEqual(
    pack.rules.map((r) => r.label),
    ["Atmos+DV"],
  );
  const title = "Movie.2024.2160p.BluRay.REMUX.DV.TrueHD.Atmos.7.1-GRP";
  assert.equal(ruleBadges({ title }, pack.rules).length, 1);
  assert.equal(ruleBadges({ title }, pack.rules, Date.now() - 1).length, 0);
});
