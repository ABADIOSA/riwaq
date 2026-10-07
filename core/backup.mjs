/**
 * Portable backups.
 *
 * profile.bin is sealed with Windows DPAPI, which binds it to one Windows
 * account on one machine. That is the right default for secrets at rest, and
 * it also means a reinstall or a new PC silently loses every library, queue,
 * profile and addon. A backup is the viewer's way out: one file they carry,
 * sealed with a passphrase only they know.
 *
 * The file is always encrypted (scrypt, then AES-256-GCM with the header as
 * authenticated data). Secrets are left out unless the viewer asks for them,
 * and even then the backup is exactly as protected as its passphrase. Import is
 * treated as untrusted input: every section goes through the same validation
 * the app applies when the data is entered by hand.
 */

import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import {
  DEFAULT_SETTINGS,
  normalizeAddon,
  validateManifest,
  safeSettings,
  webUrl,
} from "./protocol.mjs";
import { cleanMedia, queueKey } from "./library.mjs";
import { cleanCollections } from "./collections.mjs";
import { HOTKEY_ACTIONS, validBinding } from "./hotkeys.mjs";
import { LOCKABLE_ROOMS } from "./profiles.mjs";
import {
  validDiscordWebhook,
  validTelegramToken,
  validTelegramChat,
} from "./notify.mjs";

export const BACKUP_FORMAT = "riwaq-backup";
export const BACKUP_VERSION = 1;
export const MIN_PASSPHRASE = 8;
const MAX_FILE = 64 * 1024 * 1024;
const MAX_PLAIN = 256 * 1024 * 1024;
const KDF = { name: "scrypt", N: 32768, r: 8, p: 1 };
const AVATARS = ["amber", "teal", "violet", "rose", "forest", "nord"];
// Paths to files on the machine that made the backup mean nothing elsewhere,
// and a stale MPV path would stop playback outright on the new machine.
// Paths and this PC's audio output belong to the installation, not a backup.
const MACHINE_SETTINGS = ["mpvPath", "shaderPath", "audioDevice"];

const isObject = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const shortText = (value, max = 4096) =>
  typeof value === "string" && value.length <= max && !/[\r\n]/.test(value);
const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/**
 * A configured addon carries its configuration, often a debrid or API key, in
 * the URL path or query. Only a bare `/manifest.json` with no query is safe to
 * carry in a backup that promises to hold no secrets.
 */
export function isPlainAddon(transportUrl) {
  try {
    const url = new URL(transportUrl);
    return url.pathname === "/manifest.json" && !url.search;
  } catch {
    return false;
  }
}

function withoutMachinePaths(settings) {
  const copy = { ...(settings || {}) };
  for (const key of MACHINE_SETTINGS) delete copy[key];
  return copy;
}

/**
 * The backup payload for the current state. `includeSecrets` adds addon
 * configurations, the Stremio sign-in, provider keys, platform tokens, live
 * sources and notification targets; without it they are counted, not copied,
 * so the viewer can see what a restore will not bring back.
 */
export function collectBackup(state, { includeSecrets = false } = {}) {
  const profiles = state.profiles || { list: [], active: "", data: {} };
  const data = {};
  for (const profile of profiles.list || []) {
    const bucket = profiles.data?.[profile.id] || {};
    data[profile.id] = {
      favorites: bucket.favorites || [],
      progress: bucket.progress || {},
      queue: bucket.queue || [],
      connectedLists: bucket.connectedLists || [],
      collections: bucket.collections || [],
      settings: withoutMachinePaths(bucket.settings),
    };
  }
  const addons = state.addons || [];
  const payload = {
    profiles: {
      active: profiles.active,
      // PIN hashes travel with their profiles: dropping them would let a
      // restore strip a child's profile of its parental lock.
      list: (profiles.list || []).map((profile) => ({ ...profile })),
      data,
    },
    hotkeys: state.hotkeys || {},
    discordAppId: state.discordAppId || "",
    addons: addons.filter(
      (addon) => includeSecrets || isPlainAddon(addon.transportUrl),
    ),
    live: {
      favorites: state.live?.favorites || [],
      sources: includeSecrets ? state.live?.sources || [] : [],
    },
  };
  if (includeSecrets) {
    payload.auth = state.auth || null;
    payload.providers = state.providers || {};
    payload.integrations = state.integrations || {};
    payload.notify = state.notify || {};
  }
  const left = {
    configuredAddons: includeSecrets
      ? 0
      : addons.filter((addon) => !isPlainAddon(addon.transportUrl)).length,
    liveSources: includeSecrets ? 0 : (state.live?.sources || []).length,
    providers: includeSecrets
      ? 0
      : Object.values(state.providers || {}).filter((p) => p?.key).length,
    integrations: includeSecrets
      ? 0
      : Object.values(state.integrations || {}).filter(
          (i) => i?.token || i?.clientId || i?.username,
        ).length,
    notify: includeSecrets ? 0 : Object.keys(state.notify || {}).length,
    stremio: !includeSecrets && !!state.auth?.authKey,
  };
  return { payload, left };
}

