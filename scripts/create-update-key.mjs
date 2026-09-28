import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const privateFile = resolve(
  process.argv[2] || ".cache/signing/update-private.pem",
);
const publicFile = resolve("assets/update-public-key.pem");
if (existsSync(privateFile) || existsSync(publicFile))
  throw new Error(
    "Signing keys already exist. Never replace a shipped trust key accidentally.",
  );
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
mkdirSync(dirname(privateFile), { recursive: true });
writeFileSync(
  privateFile,
  privateKey.export({ type: "pkcs8", format: "pem" }),
  { flag: "wx", mode: 0o600 },
);
writeFileSync(publicFile, publicKey.export({ type: "spki", format: "pem" }), {
  flag: "wx",
});
console.log(
  "Created an Ed25519 release key. Keep the private PEM outside source control and in the RIWAQ_UPDATE_PRIVATE_KEY repository secret. Only the public key ships.",
);
