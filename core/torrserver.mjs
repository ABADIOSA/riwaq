/**
 * TorrServer (YouROK, GPL-3.0, github.com/YouROK/TorrServer) as the built-in
 * engine's fallback (0.46). When a built-in torrent sends nothing for 40 s,
 * Riwaq tries the same torrent in TorrServer, whose engine (anacrolix) also
 * reaches peers over uTP, before it moves to the next source; Nuvio HTPC
 * falls back to TorrServer the same way (docs/REFERENCE-REVIEW.md).
 *
 * Riwaq never ships TorrServer: the viewer downloads the pinned upstream
 * release on a click, its size and SHA-256 are checked before it is kept and
 * again before it first runs, and it runs as its own program on 127.0.0.1
 * with a random port and password (electron/torrserver.mjs).
 */
import {
  PUBLIC_TRACKERS,
  cleanFilename,
  engineOptions,
  pickFile,
} from "./torrent-engine.mjs";

/** The one TorrServer release Riwaq downloads (checked against its tag). */
export const TORRSERVER = Object.freeze({
  version: "MatriX.145.1",
  url: "https://github.com/YouROK/TorrServer/releases/download/MatriX.145.1/TorrServer-windows-amd64.exe",
  size: 63547904,
  sha256: "d8bf93aba0521f2450436d4ede02c3b6e44a37b52c386aa9e6206daa8e5551ed",
  source: "https://github.com/YouROK/TorrServer/tree/MatriX.145.1",
  license: "GPL-3.0",
});

/** How long TorrServer may take to read a torrent's metadata. */
export const TORRSERVER_READY_MS = 45000;
/** A TorrServer with nothing to play stops after this long. */
export const TORRSERVER_IDLE_MS = 3 * 60 * 1000;

/**
 * TorrServer's settings file, written before every start so its defaults
 * never apply: no Bonjour or LAN peer discovery (Riwaq never announces
 * itself on the LAN), no DLNA or searches, the router port only with
 * incoming peers on, and the viewer's connection, speed and upload limits.
 * Every field is written: TorrServer reads a missing one as zero.
 */
export function torrServerSettings(settings = {}, memory = 0) {
  const options = engineOptions(settings);
  const kib = (bytes) =>
    bytes > 0 ? Math.max(1, Math.round(bytes / 1024)) : 0;
  return {
    BitTorr: {
      CacheSize: (memory >= 12 * 1024 ** 3 ? 256 : 128) * 1024 * 1024,
      ReaderReadAHead: 95,
      PreloadCache: 50,
      UseDisk: false,
      TorrentsSavePath: "",
      RemoveCacheOnDrop: false,
      ForceEncrypt: false,
      RetrackersMode: 1,
      TrackersListURL: "",
      DefaultTrackers: PUBLIC_TRACKERS.join("\n"),
      // Riwaq drops a torrent when its viewing ends; this only covers a
      // pause or a seek that leaves no reader for a while.
      TorrentDisconnectTimeout: 300,
      EnableDebug: false,
      EnableDLNA: false,
      EnableBonjour: false,
      FriendlyName: "",
      EnableRutorSearch: false,
      EnableTorznabSearch: false,
      TorznabUrls: [],
      TMDBSettings: {
        APIKey: "",
        APIURL: "https://api.themoviedb.org",
        ImageURL: "https://image.tmdb.org",
        ImageURLRu: "https://imagetmdb.com",
      },
      EnableIPv6: false,
      DisableTCP: false,
      DisableUTP: false,
      DisableUPNP: !options.incoming,
      DisableDHT: false,
      DisablePEX: false,
      DisableUpload: false,
      DownloadRateLimit: kib(options.downloadLimit),
      UploadRateLimit: kib(options.uploadLimit),
      ConnectionsLimit: options.maxConns,
      PeersListenPort: 0,
      EnableLPD: false,
      LPDIPv6: false,
      SslPort: 0,
      SslCert: "",
      SslKey: "",
      ResponsiveMode: true,
      ShowFSActiveTorr: false,
      StoreSettingsInJson: true,
      StoreViewedInJson: false,
      TrackTimecode: false,
      MergeAllM3U: false,
    },
  };
}

const count = (value) =>
  Number.isFinite(Number(value)) && Number(value) > 0
    ? Math.round(Number(value))
    : 0;

/** TorrServer's files ({id, path, length}), the malformed left out. */
export function torrServerFiles(stats) {
  const list = Array.isArray(stats?.file_stats) ? stats.file_stats : [];
  return list.filter(
    (file) =>
      Number.isInteger(file?.id) &&
      file.id > 0 &&
      typeof file.path === "string" &&
      Number.isFinite(file.length),
  );
}

/** A TorrServer torrent's start, in the built-in engine's shape. */
export function torrServerStatus(stats) {
  if (!stats || typeof stats !== "object") return null;
  return {
    metadata: torrServerFiles(stats).length > 0,
    peers: count(stats.active_peers),
    down: count(stats.download_speed),
    bytes: Math.max(
      count(stats.loaded_size),
      count(stats.bytes_read_useful_data),
    ),
  };
}

const base = (path) => cleanFilename(String(path || "")).toLowerCase();

/**
 * TorrServer's id for the file to play, or 0 when it cannot be known.
 * TorrServer numbers files after sorting them by path, so an addon's file
 * index (the torrent's own order) is matched through the torrent's file
 * list from the built-in engine, else the file the addon names. Without
 * either, a multi-file torrent with an index is refused rather than guessed.
 */
export function torrServerFile(stats, { fileIdx, filename, files } = {}) {
  const list = torrServerFiles(stats);
  if (!list.length) return 0;
  if (list.length === 1) return list[0].id;
  const index = Number.isInteger(fileIdx) && fileIdx >= 0 ? fileIdx : undefined;
  const original = Array.isArray(files) ? files[index] : undefined;
  if (index !== undefined && original) {
    const name = base(original.path || original.name);
    const same = list.filter(
      (file) => base(file.path) === name && file.length === original.length,
    );
    if (same.length === 1) return same[0].id;
    const tail = String(original.path || "")
      .split(/[\\/]/)
      .slice(1)
      .join("/");
    const exact = same.find((file) => tail && file.path.endsWith(tail));
    if (exact) return exact.id;
  }
  const wanted = base(filename);
  if (wanted) {
    const named = list.find((file) => base(file.path) === wanted);
    if (named) return named.id;
  }
  if (index !== undefined) return 0;
  const at = pickFile(
    list.map((file) => ({ name: file.path, length: file.length })),
  );
  return at >= 0 ? list[at].id : 0;
}

/** The address MPV plays: the file's name for MPV, its id, play. */
export function torrServerStreamUrl(origin, hash, file) {
  const name = cleanFilename(file?.path) || "video";
  return `${origin}/stream/${encodeURIComponent(name)}?link=${hash}&index=${file.id}&play`;
}
