import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  WHATS_NEW,
  cleanSeenVersion,
  compareVersions,
  lastSeen,
  shouldShowWhatsNew,
  unseenNotes,
} from "../core/whats-new.mjs";
import { matchesWords } from "../core/arabic.mjs";
import { bindingLabel, publicHotkeys } from "../core/hotkeys.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");
const version = JSON.parse(source("package.json")).version;

test("every release ships its own highlights, newest first", () => {
  // A release without notes would open "what's new" on an older list.
  assert.equal(WHATS_NEW[0].version, version);
  const versions = WHATS_NEW.map((n) => n.version);
  assert.equal(new Set(versions).size, versions.length);
  for (let i = 1; i < versions.length; i++)
    assert.equal(compareVersions(versions[i - 1], versions[i]), 1);
  for (const note of WHATS_NEW) {
    assert.ok(note.title && note.items.length > 0, note.version);
    assert.ok(note.items.every((t) => typeof t === "string" && t.length < 200));
  }
});

test("versions compare numerically, and only real versions are stored", () => {
  assert.equal(compareVersions("0.28.1", "0.28.0"), 1);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.27.0", "0.28.0"), -1);
  assert.equal(cleanSeenVersion("0.28.1"), "0.28.1");
  assert.equal(cleanSeenVersion("../x"), "");
  assert.equal(DEFAULT_SETTINGS.seenVersion, "");
  assert.equal(safeSettings({ seenVersion: "0.29.0" }).seenVersion, "0.29.0");
  assert.equal(safeSettings({ seenVersion: "<b>" }).seenVersion, "");
});

test("what's new opens once after an update, never on a fresh install", () => {
  // A fresh install has seen everything up to now.
  assert.equal(
    shouldShowWhatsNew({ seenVersion: "", used: false, current: "0.29.0" }),
    false,
  );
  assert.equal(
    lastSeen({ seenVersion: "", used: false, current: "0.29.0" }),
    "0.29.0",
  );
  // A profile that used Riwaq before the feature last saw 0.28.1.
  assert.equal(
    shouldShowWhatsNew({ seenVersion: "", used: true, current: "0.29.0" }),
    true,
  );
  assert.deepEqual(
    unseenNotes({ seen: "0.28.1", current: "0.29.0" }).map((n) => n.version),
    ["0.29.0"],
  );
  // Several releases behind: newest first, at most four.
  assert.deepEqual(
    unseenNotes({ seen: "0.25.1", current: "0.29.0" }).map((n) => n.version),
    ["0.29.0", "0.28.1", "0.28.0", "0.27.0"],
  );
  // Seen already, or notes from a newer build than the one running.
  assert.equal(
    shouldShowWhatsNew({
      seenVersion: "0.29.0",
      used: true,
      current: "0.29.0",
    }),
    false,
  );
  assert.deepEqual(unseenNotes({ seen: "0.28.1", current: "0.28.1" }), []);
  assert.deepEqual(unseenNotes({ seen: "", current: "junk" }), []);
});

test("the app records the version seen and reads it from the running build", () => {
  const app = source("src/App.jsx");
  assert.match(app, /const runningVersion = state\.update\?\.current/);
  assert.match(app, /update\("settings", \{ seenVersion: runningVersion \}\)/);
  assert.match(app, /call\("settings", \{ seenVersion: runningVersion \}\)/);
  // Settings → Updates can show the list at any time.
  assert.match(source("src/components/UpdatesCard.jsx"), /<WhatsNew/);
});

test("? opens the shortcuts, but never while typing", () => {
  const app = source("src/App.jsx");
  assert.match(app, /e\.key === "\?"/);
  assert.match(app, /\^\(INPUT\|TEXTAREA\|SELECT\)\$/);
  assert.match(app, /!t\?\.isContentEditable/);
  assert.equal(bindingLabel("Shift+LEFT"), "Shift + ←");
  assert.equal(bindingLabel("SPACE"), "مسافة");
  assert.equal(bindingLabel("m"), "M");
  // Every playback key the viewer has has a label to show.
  assert.ok(publicHotkeys({}).every((h) => h.label && bindingLabel(h.binding)));
});

test("settings search folds Arabic and wants every word", () => {
  const playback =
    "المشغل HDR الجودة تسريع العتاد متابعة إيقاف معاينة تسريع تقديم خطوة تذكر مسلسل";
  assert.ok(matchesWords(playback, "خطوة تقديم"));
  assert.ok(matchesWords(playback, "تَذكُّر"));
  assert.ok(matchesWords("اقتراحات تراكت", "إقتراحات"));
  assert.ok(matchesWords("الصلاة", "صلاه"));
  assert.ok(!matchesWords(playback, "خطوة صلاة"));
  assert.ok(matchesWords(playback, "  "));
  const studio = source("src/components/SettingsStudio.jsx");
  assert.equal((studio.match(/matchesWords\(/g) || []).length, 3);
  assert.doesNotMatch(studio, /\.includes\(search\.toLowerCase\(\)\)/);
});
