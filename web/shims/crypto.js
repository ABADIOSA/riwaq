/**
 * The parts of node:crypto that core/ uses, for the web edition.
 *
 * core/ runs unchanged in the browser: PIN hashes (scrypt), backups (scrypt,
 * then AES-256-GCM), Spotify's PKCE challenge and opaque keys (SHA-256) need
 * synchronous answers, which WebCrypto does not give. The audited @noble
 * libraries compute the same bytes, so a backup made on the desktop opens on
 * the web and the other way round. Randomness always comes from
 * crypto.getRandomValues.
 */
import { Buffer } from "./buffer.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { sha1 } from "@noble/hashes/legacy.js";
import { scrypt as nobleScrypt, scryptAsync } from "@noble/hashes/scrypt.js";
import { hmac } from "@noble/hashes/hmac.js";
import { gcm } from "@noble/ciphers/aes.js";

const HASHES = { sha1, sha256, sha512 };
const bytes = (data, encoding) =>
  typeof data === "string"
    ? Buffer.from(data, encoding || "utf8")
    : data instanceof Uint8Array
      ? data
      : Buffer.from(data);
const join = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

export function createHash(algorithm) {
  const hash = HASHES[String(algorithm).toLowerCase()];
  if (!hash) throw new Error(`Unsupported hash: ${algorithm}`);
  const parts = [];
  return {
    update(data, encoding) {
      parts.push(bytes(data, encoding));
      return this;
    },
    digest(encoding) {
      const out = Buffer.from(hash(join(parts)));
      return encoding ? out.toString(encoding) : out;
    },
  };
}

export function randomBytes(size) {
  const out = new Uint8Array(size);
  // getRandomValues fills at most 65536 bytes per call.
  for (let at = 0; at < size; at += 65536)
    crypto.getRandomValues(out.subarray(at, Math.min(size, at + 65536)));
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

export const randomUUID = () => crypto.randomUUID();

export function createHmac(algorithm, key) {
  const hash = HASHES[String(algorithm).toLowerCase()];
  if (!hash) throw new Error(`Unsupported hash: ${algorithm}`);
  const parts = [];
  return {
    update(data, encoding) {
      parts.push(bytes(data, encoding));
      return this;
    },
    digest(encoding) {
      const out = Buffer.from(hmac(hash, bytes(key), join(parts)));
      return encoding ? out.toString(encoding) : out;
    },
  };
}

const scryptOptions = (keylen, options = {}) => ({
  N: options.N ?? options.cost ?? 16384,
  r: options.r ?? options.blockSize ?? 8,
  p: options.p ?? options.parallelization ?? 1,
  dkLen: keylen,
  maxmem: options.maxmem ?? 64 * 1024 * 1024,
});

export function scryptSync(password, salt, keylen, options = {}) {
  return Buffer.from(
    nobleScrypt(bytes(password), bytes(salt), scryptOptions(keylen, options)),
  );
}

/**
 * Node's callback scrypt. noble's async version yields to the page between
 * rounds, so a sign-in does not freeze the interface while it derives keys.
 */
export function scrypt(password, salt, keylen, options, callback) {
  if (typeof options === "function") [options, callback] = [{}, options];
  scryptAsync(bytes(password), bytes(salt), scryptOptions(keylen, options))
    .then((key) => callback(null, Buffer.from(key)))
    .catch((error) => callback(error));
}

export function timingSafeEqual(a, b) {
  if (a.length !== b.length)
    throw new RangeError("Input buffers must have the same byte length");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * AES-256-GCM with Node's streaming shape. GCM is computed in one pass at
 * final(), which gives exactly the bytes Node's update()+final() give.
 */
function gcmStream(mode, algorithm, key, iv) {
  if (String(algorithm).toLowerCase() !== "aes-256-gcm")
    throw new Error(`Unsupported cipher: ${algorithm}`);
  const parts = [];
  let aad;
  let tag;
  return {
    setAAD(data) {
      aad = bytes(data);
      return this;
    },
    setAuthTag(data) {
      tag = bytes(data);
      return this;
    },
    getAuthTag() {
      if (!tag) throw new Error("Call final() first");
      return Buffer.from(tag);
    },
    update(data, encoding) {
      parts.push(bytes(data, encoding));
      return Buffer.alloc(0);
    },
    final() {
      const cipher = gcm(bytes(key), bytes(iv), aad);
      if (mode === "encrypt") {
        const sealed = cipher.encrypt(join(parts));
        tag = sealed.subarray(sealed.length - 16);
        return Buffer.from(sealed.subarray(0, sealed.length - 16));
      }
      if (!tag) throw new Error("Missing authentication tag");
      // Throws when the tag does not match: wrong key or tampered data.
      return Buffer.from(cipher.decrypt(join([...parts, tag])));
    },
  };
}
export const createCipheriv = (algorithm, key, iv) =>
  gcmStream("encrypt", algorithm, key, iv);
export const createDecipheriv = (algorithm, key, iv) =>
  gcmStream("decrypt", algorithm, key, iv);

// Signed update packages are a desktop matter (electron/updater.mjs).
export function verify() {
  throw new Error("Signature checks run in the desktop edition only");
}

export default {
  createHash,
  createHmac,
  scrypt,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  verify,
};
