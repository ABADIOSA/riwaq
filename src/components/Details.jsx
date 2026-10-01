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
} from "lucide-react";
import ArtworkGallery from "./ArtworkGallery.jsx";
import { AddToCollection } from "./Collections.jsx";
import { titlePlaces } from "../../core/collections.mjs";
import { trailerOf } from "../../core/credits.mjs";
import { shuffleCandidates, shufflePick } from "../../core/shuffle.mjs";

/** Episodes already shuffled to, per series, for this session. */
const shuffled = new Map();
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
import { spoilerIds } from "../../core/spoilers.mjs";
import { episodeDetails } from "../../core/season-details.mjs";
import { chipArt } from "../../core/badges.mjs";
import { ArtChip, RuleBadge } from "./StreamBadge.jsx";
import { IconButton, Busy, Empty, ScrollRow } from "./UI.jsx";
import { call } from "../lib/api.js";
import {
  queueKey,
  releasedEpisodes,
  isCompleted,
} from "../../core/library.mjs";
import { arabicCount, EPISODES } from "../../core/arabic.mjs";
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
    setSubs([]);
    setStreamsLoading(true);
    call("streams", { type: meta.type, id: videoId })
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
  const openSources = () => {
    setShowSources(true);
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
  const hiddenKinds = new Set(settings.badgesHidden || []);
  const chip = (kind) => settings.badgesOn !== false && !hiddenKinds.has(kind);
  const art = settings.badgeArt || {};
  const dropped = result?.dropped || [];
  const currentEpisode = videos.find((v) => v.id === videoId);
  const saved = state.progress[`${meta.type}:${videoId}`];
  const resuming = saved && !isCompleted(saved) && saved.position > 30;
  const playLabel = currentEpisode
    ? `${resuming ? "متابعة" : "تشغيل"} ${episodeLabel(currentEpisode)}`
    : resuming
      ? `متابعة من ${clock(saved.position)}`
      : "تشغيل";
  return (
    <article className="title-page">
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
          {meta.logo && (
            <img
              className="detail-title-logo"
              src={imgUrl(meta.logo)}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          )}
          <h1 dir="auto">{meta.name}</h1>
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
        {!showSources && !loading && (
          <div className="sources-closed">
            <Play size={18} />
            <span>
              المصادر تظهر بعد ما تضغط «{playLabel}»
              {videos.length > 0 ? "، أو تضغط الحلقة المختارة مرة ثانية" : ""}.
            </span>
            <button className="secondary small" onClick={openSources}>
              اعرض المصادر
            </button>
          </div>
        )}
        {showSources && (
          <section className="streams" ref={sourcesRef}>
            <div className="section-heading">
              <div>
                <h2>
                  اختر مصدر المشاهدة
                  {currentEpisode ? ` · ${episodeLabel(currentEpisode)}` : ""}
                </h2>
                <span>
                  {result
                    ? `${shown.length} مصدر جاهز${dropped.length ? ` · ${dropped.length} مستبعد` : ""}`
                    : "مرتبة بمحرّك رِواق: الجودة واللغة والموثوقية"}
                </span>
              </div>
              <div className="button-row">
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
              <div
                className={`stream-list ${settings.pickerLayout === "compact" ? "compact" : ""}`}
              >
                {shown.map((s, i) => (
                  <div
                    key={s.key}
                    className={`stream ${i === 0 ? "recommended" : ""} ${s.matches === false ? "outside" : ""}`}
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
                        {i === 0 && <small>الأعلى ترتيباً</small>}
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
            ) : (
              <Empty
                icon={Puzzle}
                title={
                  result?.providers
                    ? "لا توجد مصادر مطابقة"
                    : "أضف مصادر المشاهدة"
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
                        <span>
                          {entry.reasons.map((r) => r.label).join("، ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {result?.failures.length > 0 && (
              <p className="inline-warning">
                لم تستجب: {result.failures.join("، ")}
              </p>
            )}
          </section>
        )}
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
