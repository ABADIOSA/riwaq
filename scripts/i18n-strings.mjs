/**
 * The interface's Arabic strings, as src/lib/jsx-runtime.js will meet them,
 * and which of them core/i18n/en.mjs translates (docs: core/i18n.mjs).
 *
 *   node scripts/i18n-strings.mjs            missing English, per file
 *   node scripts/i18n-strings.mjs --json     every key with its file
 *
 * JSX text is collapsed the way React does; string literals are taken whole;
 * template literals become patterns with {1}, {2}… for their expressions.
 * tests/i18n.test.mjs uses extract() to keep the interface covered.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAst } from "rolldown/parseAst";
import { translate } from "../core/i18n.mjs";
import EN from "../core/i18n/en.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const ARABIC = /[؀-ۿ]/;

/** React's JSX whitespace rule: trimmed lines joined by one space. */
export function jsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  const kept = [];
  lines.forEach((line, i) => {
    let text = line.replace(/\t/g, " ");
    if (i > 0) text = text.replace(/^[ ]+/, "");
    if (i < lines.length - 1) text = text.replace(/[ ]+$/, "");
    if (text) kept.push(text);
  });
  return kept.join(" ");
}

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (key === "start" || key === "end") continue;
    const value = node[key];
    if (value && typeof value === "object") walk(value, visit);
  }
}

/** The Arabic strings of one source file. */
export function stringsOf(source, file = "x.jsx") {
  const ast = parseAst(source, { lang: /x$/.test(file) ? "jsx" : "js" });
  const out = new Set();
  const add = (text) => {
    const clean = String(text).trim();
    if (clean && ARABIC.test(clean)) out.add(clean);
  };
  walk(ast, (node) => {
    if (node.type === "JSXText") add(jsxText(node.value));
    else if (node.type === "Literal" && typeof node.value === "string")
      add(node.value);
    else if (node.type === "TemplateLiteral") {
      const parts = node.quasis.map((q) => q.value.cooked ?? q.value.raw);
      if (!parts.some((p) => ARABIC.test(p))) return;
      add(
        parts
          .map((part, i) => (i < parts.length - 1 ? `${part}{${i + 1}}` : part))
          .join(""),
      );
    }
  });
  return [...out];
}

function files(dir, pattern) {
  const list = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) list.push(...files(path, pattern));
    else if (pattern.test(name)) list.push(path);
  }
  return list;
}

/** Interface files: everything under src/. */
export const interfaceFiles = () =>
  files(join(root, "src"), /\.(jsx|js)$/).filter(
    (f) => !/jsx-(dev-)?runtime\.js$/.test(f),
  );

// Arabic letters and punctuation, without the Arabic-Indic digits that
// stand in for a template's expressions.
const LETTERS = /[\u0600-\u065F\u066A-\u06FF]/;

/**
 * Whether a key is translated: exactly, or by pattern entries that leave
 * no Arabic behind. A short pattern ("لون {1}") would otherwise "cover" a
 * whole sentence that merely starts with its word, and the sentence would
 * render half in English.
 */
export function covered(key, dictionary = EN) {
  if (dictionary[key] !== undefined) return true;
  // A template's own pattern is covered by the same entry, or by a
  // pattern that reads its parts (its placeholders standing in as text).
  const sample = key.replace(/\{(\d+)\}/g, "٠");
  const out = translate(sample, "en", dictionary);
  return out !== sample && !LETTERS.test(out);
}

export function extract(list = interfaceFiles()) {
  return list.map((path) => ({
    file: relative(root, path),
    strings: stringsOf(readFileSync(path, "utf8"), path),
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = extract();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 1));
  } else {
    let missing = 0;
    let total = 0;
    for (const { file, strings } of result) {
      const gaps = strings.filter((s) => !covered(s));
      total += strings.length;
      missing += gaps.length;
      if (gaps.length) console.log(`${gaps.length}\t${file}`);
    }
    console.log(`${total - missing}/${total} translated`);
  }
}
