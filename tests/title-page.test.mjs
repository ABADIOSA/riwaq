import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (name) =>
  readFileSync(
    fileURLToPath(new URL(`../src/${name}`, import.meta.url)),
    "utf8",
  );

// A title page scrolls on its own (title.css), outside .content's padding, so
// every bottom bar that pads .content must pad it too (#119 review).
test("a title page keeps the same room as the page under each music bar", () => {
  for (const [file, bar] of [
    ["music.css", "music-bar"],
    ["local-music.css", "local-music-bar"],
  ]) {
    const rule = [...read(file).matchAll(/([^{}]+)\{([^}]*)\}/g)].find(
      ([, selectors]) => selectors.includes(`.app:has(.${bar}) .content`),
    );
    assert.ok(rule, `${bar} pads .content`);
    assert.ok(
      rule[1].includes(`.app:has(.${bar}) .title-page`),
      `${bar} pads the title page with the same rule`,
    );
    assert.match(rule[2], /padding-bottom:\s*\d+px/);
  }
  assert.match(read("title.css"), /\.title-page \{[^}]*position: fixed;/);
});
