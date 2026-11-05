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
import { HOTKEY_ACTIONS, inputConf } from "../core/hotkeys.mjs";
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
  // A chapter list starting late still covers the opening.
  assert.equal(
    chapterMarks(
      [
        { time: 30, title: "A" },
        { time: 90, title: "B" },
      ],
      120,
    )[0].start,
    0,
  );
  // One chapter, none, live or an unknown length: no division.
  assert.deepEqual(chapterMarks([{ time: 0, title: "Only" }], 100), []);
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
  assert.match(hud, /hud-volume-pill/);
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
