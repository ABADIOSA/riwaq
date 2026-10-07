import { DEFAULT_SUBTITLE_STYLE, safeSubtitleStyle } from "./subtitles.mjs";
import { cleanSavedThemes, safeAppearance } from "./appearance.mjs";
import { cleanAddonPriority, cleanStreamFilters } from "./stream-prefs.mjs";
import {
  cleanBadgeArt,
  cleanBadgeRules,
  cleanHiddenBadges,
} from "./badges.mjs";
import { cleanServices } from "./services.mjs";
import { cleanHudHidden } from "./hud-layout.mjs";
import { PRAYER_CITIES, PRAYER_METHODS } from "./prayer.mjs";
import { LOGO_MODES } from "./logos.mjs";
import { HOME_GROUPING, cleanSmartHidden } from "./smart-groups.mjs";
import { cleanFeedHidden } from "./feed.mjs";
import { cleanCountdowns } from "./countdown.mjs";
import { cleanSeriesMemory } from "./series-memory.mjs";
import { cleanSkipExcept } from "./skip-segments.mjs";
import { cleanSeenVersion } from "./whats-new.mjs";
import { cleanTaste } from "./taste.mjs";
import { cleanMusic } from "./music.mjs";
import { cleanThemeSkip } from "./theme-song.mjs";
import {
  DEFAULT_HOME_SECTIONS,
  safeCatalogKeys,
  safeHomeSections,
} from "./home.mjs";
import {
  AUDIO_PROFILE_IDS,
  BUFFER_SIZES,
  DISPLAY_PANELS,
  HDR_MODES,
  HWDEC_MODES,
  RENDERERS,
  VIDEO_QUALITY,
  VOLUME_MAX,
  cleanAudioDevice,
} from "./player-tuning.mjs";
import { BANDWIDTH_CAPS } from "./stream-engine.mjs";
import { createHash } from "node:crypto";

