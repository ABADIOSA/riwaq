import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseAst } from "rolldown/parseAst";

// The interface is plain JSX, so a name used outside the scope that declares
// it builds fine and only fails when that branch renders. 0.22.0 shipped one
// such name ("liveRows" in the full-catalog grid), which blanked the app on
// "عرض الكل". This walks every module's scopes and names each identifier that
// nothing declares.

const GLOBALS = new Set(
  (
    "window document console setTimeout clearTimeout setInterval clearInterval " +
    "requestAnimationFrame cancelAnimationFrame fetch URL URLSearchParams Image " +
    "ResizeObserver MutationObserver IntersectionObserver PerformanceObserver " +
    "getComputedStyle navigator localStorage sessionStorage performance Intl " +
    "Blob File FileReader TextEncoder TextDecoder crypto AbortController " +
    "AbortSignal structuredClone process Buffer atob btoa HTMLElement Event " +
    "CustomEvent KeyboardEvent location history alert confirm queueMicrotask " +
    "globalThis Response Request Headers DOMParser matchMedia screen " +
    "devicePixelRatio innerWidth innerHeight OffscreenCanvas createImageBitmap " +
    "ImageData WebSocket EventTarget Node Element ClipboardItem FormData " +
    "undefined NaN Infinity Object Array String Number Boolean Symbol BigInt " +
    "Math JSON Date RegExp Error TypeError RangeError SyntaxError Map Set " +
    "WeakMap WeakSet WeakRef Promise Proxy Reflect parseInt parseFloat isNaN " +
    "isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI " +
    "Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array " +
    "Int32Array Float32Array Float64Array ArrayBuffer DataView escape unescape " +
    "arguments"
  ).split(/\s+/),
);

/** Names bound by a pattern: `a`, `{ b, c: [d] }`, `...e`, `f = 1`. */
function bound(pattern, out = []) {
  if (!pattern) return out;
  switch (pattern.type) {
    case "Identifier":
      out.push(pattern.name);
      break;
    case "ObjectPattern":
      for (const p of pattern.properties)
        bound(p.type === "RestElement" ? p.argument : p.value, out);
      break;
    case "ArrayPattern":
      for (const e of pattern.elements) bound(e, out);
      break;
    case "RestElement":
      bound(pattern.argument, out);
      break;
    case "AssignmentPattern":
      bound(pattern.left, out);
      break;
  }
  return out;
}

/** Declarations a block or program hoists into its own scope. */
function declaredIn(body, fnScope) {
  const names = [];
  const vars = (node) => {
    // `var` and function declarations reach the enclosing function scope.
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(vars);
    if (node.type === "VariableDeclaration" && node.kind === "var")
      node.declarations.forEach((d) => names.push(...bound(d.id)));
    if (/Function/.test(node.type)) return;
    for (const key of [
      "body",
      "consequent",
      "alternate",
      "block",
      "handler",
      "finalizer",
      "cases",
      "init",
      "left",
    ])
      if (node[key]) vars(node[key]);
  };
  for (const node of body) {
    if (node.type === "VariableDeclaration")
      node.declarations.forEach((d) => names.push(...bound(d.id)));
    else if (
      node.type === "FunctionDeclaration" ||
      node.type === "ClassDeclaration"
    )
      node.id && names.push(node.id.name);
    else if (node.type === "ImportDeclaration")
      node.specifiers.forEach((s) => names.push(s.local.name));
    else if (
      (node.type === "ExportNamedDeclaration" ||
        node.type === "ExportDefaultDeclaration") &&
      node.declaration
    ) {
      const d = node.declaration;
      if (d.type === "VariableDeclaration")
        d.declarations.forEach((x) => names.push(...bound(x.id)));
      else if (d.id) names.push(d.id.name);
    }
    if (fnScope) vars(node);
  }
  return names;
}