function deriveKey(passphrase, salt, kdf) {
  return scryptSync(String(passphrase).normalize("NFKC"), salt, 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 128 * 1024 * 1024,
  });
}

export function checkPassphrase(passphrase) {
  if (typeof passphrase !== "string" || [...passphrase].length < MIN_PASSPHRASE)
    throw new Error(`اختر عبارة مرور من ${MIN_PASSPHRASE} أحرف على الأقل`);
  if (passphrase.length > 1024) throw new Error("عبارة المرور طويلة جداً");
}

/** Seals a payload into the text of a `.riwaq` file. */
export function encryptBackup(
  payload,
  passphrase,
  { app = "", includesSecrets = false, now = Date.now() } = {},
) {
  checkPassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date(now).toISOString(),
    app: String(app).slice(0, 40),
    includesSecrets: !!includesSecrets,
    kdf: { ...KDF, salt: salt.toString("base64") },
    cipher: { name: "aes-256-gcm", iv: iv.toString("base64") },
  };
  const key = deriveKey(passphrase, salt, KDF);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // The header is readable before a passphrase is entered, so it is bound to
  // the ciphertext: editing "includesSecrets" or the KDF breaks decryption.
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const sealed = Buffer.concat([
    cipher.update(gzipSync(Buffer.from(JSON.stringify(payload)))),
    cipher.final(),
  ]);
  return JSON.stringify({
    header,
    tag: cipher.getAuthTag().toString("base64"),
    data: sealed.toString("base64"),
  });
}

/** Reads the unencrypted header so the interface can describe the file first. */
export function readBackupHeader(text) {
  if (typeof text !== "string" || !text.length)
    throw new Error("ملف النسخة الاحتياطية فارغ");
  if (text.length > MAX_FILE)
    throw new Error("ملف النسخة الاحتياطية كبير جداً");
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error("هذا الملف ليس نسخة احتياطية من رِواق");
  }
  const header = envelope?.header;
  if (!isObject(header) || header.format !== BACKUP_FORMAT)
    throw new Error("هذا الملف ليس نسخة احتياطية من رِواق");
  if (header.version !== BACKUP_VERSION)
    throw new Error(
      "هذه النسخة الاحتياطية من إصدار أحدث من رِواق. حدّث التطبيق أولاً.",
    );
  const kdf = header.kdf;
  // Parameters come from the file. Bound them before running scrypt so a
  // crafted header cannot ask for gigabytes of memory.
  if (
    !isObject(kdf) ||
    kdf.name !== "scrypt" ||
    ![16384, 32768, 65536, 131072].includes(kdf.N) ||
    kdf.r !== 8 ||
    kdf.p !== 1 ||
    typeof kdf.salt !== "string" ||
    header.cipher?.name !== "aes-256-gcm" ||
    typeof header.cipher?.iv !== "string" ||
    typeof envelope.tag !== "string" ||
    typeof envelope.data !== "string"
  )
    throw new Error("ملف النسخة الاحتياطية تالف");
  return { envelope, header };
}

