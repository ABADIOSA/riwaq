/**
 * The connection a saved subtitle is fetched over (issue #157, Codex's final
 * acceptance, 2026-11-21). core/subtitle-export.mjs decides, hop by hop,
 * which addresses may be asked for; this decides where the socket may
 * actually go, in main, the way artwork does (electron/artwork-http.mjs):
 *
 * - An address outside the request's trusted origins may reach only public
 *   internet addresses. Its name is resolved by the connection itself and
 *   every answer that is this computer, the viewer's network, link-local
 *   (cloud metadata), multicast or reserved is dropped before the socket
 *   connects; with none left the request fails. A separate check followed
 *   by a fetch would let DNS answer differently the second time (DNS
 *   rebinding). An IP literal is checked as it is.
 * - A trusted origin is a configured, enabled addon's own local origin
 *   (scheme, host and port), named by main from the addon that supplied the
 *   subtitle; only there may the socket reach a local address.
 * - No redirect is followed here (the caller checks each one), no cookies,
 *   no environment proxy (a proxy would resolve the name itself), and no
 *   header but Accept.
 *
 * No `electron` import: tests pass a fake resolver and request.
 */
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { publicAddress, publicLookup } from "./artwork-http.mjs";
import { SUBTITLE_HOST_BLOCKED, localHost } from "../core/subtitle-export.mjs";

const blocked = () =>
  Object.assign(new Error("blocked address"), { code: SUBTITLE_HOST_BLOCKED });

/** A fetch-shaped GET for fetchSubtitle (`init.trusted`: origins). */
export async function requestSubtitle(
  input,
  { signal, headers = {}, trusted = [] } = {},
  { lookup = dnsLookup, http = httpRequest, https = httpsRequest } = {},
) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw blocked();
  const local = Array.isArray(trusted) && trusted.includes(url.origin);
  const host = url.hostname.replace(/^\[|\]$|\.$/g, "");
  if (!local) {
    if (isIP(host) ? !publicAddress(host) : localHost(host)) throw blocked();
  }
  signal?.throwIfAborted();
  const send = url.protocol === "https:" ? https : http;
  const accept = typeof headers.Accept === "string" ? headers.Accept : "*/*";
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: "GET",
        agent: false,
        lookup: local ? lookup : publicLookup(lookup, SUBTITLE_HOST_BLOCKED),
        signal,
        headers: { Accept: accept, "accept-encoding": "identity" },
      },
      (response) => {
        const status = response.statusCode;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: {
            get: (name) => {
              const value = response.headers[name.toLowerCase()];
              return Array.isArray(value) ? value.join(", ") : (value ?? null);
            },
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