function undefinedNames(source, file) {
  const ast = parseAst(source, { lang: file.endsWith("x") ? "jsx" : "js" });
  const missing = [];
  const scopes = [];
  const known = (name) => GLOBALS.has(name) || scopes.some((s) => s.has(name));
  const withScope = (names, fn) => {
    scopes.push(new Set(names));
    fn();
    scopes.pop();
  };
  const use = (node) => {
    if (!known(node.name)) missing.push(`${node.name} (offset ${node.start})`);
  };
  const visit = (node, parent, key) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, parent, key));
    switch (node.type) {
      case "Program":
        return withScope(declaredIn(node.body, true), () =>
          visit(node.body, node),
        );
      case "BlockStatement":
      case "StaticBlock":
        return withScope(declaredIn(node.body, false), () =>
          visit(node.body, node),
        );
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const params = node.params.flatMap((p) => bound(p));
        const own =
          node.type === "FunctionExpression" && node.id ? [node.id.name] : [];
        const inner =
          node.body.type === "BlockStatement"
            ? declaredIn(node.body.body, true)
            : [];
        return withScope([...params, ...own, ...inner, "arguments"], () => {
          node.params.forEach((p) => visitPattern(p));
          if (node.body.type === "BlockStatement")
            visit(node.body.body, node.body);
          else visit(node.body, node);
        });
      }
      case "ClassDeclaration":
      case "ClassExpression":
        return withScope(node.id ? [node.id.name] : [], () => {
          visit(node.superClass, node);
          visit(node.body, node);
        });
      case "CatchClause":
        return withScope(bound(node.param), () => visit(node.body, node));
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const head = node.init || node.left;
        const names =
          head?.type === "VariableDeclaration"
            ? head.declarations.flatMap((d) => bound(d.id))
            : [];
        return withScope(names, () => {
          for (const k of ["init", "left", "test", "update", "right", "body"])
            visit(node[k], node, k);
        });
      }
      case "VariableDeclarator":
        visitPattern(node.id);
        return visit(node.init, node);
      case "Identifier":
        return use(node);
      case "MemberExpression":
        visit(node.object, node);
        if (node.computed) visit(node.property, node);
        return;
      case "Property":
        if (node.computed) visit(node.key, node);
        return visit(node.value, node);
      case "MethodDefinition":
      case "PropertyDefinition":
        if (node.computed) visit(node.key, node);
        return visit(node.value, node);
      case "LabeledStatement":
        return visit(node.body, node);
      case "BreakStatement":
      case "ContinueStatement":
        return;
      case "ImportDeclaration":
        return;
      case "ExportNamedDeclaration":
        if (node.declaration) return visit(node.declaration, node);
        if (!node.source) node.specifiers.forEach((s) => use(s.local));
        return;
      case "JSXIdentifier":
        // A capitalised tag is a component reference; lower case is HTML.
        if (
          key === "name" &&
          parent.type !== "JSXAttribute" &&
          /^[A-Z]/.test(node.name)
        )
          use(node);
        return;
      case "JSXMemberExpression":
        return visit(node.object, node, "name");
      case "JSXAttribute":
        return visit(node.value, node);
      case "JSXNamespacedName":
      case "MetaProperty":
        return;
    }
    for (const [k, v] of Object.entries(node))
      if (k !== "type" && v && typeof v === "object") visit(v, node, k);
  };
  // Patterns bind names (already in scope) but defaults and computed keys use them.
  const visitPattern = (p) => {
    if (!p) return;
    if (p.type === "AssignmentPattern") {
      visitPattern(p.left);
      visit(p.right, p);
    } else if (p.type === "ObjectPattern")
      p.properties.forEach((q) => {
        if (q.type === "RestElement") return visitPattern(q.argument);
        if (q.computed) visit(q.key, q);
        visitPattern(q.value);
      });
    else if (p.type === "ArrayPattern") p.elements.forEach(visitPattern);
    else if (p.type === "RestElement") visitPattern(p.argument);
  };
  visit(ast);
  return missing;
}

const files = (dir, ext) =>
  readdirSync(dir, { recursive: true })
    .filter((f) => ext.test(f))
    .map((f) => join(dir, f));

test("the checker notices a name used outside the scope that declares it", () => {
  const sample =
    "function App(){ const rows = useMemo(() => { const live = 1; return live; }, []); return <div>{live}{rows}</div>; }";
  assert.deepEqual(
    undefinedNames(sample, "a.jsx").map((m) => m.split(" ")[0]),
    ["useMemo", "live"],
  );
  assert.deepEqual(
    undefinedNames(
      "import React from 'react'; const X = () => <React.Fragment><Y /></React.Fragment>; function Y({ a = 1, ...b }) { for (const k of [a]) try { k(b) } catch (e) { e } }",
      "b.jsx",
    ),
    [],
  );
});

test("every interface and core module uses only names it declares", () => {
  const root = new URL("..", import.meta.url).pathname;
  const all = [
    ...files(join(root, "src"), /\.(jsx|js)$/),
    ...files(join(root, "core"), /\.mjs$/),
    ...files(join(root, "electron"), /\.mjs$/),
  ];
  assert.ok(all.length > 60, `${all.length} files`);
  const problems = [];
  for (const file of all) {
    const missing = undefinedNames(readFileSync(file, "utf8"), file);
    if (missing.length)
      problems.push(`${file.slice(root.length)}: ${missing.join(", ")}`);
  }
  assert.deepEqual(problems, []);
});