/** Opens a `.riwaq` file. Wrong passphrase and tampering look the same, on purpose. */
export function decryptBackup(text, passphrase) {
  const { envelope, header } = readBackupHeader(text);
  if (typeof passphrase !== "string" || !passphrase)
    throw new Error("أدخل عبارة المرور");
  try {
    const key = deriveKey(
      passphrase,
      Buffer.from(header.kdf.salt, "base64"),
      header.kdf,
    );
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(header.cipher.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(JSON.stringify(header)));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const zipped = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]);
    const payload = JSON.parse(
      gunzipSync(zipped, { maxOutputLength: MAX_PLAIN }).toString("utf8"),
    );
    if (!isObject(payload)) throw new Error("invalid");
    return { header, payload };
  } catch {
    throw new Error("عبارة المرور غير صحيحة أو الملف تالف");
  }
}

function cleanRecord(record, key) {
  if (!isObject(record) || typeof record.videoId !== "string") return null;
  let meta;
  try {
    meta = cleanMedia(record.meta);
  } catch {
    return null;
  }
  if (key !== `${meta.type}:${record.videoId}`) return null;
  const clean = {
    meta,
    videoId: record.videoId.slice(0, 1000),
    position: Math.max(0, finite(record.position)),
    duration: Math.max(0, finite(record.duration)),
    updated: Math.max(0, finite(record.updated)),
  };
  if (record.completed === true) clean.completed = true;
  if (Number.isFinite(record.markedAt)) clean.markedAt = record.markedAt;
  return clean;
}

function cleanMetas(list, max = 5000) {
  const out = [];
  for (const meta of Array.isArray(list) ? list.slice(0, max) : []) {
    try {
      out.push(cleanMedia(meta));
    } catch {
      /* A malformed entry is skipped, not allowed to fail the restore. */
    }
  }
  return out;
}

function cleanBucket(bucket) {
  const source = isObject(bucket) ? bucket : {};
  const progress = {};
  if (isObject(source.progress))
    for (const [key, record] of Object.entries(source.progress).slice(
      0,
      20000,
    )) {
      const clean = cleanRecord(record, key);
      if (clean) progress[key] = clean;
    }
  const queue = [];
  const seen = new Set();
  for (const item of Array.isArray(source.queue)
    ? source.queue.slice(0, 200)
    : []) {
    try {
      const meta = cleanMedia(item?.meta);
      if (typeof item.videoId !== "string" || !item.videoId) continue;
      const key = queueKey(meta.type, item.videoId);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({
        key,
        meta,
        videoId: item.videoId.slice(0, 1000),
        label: String(item.label || "").slice(0, 200),
        added: finite(item.added, Date.now()),
      });
    } catch {
      /* skip */
    }
  }
  const connectedLists = (
    Array.isArray(source.connectedLists) ? source.connectedLists : []
  )
    .slice(0, 50)
    .filter(
      (list) =>
        isObject(list) && shortText(list.key, 100) && shortText(list.name, 200),
    )
    .map((list) => ({
      key: list.key,
      service: shortText(list.service, 40) ? list.service : "",
      name: list.name,
      metas: cleanMetas(list.metas, 2000),
    }));
  let settings = { ...DEFAULT_SETTINGS };
  if (isObject(source.settings)) {
    try {
      settings = safeSettings(source.settings, { ...DEFAULT_SETTINGS });
    } catch {
      settings = safeSettings(
        { ...source.settings, serverUrl: DEFAULT_SETTINGS.serverUrl },
        { ...DEFAULT_SETTINGS },
      );
    }
  }
  return {
    favorites: cleanMetas(source.favorites),
    progress,
    queue,
    connectedLists,
    collections: cleanCollections(source.collections),
    settings,
  };
}

