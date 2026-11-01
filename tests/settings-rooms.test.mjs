// Issue #127: settings are six rooms with no basic/advanced split; every
// page sits in exactly one room, and nothing the old basic panel offered
// was lost on the way.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PRIVACY_URLS, privacyLink } from "../core/privacy.mjs";

const path = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p) => readFileSync(path(p), "utf8");
const studio = read("src/components/SettingsStudio.jsx");
const groups = studio.slice(
  studio.indexOf("const ALL_GROUPS"),
  studio.indexOf("const WEB_HIDDEN"),
);

test("settings are six rooms in the order issue #127 asks for", () => {
  const rooms = [
    ...groups.matchAll(/\n {4}id: "(\w+)",\n {4}title: "([^"]+)"/g),
  ];
  assert.deepEqual(
    rooms.map((m) => m[1]),
    ["look", "watching", "content", "files", "account", "system"],
  );
  assert.deepEqual(
    rooms.map((m) => m[2]),
    [
      "المظهر والواجهة",
      "المشغل والتشغيل",
      "المصادر والمكتبة",
      "التنزيلات والملفات",
      "الحسابات والربط",
      "النظام والتشخيص",
    ],
  );
});

test("every settings page sits in exactly one room and renders", () => {
  const pages = [
    ...groups.matchAll(/\[\s*"(\w+)",\s*"[^"]+",\s*"[^"]*",/g),
  ].map((m) => m[1]);
  assert.equal(new Set(pages).size, pages.length, "a page in two rooms");
  for (const id of pages)
    assert.match(studio, new RegExp(`id === "${id}" &&`), `page ${id}`);
  // The pages the old basic panel linked to, and the new ones.
  for (const id of [
    "language",
    "audio",
    "video",
    "updates",
    "system",
    "profiles",
    "downloads",
    "privacy",
    "hotkeys",
    "playerLayout",
  ])
    assert.ok(pages.includes(id), id);
});

test("the basic/advanced split is gone and its controls live on", () => {
  assert.equal(existsSync(path("src/components/QuickSettings.jsx")), false);
  assert.doesNotMatch(studio, /settingsMode|QuickSettings|إعدادات متقدمة/);
  // The quiet interface and the profiles button moved to Profiles.
  const profiles = studio.slice(studio.indexOf('id === "profiles" &&'));
  assert.match(profiles.slice(0, 1500), /"quietInterface"/);
  assert.match(profiles.slice(0, 1500), /onClick=\{onProfiles\}/);
  // App hands the page what its buttons open (the old basic panel's
  // "show profiles" button had no handler and did nothing).
  const app = read("src/App.jsx");
  const prefs = app.slice(
    app.indexOf("<Preferences"),
    app.indexOf("<Preferences") + 600,
  );
  assert.match(prefs, /onProfiles=\{\(\) => setProfilesOpen\(true\)\}/);
  assert.match(prefs, /onDownloads=\{\(\) => setOfflineOpen\(true\)\}/);
  // Usage statistics sit on the privacy page, nowhere else in settings.
  const system = read("src/components/settings/SystemPages.jsx");
  assert.match(system, /<UsageSettings notice=\{notice\} \/>/);
  assert.doesNotMatch(studio, /<UsageSettings/);
});

test("one control per setting across the settings pages", () => {
  // The preferred quality and the CAM filter were each offered twice.
  const count = (re) => (studio.match(re) || []).length;
  assert.equal(count(/select\("quality",/g), 1);
  assert.equal(count(/"hideCam",/g), 1);
  assert.equal(count(/"showShowcase",/g), 0, "the showcase picker owns it");
  assert.equal(count(/"showSession",/g), 1);
});

test("the downloads room is desktop-only and the privacy page is everywhere", () => {
  const hidden = studio.slice(
    studio.indexOf("const WEB_HIDDEN"),
    studio.indexOf("const GROUPS ="),
  );
  assert.match(hidden, /downloads: "privacy"/);
  assert.doesNotMatch(hidden, /privacy:/);
});

test("the privacy policy opens only its two fixed pages", () => {
  assert.deepEqual(Object.keys(PRIVACY_URLS).sort(), ["privacy", "privacyAr"]);
  for (const url of Object.values(PRIVACY_URLS))
    assert.match(
      url,
      /^https:\/\/github\.com\/ABADIOSA\/riwaq\/blob\/main\/PRIVACY(\.ar)?\.md$/,
    );
  assert.equal(privacyLink("en"), "privacy");
  assert.equal(privacyLink("ar"), "privacyAr");
  for (const file of ["electron/main.mjs", "web/bridge.js"])
    assert.match(read(file), /\.\.\.PRIVACY_URLS,/, file);
  for (const file of ["PRIVACY.md", "PRIVACY.ar.md"])
    assert.ok(existsSync(path(file)), file);
});
