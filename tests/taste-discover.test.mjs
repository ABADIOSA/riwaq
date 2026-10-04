import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { arabicCount, EXCLUDED, LIKES } from "../core/arabic.mjs";

const source = (file) =>
  readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), "utf8");

test("the taste shelf names no addon, since it sits on Discover", () => {
  assert.doesNotMatch(source("src/components/TasteDiscovery.jsx"), /إضاف/);
});

test("on Discover the taste panel starts closed, so the section tabs stay in view", () => {
  const app = source("src/App.jsx");
  const discover = app.slice(app.indexOf('view === "discover" ? ('));
  const shelf = discover.slice(
    discover.indexOf("<TasteDiscovery"),
    discover.indexOf("/>", discover.indexOf("<TasteDiscovery")),
  );
  assert.match(shelf, /\bcollapsed\b/);
  assert.match(
    source("src/components/TasteDiscovery.jsx"),
    /!collapsed &&\s+!taste\.genres\.length/,
  );
});

test("saved taste counts agree with their number", () => {
  assert.equal(arabicCount(0, LIKES), "لا إعجابات");
  assert.equal(arabicCount(2, LIKES), "إعجابان");
  assert.equal(arabicCount(4, LIKES), "4 إعجابات");
  assert.equal(arabicCount(1, EXCLUDED), "عمل واحد مستبعد");
  assert.equal(arabicCount(15, EXCLUDED), "15 عملاً مستبعداً");
  assert.match(
    source("src/components/TasteDiscovery.jsx"),
    /arabicCount\(liked\.length, LIKES\)/,
  );
});
