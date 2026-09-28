import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
} from "node:crypto";
import {
  createReadStream,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { installerName, verifyManifest } from "../core/update-package.mjs";
import { REPO } from "../core/updates.mjs";

const directory = resolve(process.argv[2] || "release");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const tag = process.env.RIWAQ_RELEASE_TAG;
if (tag && tag !== `v${version}`)
  throw new Error("Release tag must match package.json version.");
const pem =
  process.env.RIWAQ_UPDATE_PRIVATE_KEY ||
  (process.env.RIWAQ_UPDATE_KEY_FILE &&
    readFileSync(process.env.RIWAQ_UPDATE_KEY_FILE, "utf8"));
if (!pem)
  throw new Error(
    "Missing RIWAQ_UPDATE_PRIVATE_KEY: unsigned updates must not be published.",
  );
const key = createPrivateKey(pem);
if (key.asymmetricKeyType !== "ed25519")
  throw new Error("Expected an Ed25519 signing key.");
const publicKey = readFileSync("assets/update-public-key.pem", "utf8");
if (
  createPublicKey(key).export({ type: "spki", format: "pem" }).trim() !==
  publicKey.trim()
)
  throw new Error(
    "Release key does not match the public key embedded in Riwaq.",
  );
const filename = installerName(version);
const hash = createHash("sha512");
for await (const chunk of createReadStream(join(directory, filename)))
  hash.update(chunk);
const payload = Buffer.from(
  JSON.stringify({
    schema: 1,
    repo: REPO,
    version,
    platform: "win32-x64",
    channel: process.env.RIWAQ_RELEASE_CHANNEL || "beta",
    publishedAt: new Date().toISOString(),
    filename,
    size: statSync(join(directory, filename)).size,
    sha512: hash.digest("hex"),
    notes: readFileSync(".github/release-notes.md", "utf8").slice(0, 20000),
  }),
);
const envelope = JSON.stringify({
  payload: payload.toString("base64"),
  signature: sign(null, payload, key).toString("base64"),
});
verifyManifest(envelope, publicKey, { version });
writeFileSync(join(directory, "riwaq-update.json"), envelope + "\n");
console.log(
  `Signed update metadata for ${version}. No private key is included in the release.`,
);
