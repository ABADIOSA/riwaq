import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";

// Settings controls from older releases could outlive what main or the
// validators accept, so a button looked alive and did nothing. These checks
// tie every control to something that answers it.

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");
const sources = readdirSync(join(root, "src"), { recursive: true })
  .filter((f) => /\.(jsx|js)$/.test(f))
  .map((f) => ({ file: f, text: read(join("src", f)) }));

test("every IPC method the interface calls is allowed and defined in main", () => {
  const preload = read("electron/preload.cjs");
  const allowed = new Set(
    [...preload.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]),
  );
  const main = read("electron/main.mjs");
  const block = main.slice(main.indexOf("const methods = {"));
  const defined = new Set(
    [...block.matchAll(/^\s{2}([A-Za-z]+)(?:\s*:|\s*\(|,)/gm)].map((m) => m[1]),
  );
  // Window buttons go through windowControl with an action, not a method.
  const actions = new Set(["close", "maximize", "minimize"]);
  const missing = [];
  for (const { file, text } of sources)
    for (const m of text.matchAll(/\b(?:call|act|update)\(\s*"([A-Za-z]+)"/g)) {
      const name = m[1];
      if (actions.has(name) && /WindowChrome/.test(file)) continue;
      if (!allowed.has(name) || !defined.has(name))
        missing.push(`${file}: ${name}`);
    }
  assert.deepEqual([...new Set(missing)], []);
});

test("every option a settings list offers is one the validator keeps", () => {
  const rejected = [];
  for (const { file, text } of sources) {
    for (const m of text.matchAll(/\bselect\(\s*"([A-Za-z]+)",/g)) {
      const key = m[1];
      const start = text.indexOf("[", m.index + m[0].length);
      let depth = 0,
        end = start;
      for (; end < text.length; end++) {
        if (text[end] === "[") depth++;
        else if (text[end] === "]" && !--depth) break;
      }
      const values = [
        ...text
          .slice(start + 1, end)
          .matchAll(/\[\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false)\s*,/g),
      ].map((x) => JSON.parse(x[1]));
      assert.ok(values.length, `${file}: ${key} has options`);
      for (const value of values)
        if (safeSettings({ [key]: value })[key] !== value)
          rejected.push(`${file}: ${key}=${JSON.stringify(value)}`);
    }
    for (const m of text.matchAll(/\btoggle\(\s*"([A-Za-z]+)",\s*"/g)) {
      const key = m[1];
      if (!(key in DEFAULT_SETTINGS)) continue; // a page's own toggle helper
      const flipped = !DEFAULT_SETTINGS[key];
      if (safeSettings({ [key]: flipped })[key] !== flipped)
        rejected.push(`${file}: toggle ${key}`);
    }
  }
  assert.deepEqual(rejected, []);
});

test("look options from before Riwaq's interface work in it too", () => {
  const css = read("src/session.css");
  // Card corners, the corner style and the accent gradient reach the new
  // interface's cards, search box and main button.
  assert.match(
    css,
    /\.experience-riwaq \.poster-card \{[^}]*border-radius: var\(--poster-radius/,
  );
  assert.match(
    css,
    /\.experience-riwaq \.search-box \{[^}]*border-radius: var\(--radius/,
  );
  assert.match(
    css,
    /\.session-build \{[^}]*border-radius: var\(--radius[^}]*background: var\(--accent-fill/,
  );
  assert.match(css, /\.app\.logotint-gold \.riwaq-monogram i/);
  // Logo style: mark only, name only, or both.
  const nav = read("src/components/RiwaqNav.jsx");
  assert.match(nav, /appearance\.logoStyle !== "name"/);
  assert.match(nav, /appearance\.logoStyle !== "mark"/);
  // The hero exists only in the classic interface, so its home section and
  // the hero glow are not offered in Riwaq's.
  const studio = read("src/components/SettingsStudio.jsx");
  assert.match(
    studio,
    /const offered = \(id\) => !\(riwaqHome && id === "hero"\)/,
  );
  const app = read("src/App.jsx");
  assert.match(app, /riwaqExperience \? "" : imgUrl\(hero\?\.background\)/);
});
