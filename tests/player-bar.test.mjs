// Issues #139 and #140: the player's bottom bar. The large volume display
// over the picture is gone (MPV's bar and the HUD's centre popup), and the
// bar gains chapters, an elapsed/remaining counter, a folded volume slider
// and a 12-hour "ends at" clock.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  chapterAt,
  chapterMarks,
  clockTime,
  endsAt,
  timeCounter,
} from "../core/player-time.mjs";
import {
  HOTKEY_ACTIONS,
  inputConf,
  publicHotkeys,
  quietBinding,
} from "../core/hotkeys.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const read = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("the counter reads elapsed / total, or -remaining / total", () => {
  assert.equal(clockTime(65), "1:05");
  assert.equal(clockTime(3725), "1:02:05");
  assert.equal(clockTime(-3), "0:00");
  const film = { position: 600, duration: 7200 };
  assert.equal(timeCounter(film), "10:00 / 2:00:00");
  assert.equal(timeCounter(film, "remaining"), "-1:50:00 / 2:00:00");
  // Past the end (a late report) never shows more than the length.
  assert.equal(
    timeCounter({ position: 7300, duration: 7200 }),
    "2:00:00 / 2:00:00",
  );
  assert.equal(
    timeCounter({ position: 7300, duration: 7200 }, "remaining"),
    "-0:00 / 2:00:00",
  );
  // Live, or an unknown length: the position alone.
  assert.equal(timeCounter({ position: 30, duration: 0 }), "0:30");
  assert.equal(timeCounter({ position: 30, duration: 99, live: true }), "0:30");
});

test("chapters come from MPV's list, cleaned, and are never invented", () => {
  const list = [
    { time: 600, title: "Act II" },
    { time: 0, title: "Opening" },
    { time: 600.4, title: "duplicate" },
    { time: 1800, title: "" },
    { time: -5, title: "before" },
    { time: 9999, title: "after the end" },
    { time: Number.NaN, title: "broken" },
    { time: 1200, title: "x".repeat(300) },
  ];
  const marks = chapterMarks(list, 3600);
  assert.deepEqual(
    marks.map((m) => [m.start, m.end, m.title.length > 50 ? "long" : m.title]),
    [
      [0, 600, "Opening"],
      [600, 1200, "Act II"],
      [1200, 1800, "long"],
      [1800, 3600, ""],
    ],
  );
  assert.equal(marks[2].title.length, 120, "titles are bounded");
  assert.equal(chapterAt(marks, 650).title, "Act II");
  assert.equal(chapterAt(marks, 0).title, "Opening");
  const late = chapterMarks(
    [
      { time: 30, title: "A" },
      { time: 90, title: "B" },
    ],
    120,
  );
  assert.equal(late[0].start, 30);
  assert.equal(chapterAt(late, 29), null);
  assert.equal(chapterAt(late, 30).title, "A");
  assert.deepEqual(chapterMarks([{ time: 12, title: "Only" }], 100), [
    { start: 12, title: "Only", index: 0, end: 100 },
  ]);
  assert.deepEqual(chapterMarks([], 100), []);
  assert.deepEqual(chapterMarks(list, 0), []);
  assert.deepEqual(chapterMarks(list, 3600, { live: true }), []);
  assert.deepEqual(chapterMarks(null, 3600), []);
  // A repeated start keeps the first title, or the first one there is.
  assert.equal(
    chapterMarks(
      [
        { time: 0, title: "" },
        { time: 0.2, title: "Named" },
        { time: 50, title: "B" },
      ],
      100,
    )[0].title,
    "Named",
  );
});

test("ends at: a 12-hour clock with AM/PM, from the time left at this speed", () => {
  const now = new Date(2026, 10, 5, 21, 0, 0).getTime();
  const film = { position: 0, duration: 5400, speed: 1 };
  const en = endsAt(film, { now, locale: "en" });
  assert.equal(en.time, "10:30 PM");
  assert.equal(en.days, 0);
  // Twice as fast, half the time.
  assert.equal(
    endsAt({ ...film, speed: 2 }, { now, locale: "en" }).time,
    "9:45 PM",
  );
  // Past midnight: tomorrow.
  const late = endsAt(
    { position: 0, duration: 4 * 3600 },
    { now, locale: "en" },
  );
  assert.equal(late.time, "1:00 AM");
  assert.equal(late.days, 1);
  // Arabic says م/ص with Latin digits.
  assert.match(endsAt(film, { now, locale: "ar" }).time, /^10:30\s?م$/);
  // Nothing misleading: live, unknown length, finished.
  assert.equal(endsAt({ position: 0, duration: 0 }, { now }), null);
  assert.equal(endsAt({ ...film, live: true }, { now }), null);
  assert.equal(endsAt({ position: 5400, duration: 5400 }, { now }), null);
  // A bad speed counts as normal speed.
  assert.equal(
    endsAt({ ...film, speed: 0 }, { now, locale: "en" }).time,
    "10:30 PM",
  );
});

