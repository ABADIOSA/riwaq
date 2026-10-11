/**
 * The parts of node:zlib that core/ uses (backups, Nuvio backup zips), for
 * the web edition. Decompression is streamed in small slices so a crafted
 * file stops at `maxOutputLength` instead of filling the tab's memory.
 */
import { Buffer } from "buffer";
import { Gunzip, Inflate, gzipSync as gzip } from "fflate";

const SLICE = 16 * 1024;

function inflateWith(
  Stream,
  data,
  { maxOutputLength = 256 * 1024 * 1024 } = {},
) {
  const input = data instanceof Uint8Array ? data : Buffer.from(data);
  const parts = [];
  let total = 0;
  const stream = new Stream((chunk) => {
    total += chunk.length;
    if (total > maxOutputLength) throw new RangeError("Output too large");
    parts.push(chunk);
  });
  if (!input.length) throw new Error("unexpected end of file");
  for (let at = 0; at < input.length; at += SLICE)
    stream.push(input.subarray(at, at + SLICE), at + SLICE >= input.length);
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}

export const gzipSync = (data) =>
  Buffer.from(gzip(data instanceof Uint8Array ? data : Buffer.from(data)));
export const gunzipSync = (data, options) => inflateWith(Gunzip, data, options);
export const inflateRawSync = (data, options) =>
  inflateWith(Inflate, data, options);

export default { gzipSync, gunzipSync, inflateRawSync };
