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
} from "lucide-react";
import { AddToCollection } from "./Collections.jsx";
import { titlePlaces } from "../../core/collections.mjs";
import { trailerOf } from "../../core/credits.mjs";
import { shuffleCandidates, shufflePick } from "../../core/shuffle.mjs";

/** Episodes already shuffled to, per series, for this session. */
const shuffled = new Map();
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
import { spoilerIds } from "../../core/spoilers.mjs";
import { chipArt } from "../../core/badges.mjs";
import { ArtChip, RuleBadge } from "./StreamBadge.jsx";
import { IconButton, Busy, Empty, Modal } from "./UI.jsx";
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
    [collecting, setCollecting] = useState(false);
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
    if (!videoId) return;
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
  }, [videoId, request]);
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
  return (
    <Modal onClose={onClose} className="details-modal">
      <div
        className="detail-backdrop"
        style={{
          backgroundImage: imgUrl(meta.background)
            ? `url("${imgUrl(meta.background)}")`
            : undefined,
        }}
      />
      <div className="detail-content">
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
        {state.settings.awardIcons !== false && credits?.awards?.length > 0 && (
          <AwardTrophies awards={credits.awards} />
        )}
        {meta.cast?.length > 0 && !credits?.cast?.length && (
          <p className="cast" dir="auto">
            {meta.cast.slice(0, 5).join(" · ")}
          </p>
        )}
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
            onClick={() => act("openTrailer", { type: meta.type, id: meta.id })}
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
              await update("queueEdit", { action: "add", meta, videoId, label })
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
        {error && <p className="inline-warning">{error}</p>}
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
              <div className="episode-list">
                {videos
                  .filter((v) => (v.season ?? 1) === season)
                  .map((v) => (
                    <button
                      key={v.id}
                      className={
                        videoId === v.id ? "episode selected" : "episode"
                      }
                      disabled={
                        v.released && Date.parse(v.released) > Date.now()
                      }
                      onClick={() => setVideoId(v.id)}
                    >
                      <span className="episode-number">
                        {String(v.episode || 1).padStart(2, "0")}
                      </span>
                      <span>
                        <b
                          dir="auto"
                          className={
                            spoilers?.has(v.id) ? "spoiler-title" : undefined
                          }
                          title={
                            spoilers?.has(v.id)
                              ? "مخفي حتى تصل لهذه الحلقة. مرّر المؤشر لإظهاره."
                              : undefined
                          }
                        >
                          {v.title || v.name || `الحلقة ${v.episode}`}
                        </b>
                        {v.released && (
                          <small>
                            {new Date(v.released).toLocaleDateString("ar-SA", {
                              calendar: "gregory",
                            })}
                          </small>
                        )}
                      </span>
                      {isCompleted(state.progress[`${meta.type}:${v.id}`]) ? (
                        <Check size={16} />
                      ) : videoId === v.id ? (
                        <Play size={16} />
                      ) : (
                        <ChevronLeft size={16} />
                      )}
                    </button>
                  ))}
              </div>
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
        <section className="streams">
          <div className="section-heading">
            <div>
              <h2>اختر مصدر المشاهدة</h2>
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
                        {chip("size") && s.sizeLabel && <em>{s.sizeLabel}</em>}
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
    </Modal>
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