export const CINEMETA = "https://v3-cinemeta.strem.io/manifest.json";
export const DEFAULT_SETTINGS = {
  accent: "amber",
  quality: "2160",
  hideCam: true,
  subtitleLanguage: "ara,ar,eng,en",
  audioLanguage: "ara,ar,eng,en",
  subtitleSize: 44,
  subtitleDelay: 0,
  hardwareDecoding: true,
  hdr: false,
  mpvPath: "",
  serverUrl: "http://127.0.0.1:11470",
  autoplay: false,
  layout: "cinematic",
  interfaceStyle: "riwaq",
  sessionBudget: 90,
  sessionMood: "any",
  taste: cleanTaste({}),
  // A title's page takes its colours from the title (core/title-theme.mjs).
  titleTheme: "artwork",
  // The music room: platforms and saved links (core/music.mjs).
  music: cleanMusic({}),
  // A title's theme song on its page (core/theme-song.mjs): played at once,
  // offered as a button, or off; its volume; titles whose song was refused.
  themeSong: "auto",
  // With Spotify linked (Premium), the full track plays through it.
  themeSongSource: "auto",
  // Official only (the title's soundtrack album or composer), or relaxed.
  themeSongTrust: "official",
  themeSongVolume: 35,
  themeSongSkip: [],
  cardStyle: "glass",
  cardSize: "comfortable",
  showHero: true,
  showRatings: true,
  reduceMotion: false,
  hideWatched: false,
  metadataLanguage: "ar-SA",
  region: "SA",
  subtitlePosition: 95,
  pauseOnMinimize: true,
  seekStep: 10,
  // The long step (Shift with the arrows), in seconds.
  seekLongStep: 60,
  seekThumbnails: "local",
  holdSpeed: 2,
  streamSafety: "strict",
  preferCached: true,
  streamSizeLimit: 0,
  skipIntro: "button",
  skipOutro: "off",
  // Recaps have their own choice; the skip button can step aside after a
  // few seconds; anime times can come from AniSkip (core/skip-online.mjs).
  skipRecap: "button",
  skipHideAfter: 0,
  skipOnline: false,
  // The picture and sound (core/player-tuning.mjs): MPV's quality profile,
  // decoder, renderer, compatibility modes, the display's panel, NVIDIA RTX
  // Video, and the sound's profile, normalising, downmix, ceiling and output.
  videoQuality: "balanced",
  hwdec: "auto",
  renderer: "gpu-next",
  simpleColor: false,
  linelessVideo: false,
  displayPanel: "auto",
  // How HDR reaches the display (core/player-tuning.mjs HDR_MODES).
  hdrMode: "tonemap",
  // The read-ahead buffer for network sources, and Dolby/DTS passthrough.
  bufferSize: "auto",
  audioPassthrough: false,
  rtxUpscale: false,
  rtxHdr: false,
  audioProfile: "flat",
  audioNormalize: false,
  audioDownmix: false,
  volumeMax: 150,
  audioDevice: "auto",
  // A connection speed cap in Mbps (0 for none); heavier streams rank lower.
  bandwidthCap: 0,
  // The HUD: the stream's quality under the title, controls on pause, the
  // sleep timer in the top bar, a volume popup while the controls sleep, and
  // full screen kept after the viewing ends.
  hudQuality: true,
  hudQualityStyle: "chips",
  hudShowOnPause: true,
  hudSleep: true,
  volumeOsd: true,
  volumeOsdPosition: "center",
  keepFullscreen: false,
  // Series whose intro and outro are never skipped on their own.
  skipExcept: [],
  shaderPath: "",
  sleepTimer: 0,
  shader: "none",
  toneMapping: "auto",
  discordPresence: false,
  presenceDetail: "title",
  notifyOnFinish: false,
  liveBufferSeconds: 4,
  epgHours: 4,
  autoFullscreen: true,
  playerOverlay: true,
  autoFailover: true,
  videoFill: false,
  subtitleKind: "standard",
  autoSubtitles: "preferred",
  subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
  // null until the viewer designs one; the older accent choice applies then.
  appearance: null,
  homeSections: [...DEFAULT_HOME_SECTIONS],
  homeOrder: [],
  homeHidden: [],
  // The window: Windows' own title bar, a hybrid bar with native-looking
  // buttons drawn by Windows over Riwaq, or Riwaq's own bar and buttons.
  // A frame change applies on the next start.
  windowFrame: "native",
  windowControls: "filled",
  frostTopBar: false,
  dragAnywhere: false,
  // Minutes idle before the ambient screensaver, 0 for never.
  screensaver: 0,
  screensaverClock: true,
  savedThemes: [],
  // Sources: which links, which order, which saved filter, and how the
  // picker and its badges look.
  sourceMode: "all",
  streamOrder: "riwaq",
  streamOrderInside: "addon",
  addonPriority: [],
  streamFilters: [],
  activeFilter: "",
  pickerLayout: "detailed",
  pickerReleaseName: true,
  badgesOn: true,
  badgesHidden: [],
  badgeRules: [],
  // Pictures for the built-in chips, from a badge pack.
  badgeArt: {},
  // Streaming services the viewer pays for, shown as home rows.
  streamingServices: [],
  // Series: hide episode titles not reached yet.
  spoilerGuard: "off",
  // The player HUD: a preset of visible controls, or the viewer's own.
  hudLayout: "full",
  hudHidden: [],
  // Award trophies grouped by family on details pages.
  awardIcons: true,
  // A title's sources appear after Play; true shows them on opening.
  sourcesOnOpen: false,
  // Play shows the sources in a window over the title page.
  sourcesPopup: true,
  // Prayer times, computed on this machine (core/prayer.mjs).
  prayerOn: true,
  prayerCity: "jeddah",
  prayerCustom: null,
  prayerMethod: "ummalqura",
  prayerAsr: "standard",
  prayerWarn: true,
  prayerHeadsUp: true,
  prayerPause: false,
  // A series' source, audio and subtitle choices carried to its next
  // episode (core/series-memory.mjs). Identities only, never links.
  rememberSeries: true,
  // The last release whose highlights the viewer saw (core/whats-new.mjs).
  seenVersion: "",
  seriesMemory: {},
  // Countdowns pinned to the home page (core/countdown.mjs).
  countdowns: [],
  // Logos in place of typed names (core/logos.mjs): arabic, original, text.
  titleLogos: "arabic",
  // The home hero moves to the next title on its own, paused on hover.
  heroAutoplay: true,
  // Home's layout (core/smart-groups.mjs, core/feed.mjs): Riwaq's own rows
  // until the viewer builds collections ("auto"), always ("riwaq"), the
  // addons' catalogs gathered into groups ("groups"), or one row per catalog
  // ("rows"); the groups and Riwaq rows the viewer hid.
  homeGrouping: "auto",
  smartHidden: [],
  feedHidden: [],
};
export const keyFor = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
export function webUrl(value, { httpsOnly = false } = {}) {
  if (typeof value !== "string" || value.length > 16000)
    throw new Error("الرابط غير صالح");
  const url = new URL(value);
  if (
    !(httpsOnly ? ["https:"] : ["http:", "https:"]).includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("استخدم رابط HTTP أو HTTPS صالحاً");
  return url;
}
export function normalizeAddon(input) {
  const url = webUrl(
    String(input)
      .trim()
      .replace(/^stremio:\/\//i, "https://"),
  );
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/manifest.json"))
    url.pathname += "/manifest.json";
  return url.toString();
}
export function validateManifest(m) {
  if (
    !m ||
    typeof m.id !== "string" ||
    !m.id ||
    typeof m.name !== "string" ||
    !Array.isArray(m.resources) ||
    !Array.isArray(m.types) ||
    !m.types.every((t) => typeof t === "string") ||
    !m.resources.every(
      (r) =>
        typeof r === "string" ||
        (r &&
          typeof r.name === "string" &&
          Array.isArray(r.types) &&
          r.types.every((t) => typeof t === "string") &&
          (!r.idPrefixes ||
            (Array.isArray(r.idPrefixes) &&
              r.idPrefixes.every((p) => typeof p === "string")))),
    ) ||
    (m.idPrefixes &&
      (!Array.isArray(m.idPrefixes) ||
        !m.idPrefixes.every((p) => typeof p === "string"))) ||
    (m.catalogs &&
      (!Array.isArray(m.catalogs) ||
        !m.catalogs.every(
          (c) =>
            c &&
            typeof c.id === "string" &&
            typeof c.type === "string" &&
            (!c.extra ||
              (Array.isArray(c.extra) &&
                c.extra.every(
                  (e) =>
                    e &&
                    typeof e.name === "string" &&
                    (!e.options ||
                      (Array.isArray(e.options) &&
                        e.options.every((o) => typeof o === "string"))),
                ))),
        )))
  )
    throw new Error("الإضافة لا تحتوي على ملف manifest صالح");
  return m;
}
export function accepts(manifest, resource, type, id) {
  return (manifest.resources || []).some((entry) => {
    if ((typeof entry === "string" ? entry : entry.name) !== resource)
      return false;
    const types = typeof entry === "string" ? manifest.types : entry.types;
    const prefixes =
      typeof entry === "string" ? manifest.idPrefixes : entry.idPrefixes;
    return (
      (types || []).includes(type) &&
      (!prefixes?.length || prefixes.some((prefix) => id.startsWith(prefix)))
    );
  });
}
export function resourceUrl(transport, resource, type, id, extras = {}) {
  const url = webUrl(transport);
  const extra = Object.entries(extras)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  url.pathname =
    url.pathname.replace(/\/manifest\.json$/, "") +
    "/" +
    [resource, type, id].map(encodeURIComponent).join("/") +
    (extra ? "/" + extra : "") +
    ".json";
  return url.toString();
}
export function catalogExtras(catalog, search = "", genre = "", skip = 0) {
  const extras = {};
  const definitions = catalog.extra || [];
  if (search && !definitions.some((e) => e.name === "search")) return null;
  if (search) extras.search = search;
  if (genre && definitions.some((e) => e.name === "genre"))
    extras.genre = genre;
  if (skip && definitions.some((e) => e.name === "skip")) extras.skip = skip;
  for (const def of definitions) {
    if (!def.isRequired || extras[def.name]) continue;
    if (def.name === "search" || !def.options?.length) return null;
    extras[def.name] = def.options[0];
  }
  return extras;
}
export function mergeAddons(local, incoming) {
  const result = [...local];
  for (const addon of incoming) {
    const normalized = {
      ...addon,
      transportUrl: normalizeAddon(addon.transportUrl),
    };
    const index = result.findIndex(
      (a) => a.transportUrl === normalized.transportUrl,
    );
    if (index < 0) result.push({ ...normalized, enabled: true });
    else result[index] = { ...result[index], manifest: normalized.manifest };
  }
  return result;
}
export function torrentUrl(stream, base) {
  if (!/^[a-f\d]{40}$/i.test(stream.infoHash || ""))
    throw new Error("معرّف التورنت غير صالح");
  const url = webUrl(base);
  if (
    stream.fileIdx !== undefined &&
    (!Number.isInteger(stream.fileIdx) || stream.fileIdx < 0)
  )
    throw new Error("رقم الملف غير صالح");
  url.pathname =
    url.pathname.replace(/\/$/, "") +
    "/" +
    stream.infoHash.toLowerCase() +
    "/" +
    (stream.fileIdx ?? -1);
  for (const source of stream.sources || []) {
    if (typeof source !== "string") continue;
    const tracker = source.replace(/^tracker:/, "");
    if (/^(udp|https?|wss?):\/\//i.test(tracker))
      url.searchParams.append("tr", tracker);
  }
  return url.toString();
}
export function continueWatching(progress) {
  return Object.values(progress)
    .filter(
      (p) => p.position > 10 && (!p.duration || p.position / p.duration < 0.95),
    )
    .sort((a, b) => b.updated - a.updated);
}
export function safeSettings(input, current = DEFAULT_SETTINGS) {
  const next = { ...current };
  for (const k of [
    "hideCam",
    "hardwareDecoding",
    "hdr",
    "autoplay",
    "showHero",
    "showRatings",
    "reduceMotion",
    "hideWatched",
    "pauseOnMinimize",
    "preferCached",
    "discordPresence",
    "notifyOnFinish",
    "autoFullscreen",
    "playerOverlay",
    "autoFailover",
    "videoFill",
    "frostTopBar",
    "dragAnywhere",
    "screensaverClock",
    "pickerReleaseName",
    "badgesOn",
    "awardIcons",
    "sourcesOnOpen",
    "sourcesPopup",
    "prayerOn",
    "prayerWarn",
    "prayerHeadsUp",
    "prayerPause",
    "heroAutoplay",
    "rememberSeries",
    "skipOnline",
    "simpleColor",
    "linelessVideo",
    "rtxUpscale",
    "rtxHdr",
    "audioNormalize",
    "audioDownmix",
    "audioPassthrough",
    "hudQuality",
    "hudShowOnPause",
    "hudSleep",
    "volumeOsd",
    "keepFullscreen",
  ])
    if (typeof input[k] === "boolean") next[k] = input[k];
  if (
    ["amber", "teal", "violet", "noir", "nord", "rose", "forest"].includes(
      input.accent,
    )
  )
    next.accent = input.accent;
  if (["2160", "1080", "720"].includes(input.quality))
    next.quality = input.quality;
  for (const k of ["subtitleLanguage", "audioLanguage"])
    if (typeof input[k] === "string" && /^[a-z,-]{0,100}$/.test(input[k]))
      next[k] = input[k];
  if (Number.isFinite(input.subtitleSize))
    next.subtitleSize = Math.max(18, Math.min(80, input.subtitleSize));
  if (Number.isFinite(input.subtitleDelay))
    next.subtitleDelay = Math.max(-60, Math.min(60, input.subtitleDelay));
  if (Number.isFinite(input.streamSizeLimit))
    next.streamSizeLimit = Math.max(
      0,
      Math.min(200, Math.round(input.streamSizeLimit)),
    );
  if (Number.isFinite(input.sleepTimer))
    next.sleepTimer = Math.max(0, Math.min(240, Math.round(input.sleepTimer)));
  if (Number.isFinite(input.liveBufferSeconds))
    next.liveBufferSeconds = Math.max(
      0,
      Math.min(30, Math.round(input.liveBufferSeconds)),
    );
  if (typeof input.audioDevice === "string")
    next.audioDevice = cleanAudioDevice(input.audioDevice) || "auto";
  if (typeof input.serverUrl === "string")
    next.serverUrl = webUrl(input.serverUrl).toString().replace(/\/$/, "");
  for (const [key, values] of Object.entries({
    layout: ["cinematic", "sidebar", "topbar"],
    interfaceStyle: ["riwaq", "classic"],
    sessionBudget: [30, 60, 90, 120, 180],
    sessionMood: ["any", "light", "thrill", "wonder", "depth"],
    streamSafety: ["strict", "balanced", "off"],
    skipIntro: ["off", "button", "auto"],
    seekThumbnails: ["off", "local", "all"],
    skipOutro: ["off", "button", "auto"],
    skipRecap: ["off", "button", "auto"],
    skipHideAfter: [0, 5, 10, 15, 30],
    videoQuality: VIDEO_QUALITY,
    hwdec: HWDEC_MODES,
    renderer: RENDERERS,
    displayPanel: DISPLAY_PANELS,
    hdrMode: HDR_MODES,
    bufferSize: BUFFER_SIZES,
    audioProfile: AUDIO_PROFILE_IDS,
    volumeMax: VOLUME_MAX,
    bandwidthCap: BANDWIDTH_CAPS,
    hudQualityStyle: ["chips", "bar"],
    volumeOsdPosition: ["center", "top", "top-left", "top-right"],
    presenceDetail: ["title", "generic", "off"],
    shader: ["none", "sharp", "anime", "film", "custom"],
    toneMapping: ["auto", "bt.2446a", "hable", "mobius", "reinhard", "off"],
    epgHours: [2, 4, 6, 12],
    cardStyle: ["glass", "flat", "outline"],
    cardSize: ["compact", "comfortable", "large"],
    metadataLanguage: ["ar-SA", "en-US", "ja-JP", "fr-FR"],
    region: ["SA", "AE", "EG", "US", "GB"],
    seekStep: [5, 10, 15, 30],
    seekLongStep: [30, 60, 90, 120, 300],
    holdSpeed: [0, 1.5, 2, 3],
    subtitleKind: ["standard", "sdh", "forced"],
    autoSubtitles: ["off", "preferred"],
    windowFrame: ["native", "hybrid", "riwaq"],
    windowControls: ["filled", "glass", "clean"],
    screensaver: [0, 1, 3, 5, 10, 15],
    sourceMode: ["all", "direct", "p2p"],
    streamOrder: ["riwaq", "addon"],
    streamOrderInside: ["addon", "riwaq"],
    titleTheme: ["artwork", "genre", "off"],
    themeSong: ["auto", "button", "off"],
    themeSongSource: ["auto", "previews"],
    themeSongTrust: ["official", "relaxed"],
    themeSongVolume: [10, 20, 35, 50, 70, 100],
    pickerLayout: ["detailed", "compact"],
    spoilerGuard: ["off", "titles"],
    hudLayout: ["full", "minimal", "cinema", "custom"],
    prayerCity: [...PRAYER_CITIES.map((c) => c.id), "custom"],
    prayerMethod: Object.keys(PRAYER_METHODS),
    prayerAsr: ["standard", "hanafi"],
    titleLogos: LOGO_MODES,
    homeGrouping: HOME_GROUPING,
  }))
    if (values.includes(input[key])) next[key] = input[key];
  if (Number.isFinite(input.subtitlePosition))
    next.subtitlePosition = Math.round(
      Math.max(50, Math.min(100, input.subtitlePosition)),
    );
  if (input.appearance && typeof input.appearance === "object")
    next.appearance = safeAppearance(
      input.appearance,
      current.appearance || undefined,
    );
  if (Array.isArray(input.savedThemes))
    next.savedThemes = cleanSavedThemes(input.savedThemes);
  if (Array.isArray(input.streamFilters))
    next.streamFilters = cleanStreamFilters(input.streamFilters);
  if (Array.isArray(input.addonPriority))
    next.addonPriority = cleanAddonPriority(input.addonPriority);
  if (Array.isArray(input.streamingServices))
    next.streamingServices = cleanServices(input.streamingServices);
  if (input.prayerCustom && typeof input.prayerCustom === "object") {
    const lat = Number(input.prayerCustom.lat);
    const lng = Number(input.prayerCustom.lng);
    const tz = Number(input.prayerCustom.tz);
    if (
      Number.isFinite(lat) &&
      Math.abs(lat) <= 66 &&
      Number.isFinite(lng) &&
      Math.abs(lng) <= 180 &&
      Number.isFinite(tz) &&
      tz >= -12 &&
      tz <= 14
    )
      next.prayerCustom = {
        lat: Math.round(lat * 10000) / 10000,
        lng: Math.round(lng * 10000) / 10000,
        tz: Math.round(tz * 4) / 4,
      };
  }
  if (next.prayerCity === "custom" && !next.prayerCustom)
    next.prayerCity = DEFAULT_SETTINGS.prayerCity;
  if (Array.isArray(input.smartHidden))
    next.smartHidden = cleanSmartHidden(input.smartHidden);
  if (Array.isArray(input.feedHidden))
    next.feedHidden = cleanFeedHidden(input.feedHidden);
  if (typeof input.seenVersion === "string")
    next.seenVersion = cleanSeenVersion(input.seenVersion);
  if (Array.isArray(input.skipExcept))
    next.skipExcept = cleanSkipExcept(input.skipExcept);
  if (input.seriesMemory && typeof input.seriesMemory === "object")
    next.seriesMemory = cleanSeriesMemory(input.seriesMemory);
  if (input.taste && typeof input.taste === "object")
    next.taste = cleanTaste(input.taste);
  if (input.music && typeof input.music === "object")
    next.music = cleanMusic(input.music);
  if (Array.isArray(input.themeSongSkip))
    next.themeSongSkip = cleanThemeSkip(input.themeSongSkip);
  if (Array.isArray(input.countdowns))
    next.countdowns = cleanCountdowns(input.countdowns);
  if (Array.isArray(input.hudHidden))
    next.hudHidden = cleanHudHidden(input.hudHidden);
  if (Array.isArray(input.badgeRules))
    next.badgeRules = cleanBadgeRules(input.badgeRules);
  if (input.badgeArt && typeof input.badgeArt === "object")
    next.badgeArt = cleanBadgeArt(input.badgeArt);
  if (Array.isArray(input.badgesHidden))
    next.badgesHidden = cleanHiddenBadges(input.badgesHidden);
  if (typeof input.activeFilter === "string")
    next.activeFilter = input.activeFilter;
  // An active filter must be one the viewer still has.
  if (!(next.streamFilters || []).some((f) => f.id === next.activeFilter))
    next.activeFilter = "";
  if (Array.isArray(input.homeSections))
    next.homeSections = safeHomeSections(input.homeSections);
  if (Array.isArray(input.homeSeen))
    next.homeSeen = safeHomeSections(input.homeSeen);
  for (const key of ["homeOrder", "homeHidden"])
    if (Array.isArray(input[key])) next[key] = safeCatalogKeys(input[key]);
  if (input.subtitleStyle && typeof input.subtitleStyle === "object")
    next.subtitleStyle = safeSubtitleStyle(
      input.subtitleStyle,
      current.subtitleStyle || DEFAULT_SUBTITLE_STYLE,
    );
  return next;
}
