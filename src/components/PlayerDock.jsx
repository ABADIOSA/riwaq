import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  X,
  Check,
  Captions,
  Timer,
  Palette,
  AudioLines,
  FolderOpen,
  RefreshCw,
  Layers,
  Minus,
  Plus,
  RotateCcw,
  ListVideo,
  Server,
  Play,
} from "lucide-react";
import { isCompleted, releasedEpisodes } from "../../core/library.mjs";
import {
  DEFAULT_SUBTITLE_STYLE,
  KIND_LABELS,
  audioLabel,
  languageGroups,
  languageOf,
  preferredLanguages,
  rankSubtitles,
  subtitleKind,
  syncDelay,
} from "../../core/subtitles.mjs";
import { call } from "../lib/api.js";

const TABS = [
  ["subs", "الترجمة", Captions],
  ["sync", "المزامنة", Timer],
  ["style", "المظهر", Palette],
  ["audio", "الصوت", AudioLines],
  ["episodes", "الحلقات", ListVideo],
  ["sources", "المصادر", Server],
];
const COLORS = ["#FFFFFF", "#FFE45C", "#7FE7FF", "#9CFF8F", "#FFB36B"];
const EDGES = ["#000000", "#1F2937", "#3B0764", "#FFFFFF"];

const clock = (value) => {
  const total = Math.max(0, Math.floor(value || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
// Release names use dots for spaces; show them as words.
const readable = (label) =>
  String(label || "")
    .replace(/\.(srt|vtt|ass|ssa|sub)$/i, "")
    .replace(/(?<=\S)\.(?=\S)/g, " ")
    .trim();
const signed = (n) => `${n > 0 ? "+" : ""}${Number(n || 0).toFixed(1)} ث`;

/**
 * The panel beside the picture: subtitles, their timing and look, and audio.
 * It never covers the video; the surface shrinks to make room for it.
 */
export default function PlayerDock({
  player,
  state,
  act,
  update,
  tab,
  setTab,
  onClose,
  onEpisode,
}) {
  const series = player.mediaType === "series";
  const addon = !["local", "live"].includes(player.mediaType);
  return (
    <aside className="player-side" aria-label="الترجمة والصوت">
      <header className="dock-head">
        <div className="dock-tabs" role="tablist">
          {TABS.filter(
            ([id]) =>
              (id !== "episodes" || (series && onEpisode)) &&
              (id !== "sources" || addon),
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        <button className="dock-close" title="إغلاق اللوحة" onClick={onClose}>
          <X size={17} />
        </button>
      </header>
      <div className="dock-body">
        {tab === "subs" && (
          <SubtitleList player={player} state={state} act={act} />
        )}
        {tab === "sync" && <SyncRoom player={player} act={act} />}
        {tab === "style" && (
          <StyleRoom player={player} state={state} act={act} update={update} />
        )}
        {tab === "audio" && <AudioRoom player={player} act={act} />}
        {tab === "episodes" && series && onEpisode && (
          <EpisodesRoom
            player={player}
            state={state}
            act={act}
            onEpisode={onEpisode}
          />
        )}
        {tab === "sources" && addon && <SourcesRoom act={act} />}
      </div>
    </aside>
  );
}

function SubtitleList({ player, state, act }) {
  const [addons, setAddons] = useState(null);
  const [source, setSource] = useState("all");
  const [language, setLanguage] = useState("");
  const languages = preferredLanguages(state.settings.subtitleLanguage);
  const kind = state.settings.subtitleKind || "standard";
  const tracks = player.tracks || [];
  const canSearch = !["local", "live"].includes(player.mediaType);
  const load = async () => {
    if (!canSearch) return setAddons([]);
    setAddons(null);
    setAddons((await act("subtitles", {})) || []);
  };
  useEffect(() => {
    load();
  }, [player.videoId]);

  const entries = useMemo(() => {
    const embedded = tracks
      .filter((t) => t.type === "sub" && !t.addonKey)
      .map((t) => ({
        id: `t${t.id}`,
        source: "embedded",
        trackId: t.id,
        lang: t.lang,
        label: t.title || "",
        title: t.title,
        forced: t.forced,
        hearingImpaired: t.hearingImpaired,
        detail: [
          t.external ? "ملف محلي" : "مدمجة",
          t.codec && String(t.codec).toUpperCase(),
          t.default && "افتراضية",
        ],
        selected: t.selected,
        secondary: t.secondary,
      }));
    const fromAddons = (addons || []).map((s) => {
      const loaded = tracks.find((t) => t.addonKey === s.key);
      return {
        id: s.key,
        source: "addon",
        key: s.key,
        lang: s.lang,
        label: s.label,
        detail: [s.provider, s.format],
        selected: !!loaded?.selected,
        secondary: !!loaded?.secondary,
      };
    });
    return rankSubtitles([...embedded, ...fromAddons], { languages, kind });
  }, [tracks, addons, state.settings.subtitleLanguage, kind]);

  const groups = languageGroups(entries, languages);
  // Start on the viewer's first language once the addons have answered, so
  // an Arabic addon subtitle is not hidden behind an English embedded track.
  useEffect(() => {
    if (language || (addons === null && canSearch)) return;
    setLanguage(
      groups.some((g) => g.code === languages[0]) ? languages[0] : "all",
    );
  }, [addons, groups.length]);
  useEffect(() => {
    setLanguage("");
  }, [player.videoId]);
  const shown = entries.filter(
    (e) =>
      (source === "all" || e.source === source) &&
      (!language || language === "all" || languageOf(e.lang).code === language),
  );
  const count = (s) =>
    entries.filter((e) => s === "all" || e.source === s).length;
  const anySecondary = tracks.some((t) => t.type === "sub" && t.secondary);
  const choose = (entry) =>
    entry.source === "embedded"
      ? act("playerCommand", { action: "sid", value: entry.trackId })
      : act("subtitle", { key: entry.key });
  const second = (entry) =>
    entry.secondary
      ? act("playerCommand", { action: "secondarySubtitle", value: "no" })
      : entry.source === "embedded"
        ? act("playerCommand", {
            action: "secondarySubtitle",
            value: entry.trackId,
          })
        : act("subtitle", { key: entry.key, secondary: true });

  return (
    <>
      <div className="dock-chips">
        {[
          ["all", "الكل"],
          ["embedded", "مدمجة"],
          ["addon", "الإضافات"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={source === id ? "active" : ""}
            onClick={() => setSource(id)}
          >
            {label} <small>{count(id)}</small>
          </button>
        ))}
        {canSearch && (
          <button title="إعادة البحث في إضافاتك" onClick={load}>
            <RefreshCw size={13} />
          </button>
        )}
      </div>
      <div className="dock-split">
        <nav className="dock-languages" aria-label="اللغات">
          <button
            className={language === "all" ? "active" : ""}
            onClick={() => setLanguage("all")}
          >
            كل اللغات <small>{entries.length}</small>
          </button>
          {groups.map((g) => (
            <button
              key={g.code}
              className={language === g.code ? "active" : ""}
              onClick={() => setLanguage(g.code)}
            >
              {g.name} <small>{g.count}</small>
            </button>
          ))}
        </nav>
        <div className="dock-list">
          <button
            className={`dock-row off ${tracks.some((t) => t.type === "sub" && t.selected) ? "" : "selected"}`}
            onClick={() => act("playerCommand", { action: "sid", value: "no" })}
          >
            <span className="dock-row-main">
              <b>بدون ترجمة</b>
            </span>
            {!tracks.some((t) => t.type === "sub" && t.selected) && (
              <Check size={16} />
            )}
          </button>
          {anySecondary && (
            <button
              className="dock-row off"
              onClick={() =>
                act("playerCommand", {
                  action: "secondarySubtitle",
                  value: "no",
                })
              }
            >
              <span className="dock-row-main">
                <b>إيقاف الترجمة الثانية</b>
              </span>
            </button>
          )}
          {addons === null && canSearch && (
            <p className="dock-note">نبحث في إضافاتك عن ترجمات…</p>
          )}
          {shown.map((e, index) => {
            const k = subtitleKind(e);
            const lang = languageOf(e.lang).name;
            return (
              <div
                key={e.id}
                className={`dock-row ${e.selected ? "selected" : ""}`}
              >
                <button className="dock-row-main" onClick={() => choose(e)}>
                  <span className="dock-index">{index + 1}</span>
                  <span>
                    <b dir="auto">{readable(e.label) || lang}</b>
                    <small>
                      {[lang, ...e.detail].filter(Boolean).join(" · ")}
                      {k !== "standard" && (
                        <em className={`kind ${k}`}>{KIND_LABELS[k]}</em>
                      )}
                    </small>
                  </span>
                </button>
                <button
                  className={`dock-second ${e.secondary ? "on" : ""}`}
                  title={
                    e.secondary ? "إيقاف كترجمة ثانية" : "عرضها كترجمة ثانية"
                  }
                  onClick={() => second(e)}
                >
                  <Layers size={14} />
                </button>
                {e.selected && <Check size={16} className="dock-check" />}
              </div>
            );
          })}
          {addons !== null && shown.length === 0 && (
            <p className="dock-note">
              لا توجد ترجمات بهذا الاختيار. جرّب «كل اللغات» أو افتح ملفاً.
            </p>
          )}
        </div>
      </div>
      <footer className="dock-foot">
        <button className="secondary" onClick={() => act("localSubtitle")}>
          <FolderOpen size={15} /> فتح ملف ترجمة
        </button>
        <small>
          اضغط على ترجمة لتجربتها مباشرة؛ إن لم تتطابق جرّب التالية أو اضبطها من
          «المزامنة».
        </small>
      </footer>
    </>
  );
}

function Stepper({ value, onChange, steps = [0.5, 0.1], format = signed }) {
  const round = (n) => Math.round(n * 10) / 10;
  return (
    <div className="dock-stepper" dir="ltr">
      {steps.map((s) => (
        <button key={`-${s}`} onClick={() => onChange(round(value - s))}>
          <Minus size={12} />
          {s}
        </button>
      ))}
      <output dir="rtl">{format(value)}</output>
      {[...steps].reverse().map((s) => (
        <button key={`+${s}`} onClick={() => onChange(round(value + s))}>
          <Plus size={12} />
          {s}
        </button>
      ))}
      <button title="إعادة الضبط" onClick={() => onChange(0)}>
        <RotateCcw size={13} />
      </button>
    </div>
  );
}

function SyncRoom({ player, act }) {
  const [cues, setCues] = useState(null);
  const [error, setError] = useState("");
  const delay = player.subtitleDelay || 0;
  const selected = (player.tracks || []).find(
    (t) => t.type === "sub" && t.selected,
  );
  const setDelay = (value) =>
    act("playerCommand", {
      action: "subtitleDelay",
      value: Math.max(-60, Math.min(60, value)),
    });
  const load = async () => {
    setError("");
    try {
      setCues(await call("subtitleCues", { key: selected.addonKey }));
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    setCues(null);
  }, [selected?.addonKey]);
  return (
    <div className="dock-room">
      <h3>تأخير الترجمة</h3>
      <p className="dock-note">
        قيمة موجبة تؤخر الترجمة، وسالبة تقدّمها. يطبق فوراً على المشاهدة.
      </p>
      <Stepper value={delay} onChange={setDelay} />
      <h3>مزامنة سريعة</h3>
      {!selected ? (
        <p className="dock-note">اختر ترجمة أولاً من تبويب الترجمة.</p>
      ) : !selected.addonKey ? (
        <p className="dock-note">
          المزامنة السريعة تعمل مع ترجمات الإضافات. للترجمة المدمجة استخدم
          الأزرار أعلاه.
        </p>
      ) : (
        <>
          <p className="dock-note">
            عندما تسمع جملة، اضغط «اعرض الجمل» ثم اختر الجملة التي سمعتها للتو،
            فيضبط رِواق التوقيت عليها.
          </p>
          <button className="secondary" onClick={load}>
            <RefreshCw size={14} /> اعرض الجمل حول هذه اللحظة
          </button>
          {error && <p className="inline-warning">{error}</p>}
          {cues && (
            <ol className="dock-cues">
              {cues.cues.map((cue) => (
                <li key={`${cue.start}-${cue.text}`}>
                  <button
                    onClick={async () => {
                      await setDelay(
                        syncDelay(cue.start, player.position || 0),
                      );
                      load();
                    }}
                  >
                    <time dir="ltr">{clock(cue.start + delay)}</time>
                    <span dir="auto">{cue.text}</span>
                  </button>
                </li>
              ))}
              {cues.cues.length === 0 && (
                <p className="dock-note">لم نجد جملاً قريبة من هذه اللحظة.</p>
              )}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

function StyleRoom({ player, state, act, update }) {
  const saved = { ...DEFAULT_SUBTITLE_STYLE, ...state.settings.subtitleStyle };
  const [style, setStyle] = useState(saved);
  const [size, setSize] = useState(state.settings.subtitleSize || 44);
  const [position, setPosition] = useState(
    player.subtitlePosition ?? state.settings.subtitlePosition ?? 95,
  );
  const timer = useRef();
  const persist = (patch) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => update("settings", patch), 400);
  };
  const change = (patch) => {
    const next = { ...style, ...patch };
    setStyle(next);
    act("playerCommand", { action: "subtitleStyle", value: next });
    persist({ subtitleStyle: next });
  };
  const alpha = Math.round((style.backgroundOpacity / 100) * 255)
    .toString(16)
    .padStart(2, "0");
  const preview = {
    color: style.color,
    fontWeight: style.bold ? 700 : 500,
    fontSize: `${Math.round(size / 2.2)}px`,
    background:
      style.backgroundOpacity > 0
        ? `${style.background}${alpha}`
        : "transparent",
    textShadow:
      style.backgroundOpacity > 0
        ? "none"
        : `0 0 ${style.outline}px ${style.outlineColor}, 0 0 ${style.outline}px ${style.outlineColor}${style.shadow ? `, ${style.shadow}px ${style.shadow}px 3px #0009` : ""}`,
  };
  const swatches = (key, colors) => (
    <div className="dock-swatches">
      {colors.map((c) => (
        <button
          key={c}
          style={{ background: c }}
          className={style[key] === c ? "on" : ""}
          aria-label={c}
          onClick={() => change({ [key]: c })}
        />
      ))}
      <input
        type="color"
        aria-label="لون مخصص"
        value={style[key].toLowerCase()}
        onChange={(e) => change({ [key]: e.target.value.toUpperCase() })}
      />
    </div>
  );
  const range = (label, value, min, max, onInput) => (
    <label className="dock-range">
      <span>
        {label} <b>{value}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onInput(Number(e.target.value))}
      />
    </label>
  );
  return (
    <div className="dock-room">
      <div className="dock-preview">
        <span style={preview}>هذا مثال على شكل الترجمة</span>
      </div>
      {range("الحجم", size, 18, 80, (v) => {
        setSize(v);
        act("playerCommand", { action: "subtitleSize", value: v });
        persist({ subtitleSize: v });
      })}
      {range("الارتفاع", position, 50, 100, (v) => {
        setPosition(v);
        act("playerCommand", { action: "subtitlePosition", value: v });
        persist({ subtitlePosition: v });
      })}
      <h3>لون النص</h3>
      {swatches("color", COLORS)}
      <h3>الحدود</h3>
      {swatches("outlineColor", EDGES)}
      {range("سماكة الحدود", style.outline, 0, 8, (v) =>
        change({ outline: v }),
      )}
      {range("الظل", style.shadow, 0, 8, (v) => change({ shadow: v }))}
      <h3>خلفية الترجمة</h3>
      {swatches("background", EDGES)}
      {range("شفافية الخلفية", style.backgroundOpacity, 0, 100, (v) =>
        change({ backgroundOpacity: v }),
      )}
      <label className="dock-toggle">
        <input
          type="checkbox"
          checked={style.bold}
          onChange={(e) => change({ bold: e.target.checked })}
        />
        خط عريض
      </label>
      <label className="dock-select">
        ترجمات ASS المنسّقة
        <select
          value={style.assOverride}
          onChange={(e) => change({ assOverride: e.target.value })}
        >
          <option value="no">كما صمّمها صانعها</option>
          <option value="scale">كما صُمّمت مع الحجم الذي اخترته</option>
          <option value="force">بمظهري دائماً</option>
        </select>
      </label>
      <h3>الاختيار التلقائي</h3>
      <label className="dock-select">
        نوع الترجمة المفضل
        <select
          value={state.settings.subtitleKind || "standard"}
          onChange={(e) => update("settings", { subtitleKind: e.target.value })}
        >
          <option value="standard">عادية</option>
          <option value="sdh">للصم وضعاف السمع (SDH)</option>
          <option value="forced">إجبارية فقط</option>
        </select>
      </label>
      <label className="dock-toggle">
        <input
          type="checkbox"
          checked={state.settings.autoSubtitles !== "off"}
          onChange={(e) =>
            update("settings", {
              autoSubtitles: e.target.checked ? "preferred" : "off",
            })
          }
        />
        جلب ترجمة بلغتي من الإضافات إن لم يحملها الملف
      </label>
      <button
        className="secondary"
        onClick={() => change({ ...DEFAULT_SUBTITLE_STYLE })}
      >
        <RotateCcw size={14} /> استعادة المظهر الافتراضي
      </button>
    </div>
  );
}

function AudioRoom({ player, act }) {
  const audio = (player.tracks || []).filter((t) => t.type === "audio");
  return (
    <div className="dock-room">
      <h3>المسار الصوتي</h3>
      <div className="dock-list">
        {audio.map((t, index) => (
          <button
            key={t.id}
            className={`dock-row ${t.selected ? "selected" : ""}`}
            onClick={() => act("playerCommand", { action: "aid", value: t.id })}
          >
            <span className="dock-row-main">
              <span className="dock-index">{index + 1}</span>
              <span>
                <b>{audioLabel(t)}</b>
                {t.default && <small>افتراضي</small>}
              </span>
            </span>
            {t.selected && <Check size={16} />}
          </button>
        ))}
        {audio.length === 0 && (
          <p className="dock-note">لا توجد مسارات صوتية بعد.</p>
        )}
      </div>
      <h3>تأخير الصوت</h3>
      <Stepper
        value={player.audioDelay || 0}
        onChange={(value) =>
          act("playerCommand", { action: "audioDelay", value })
        }
      />
      <h3>مستوى الصوت</h3>
      <label className="dock-range">
        <span>
          الصوت <b>{Math.round(player.volume || 0)}%</b>
        </span>
        <input
          type="range"
          min="0"
          max="150"
          value={player.volume || 0}
          onChange={(e) =>
            act("playerCommand", {
              action: "volume",
              value: Number(e.target.value),
            })
          }
        />
      </label>
      <p className="dock-note">فوق 100% تضخيم للصوت للمصادر الهادئة.</p>
    </div>
  );
}

/** Every released episode of the series, by season, to jump to one. */
function EpisodesRoom({ player, state, act, onEpisode }) {
  const [meta, setMeta] = useState(null);
  const [season, setSeason] = useState(null);
  useEffect(() => {
    let live = true;
    act("metadata", { type: "series", id: player.meta?.id }).then(
      (m) => live && setMeta(m || { videos: [] }),
    );
    return () => {
      live = false;
    };
  }, [player.meta?.id]);
  const videos = meta ? releasedEpisodes(meta) : [];
  const seasons = [...new Set(videos.map((v) => v.season ?? 1))].sort(
    (a, b) => a - b,
  );
  const currentSeason =
    videos.find((v) => v.id === player.videoId)?.season ?? seasons[0];
  const shown = season ?? currentSeason;
  if (!meta) return <p className="dock-note dock-room">نجلب الحلقات…</p>;
  return (
    <div className="dock-room">
      {seasons.length > 1 && (
        <div className="dock-chips">
          {seasons.map((n) => (
            <button
              key={n}
              className={n === shown ? "active" : ""}
              onClick={() => setSeason(n)}
            >
              {n === 0 ? "خاصة" : `الموسم ${n}`}
            </button>
          ))}
        </div>
      )}
      <div className="dock-list">
        {videos
          .filter((v) => (v.season ?? 1) === shown)
          .map((v) => {
            const current = v.id === player.videoId;
            const done = isCompleted(state.progress?.[`series:${v.id}`] || {});
            return (
              <button
                key={v.id}
                className={`dock-row ${current ? "selected" : ""}`}
                onClick={() => !current && onEpisode(v.id)}
              >
                <span className="dock-row-main">
                  <span className="dock-index">{v.episode}</span>
                  <span>
                    <b dir="auto">
                      {v.title || v.name || `الحلقة ${v.episode}`}
                    </b>
                    <small>
                      {current ? "تشاهدها الآن" : done ? "شاهدتها" : ""}
                    </small>
                  </span>
                </span>
                {current ? (
                  <Play size={15} />
                ) : done ? (
                  <Check size={15} />
                ) : null}
              </button>
            );
          })}
        {videos.length === 0 && (
          <p className="dock-note">لا تتوفر قائمة حلقات لهذا العمل.</p>
        )}
      </div>
    </div>
  );
}

/**
 * The sources for what is playing, ranked as in Details. Switching keeps the
 * position: the player saves it and the new source resumes there.
 */
function SourcesRoom({ act }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    act("playerSources").then((r) => setResult(r || { streams: [] }));
  }, []);
  if (!result)
    return <p className="dock-note dock-room">نجمع المصادر من إضافاتك…</p>;
  const streams = result.streams.filter((s) => !s.external);
  return (
    <div className="dock-room">
      <p className="dock-note">
        بدّل المصدر إن تقطّع أو كانت جودته سيئة؛ تكمل من نفس اللحظة.
      </p>
      <div className="dock-list">
        {streams.map((s) => {
          const current = s.key === result.current;
          return (
            <button
              key={s.key}
              disabled={!s.supported || !!busy}
              className={`dock-row ${current ? "selected" : ""}`}
              onClick={async () => {
                if (current) return;
                setBusy(s.key);
                await act("switchSource", { key: s.key });
                setBusy("");
              }}
            >
              <span className="dock-row-main">
                <span className="dock-index">
                  {s.resolution === 2160
                    ? "4K"
                    : s.resolution
                      ? `${s.resolution}p`
                      : "—"}
                </span>
                <span>
                  <b dir="auto">{s.title || s.name}</b>
                  <small>
                    {[
                      s.provider,
                      s.hdr,
                      s.codec,
                      s.audio,
                      s.sizeLabel,
                      s.cached && "مخزّن",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
              </span>
              {busy === s.key ? (
                <RefreshCw size={15} />
              ) : current ? (
                <Check size={15} />
              ) : null}
            </button>
          );
        })}
        {streams.length === 0 && (
          <p className="dock-note">لم تجد إضافاتك مصادر أخرى لهذا العمل.</p>
        )}
      </div>
    </div>
  );
}