test("no large volume display: MPV's bar is off for the volume keys (#139)", () => {
  for (const id of ["volumeUp", "volumeDown"]) {
    const action = HOTKEY_ACTIONS.find((a) => a.id === id);
    assert.match(action.command, /^no-osd add volume -?5$/, id);
  }
  assert.equal(read("assets/player-input.conf"), inputConf({}));
  const hud = read("src/components/Hud.jsx");
  assert.doesNotMatch(hud, /hud-volume-popup|hud-volume-meter/);
  assert.doesNotMatch(hud, /pulse\("volume"\)/);
  // The round level in the middle replaced the corner pill (#147).
  assert.match(hud, /<VolumeOsd/);
  assert.doesNotMatch(hud, /hud-volume-pill/);
  // The retired position stays in saved settings for older devices, unread.
  assert.equal(
    safeSettings({ volumeOsdPosition: "top-left" }).volumeOsdPosition,
    "top-left",
  );
  assert.ok("volumeOsd" in DEFAULT_SETTINGS);
  assert.doesNotMatch(
    read("src/components/settings/PlayerPages.jsx"),
    /s\.volumeOsdPosition|set\(\{ volumeOsdPosition/,
  );
});

test("both players draw the same bar, in the order the report asked (#140)", () => {
  for (const file of [
    "src/components/Hud.jsx",
    "src/components/PlayerView.jsx",
  ]) {
    const page = read(file);
    const order = [
      'command("pause")',
      '"رجوع"',
      '"تقديم"',
      "<VolumeControl",
      "<TimeCounter",
    ].map((text) => page.indexOf(text));
    assert.ok(
      order.every((i) => i > 0),
      `${file}: ${order}`,
    );
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      order,
      file,
    );
    assert.match(page, /<ChapterStrip/, file);
    assert.match(page, /<ChapterTicks/, file);
    assert.match(page, /<EndsAt/, file);
    // Stop watching stays.
    assert.match(page, /title="إيقاف المشاهدة"/, file);
  }
});

test("volume keys and the wheel show only the round level (#147)", () => {
  const keys = publicHotkeys({});
  assert.equal(quietBinding("UP", keys), true);
  assert.equal(quietBinding("DOWN", keys), true);
  assert.equal(quietBinding("m", keys), true);
  // Every other key still wakes the controls.
  for (const binding of ["SPACE", "LEFT", "RIGHT", "f", "c"])
    assert.equal(quietBinding(binding, keys), false, binding);
  assert.equal(quietBinding("", keys), false);
  assert.equal(quietBinding("UP", null), false);
  // A viewer's own volume key is quiet too; a clash with another action
  // is not.
  assert.equal(quietBinding("9", publicHotkeys({ volumeUp: "9" })), true);
  assert.equal(quietBinding("u", publicHotkeys({ volumeUp: "u" })), false);
  assert.equal(quietBinding("UP", publicHotkeys({ seekForward: "UP" })), false);
  const hud = read("src/components/Hud.jsx");
  // The key handler wakes only for other keys; the wheel never wakes.
  assert.match(
    hud,
    /if \(!quietBinding\(binding, state\?\.hotkeys\)\) wake\(\);/,
  );
  const wheel = hud.slice(
    hud.indexOf("const onWheel"),
    hud.indexOf("const seekTo"),
  );
  assert.match(wheel, /osd\.external\(\);\s*command\("volume", volume\)/);
  assert.doesNotMatch(wheel, /wake\(\)/);
  // The slider never unfolds by itself: no reveal from a key or the wheel.
  const bar = read("src/components/PlayerBar.jsx");
  assert.doesNotMatch(bar, /reveal/);
  assert.doesNotMatch(hud, /reveal=|volumeReveal/);
  // The bar's own slider and mute button keep the round level away, by
  // the values they sent, not by a pause after them (PR #155 review): a
  // key right after the slider still shows. The theater draws it too.
  assert.match(
    hud,
    /osd\.bar\(player\.volume \|\| 0, !player\.muted\);\s*command\("mute"\)/,
  );
  assert.match(
    hud,
    /osd\.bar\(value, !!player\.muted\);\s*command\("volume", value\)/,
  );
  assert.match(hud, /else osd\.external\(\);/);
  assert.doesNotMatch(hud, /barVolume|< 800/);
  const theater = read("src/components/PlayerView.jsx");
  assert.match(theater, /const osd = useVolumeOsd\(player\);/);
  assert.match(theater, /<VolumeOsd[\s\S]{0,240}inline/);
  // It is round, in the middle, and says the percentage alone.
  const css = read("src/player-bar.css");
  const osd = css.slice(css.indexOf(".volume-osd {"));
  assert.match(osd, /border-radius: 50%/);
  assert.match(osd, /top: 50%;\s*left: 50%/);
  assert.match(osd, /pointer-events: none/);
  assert.match(bar, /`\$\{level\}%`/);
});

test("no volume indicator switch: the old setting stays saved, unread (#145)", () => {
  const page = read("src/components/settings/PlayerPages.jsx");
  assert.doesNotMatch(page, /s\.volumeOsd|set\(\{ volumeOsd/);
  assert.doesNotMatch(page, /مؤشر صغير لمستوى الصوت/);
  assert.doesNotMatch(read("src/components/Hud.jsx"), /settings\.volumeOsd/);
  // Older devices that sync keep their value.
  assert.ok("volumeOsd" in DEFAULT_SETTINGS);
  assert.equal(safeSettings({ volumeOsd: false }).volumeOsd, false);
});

test("Ends sits on the icons' line, with its own class (#144)", () => {
  const bar = read("src/components/PlayerBar.jsx");
  const ends = bar.slice(bar.indexOf("export function EndsAt"));
  assert.match(ends, /className=\{`player-ends \$\{className\}`\}/);
  assert.match(ends, /dir="auto"/);
  // The title page's `.ends-at` paragraph (with its top margin) is not the
  // player's label any more.
  assert.doesNotMatch(bar, /className=\{?[`"]ends-at/);
  assert.match(read("src/title.css"), /\.ends-at \{[^}]*margin: 10px 0 0/);
  const css = read("src/player-bar.css");
  assert.match(css, /\.hud-actions \.player-ends,/);
  // A changing clock never moves its neighbours.
  assert.match(css, /\.player-ends \{[^}]*font-variant-numeric: tabular-nums/);
  assert.match(
    css,
    /\.hud-actions \.player-ends,\n\.app \.theater-actions \.player-ends \{[^}]*min-width: 13ch/,
  );
});

test("every control in the bar sits in the same glass chip (#151)", () => {
  const css = read("src/player-bar.css");
  const chip = css.slice(
    css.indexOf(".hud-actions .hud-group > button,"),
    css.indexOf("/* The picture-mode"),
  );
  for (const part of [
    ".hud-actions .hud-group > button",
    ".hud-actions .playback-choice > button",
    ".hud-actions .playback-choices > button",
    ".hud-actions .volume-group",
    ".hud-actions .time-counter",
    ".hud-actions .player-ends",
    ".hud-actions .chapter-now",
    ".app .theater-actions .button-row > .icon-button",
    ".app .theater-actions .volume-group",
    ".app .theater-actions .player-ends",
  ])
    assert.ok(chip.includes(part), part);
  // Always drawn: the fill, the edge and the height are not hover-only.
  assert.match(
    chip,
    /background: var\(--bar-chip-sheen\), var\(--bar-chip-fill\)/,
  );
  assert.match(chip, /border: 1px solid var\(--bar-chip-edge\)/);
  assert.match(chip, /height: var\(--bar-chip-size\)/);
  // The old one-off box on play/pause is gone; it is a chip like the rest.
  assert.doesNotMatch(read("src/hud.css"), /\.hud-main \{[^}]*!important/);
  // Opaque where transparency is reduced, plain in forced colours.
  assert.match(css, /prefers-reduced-transparency: reduce/);
  assert.match(css, /\.forced-colors\s+:is\(/);
});

test("the player menu is as wide as its longest item (#150)", () => {
  const css = read("src/review083.css");
  const menu = css.slice(css.indexOf(".player-menu {"));
  const rule = menu.slice(0, menu.indexOf("}"));
  assert.match(rule, /width: max-content/);
  assert.match(rule, /max-width: min\(320px, calc\(100vw - 16px\)\)/);
  assert.doesNotMatch(rule, /min-width: 2\d\dpx/);
  // A note wraps inside the items' width and never widens the menu.
  const notes = read("src/downloads-quality.css");
  assert.match(
    notes,
    /\.player-menu \.menu-note \{[^}]*width: 0;\s*min-width: 100%/,
  );
  // Still the HTML menu, never a native one.
  assert.doesNotMatch(
    read("src/components/PlayerMenu.jsx"),
    /Menu\.buildFromTemplate|electron/,
  );
});
