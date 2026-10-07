import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import sevenZip from "7zip-bin";

/**
 * MPV's own stable Windows release (mpv-player/mpv on GitHub). Stable
 * releases stay published, unlike the daily builds Riwaq pinned before
 * (two of which were removed upstream), and a tagged release is the most
 * tested MPV there is. The archive holds the CI build as an inner zip.
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, "vendor", "mpv");
const cache = join(root, ".cache");
const asset = "mpv-v0.41.0-x86_64-w64-mingw32.zip";
const url = `https://github.com/mpv-player/mpv/releases/download/v0.41.0/${asset}`;
const expected =
  "a49811c0752c108b8260636f9c6f6fcb97406641c98b30f1e7b500dfb20177de";
const marker = join(out, ".riwaq-build");
const extract = (archive, target) =>
  execFileSync(sevenZip.path7za, ["x", "-y", archive, `-o${target}`], {
    stdio: "inherit",
    windowsHide: true,
  });

mkdirSync(cache, { recursive: true });
const current = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";
if (!existsSync(join(out, "mpv.exe")) || current !== asset) {
  console.log("Downloading MPV's stable release…");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`MPV download: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(data).digest("hex") !== expected)
    throw new Error("MPV checksum mismatch");
  const archive = join(cache, asset);
  writeFileSync(archive, data);
  const outer = join(cache, "mpv-outer");
  rmSync(outer, { recursive: true, force: true });
  extract(archive, outer);
  const inner = readdirSync(outer).find((name) => /^mpv-.*\.zip$/i.test(name));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  extract(inner ? join(outer, inner) : archive, out);
  if (!existsSync(join(out, "mpv.exe")))
    throw new Error("MPV archive did not contain mpv.exe");
  writeFileSync(marker, asset);
}
console.log("MPV ready");
