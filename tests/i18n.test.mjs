import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  anchorOf,
  cleanLanguage,
  direction,
  language,
  locale,
  setLanguage,
  t,
  translate,
} from "../core/i18n.mjs";
import EN from "../core/i18n/en.mjs";
import SEARCH_EN from "../core/i18n/en/settings-search.mjs";
import {
  covered,
  extract,
  jsxText,
  stringsOf,
} from "../scripts/i18n-strings.mjs";
import { localize } from "../src/lib/jsx-runtime.js";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const read = (path) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

// Collections builds whole count phrases from word parts ("لا مصادر",
// "مصدر واحد"); the finished phrases are translated, the parts are not.
const BUILT_FROM_PARTS = new Set(["لا {1}", "{1} واحد"]);

test("every Arabic string in the interface has English", () => {
  const gaps = [];
  for (const { file, strings } of extract())
    for (const key of strings)
      if (!BUILT_FROM_PARTS.has(key) && !covered(key))
        gaps.push(`${file}: ${key}`);
  assert.deepEqual(gaps, [], `untranslated:\n${gaps.join("\n")}`);
});

// Arabic in core/, electron/ and web/ that never reaches the screen as is
// (single letters are folding tables for Arabic matching).
const UNSHOWN = {
  // English clocks say AM and PM instead.
  "core/prayer.mjs": (s) => s === "ص" || s === "م",
  // The copied diagnostic report stays Arabic for whoever reads it.
  "core/diagnose.mjs": (s) =>
    /^(---|===|\[|\(لا يحتوي|الحالة العامة:|وقت التقرير)/.test(s),
};

test("messages from core, main and the web bridge have English", () => {
  const roots = ["core", "electron", "web"];
  const list = roots.flatMap((dir) =>
    readdirSync(fileURLToPath(new URL(`../${dir}`, import.meta.url)))
      .filter((name) => /\.(mjs|js|cjs)$/.test(name))
      .map((name) => `${dir}/${name}`),
  );
  const gaps = [];
  for (const file of list) {
    // What's new is written per release and shown as written.
    if (file === "core/whats-new.mjs" || file === "core/i18n.mjs") continue;
    for (const key of stringsOf(read(file), file))
      if (key.length > 1 && !UNSHOWN[file]?.(key) && !covered(key))
        gaps.push(`${file}: ${key}`);
  }
  assert.deepEqual(gaps, [], `untranslated:\n${gaps.join("\n")}`);
});

test("text main writes itself follows the interface language", () => {
  const main = read("electron/main.mjs");
  assert.doesNotMatch(
    main,
    /\btitle: "[^"]*[؀-ۿ]/,
    "dialog titles go through t()",
  );
  assert.match(main, /const broadcast = \(\) => \{\n  syncLanguage\(\);/);
  assert.match(main, /resultPage\("تم تسجيل الدخول/);
  assert.doesNotMatch(main, /<html dir="rtl">/);
  assert.match(read("electron/player.mjs"), /t\("Esc للخروج من ملء الشاشة"\)/);
  assert.match(read("src/lib/language.js"), /document\.title = translate\(/);
});

test("Discord presence speaks the interface language", async () => {
  const { buildActivity } = await import("../core/presence.mjs");
  try {
    setLanguage("en");
    assert.equal(buildActivity({}).details, "Browsing Riwaq");
    const paused = buildActivity({
      playing: true,
      paused: true,
      title: "Dune",
    });
    assert.match(paused.state, /Paused/);
    setLanguage("ar");
    assert.equal(buildActivity({}).details, "يتصفّح رِواق");
  } finally {
    setLanguage("ar");
  }
});

test("the count phrases Collections builds are translated", () => {
  for (const [arabic, english] of [
    ["لا مصادر", "No sources"],
    ["مصدر واحد", "1 source"],
    ["مصدران", "2 sources"],
    ["3 مصادر", "3 sources"],
    ["11 مصدراً", "11 sources"],
    ["100 مصدر", "100 sources"],
    ["إضافة واحدة", "1 addon"],
    ["لا أدوات", "No tools"],
  ])
    assert.equal(translate(arabic, "en"), english);
});

test("the dictionary is well formed", () => {
  const problems = [];
  const shapes = new Map();
  for (const [key, value] of Object.entries(EN)) {
    if (typeof value !== "string" || !value.trim())
      problems.push(`${key}: empty`);
    else if (/[؀-ۿ]/.test(value)) problems.push(`${key}: Arabic in English`);
    if (key !== key.trim()) problems.push(`${key}: spaces around the key`);
    const names = (text) => (text.match(/\{\w+\}/g) || []).sort().join();
    if (names(key) !== names(value))
      problems.push(`${key}: placeholders differ from "${value}"`);
    if (!key.includes("{")) continue;
    // A pattern must keep Arabic words of its own, or it would match
    // anything a viewer typed.
    if (!anchorOf(key)) problems.push(`${key}: no Arabic outside placeholders`);
    // Two patterns that read the same words must say the same thing:
    // which one wins would otherwise depend on the order of the files.
    const shape = key.replace(/\{\w+\}/g, "{}");
    const said = value.replace(/\{\w+\}/g, "{}");
    if (shapes.has(shape) && shapes.get(shape) !== said)
      problems.push(`${key}: clashes with another pattern`);
    shapes.set(shape, said);
  }
  assert.deepEqual(problems, []);
});

test("the seeder count and the source count read differently", () => {
  assert.match(read("core/stream-engine.mjs"), /\$\{parsed\.seeders\} مشارك/);
  assert.equal(translate("120 مشارك", "en"), "120 peers");
  assert.equal(translate("3 مصدر · 40 قناة", "en"), "3 sources · 40 channels");
});

test("translate keeps text it has no entry for and the spaces around it", () => {
  assert.equal(translate("الإعدادات", "en"), "Settings");
  assert.equal(translate(" الإعدادات ", "en"), " Settings ");
  assert.equal(translate("الإعدادات", "ar"), "الإعدادات");
  assert.equal(
    translate("كلام لا يعرفه القاموس", "en"),
    "كلام لا يعرفه القاموس",
  );
  assert.equal(translate("Breaking Bad", "en"), "Breaking Bad");
  assert.equal(translate(42, "en"), 42);
});

test("number placeholders match numbers only", () => {
  const dictionary = {
    "بعد {n} دقيقة": "in {n} minutes",
    "الحلقة {1}": "Episode {1}",
  };
  assert.equal(translate("بعد 5 دقيقة", "en", dictionary), "in 5 minutes");
  assert.equal(translate("بعد ٥ دقيقة", "en", dictionary), "in ٥ minutes");
  assert.equal(translate("بعد قليل دقيقة", "en", dictionary), "بعد قليل دقيقة");
  assert.equal(
    translate("الحلقة الأخيرة", "en", dictionary),
    "Episode الأخيرة",
  );
});

test("placeholder values are translated in turn, and lines split at ·", () => {
  const dictionary = {
    "الموسم {1}": "Season {1}",
    الأخير: "the last",
    فيلم: "Film",
    دراما: "Drama",
  };
  assert.equal(translate("الموسم الأخير", "en", dictionary), "Season the last");
  assert.equal(
    translate("فيلم · 2024 · دراما", "en", dictionary),
    "Film · 2024 · Drama",
  );
  assert.equal(translate("مجهول · 2024", "en", dictionary), "مجهول · 2024");
});

test("a short pattern never counts as translating a sentence", () => {
  const dictionary = {
    "لون {1}": "{1} colour",
    "{1} على {2}": "{1} on {2}",
    أحمر: "red",
  };
  assert.equal(translate("لون أحمر", "en", dictionary), "red colour");
  assert.ok(covered("لون أحمر", dictionary));
  assert.ok(covered("لون {1}", dictionary));
  assert.equal(covered("حكاياتك، على ترتيبك.", dictionary), false);
  assert.equal(covered("لون التمييز", dictionary), false);
});

test("a pattern that leaves no Arabic beats a longer one that does", () => {
  const dictionary = {
    "ابدأ {1} الآن": "Start {1} now",
    "ابدأ {1}": "Begin {1}",
    "الفيلم الآن": "the film now",
  };
  assert.equal(
    translate("ابدأ الفيلم الآن", "en", dictionary),
    "Begin the film now",
  );
  // With nothing better, a viewer's own Arabic stays inside the English.
  assert.equal(translate("ابدأ سهرة الآن", "en", dictionary), "Start سهرة now");
});

test("the language switch sets direction, locale and t()", () => {
  try {
    assert.equal(cleanLanguage("fr"), "ar");
    assert.equal(cleanLanguage("en"), "en");
    setLanguage("en");
    assert.equal(language(), "en");
    assert.equal(direction(), "ltr");
    assert.equal(locale(), "en-GB");
    assert.equal(t("الإعدادات"), "Settings");
    assert.equal(t("بلا {x}", { x: 3 }), "بلا 3");
    setLanguage("ar");
    assert.equal(direction(), "rtl");
    assert.equal(t("الإعدادات"), "الإعدادات");
  } finally {
    setLanguage("ar");
  }
});

test("the JSX runtime translates host elements only, and not translate=no", () => {
  try {
    const props = { children: "الإعدادات", title: "الإعدادات", id: "x" };
    assert.equal(localize("div", props), props, "Arabic leaves props alone");
    setLanguage("en");
    const div = localize("div", props);
    assert.equal(div.children, "Settings");
    assert.equal(div.title, "Settings");
    assert.equal(div.id, "x");
    const list = localize("p", { children: ["الإعدادات", 3, " الإعدادات"] });
    assert.deepEqual(list.children, ["Settings", 3, " Settings"]);
    const Component = () => null;
    assert.equal(localize(Component, props), props);
    const own = { children: "العربية", translate: "no" };
    assert.equal(localize("button", own), own);
    const plain = { children: "Riwaq" };
    assert.equal(
      localize("span", plain),
      plain,
      "unchanged props keep identity",
    );
  } finally {
    setLanguage("ar");
  }
});

test("JSX text is collapsed the way React collapses it", () => {
  assert.equal(jsxText("\n    أهلاً\n    بك  \n  "), "أهلاً بك");
  assert.equal(jsxText(" أهلاً "), " أهلاً ");
});

test("the interface language is a per-profile setting that survives a backup", () => {
  assert.equal(DEFAULT_SETTINGS.uiLanguage, "ar");
  assert.equal(safeSettings({ uiLanguage: "en" }).uiLanguage, "en");
  assert.equal(safeSettings({ uiLanguage: "xx" }).uiLanguage, "ar");
});

test("settings search knows every page in English", () => {
  const studio = read("src/components/SettingsStudio.jsx");
  const pages = [
    ...studio
      .slice(
        studio.indexOf("const ALL_GROUPS"),
        studio.indexOf("const GROUPS ="),
      )
      .matchAll(/\[\s*"(\w+)",\s*"[^"]+",\s*"[^"]*",/g),
  ].map((m) => m[1]);
  assert.ok(pages.length > 30);
  assert.deepEqual(
    pages.filter((id) => !SEARCH_EN[id]),
    [],
  );
  assert.deepEqual(
    Object.keys(SEARCH_EN).filter((id) => !pages.includes(id)),
    [],
  );
  assert.match(studio, /matchesWords\(pageWords\(page\), search\)/);
  assert.doesNotMatch(studio, /matchesWords\(`\$\{title\} \$\{keywords\}`/);
});

test("both editions build JSX through the translating runtime", () => {
  assert.match(read("vite.config.mjs"), /jsxImportSource: "riwaq-jsx"/);
  assert.match(read("vite.web.config.mjs"), /jsxLanguage/);
  const app = read("src/App.jsx");
  assert.match(app, /useInterfaceLanguage\(state\.settings\.uiLanguage\)/);
  assert.match(app, /key=\{uiLanguage\}/);
  assert.match(read("src/components/Hud.jsx"), /key=\{uiLanguage\}/);
});
