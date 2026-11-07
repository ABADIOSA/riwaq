import { lookup as dnsLookup } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable } from "node:stream";

export const ARTWORK_HOST_BLOCKED = "ERR_RIWAQ_ARTWORK_HOST";

const nonPublic = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  nonPublic.addSubnet(address, prefix, "ipv4");

const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
])
  nonPublic.addSubnet(address, prefix, "ipv6");

function publicAddress(address) {
  switch (isIP(address)) {
    case 4:
      return !nonPublic.check(address, "ipv4");
    case 6:
      return (
        globalV6.check(address, "ipv6") && !nonPublic.check(address, "ipv6")
      );
    default:
      return false;
  }
}

/** Automatic poster metadata may name only public HTTPS destinations. */
export function publicArtworkUrl(url) {
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$|\.$/g, "");
  if (isIP(host)) return publicAddress(host);
  return host.includes(".") && !/\.(?:localhost|local|home\.arpa)$/.test(host);
}

function blockedAddress() {
  return Object.assign(new Error("blocked address"), {
    code: ARTWORK_HOST_BLOCKED,
  });
}

/**
 * Give the socket the addresses that were checked, with the URL hostname
 * still used for TLS verification and SNI. A separate lookup followed by
 * fetch would let DNS change the answer between the check and connection.
 */
function publicLookup(resolve) {
  return (host, options, callback) => {
    resolve(host, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const allowed = addresses.filter(({ address }) => publicAddress(address));
      if (!allowed.length) return callback(blockedAddress());
      if (options.all) return callback(null, allowed);
      callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

/** HTTPS with no redirect following, cookies or environment proxy. */
export async function requestArtwork(
  input,
  { signal, headers = {} } = {},
  { lookup = dnsLookup, request = httpsRequest } = {},
) {
  const url = new URL(input);
  if (!publicArtworkUrl(url)) throw blockedAddress();
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        // The direct connection must use our DNS check. A proxy could resolve
        // the hostname independently and connect to a different address.
        agent: false,
        lookup: publicLookup(lookup),
        signal,
        headers: { ...headers, "accept-encoding": "identity" },
      },
      (response) => {
        const status = response.statusCode;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: {
            get: (name) => response.headers[name.toLowerCase()] ?? null,
          },
          body: Readable.toWeb(response, {
            strategy: {
              highWaterMark: response.readableHighWaterMark,
              size: (chunk) => chunk.byteLength,
            },
          }),
        });
      },
    );
    req.once("error", reject);
    req.end();
  });
}
