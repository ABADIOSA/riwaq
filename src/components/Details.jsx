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
} from "lucide-react";
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
import { IconButton, Busy, Empty, Modal } from "./UI.jsx";
import { call } from "../lib/api.js";
export default function Details({
  selection,
  state,
  onClose,
  onFavorite,
  act,
  notice,
  onPlayer,
}) {
  const [meta, setMeta] = useState(selection.meta),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [videoId, setVideoId] = useState(selection.videoId || ""),
    [season, setSeason] = useState(1),
    [result, setResult] = useState(null),
    [streamsLoading, setStreamsLoading] = useState(false),
    [quality, setQuality] = useState(""),
    [showDropped, setShowDropped] = useState(false),
    [explained, setExplained] = useState(""),
    [playing, setPlaying] = useState(""),
    [subs, setSubs] = useState([]),
    [subLoading, setSubLoading] = useState(false),
    [request, setRequest] = useState(0);
  useEffect(() => {
    let current = true;
    call("metadata", { type: selection.meta.type, id: selection.meta.id })
      .then((data) => {
        if (!current) return;
        setMeta(data);
        const videos = episodeList(data);
        const saved = Object.values(state.progress)
          .filter((p) => p.meta.id === data.id)
          .sort((a, b) => b.updated - a.updated)[0];
        const initialId =
          selection.videoId ||
          saved?.videoId ||
          data.behaviorHints?.defaultVideoId ||
          videos.find((v) => (v.season ?? 1) > 0)?.id ||
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
    seasons = [...new Set(videos.map((v) => v.season ?? 1))],
    isFavorite = state.favorites.some(
      (m) => m.id === meta.id && m.type === meta.type,
    );
  const playStream = async (stream) => {
    setPlaying(stream.key);
    const ok = await act("play", { key: stream.key, meta, videoId });
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
  const shown =
    result?.streams?.filter(
      (s) => !quality || s.tier === quality || String(s.resolution) === quality,
    ) || [];
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
        {meta.cast?.length > 0 && (
          <p className="cast" dir="auto">
            {meta.cast.slice(0, 5).join(" · ")}
          </p>
        )}
        <button className="secondary" onClick={() => onFavorite(meta)}>
          {isFavorite ? <Check size={18} /> : <Plus size={18} />}{" "}
          {isFavorite ? "في مكتبتي" : "أضف إلى مكتبتي"}
        </button>
        {error && <p className="inline-warning">{error}</p>}
        {loading ? (
          <Busy text="جاري تحميل التفاصيل…" />
        ) : (
          videos.length > 0 && (
            <section className="episodes">
              <div className="section-heading">
                <h2>الحلقات</h2>
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
                      onClick={() => setVideoId(v.id)}
                    >
                      <span className="episode-number">
                        {String(v.episode || 1).padStart(2, "0")}
                      </span>
                      <span>
                        <b dir="auto">
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
                      {videoId === v.id ? (
                        <Play size={16} />
                      ) : (
                        <ChevronLeft size={16} />
                      )}
                    </button>
                  ))}
              </div>
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
          {streamsLoading ? (
            <Busy text="نبحث في إضافاتك عن المصادر…" />
          ) : shown.length ? (
            <div className="stream-list">
              {shown.map((s, i) => (
                <div
                  key={s.key}
                  className={`stream ${i === 0 ? "recommended" : ""}`}
                >
                  <button
                    className="stream-play"
                    disabled={!s.supported || !!playing}
                    onClick={() => playStream(s)}
                  >
                    <span className="stream-quality">
                      {s.resolution === 2160 ? (
                        "4K"
                      ) : s.resolution ? (
                        `${s.resolution}p`
                      ) : (
                        <Play size={20} />
                      )}
                    </span>
                    <span className="stream-info">
                      <b dir="auto">{s.name}</b>
                      <span dir="auto">{s.title || s.provider}</span>
                      <small>
                        {s.hdr && <em className="tag-hdr">{s.hdr}</em>}
                        {s.codec && <em>{s.codec}</em>}
                        {s.source && <em>{s.source}</em>}
                        {s.audio && (
                          <em>
                            {s.audio}
                            {s.channels ? ` ${s.channels}` : ""}
                          </em>
                        )}
                        {s.sizeLabel && <em>{s.sizeLabel}</em>}
                        {s.cached && (
                          <em className="tag-cached">
                            <Zap size={11} /> {s.debrid || "مخزّن"}
                          </em>
                        )}
                        {s.seeders !== null && s.seeders !== undefined && (
                          <em>
                            <Users size={11} /> {s.seeders}
                          </em>
                        )}
                        {s.trustedGroup && (
                          <em className="tag-trusted">
                            <ShieldCheck size={11} /> {s.group}
                          </em>
                        )}
                        {s.arabicDub && (
                          <em className="tag-arabic">دبلجة عربية</em>
                        )}
                        {s.arabicSub && (
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
                    {s.lang} · {s.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
