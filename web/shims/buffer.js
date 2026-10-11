/**
 * Node's Buffer for the web edition: the npm `buffer` package (imported by path,
 * "buffer/index.js", so Node's tests load the same package, not Node's own),
 * plus the "base64url" encoding it lacks and core/ uses (Spotify's PKCE,
 * the Letterboxd bridge, accounts). Without it those failed only on the web.
 */
import { Buffer } from "buffer/index.js";

const toBase64 = (text) => text.replace(/-/g, "+").replace(/_/g, "/");
const toBase64Url = (text) =>
  text.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const isUrl = (encoding) => String(encoding).toLowerCase() === "base64url";

if (!Buffer.isEncoding("base64url")) {
  const toString = Buffer.prototype.toString;
  Buffer.prototype.toString = function (encoding, start, end) {
    return isUrl(encoding)
      ? toBase64Url(toString.call(this, "base64", start, end))
      : toString.apply(this, arguments);
  };
  const from = Buffer.from;
  Buffer.from = function (value, encoding, length) {
    return typeof value === "string" && isUrl(encoding)
      ? from.call(this, toBase64(value), "base64")
      : from.apply(this, arguments);
  };
  const isEncoding = Buffer.isEncoding;
  Buffer.isEncoding = (encoding) => isUrl(encoding) || isEncoding(encoding);
}

export { Buffer };
export default { Buffer };
