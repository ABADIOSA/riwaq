import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Riwaq Admin is the owner's tool (docs/ADMIN.md, "Who can reach it"): it
// must never ride along with the viewer app, the site, a release or an
// Actions artifact, which on a public repository any GitHub account can
// download.
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

function files(dir) {
  const out = [];
  for (const name of readdirSync(join(root, dir))) {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) out.push(...files(path));
    else out.push(path);
  }
  return out;
}

test("the viewer package takes only the viewer's own folders", () => {
  const { build } = JSON.parse(read("package.json"));
  const included = build.files.filter((pattern) => !pattern.startsWith("!"));
  const allowed = /^(dist|electron|core|assets)\/\*\*\/\*$/;
  for (const pattern of included)
    assert.ok(
      allowed.test(pattern) ||
        ["package.json", "LICENSE", "THIRD-PARTY.md"].includes(pattern),
      `unexpected packaged path: ${pattern}`,
    );
  assert.ok(!included.some((pattern) => /admin/i.test(pattern)));
  assert.ok(
    !JSON.stringify(build.asarUnpack || []).includes("admin"),
    "nothing of Admin is unpacked beside the viewer",
  );
});

test("no viewer code, site build or page imports Admin", () => {
  for (const dir of ["src", "electron", "core", "web"])
    for (const file of files(dir).filter((f) => /\.(m?js|jsx|cjs)$/.test(f)))
      assert.doesNotMatch(
        read(file),
        /(from\s+|import\(\s*|require\(\s*)["'][^"']*\badmin\//,
        `${file} must not import admin/`,
      );
  for (const config of ["vite.config.mjs", "vite.web.config.mjs"])
    assert.doesNotMatch(read(config), /admin/i, config);
});

test("no workflow builds, uploads or publishes Admin", () => {
  for (const name of readdirSync(join(root, ".github/workflows"))) {
    const workflow = read(join(".github/workflows", name));
    assert.doesNotMatch(
      workflow,
      /package:admin|release-admin|Riwaq-Admin|admin\/electron-builder/i,
      `${name} must not build or ship Admin`,
    );
  }
  // The release attaches the viewer's own outputs, nothing else.
  const release = read(".github/workflows/release.yml");
  const publish = release.slice(release.indexOf("name: Publish the release"));
  assert.match(publish, /\$files = @\(Get-ChildItem release\/\*\.exe/);
  assert.match(
    publish,
    /gh release create "\$env:TAG" @files release\/SHA256SUMS\.txt release\/riwaq-update\.json --draft/,
  );
});

test("Admin refuses to publish for anyone but the owner", () => {
  // The publisher is shared with owner devices of the public app
  // (electron/owner.mjs); Admin only adds the releases list on top.
  assert.match(read("admin/github.mjs"), /extends NoticePublisher/);
  const github = read("core/notice-publisher.mjs");
  assert.match(github, /String\(user\.login\)\.toLowerCase\(\) !== "abadiosa"/);
  assert.match(github, /!repo\.permissions\?\.push/);
  // Publishing needs a preview, which needs the owner's connection.
  assert.match(github, /if \(!this\.token \|\| this\.busy\)/);
});