function cleanProfiles(input) {
  const source = isObject(input) ? input : {};
  const list = [];
  for (const profile of Array.isArray(source.list)
    ? source.list.slice(0, 6)
    : []) {
    if (!isObject(profile) || !/^[\w-]{1,40}$/.test(profile.id || "")) continue;
    if (list.some((entry) => entry.id === profile.id)) continue;
    const name = String(profile.name || "")
      .trim()
      .slice(0, 40);
    if (!name) continue;
    const clean = {
      id: profile.id,
      name,
      avatar: AVATARS.includes(profile.avatar) ? profile.avatar : AVATARS[0],
      createdAt: finite(profile.createdAt, Date.now()),
    };
    if (
      isObject(profile.pin) &&
      /^[a-f\d]{32}$/i.test(profile.pin.salt || "") &&
      /^[a-f\d]{64}$/i.test(profile.pin.hash || "")
    )
      clean.pin = { salt: profile.pin.salt, hash: profile.pin.hash };
    if (Array.isArray(profile.lockedRooms))
      clean.lockedRooms = profile.lockedRooms.filter((room) =>
        LOCKABLE_ROOMS.includes(room),
      );
    if (typeof profile.hideAdult === "boolean")
      clean.hideAdult = profile.hideAdult;
    list.push(clean);
  }
  if (!list.length)
    throw new Error("النسخة الاحتياطية لا تحتوي على ملف شخصي صالح");
  const data = {};
  for (const profile of list)
    data[profile.id] = cleanBucket(source.data?.[profile.id]);
  const active = list.some((profile) => profile.id === source.active)
    ? source.active
    : list[0].id;
  return { list, active, data };
}

function cleanAddons(list) {
  const out = [];
  for (const addon of Array.isArray(list) ? list.slice(0, 200) : []) {
    try {
      const transportUrl = normalizeAddon(addon.transportUrl);
      if (out.some((entry) => entry.transportUrl === transportUrl)) continue;
      out.push({
        transportUrl,
        manifest: validateManifest(addon.manifest),
        enabled: addon.enabled !== false,
      });
    } catch {
      /* skip */
    }
  }
  return out;
}

function cleanLiveSources(list) {
  const out = [];
  for (const source of Array.isArray(list) ? list.slice(0, 12) : []) {
    if (!isObject(source) || !/^[a-f\d]{24}$/.test(source.id || "")) continue;
    if (!["m3u", "xtream"].includes(source.kind)) continue;
    const name = String(source.name || "")
      .trim()
      .slice(0, 80);
    if (!name) continue;
    try {
      const clean = {
        id: source.id,
        kind: source.kind,
        name,
        enabled: source.enabled !== false,
        addedAt: finite(source.addedAt, Date.now()),
      };
      if (source.kind === "m3u") {
        clean.url = webUrl(source.url).toString();
        if (source.epgUrl) clean.epgUrl = webUrl(source.epgUrl).toString();
      } else {
        if (
          !shortText(source.username, 256) ||
          !shortText(source.password, 256)
        )
          continue;
        clean.host = webUrl(source.host).toString().replace(/\/$/, "");
        clean.username = source.username;
        clean.password = source.password;
      }
      out.push(clean);
    } catch {
      /* skip */
    }
  }
  return out;
}

function cleanSecretBag(input, ids) {
  // Tokens and keys are opaque. Keep only known services and plain values, so
  // a crafted file cannot smuggle structure the app never wrote.
  const out = {};
  if (!isObject(input)) return out;
  for (const id of ids) {
    const value = input[id];
    if (!isObject(value)) continue;
    const clean = {};
    for (const [key, field] of Object.entries(value)) {
      if (typeof field === "string" && field.length <= 8192) clean[key] = field;
      else if (typeof field === "boolean" || Number.isFinite(field))
        clean[key] = field;
      else if (key === "token" && isObject(field)) {
        const token = {};
        for (const [name, part] of Object.entries(field))
          if (typeof part === "string" && part.length <= 8192)
            token[name] = part;
          else if (Number.isFinite(part)) token[name] = part;
        if (token.access_token) clean.token = token;
      } else if (key === "pending" && Array.isArray(field))
        clean.pending = field.filter(isObject).slice(-500);
      else if (key === "sent" && Array.isArray(field))
        clean.sent = field
          .filter((entry) => typeof entry === "string")
          .slice(-5000);
    }
    out[id] = clean;
  }
  return out;
}

function cleanNotify(input) {
  const out = {};
  if (!isObject(input)) return out;
  try {
    if (input.discord?.webhook)
      out.discord = {
        webhook: validDiscordWebhook(input.discord.webhook),
        enabled: input.discord.enabled !== false,
        status: "untested",
      };
  } catch {
    /* skip */
  }
  try {
    if (input.telegram?.token && input.telegram?.chatId)
      out.telegram = {
        token: validTelegramToken(input.telegram.token),
        chatId: validTelegramChat(input.telegram.chatId),
        enabled: input.telegram.enabled !== false,
        status: "untested",
      };
  } catch {
    /* skip */
  }
  return out;
}

