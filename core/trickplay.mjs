/**
 * Seek-bar thumbnails. When the pointer rests on the timeline, main grabs a
 * single small frame at that moment with a second, silent MPV and hands the
 * HUD a JPEG. Every frame is a network request against the source, so the
 * viewer chooses how far this reaches, as Nuvio HTPC does:
 *
 * - `off`: never.
 * - `local`: files on this PC and servers on the home network only. Never
 *   debrid or addon streams, and never torrents, even though those arrive
 *   through the local streaming server, so previews cannot get a viewer
 *   rate-limited while seeking.
 * - `all`: every source.
 *
 * Pure policy and argument building; main does the spawning.
 */

export const THUMB_MODES = ["off", "local", "all"];
export const THUMB_WIDTH = 320;

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
];

/** True for a host on this machine or the home network. */
export function isHomeHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".lan"))
    return true;
  if (host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe80:/.test(host))
    return true;
  return PRIVATE_V4.some((re) => re.test(host));
}

/**
 * Whether a preview may be taken of this source. `source` is what main holds
 * for the current viewing (never sent to the interface): its address,
 * whether it is a local file, whether it is live. `serverUrl` is the torrent
 * streaming server, whose streams count as remote.
 */
export function thumbnailsAllowed(source, mode, serverUrl = "") {
  if (!source || source.live || !THUMB_MODES.includes(mode) || mode === "off")
    return false;
  if (source.local) return true;
  let url;
  try {
    url = new URL(source.url);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(url.protocol)) return false;
  if (mode === "all") return true;
  try {
    if (serverUrl && new URL(serverUrl).origin === url.origin) return false;
  } catch {
    /* A malformed server address cannot match. */
  }
  return isHomeHost(url.hostname);
}

/**
 * The moment a preview stands for: previews are shared within a slice of the
 * film, so sweeping the pointer asks for a handful of frames, not hundreds.
 */
export function thumbnailSlot(at, duration) {
  const d = Number(duration) || 0;
  const t = Math.max(0, Math.min(d || Infinity, Number(at) || 0));
  // About 200 slices a film, never closer than five seconds apart.
  const step = Math.max(5, Math.round(d / 200) || 5);
  return Math.min(Math.max(0, d - 1), Math.round(t / step) * step) || 0;
}

/** Arguments for a silent MPV that writes one scaled JPEG and quits. */
export function thumbnailArgs({ url, headers = {}, at, outDir }) {
  const args = [
    "--no-config",
    "--load-scripts=no",
    "--ytdl=no",
    "--terminal=no",
    "--msg-level=all=no",
    "--idle=no",
    "--force-window=no",
    "--audio=no",
    "--sub=no",
    "--osc=no",
    "--hwdec=no",
    "--hr-seek=no",
    "--cache=no",
    "--network-timeout=8",
    `--start=${Math.max(0, Math.floor(Number(at) || 0))}`,
    "--frames=1",
    `--vf=scale=${THUMB_WIDTH}:-2`,
    "--vo=image",
    "--vo-image-format=jpg",
    "--vo-image-jpeg-quality=72",
    `--vo-image-outdir=${outDir}`,
  ];
  const entries = Object.entries(headers || {}).filter(
    ([k, v]) =>
      /^[\w-]+$/.test(k) && typeof v === "string" && !/[\r\n]/.test(v),
  );
  if (entries.length)
    args.push(
      "--http-header-fields=" +
        entries
          .map(([k, v]) =>
            `${k}: ${v}`.replace(/\\/g, "\\\\").replace(/,/g, "\\,"),
          )
          .join(","),
    );
  args.push("--", url);
  return args;
}
