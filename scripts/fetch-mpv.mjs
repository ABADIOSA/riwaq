import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import sevenZip from "7zip-bin";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "vendor", "mpv");
const cache = join(root, ".cache");
const asset = "mpv-x86_64-20260610-git-304426c.7z";
const url = `https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20260610/${asset}`;
const expected =
  "facac536baa73c7b925771af5e39a3c9cb16b8d75b59a6e9800de89799dffca7";
mkdirSync(out, { recursive: true });
mkdirSync(cache, { recursive: true });
if (!existsSync(join(out, "mpv.exe"))) {
  console.log("Downloading pinned MPV build…");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MPV download: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== expected)
    throw new Error("MPV checksum mismatch");
  const archive = join(cache, asset);
  writeFileSync(archive, data);
  execFileSync(sevenZip.path7za, ["x", "-y", archive, `-o${out}`], {
    stdio: "inherit",
    windowsHide: true,
  });
}
console.log("MPV ready");
