import { languageOf } from "../../core/subtitles.mjs";
import React, { useState, useEffect, useRef } from "react";
import {
  Plus,
  Check,
  Play,
  RefreshCw,
  ChevronLeft,
  Puzzle,
  Subtitles,
  Star,
  LoaderCircle,
  Zap,
  Users,
  ShieldCheck,
  EyeOff,
  Info,
  ListPlus,
  CheckCheck,
  Undo2,
  Clapperboard,
  Folders,
  Shuffle,
  ArrowRight,
  Calendar,
  Clock,
  Globe2,
  Award as AwardIcon,
  Languages,
  PenLine,
  Video,
  History,
  Search,
  Music2,
  Pause,
  VolumeX,
} from "lucide-react";
import ArtworkGallery from "./ArtworkGallery.jsx";
import { TasteFeedback } from "./TasteDiscovery.jsx";
import { AddToCollection } from "./Collections.jsx";
import { titlePlaces } from "../../core/collections.mjs";
import { trailerOf } from "../../core/credits.mjs";
import { shuffleCandidates, shufflePick } from "../../core/shuffle.mjs";

/** Episodes already shuffled to, per series, for this session. */
const shuffled = new Map();
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
import { spoilerIds } from "../../core/spoilers.mjs";
import { episodeDetails } from "../../core/season-details.mjs";
import { runtimeMinutes } from "../../core/prayer.mjs";
import { EndsAt } from "./Prayer.jsx";
import { TitleCountdown } from "./Countdown.jsx";
import { releaseTarget } from "../../core/countdown.mjs";
import { chipArt } from "../../core/badges.mjs";
import { ArtChip, RuleBadge } from "./StreamBadge.jsx";
import {
  SOURCE_CHIPS,
  addonSections,
  chipCounts,
  filterSources,
} from "../../core/source-view.mjs";
import { IconButton, Busy, Empty, Modal, ScrollRow } from "./UI.jsx";
import { TitleLogo } from "./TitleLogo.jsx";
import { dominantColor, titleTheme } from "../../core/title-theme.mjs";
import {
  externalMusicPlaying,
  onAudio,
  playPreview,
  stopAudio,
  toggleAudio,
  videoIsPlaying,
} from "../lib/audio.js";
import { luminance, resolveAppearance } from "../../core/appearance.mjs";
import {
  platformName,
  preferredPlatform,
  soundtrackQuery,
} from "../../core/music.mjs";
import { api, call } from "../lib/api.js";
import {
  queueKey,
  releasedEpisodes,
  isCompleted,
} from "../../core/library.mjs";
import {
  arabicCount,
  EPISODES,
  READY_SOURCES,
  SOURCES,
} from "../../core/arabic.mjs";
import {
  CastRail,
  CollectionRails,
  CreditsFacts,
  ExploreModal,
  useCredits,
  AwardTrophies,
} from "./Credits.jsx";
export default function Details({
  selection,
  state,
  onClose,
  onFavorite,
  update,
  act,
  notice,
  onPlayer,
  onOpenTitle,
  onSettings,
}) {
  const [meta, setMeta] = useState(selection.meta),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [videoId, setVideoId] = useState(selection.videoId || ""),
    [season, setSeason] = useState(1),
    [shuffleAll, setShuffleAll] = useState(false),
    [result, setResult] = useState(null),
    [streamsLoading, setStreamsLoading] = useState(false),
    // Sources from addons that answered after the list was shown.
    [arrived, setArrived] = useState(0),
    [sourceQuery, setSourceQuery] = useState(""),
    [sourceChips, setSourceChips] = useState([]),
    [folded, setFolded] = useState([]),
    asked = useRef(null),
    // The colour read from the title's artwork, for its page theme.
    [artColor, setArtColor] = useState(null),
    // The title's theme song (core/theme-song.mjs) and whether it plays.
    [song, setSong] = useState(null),
    [songPlaying, setSongPlaying] = useState(false),
    songOwner = useRef(`page-${Math.random().toString(36).slice(2)}`),
    [quality, setQuality] = useState(""),
    [showOutside, setShowOutside] = useState(false),
    [showDropped, setShowDropped] = useState(false),
    [explained, setExplained] = useState(""),
    [playing, setPlaying] = useState(""),
    [subs, setSubs] = useState([]),
    [subLoading, setSubLoading] = useState(false),
    [request, setRequest] = useState(0),
    [explore, setExplore] = useState(null),
    [collecting, setCollecting] = useState(false),
    [seasonInfo, setSeasonInfo] = useState(null),
    // Sources load only once the viewer presses play, unless they asked for
    // them on opening (Details pages settings) or were sent here to choose.
    [showSources, setShowSources] = useState(
      selection.showSources === true || state.settings.sourcesOnOpen === true,
    );
  // Play opens the sources in a window over the page, unless the viewer
  // keeps them on the page (sourcesPopup off) or shows them on opening.
  const popupMode =
    state.settings.sourcesPopup !== false &&
    state.settings.sourcesOnOpen !== true;
  const [sourcesOpen, setSourcesOpen] = useState(
    popupMode && selection.showSources === true,
  );
  const sourcesRef = useRef(null);
  // Credits wait for the addon's metadata so its IMDb ID is settled.
  const { credits, error: creditsError } = useCredits(meta, !loading);
  useEffect(() => {
    let current = true;
    call("metadata", {
      type: selection.meta.type,
      id: selection.meta.id,
      flexible: selection.meta.guessed === true,
    })
      .then((data) => {
        if (!current) return;
        setMeta(data);
        const videos = episodeList(data);
        const saved = Object.values(state.progress)
          .filter((p) => p.meta.id === data.id && p.meta.type === data.type)
          .sort((a, b) => b.updated - a.updated)[0];
        const released = releasedEpisodes(data);
        const savedIndex = released.findIndex((v) => v.id === saved?.videoId);
        const resumeId = isCompleted(saved)
          ? released[savedIndex + 1]?.id
          : saved?.videoId;
        const initialId =
          selection.videoId ||
          resumeId ||
          data.behaviorHints?.defaultVideoId ||
          released.find((v) => (v.season ?? 1) > 0)?.id ||
          data.id;
        setVideoId(initialId);
        setSeason(videos.find((v) => v.id === initialId)?.season ?? 1);
      })
      .catch((e) => {
        if (current) {
          setError(e.message);
          setVideoId(selection.videoId || selection.meta.id);
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (selection.videoId) {
      setVideoId(selection.videoId);
      setSeason(
        episodeList(meta).find((v) => v.id === selection.videoId)?.season ?? 1,
      );
    }
  }, [selection.videoId]);
  useEffect(() => {
    if (!videoId || !showSources) return;
    let current = true;
    setResult(null);
    setArrived(0);
    setSourceQuery("");
    setSourceChips([]);
    setFolded([]);
    setSubs([]);
    setStreamsLoading(true);
    // What was asked, so a late report or a refresh matches this request.
    asked.current = { type: meta.type, id: videoId, seriesId: meta.id };
    call("streams", asked.current)
      .then((r) => {
        if (current) setResult(r);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setStreamsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [videoId, request, showSources]);
  // Late addons report once they settle: their sources wait behind a button
  // so the list never moves under the pointer.
  useEffect(() => {
    if (!videoId || !showSources || !api?.on) return;
    return api.on("sources", (info) => {
      const now = asked.current;
      if (!now || info?.type !== now.type || info?.id !== now.id) return;
      setResult((prev) =>
        prev
          ? {
              ...prev,
              late: [],
              failures: [...(prev.failures || []), ...(info.failed || [])],
            }
          : prev,
      );
      if (info.found > 0) setArrived(info.found);
    });
  }, [videoId, showSources]);
  // Switching the order re-ranks the answers already in hand: no new search.
  const reorder = async (order) => {
    const now = asked.current;
    const saved = await update("settings", { streamOrder: order });
    if (!saved || !now) return;
    try {
      const next = await call("streams", { ...now, again: true });
      if (asked.current === now) setResult(next);
    } catch (e) {
      setError(e.message);
    }
  };
  const addArrived = async () => {
    const now = asked.current;
    if (!now) return;
    try {
      const next = await call("streams", { ...now, again: true });
      if (asked.current !== now) return;
      setResult(next);
      setArrived(0);
    } catch (e) {
      setError(e.message);
    }
  };
  // TMDB's stills and descriptions for the season on screen (with a key).
  useEffect(() => {
    if (meta.type !== "series" || loading) return;
    let live = true;
    setSeasonInfo(null);
    call("seasonDetails", { id: meta.id, season })
      .then((info) => live && setSeasonInfo(info))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [meta.id, season, loading]);
  // Escape goes back from the page unless a dialog or the viewer has it.
  useEffect(() => {
    const onKey = (e) => {
      if (
        e.key !== "Escape" ||
        e.defaultPrevented ||
        document.querySelector("dialog[open], .gallery-viewer")
      )
        return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // The title's own colours on its page (core/title-theme.mjs). The picture
  // is read through a small canvas; a host that refuses cross-origin reads
  // leaves the genre colour.
  const themeMode = state.settings.titleTheme || "artwork";
  const artSource = imgUrl(meta.background) || imgUrl(meta.poster) || "";
  useEffect(() => {
    setArtColor(null);
    if (themeMode !== "artwork" || !artSource) return;
    let live = true;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.onload = () => {
      if (!live) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, 48, 32);
        setArtColor(dominantColor(ctx.getImageData(0, 0, 48, 32).data));
      } catch {
        setArtColor(null);
      }
    };
    img.onerror = () => live && setArtColor(null);
    img.src = artSource;
    return () => {
      live = false;
      img.onload = img.onerror = null;
    };
  }, [artSource, themeMode]);
  const look = resolveAppearance(state.settings);
  const pageTheme = titleTheme(meta, {
    mode: themeMode,
    rgb: artColor,
    light: luminance(look.colors.bg) > 0.4,
    gradient: look.gradient,
  });
  const musicPlatform = preferredPlatform(state.settings.music);
  // The theme song: asked once the title is loaded; it plays at once in
  // "auto" (never over Spotify, a viewing or a hidden window), waits for a
  // press in "button", and stops when the page goes.
  const songMode = state.settings.themeSong || "auto";
  const songKey = `${meta.type}:${meta.id}`;
  const songRefused = (state.settings.themeSongSkip || []).includes(songKey);
  useEffect(() => {
    setSong(null);
    if (songMode === "off" || loading || songRefused || !meta.id) return;
    let live = true;
    call("themeSong", { type: meta.type, id: meta.id })
      .then((found) => {
        if (!live || !found) return;
        setSong(found);
        if (
          songMode === "auto" &&
          document.visibilityState === "visible" &&
          !externalMusicPlaying() &&
          !videoIsPlaying()
        )
          playPreview(found, {
            owner: songOwner.current,
            volume: (state.settings.themeSongVolume || 35) / 100,
            gentle: !(
              state.settings.reduceMotion ||
              matchMedia("(prefers-reduced-motion: reduce)").matches
            ),
          });
      })
      .catch(() => {});
    return () => {
      live = false;
      stopAudio(songOwner.current);
    };
  }, [meta.id, meta.type, loading, songMode, songRefused]);
  useEffect(
    () =>
      onAudio((now) =>
        setSongPlaying(!!now?.playing && now.owner === songOwner.current),
      ),
    [],
  );
  const playSong = () => {
    if (songPlaying) toggleAudio();
    else
      playPreview(song, {
        owner: songOwner.current,
        volume: (state.settings.themeSongVolume || 35) / 100,
      });
  };
  const refuseSong = () => {
    stopAudio(songOwner.current, { fadeMs: 200 });
    setSong(null);
    update("settings", {
      themeSongSkip: [songKey, ...(state.settings.themeSongSkip || [])],
    });
  };
  const openSources = () => {
    setShowSources(true);
    if (popupMode) {
      setSourcesOpen(true);
      return;
    }
    setTimeout(
      () =>
        sourcesRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        }),
      60,
    );
  };
  const videos = episodeList(meta),
    // Titles of episodes not reached yet stay hidden when the viewer asks.
    spoilers =
      state.settings.spoilerGuard === "titles"
        ? spoilerIds(videos, state.progress, {
            type: meta.type,
            current: videoId,
          })
        : null,
    seasons = [...new Set(videos.map((v) => v.season ?? 1))],
    isFavorite = state.favorites.some(
      (m) => m.id === meta.id && m.type === meta.type,
    );
  const playStream = async (stream) => {
    setPlaying(stream.key);
    const ok = await act("play", {
      key: stream.key,
      meta,
      videoId,
      profileId: state.profiles?.active,
    });
    setPlaying("");
    if (ok) setSourcesOpen(false);
    if (ok && !ok.external) {
      notice("بدأ التشغيل في مشغل رِواق المدمج");
      setSubLoading(true);
      call("subtitles", { type: meta.type, id: videoId, streamKey: stream.key })
        .then(setSubs)
        .catch(() => {})
        .finally(() => setSubLoading(false));
    }
  };
  const settings = state.settings;
  const allShown =
    result?.streams?.filter(
      (s) => !quality || s.tier === quality || String(s.resolution) === quality,
    ) || [];
  // Streams outside the active saved filter fold away until asked for.
  const outside = allShown.filter((s) => s.matches === false);
  const shown =
    result?.filter && !result.filter.fallback && !showOutside
      ? allShown.filter((s) => s.matches !== false)
      : allShown;
  // Finding a source in a long list (core/source-view.mjs): view only.
  const visible = filterSources(shown, {
    query: sourceQuery,
    chips: sourceChips,
  });
  const narrowed = visible.length !== shown.length;
  // The tools stay while a search or chip is on, even if the list shrank
  // under five (a quality pick), so the viewer can always see and clear it.
  const narrowing = !!sourceQuery.trim() || sourceChips.length > 0;
  const counts = chipCounts(shown);
  const grouped = result?.order === "addon";
  const sections = grouped
    ? addonSections(visible)
    : [{ id: "all", name: "", streams: visible }];
  const hiddenKinds = new Set(settings.badgesHidden || []);
  const chip = (kind) => settings.badgesOn !== false && !hiddenKinds.has(kind);
  const art = settings.badgeArt || {};
  const dropped = result?.dropped || [];
  const currentEpisode = videos.find((v) => v.id === videoId);
  const saved = state.progress[`${meta.type}:${videoId}`];
  const resuming = saved && !isCompleted(saved) && saved.position > 30;
  // How long the viewing would take from where the viewer would start.
  const totalMinutes =
    (currentEpisode &&
      episodeDetails(
        currentEpisode,
        seasonInfo?.episodes?.[currentEpisode.episode],
      ).runtime) ||
    runtimeMinutes(meta.runtime) ||
    (saved?.duration > 0 ? Math.round(saved.duration / 60) : 0);
  const remainingMinutes = Math.max(
    0,
    Math.round(totalMinutes - (resuming ? saved.position / 60 : 0)),
  );
  const playLabel = currentEpisode
    ? `${resuming ? "متابعة" : "تشغيل"} ${episodeLabel(currentEpisode)}`
    : resuming
      ? `متابعة من ${clock(saved.position)}`
      : "تشغيل";
  // The sources, on the page or inside the window that Play opens.
  const sourcesSection = (
    <section className="streams" ref={sourcesRef}>
      <div className="section-heading">
        <div>
          <h2>
            اختر مصدر المشاهدة
            {currentEpisode ? ` · ${episodeLabel(currentEpisode)}` : ""}
          </h2>
          <span>
            {result
              ? `${arabicCount(shown.length, READY_SOURCES)}${dropped.length ? ` · ${dropped.length} مستبعد` : ""}`
              : "مرتبة بمحرّك رِواق: الجودة واللغة والموثوقية"}
            {result &&
              (result.order === "addon"
                ? " · بترتيب إضافاتك"
                : " · بترتيب رِواق")}
          </span>
        </div>
        <div className="button-row">
          <select
            aria-label="ترتيب المصادر"
            title="ترتيب المصادر"
            value={settings.streamOrder === "addon" ? "addon" : "riwaq"}
            onChange={(e) => reorder(e.target.value)}
          >
            <option value="riwaq">ترتيب رِواق</option>
            <option value="addon">ترتيب إضافاتي</option>
          </select>
          <select
            aria-label="فلترة جودة المصادر"
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
          >
            <option value="">كل الجودات</option>
            {(result?.groups || []).map((g) => (
              <option key={g.tier} value={g.tier}>
                {g.label} ({g.count})
              </option>
            ))}
          </select>
          <IconButton
            title="تحديث المصادر"
            onClick={() => setRequest((x) => x + 1)}
          >
            <RefreshCw size={17} />
          </IconButton>
        </div>
      </div>
      {result?.modeFallback && (
        <p className="stream-pref-note">
          لا توجد مصادر من النوع الذي اخترته في «اختيار المصدر»، فنعرض كل
          المصادر.
        </p>
      )}
      {result?.remembered > 0 && (
        <p className="stream-pref-note">
          قدّمنا نفس الإضافة وفريق الإصدار الذي شاهدت منه هذا المسلسل آخر مرة.
          <button
            className="text-button"
            onClick={() =>
              update("forgetSeries", { seriesId: meta.id })
                .then(() => setRequest((x) => x + 1))
                .catch(() => {})
            }
          >
            انسَ اختياري
          </button>
        </p>
      )}
      {result?.filter && (
        <p className="stream-pref-note">
          {result.filter.fallback
            ? `لا مصدر يطابق مرشح «${result.filter.name}»، فنعرض الأفضل المتاح.`
            : `مرشح «${result.filter.name}» مفعّل: ${result.filter.matched} مطابق.`}
          {!result.filter.fallback && outside.length > 0 && (
            <button
              className="text-button"
              onClick={() => setShowOutside(!showOutside)}
            >
              {showOutside
                ? "أخفِ غير المطابق"
                : `اعرض ${outside.length} غير مطابق`}
            </button>
          )}
        </p>
      )}
      {streamsLoading ? (
        <Busy text="نبحث في إضافاتك عن المصادر…" />
      ) : shown.length ? (
        <>
          {(shown.length > 4 || narrowing) && (
            <div className="source-tools">
              <label className="source-search">
                <Search size={15} />
                <input
                  type="search"
                  value={sourceQuery}
                  onChange={(e) => setSourceQuery(e.target.value)}
                  placeholder="ابحث في المصادر: فريق، REMUX، عربي…"
                  aria-label="ابحث في المصادر"
                  maxLength={80}
                />
              </label>
              <ScrollRow className="source-chips">
                {SOURCE_CHIPS.filter(([id]) => counts[id] > 0).map(
                  ([id, label]) => (
                    <button
                      key={id}
                      className={sourceChips.includes(id) ? "chosen" : ""}
                      aria-pressed={sourceChips.includes(id)}
                      onClick={() =>
                        setSourceChips((list) =>
                          list.includes(id)
                            ? list.filter((c) => c !== id)
                            : [...list, id],
                        )
                      }
                    >
                      {label} <bdi>{counts[id]}</bdi>
                    </button>
                  ),
                )}
              </ScrollRow>
              {narrowed && (
                <small className="source-count" role="status">
                  يعرض {arabicCount(visible.length, SOURCES)} من {shown.length}
                </small>
              )}
            </div>
          )}
          {visible.length ? (
            sections.map((section, index) => (
              <div className="stream-section" key={`${section.id}-${index}`}>
                {grouped && (
                  <button
                    className="stream-addon"
                    aria-expanded={!folded.includes(section.id)}
                    onClick={() =>
                      setFolded((list) =>
                        list.includes(section.id)
                          ? list.filter((f) => f !== section.id)
                          : [...list, section.id],
                      )
                    }
                  >
                    <ChevronLeft size={15} />
                    <b dir="auto">{section.name}</b>
                    <small>
                      {arabicCount(section.streams.length, SOURCES)}
                    </small>
                  </button>
                )}
                {!(grouped && folded.includes(section.id)) && (
                  <div
                    className={`stream-list ${settings.pickerLayout === "compact" ? "compact" : ""}`}
                  >
                    {section.streams.map((s) => (
                      <div
                        key={s.key}
                        className={`stream ${s.key === shown[0]?.key ? "recommended" : ""} ${s.matches === false ? "outside" : ""}`}
                      >
                        <button
                          className="stream-play"
                          disabled={!s.supported || !!playing}
                          onClick={() => playStream(s)}
                        >
                          <span className="stream-quality">
                            {!chip("resolution") ? (
                              <Play size={20} />
                            ) : s.resolution === 2160 ? (
                              "4K"
                            ) : s.resolution ? (
                              `${s.resolution}p`
                            ) : (
                              <Play size={20} />
                            )}
                          </span>
                          <span className="stream-info">
                            <b dir="auto">{s.name}</b>
                            {settings.pickerReleaseName !== false && (
                              <span dir="auto">{s.title || s.provider}</span>
                            )}
                            <small>
                              {chip("resolution") &&
                                chipArt(art, "resolution", s.resolution).map(
                                  (src) => (
                                    <img
                                      key={src}
                                      className="badge-art"
                                      src={src}
                                      alt={`${s.resolution}p`}
                                      loading="lazy"
                                      referrerPolicy="no-referrer"
                                    />
                                  ),
                                )}
                              {s.remembered && (
                                <em
                                  className="tag-remembered"
                                  title="نفس مصدر الحلقة السابقة"
                                >
                                  <History size={11} /> مصدرك السابق
                                </em>
                              )}
                              {(s.badges || []).map((b) => (
                                <RuleBadge key={b.label} badge={b} />
                              ))}
                              {chip("hdr") && s.hdr && (
                                <ArtChip
                                  images={chipArt(art, "hdr", s.hdr)}
                                  label={s.hdr}
                                >
                                  <em className="tag-hdr">{s.hdr}</em>
                                </ArtChip>
                              )}
                              {chip("codec") && s.codec && (
                                <ArtChip
                                  images={chipArt(art, "codec", s.codec)}
                                  label={s.codec}
                                >
                                  <em>{s.codec}</em>
                                </ArtChip>
                              )}
                              {chip("source") && s.source && (
                                <ArtChip
                                  images={chipArt(art, "source", s.source)}
                                  label={s.source}
                                >
                                  <em>{s.source}</em>
                                </ArtChip>
                              )}
                              {chip("audio") && s.audio && (
                                <ArtChip
                                  images={[
                                    ...chipArt(art, "audio", s.audio),
                                    ...(chipArt(art, "audio", s.audio).length
                                      ? chipArt(art, "channels", s.channels)
                                      : []),
                                  ]}
                                  label={`${s.audio}${s.channels ? ` ${s.channels}` : ""}`}
                                >
                                  <em>
                                    {s.audio}
                                    {s.channels ? ` ${s.channels}` : ""}
                                  </em>
                                </ArtChip>
                              )}
                              {chip("size") && s.sizeLabel && (
                                <em>{s.sizeLabel}</em>
                              )}
                              {chip("cached") && s.cached && (
                                <em className="tag-cached">
                                  <Zap size={11} /> {s.debrid || "مخزّن"}
                                </em>
                              )}
                              {chip("seeders") &&
                                s.seeders !== null &&
                                s.seeders !== undefined && (
                                  <em>
                                    <Users size={11} /> {s.seeders}
                                  </em>
                                )}
                              {chip("group") && s.trustedGroup && (
                                <em className="tag-trusted">
                                  <ShieldCheck size={11} /> {s.group}
                                </em>
                              )}
                              {chip("arabic") && s.arabicDub && (
                                <em className="tag-arabic">دبلجة عربية</em>
                              )}
                              {chip("arabic") && s.arabicSub && (
                                <em className="tag-arabic">ترجمة عربية</em>
                              )}
                              {s.torrent && <em>Stremio Service</em>}
                              {s.external && <em>رابط خارجي</em>}
                              {!s.supported && <em>صيغة غير مدعومة</em>}
                            </small>
                            {explained === s.key && (
                              <small className="stream-why" dir="auto">
                                {s.reasons.map((r) => (
                                  <em
                                    key={r.code}
                                    className={r.points < 0 ? "minus" : "plus"}
                                  >
                                    {r.label} {r.points > 0 ? "+" : ""}
                                    {r.points}
                                  </em>
                                ))}
                              </small>
                            )}
                          </span>
                          <span className="stream-action">
                            {s.key === shown[0]?.key && (
                              <small>الأعلى ترتيباً</small>
                            )}
                            {playing === s.key ? (
                              <LoaderCircle className="spin" size={22} />
                            ) : (
                              <Play size={20} fill="currentColor" />
                            )}
                          </span>
                        </button>
                        <button
                          className="stream-why-toggle"
                          title="لماذا هذا الترتيب؟"
                          aria-label="لماذا هذا الترتيب؟"
                          aria-expanded={explained === s.key}
                          onClick={() =>
                            setExplained(explained === s.key ? "" : s.key)
                          }
                        >
                          <Info size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <p className="source-none" role="status">
              لا مصدر يطابق بحثك أو اختياراتك.
              <button
                className="text-button"
                onClick={() => {
                  setSourceQuery("");
                  setSourceChips([]);
                }}
              >
                امسح البحث
              </button>
            </p>
          )}
        </>
      ) : (
        <Empty
          icon={Puzzle}
          title={
            result?.providers ? "لا توجد مصادر مطابقة" : "أضف مصادر المشاهدة"
          }
        >
          {result?.providers
            ? "جرّب تغيير فلتر الجودة أو تحديث المصادر."
            : "اربط حساب ستريميو أو أضف رابط إضافة تدعم مصادر التشغيل. Cinemeta يعرض معلومات الأعمال فقط."}
        </Empty>
      )}
      {dropped.length > 0 && (
        <div className="dropped-block">
          <button
            className="text-button"
            onClick={() => setShowDropped(!showDropped)}
          >
            <EyeOff size={15} /> {showDropped ? "إخفاء" : "عرض"}{" "}
            {dropped.length} مصدراً استبعده المحرّك
          </button>
          {showDropped && (
            <ul className="dropped-list">
              {dropped.slice(0, 40).map((entry, index) => (
                <li key={index}>
                  <b dir="auto">{entry.name}</b>
                  <span>{entry.reasons.map((r) => r.label).join("، ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {arrived > 0 && (
        <button className="secondary sources-arrived" onClick={addArrived}>
          <RefreshCw size={15} />
          وصل {arabicCount(arrived, SOURCES)} من إضافات تأخرت · أضفها للقائمة
        </button>
      )}
      {result?.late?.length > 0 && (
        <p className="sources-late" role="status">
          ما زالت تبحث: {result.late.join("، ")}. نعرض اللي وصل، ونضيف مصادرها
          إذا ردّت.
        </p>
      )}
      {result?.failures.length > 0 && (
        <p className="inline-warning">لم تستجب: {result.failures.join("، ")}</p>
      )}
    </section>
  );
  return (
    <article
      className={`title-page ${pageTheme ? `themed theme-${pageTheme.source}` : ""}`}
      style={pageTheme?.vars}
    >
      <div className="title-hero">
        <div
          className="detail-backdrop"
          style={{
            backgroundImage: imgUrl(meta.background)
              ? `url("${imgUrl(meta.background)}")`
              : undefined,
          }}
        />
        <div className="detail-content">
          <button className="back-button" onClick={onClose}>
            <ArrowRight size={18} /> رجوع
          </button>
          <span className="eyebrow">{typeName(meta.type)} · من إضافاتك</span>
          <TitleLogo
            meta={meta}
            mode={state.settings.titleLogos || "arabic"}
            className="detail-title"
          />
          <div className="hero-meta">
            {meta.imdbRating && (
              <span className="hero-rating">
                <Star size={15} />
                {meta.imdbRating}
              </span>
            )}
            <span>{meta.releaseInfo}</span>
            <span>{meta.runtime}</span>
            {meta.genres?.slice(0, 3).map((g) => (
              <span key={g}>{g}</span>
            ))}
          </div>
          {meta.ratings?.length > 0 && (
            <div className="ratings-strip">
              {meta.ratings.map((r) => (
                <span key={r.source}>
                  <small>{r.source}</small>
                  <b>{r.value}</b>
                </span>
              ))}
            </div>
          )}
          {meta.watchProviders?.length > 0 && (
            <div className="watch-providers">
              <small>متاح في منطقتك عبر</small>
              {meta.watchProviders.map((p) => (
                <span key={p.name}>
                  {p.logo && <img src={p.logo} alt="" />}
                  {p.name}
                </span>
              ))}
              <small>TMDB / JustWatch</small>
            </div>
          )}
          {meta.dataFailures?.length > 0 && (
            <p className="subtle">
              تعذّر إثراء البيانات من {meta.dataFailures.join("، ")}. بيانات
              الإضافة ما زالت متاحة.
            </p>
          )}
          <p className="synopsis" dir="auto">
            {meta.description}
          </p>
          {state.settings.awardIcons !== false &&
            credits?.awards?.length > 0 && (
              <AwardTrophies awards={credits.awards} />
            )}
          {meta.cast?.length > 0 && !credits?.cast?.length && (
            <p className="cast" dir="auto">
              {meta.cast.slice(0, 5).join(" · ")}
            </p>
          )}
          <div className="title-actions">
            <button
              className="primary title-play"
              disabled={loading || !videoId}
              onClick={openSources}
            >
              <Play size={20} fill="currentColor" /> {playLabel}
            </button>
            <button className="secondary" onClick={() => onFavorite(meta)}>
              {isFavorite ? <Check size={18} /> : <Plus size={18} />}{" "}
              {isFavorite ? "في مكتبتي" : "أضف إلى مكتبتي"}
            </button>
            <button className="secondary" onClick={() => setCollecting(true)}>
              <Folders size={18} />
              {titlePlaces(state.collections, meta).length
                ? "في مجموعاتك"
                : "أضف لمجموعة"}
            </button>
            {soundtrackQuery(meta) && (
              <button
                className="secondary"
                title={`ابحث عن موسيقى العمل في ${platformName(musicPlatform)}`}
                onClick={() =>
                  act("musicOpen", {
                    platform: musicPlatform,
                    query: soundtrackQuery(meta),
                  })
                }
              >
                <Music2 size={18} /> موسيقى العمل
              </button>
            )}
            {trailerOf(meta) && (
              <button
                className="secondary"
                onClick={() =>
                  act("openTrailer", { type: meta.type, id: meta.id })
                }
              >
                <Clapperboard size={18} /> الإعلان
              </button>
            )}
            <button
              className="secondary queue-add"
              disabled={
                !videoId ||
                loading ||
                (state.queue || []).some(
                  (q) => q.key === queueKey(meta.type, videoId),
                )
              }
              onClick={async () => {
                const episode = videos.find((v) => v.id === videoId);
                const label = episode
                  ? (episode.season === 0
                      ? "إضافات خاصة"
                      : "الموسم " + (episode.season ?? 1)) +
                    " · الحلقة " +
                    (episode.episode ?? "")
                  : "";
                if (
                  await update("queueEdit", {
                    action: "add",
                    meta,
                    videoId,
                    label,
                  })
                )
                  notice("أضيف إلى طابور المشاهدة في مكتبتي");
              }}
            >
              <ListPlus size={18} />
              {(state.queue || []).some(
                (q) => q.key === queueKey(meta.type, videoId),
              )
                ? "في طابور المشاهدة"
                : "أضف إلى الطابور"}
            </button>
          </div>
          {!loading && song && (
            <div className="theme-song" role="group" aria-label="أغنية العمل">
              <button
                className={`theme-song-play ${songPlaying ? "playing" : ""}`}
                onClick={playSong}
                aria-pressed={songPlaying}
                title={songPlaying ? "إيقاف مؤقت" : "شغّل أغنية العمل"}
              >
                {songPlaying ? <Pause size={15} /> : <Music2 size={15} />}
              </button>
              {song.image && (
                <img src={song.image} alt="" referrerPolicy="no-referrer" />
              )}
              <span>
                <b dir="auto">{song.track}</b>
                <small dir="auto">
                  {song.artist} · مقطع 30 ثانية من{" "}
                  {song.source === "deezer" ? "Deezer" : "Apple Music"}
                </small>
              </span>
              <button
                className="text-button"
                onClick={refuseSong}
                title="ما تنطلب لهذا العمل مرة ثانية"
              >
                <VolumeX size={14} /> مو هذي
              </button>
            </div>
          )}
          {!loading && (
            <TasteFeedback meta={meta} state={state} update={update} />
          )}
          {!loading &&
            !(
              meta.type === "movie" &&
              releaseTarget(meta, new Date(), -new Date().getTimezoneOffset())
            ) && (
              <EndsAt minutes={remainingMinutes} settings={state.settings} />
            )}
          {!loading && (
            <TitleCountdown
              meta={meta}
              state={state}
              update={update}
              notice={notice}
            />
          )}
          {error && <p className="inline-warning">{error}</p>}
        </div>
      </div>
      <div className="title-body">
        {loading ? (
          <Busy text="جاري تحميل التفاصيل…" />
        ) : (
          videos.length > 0 && (
            <section className="episodes">
              <div className="section-heading">
                <h2>الحلقات</h2>
                <div className="episode-shuffle">
                  <button
                    className="secondary small"
                    title="اختر حلقة عشوائية لم تشاهدها"
                    onClick={() => {
                      const candidates = shuffleCandidates(
                        meta,
                        state.progress,
                        { includeWatched: shuffleAll },
                      );
                      if (!shuffled.has(meta.id))
                        shuffled.set(meta.id, new Set());
                      const pick = shufflePick(candidates, {
                        current: videoId,
                        history: shuffled.get(meta.id),
                      });
                      if (!pick) {
                        notice(
                          shuffleAll
                            ? "لا توجد حلقات أخرى متاحة"
                            : "شاهدت كل الحلقات المتاحة. فعّل «تشمل المشاهدة» لتختار منها.",
                        );
                        return;
                      }
                      setSeason(pick.season ?? 1);
                      setVideoId(pick.id);
                      setTimeout(
                        () =>
                          document
                            .querySelector(".episode.selected")
                            ?.scrollIntoView({
                              block: "nearest",
                              inline: "center",
                            }),
                        60,
                      );
                      notice(
                        `اخترنا لك الموسم ${pick.season ?? 1} · الحلقة ${pick.episode}`,
                      );
                    }}
                  >
                    <Shuffle size={15} /> حلقة عشوائية
                  </button>
                  <label className="episode-shuffle-all">
                    <input
                      type="checkbox"
                      checked={shuffleAll}
                      onChange={(e) => setShuffleAll(e.target.checked)}
                    />
                    تشمل المشاهدة
                  </label>
                  {(settings.skipIntro === "auto" ||
                    settings.skipOutro === "auto") && (
                    <label
                      className="episode-shuffle-all"
                      title="عند الإيقاف يظهر زر التخطي بدل التخطي التلقائي في هذا المسلسل"
                    >
                      <input
                        type="checkbox"
                        checked={!(settings.skipExcept || []).includes(meta.id)}
                        onChange={(e) => {
                          const rest = (settings.skipExcept || []).filter(
                            (id) => id !== meta.id,
                          );
                          update("settings", {
                            skipExcept: e.target.checked
                              ? rest
                              : [...rest, meta.id],
                          });
                        }}
                      />
                      تخطٍّ تلقائي للمقدمة هنا
                    </label>
                  )}
                </div>
                <select
                  aria-label="الموسم"
                  value={season}
                  onChange={(e) => setSeason(Number(e.target.value))}
                >
                  {seasons.map((s) => (
                    <option key={s} value={s}>
                      {s === 0 ? "إضافات خاصة" : `الموسم ${s}`}
                    </option>
                  ))}
                </select>
              </div>
              <ScrollRow className="episode-list">
                {videos
                  .filter((v) => (v.season ?? 1) === season)
                  .map((v) => {
                    const d = episodeDetails(
                      v,
                      seasonInfo?.episodes?.[v.episode],
                    );
                    const hidden = spoilers?.has(v.id);
                    const saved = state.progress[`${meta.type}:${v.id}`];
                    const done = isCompleted(saved);
                    const upcoming =
                      v.released && Date.parse(v.released) > Date.now();
                    const part =
                      !done && saved?.duration > 0
                        ? Math.min(100, (saved.position / saved.duration) * 100)
                        : 0;
                    return (
                      <button
                        key={v.id}
                        className={`episode episode-card ${videoId === v.id ? "selected" : ""} ${hidden ? "spoiler" : ""}`}
                        disabled={upcoming}
                        onClick={() =>
                          videoId === v.id ? openSources() : setVideoId(v.id)
                        }
                        title={
                          hidden
                            ? "مخفية حتى تصل لهذه الحلقة. مرّر المؤشر لإظهارها."
                            : videoId === v.id && !showSources
                              ? "اضغط مرة أخرى لعرض المصادر"
                              : undefined
                        }
                      >
                        <span className="episode-still">
                          {d.thumb ? (
                            <img
                              src={d.thumb}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={(e) =>
                                (e.currentTarget.style.display = "none")
                              }
                            />
                          ) : null}
                          <span className="episode-number">
                            {String(v.episode || 1).padStart(2, "0")}
                          </span>
                          {done && (
                            <span className="episode-done" title="شاهدتها">
                              <Check size={14} strokeWidth={3} />
                            </span>
                          )}
                          {videoId === v.id && (
                            <span className="episode-play">
                              <Play size={22} fill="currentColor" />
                            </span>
                          )}
                          {part > 0 && (
                            <span className="progress-line">
                              <i style={{ width: `${part}%` }} />
                            </span>
                          )}
                        </span>
                        <span className="episode-text">
                          <b dir="auto" className="episode-title">
                            {d.title || `الحلقة ${v.episode}`}
                          </b>
                          <small className="episode-facts">
                            {[
                              d.runtime ? `${d.runtime} د` : "",
                              v.released
                                ? new Date(v.released).toLocaleDateString(
                                    "ar-SA-u-ca-gregory-nu-latn",
                                    {
                                      day: "numeric",
                                      month: "short",
                                      year: "numeric",
                                    },
                                  )
                                : "",
                              upcoming ? "قريباً" : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            {d.rating ? (
                              <em className="episode-rating">
                                <Star size={11} fill="currentColor" />{" "}
                                {d.rating}
                              </em>
                            ) : null}
                          </small>
                          {d.overview && (
                            <span
                              className="episode-overview"
                              dir="auto"
                              lang={d.overviewLang || undefined}
                            >
                              {d.overview}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
              </ScrollRow>
              {videos.some((v) => v.id === videoId) && (
                <EpisodeActions
                  meta={meta}
                  videoId={videoId}
                  progress={state.progress}
                  update={update}
                  notice={notice}
                />
              )}
            </section>
          )
        )}
        <CastRail credits={credits} onExplore={setExplore} />
        {/* The makers sit above the sources, as the owner asked. */}
        <CreditsFacts
          credits={credits}
          error={creditsError}
          onExplore={setExplore}
        />
        <CollectionRails
          credits={credits}
          onOpenTitle={(title) => onOpenTitle?.(title)}
        />
        {(!showSources || (popupMode && !sourcesOpen)) && !loading && (
          <div className="sources-closed">
            <Play size={18} />
            <span>
              المصادر تظهر {popupMode ? "في نافذة " : ""}بعد ما تضغط «
              {playLabel}»
              {videos.length > 0 ? "، أو تضغط الحلقة المختارة مرة ثانية" : ""}.
            </span>
            <button className="secondary small" onClick={openSources}>
              اعرض المصادر
            </button>
          </div>
        )}
        {showSources &&
          (popupMode
            ? sourcesOpen && (
                <Modal
                  className="sources-modal"
                  onClose={() => setSourcesOpen(false)}
                >
                  {sourcesSection}
                </Modal>
              )
            : sourcesSection)}
        {(subLoading || subs.length > 0) && (
          <section className="subtitle-section">
            <div className="section-heading">
              <h2>ترجمات الإضافات</h2>
              <button className="text-button" onClick={onPlayer}>
                خيارات المشغل
              </button>
            </div>
            {subLoading ? (
              <Busy />
            ) : (
              <div className="subtitle-list">
                {subs.map((s, i) => (
                  <button
                    className="secondary small"
                    key={`${s.key}:${i}`}
                    onClick={() => act("subtitle", { key: s.key })}
                  >
                    <Subtitles size={16} />
                    {languageOf(s.lang).name} ·{" "}
                    {s.label || s.provider || "ترجمة"}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        <TitleFacts meta={meta} credits={credits} />
        <ArtworkGallery
          meta={meta}
          state={state}
          update={update}
          notice={notice}
          onSettings={onSettings}
        />
      </div>
      {collecting && (
        <AddToCollection
          meta={meta}
          state={state}
          update={update}
          onClose={() => setCollecting(false)}
        />
      )}
      {explore && (
        <ExploreModal
          start={explore}
          onClose={() => setExplore(null)}
          onOpenTitle={(title) => {
            setExplore(null);
            onOpenTitle?.(title);
          }}
        />
      )}
    </article>
  );
}

/** "م1 · ح3" for an episode, "خاصة · ح2" for a special. */
function episodeLabel(v) {
  return `${(v.season ?? 1) === 0 ? "خاصة" : `م${v.season ?? 1}`} · ح${v.episode ?? 1}`;
}

const list = (value) =>
  (Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/,\s*/)
      : []
  )
    .map((x) => String(x).trim())
    .filter(Boolean);

/** What the addon and the data providers say about the work, in one place. */
function TitleFacts({ meta, credits }) {
  const released = meta.released ? new Date(meta.released) : null;
  const facts = [
    [
      Calendar,
      "تاريخ العرض",
      released && !Number.isNaN(released.getTime())
        ? released.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : meta.releaseInfo || meta.year,
    ],
    [Clock, "المدة", meta.runtime],
    [Video, "الإخراج", list(meta.director).slice(0, 4).join("، ")],
    [PenLine, "الكتابة", list(meta.writer).slice(0, 4).join("، ")],
    [
      Globe2,
      "بلد الإنتاج",
      list(meta.country).join("، ") ||
        (credits?.countries || [])
          .map((c) => c.name)
          .slice(0, 4)
          .join("، "),
    ],
    [Languages, "اللغة", list(meta.language).join("، ")],
    [AwardIcon, "الجوائز", meta.awards],
    [Folders, "التصنيفات", list(meta.genres || meta.genre).join("، ")],
  ].filter(([, , value]) => value);
  if (!facts.length) return null;
  return (
    <section className="title-facts">
      <h2>عن العمل</h2>
      <dl>
        {facts.map(([Icon, label, value]) => (
          <div key={label}>
            <dt>
              <Icon size={15} /> {label}
            </dt>
            <dd dir="auto">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Watched marks for the selected episode. "Watched everything before it" is
 * for a series the viewer followed somewhere else: up next then starts after
 * this episode instead of at the pilot. Marks stay local to this profile.
 */
function EpisodeActions({ meta, videoId, progress, update, notice }) {
  const [busy, setBusy] = useState(false);
  const watched = isCompleted(progress[`${meta.type}:${videoId}`]);
  const ordered = releasedEpisodes(meta).filter((v) => (v.season ?? 1) > 0);
  const index = ordered.findIndex((v) => v.id === videoId);
  const run = async (input, message) => {
    setBusy(true);
    const result = await update("historyEdit", { meta, ...input });
    setBusy(false);
    if (result) notice(message);
  };
  return (
    <div className="episode-actions">
      <button
        className="secondary small"
        disabled={busy}
        onClick={() =>
          watched
            ? run({ action: "remove", videoId }, "أزيلت علامة المشاهدة")
            : run({ action: "complete", videoId }, "عُلّمت الحلقة كمشاهدة")
        }
      >
        {watched ? <Undo2 size={15} /> : <Check size={15} />}
        {watched ? "لم أشاهدها" : "شاهدت هذه الحلقة"}
      </button>
      {index > 0 && (
        <button
          className="secondary small"
          disabled={busy}
          onClick={() =>
            run(
              {
                action: "completeThrough",
                videoIds: ordered.slice(0, index + 1).map((v) => v.id),
              },
              `عُلّمت ${arabicCount(index + 1, EPISODES)} كمشاهدة`,
            )
          }
        >
          <CheckCheck size={15} /> شاهدت كل ما قبلها
        </button>
      )}
    </div>
  );
}
