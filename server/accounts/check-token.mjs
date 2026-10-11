// Cleans CLOUDFLARE_API_TOKEN of what copying and pasting adds, and says what
// the value looks like when it is not an API token. Used by
// .github/workflows/accounts.yml; it never prints the value itself.
//
//   node server/accounts/check-token.mjs   → writes the cleaned token to
//   $GITHUB_ENV, `ok` and `hint` to $GITHUB_OUTPUT

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Removes spaces of every kind, invisible marks, quotes, a "Bearer" prefix
 * and a variable name pasted with the value (`CLOUDFLARE_API_TOKEN=…`,
 * `export …=`). No API token contains "=" or ":", so nothing real is lost.
 */
export function cleanToken(raw) {
  return String(raw || "")
    .normalize("NFKC")
    .replace(/[\p{Cf}"'`«»“”‘’]/gu, "")
    .replace(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*[=:]/, "")
    .replace(/^\s*(?:authorization\s*:\s*)?bearer\s+/i, "")
    .replace(/[\p{White_Space}\p{Cc}]/gu, "");
}

/** What the value is, when it is clearly not an API token; otherwise null. */
export function wrongKind(token) {
  if (!token) return "it is empty";
  if (/^[0-9a-f]{32}$/i.test(token)) {
    return "it holds a 32-character ID (the Account ID or the token's ID), not the token's value";
  }
  if (/^[0-9a-f]{37}$/i.test(token) || /^cfk_/.test(token)) {
    return "it holds the Global API Key, which Wrangler cannot use as a token";
  }
  if (/^v1\.0-/i.test(token)) return "it holds an Origin CA key";
  if (token.includes("://")) return "it holds a link";
  return null;
}

/** Shape facts only: length and kinds of characters, never the characters. */
export function describeToken(token) {
  const chars = [...token];
  const other = chars.filter((c) => !/[A-Za-z0-9_-]/.test(c)).length;
  const kinds = [
    /[a-z]/.test(token) && "small letters",
    /[A-Z]/.test(token) && "capital letters",
    /[0-9]/.test(token) && "digits",
    /[_-]/.test(token) && "- or _",
    other && `${other} other character${other === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return `${chars.length} characters (${kinds.join(", ") || "none"})`;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const token = cleanToken(process.env.CLOUDFLARE_API_TOKEN);
  const output = process.env.GITHUB_OUTPUT;
  const write = (file, line) => file && appendFileSync(file, `${line}\n`);
  if (token) console.log(`::add-mask::${token}`);
  const wrong = wrongKind(token);
  if (wrong) {
    console.log(
      `::error::CLOUDFLARE_API_TOKEN is not an API token: ${wrong}. In Cloudflare: My Profile → API Tokens → Create Token, then copy the value shown once after "Create Token".`,
    );
    process.exit(1);
  }
  write(process.env.GITHUB_ENV, `CLOUDFLARE_API_TOKEN=${token}`);
  write(output, "ok=true");
  write(
    output,
    `hint=The value is ${describeToken(token)}; a Cloudflare API token is 53 characters starting cfut_ or cfat_ (older ones: 40 letters, digits, - and _).`,
  );
}