/** What a restore would bring back, for the confirmation screen. */
export function summarizeBackup(header, payload) {
  const profiles = Array.isArray(payload.profiles?.list)
    ? payload.profiles.list
    : [];
  const buckets = Object.values(payload.profiles?.data || {});
  const count = (key) =>
    buckets.reduce(
      (total, bucket) =>
        total +
        (Array.isArray(bucket?.[key])
          ? bucket[key].length
          : isObject(bucket?.[key])
            ? Object.keys(bucket[key]).length
            : 0),
      0,
    );
  return {
    createdAt: header.createdAt,
    app: header.app,
    includesSecrets: !!header.includesSecrets,
    profiles: profiles.map((profile) =>
      String(profile?.name || "").slice(0, 40),
    ),
    titles: count("favorites"),
    progress: count("progress"),
    queue: count("queue"),
    collections: count("collections"),
    addons: Array.isArray(payload.addons) ? payload.addons.length : 0,
    liveSources: Array.isArray(payload.live?.sources)
      ? payload.live.sources.length
      : 0,
  };
}

/**
 * The state a restore produces. Everything the backup carries replaces the
 * current viewer data. Secrets the backup does not carry are kept from this
 * installation, so restoring a data-only backup on the same PC does not sign
 * the viewer out of everything they already set up.
 */
export function restoreState(current, payload) {
  if (!isObject(payload)) throw new Error("النسخة الاحتياطية تالفة");
  const profiles = cleanProfiles(payload.profiles);
  // Machine-specific paths belong to this installation, not to the backup.
  for (const id of Object.keys(profiles.data))
    for (const key of MACHINE_SETTINGS)
      profiles.data[id].settings[key] = current.settings?.[key] || "";
  const hotkeys = {};
  if (isObject(payload.hotkeys))
    for (const action of HOTKEY_ACTIONS)
      if (validBinding(payload.hotkeys[action.id]))
        hotkeys[action.id] = payload.hotkeys[action.id];
  const restoredAddons = cleanAddons(payload.addons);
  // Configured addons are secrets. When the backup did not carry them, keep
  // the ones this installation already has alongside the restored list.
  const keptAddons = (current.addons || []).filter(
    (addon) =>
      !isPlainAddon(addon.transportUrl) &&
      !restoredAddons.some(
        (entry) => entry.transportUrl === addon.transportUrl,
      ),
  );
  const carries = (key) => Object.hasOwn(payload, key);
  const liveSources =
    Array.isArray(payload.live?.sources) && payload.live.sources.length
      ? cleanLiveSources(payload.live.sources)
      : current.live?.sources || [];
  return {
    ...current,
    profiles,
    hotkeys,
    discordAppId: /^\d{17,20}$/.test(payload.discordAppId || "")
      ? payload.discordAppId
      : current.discordAppId || "",
    addons: [...restoredAddons, ...keptAddons],
    live: {
      sources: liveSources,
      favorites: (Array.isArray(payload.live?.favorites)
        ? payload.live.favorites
        : []
      )
        .filter((key) => /^[a-f\d]{24}$/.test(key))
        .slice(0, 5000),
    },
    auth:
      carries("auth") &&
      isObject(payload.auth) &&
      shortText(payload.auth.authKey)
        ? {
            authKey: payload.auth.authKey,
            email: String(payload.auth.email || "").slice(0, 320),
            name: String(payload.auth.name || "").slice(0, 200),
          }
        : current.auth || null,
    providers: carries("providers")
      ? cleanSecretBag(payload.providers, [
          "tmdb",
          "omdb",
          "mdblist",
          "fanart",
          "theintrodb",
        ])
      : current.providers || {},
    integrations: carries("integrations")
      ? cleanSecretBag(payload.integrations, [
          "trakt",
          "letterboxd",
          "simkl",
          "spotify",
        ])
      : current.integrations || {},
    notify: carries("notify")
      ? cleanNotify(payload.notify)
      : current.notify || {},
  };
}
