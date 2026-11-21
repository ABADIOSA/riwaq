import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from "lucide-react";
import {
  FILTER_LIMIT,
  FILTER_OPTIONS,
  cleanAddonPriority,
} from "../../../core/stream-prefs.mjs";
import {
  BADGE_KINDS,
  RULE_LIMIT,
  patternProblem,
  ruleBadges,
} from "../../../core/badges.mjs";
import {
  LOOK_SUPERSEDED,
  chooseLook,
  isFrLook,
} from "../../../core/badge-look.mjs";
import { call } from "../../lib/api.js";
import { RuleBadge } from "../StreamBadge.jsx";

const newId = () =>
  (crypto.randomUUID?.() || `${Date.now()}${Math.random()}`)
    .replace(/[^\w-]/g, "")
    .slice(0, 20);

function Choices({ options, value, onPick }) {
  return (
    <div className="choice-row" role="radiogroup">
      {options.map(([id, label]) => (
        <button
          key={String(id)}
          role="radio"
          aria-checked={value === id}
          className={value === id ? "selected" : ""}
          onClick={() => onPick(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
function Toggle({ on, title, text, onChange }) {
  return (
    <div className="setting-row">
      <div>
        <b>{title}</b>
        {text && <p>{text}</p>}
      </div>
      <button
        className={`toggle ${on ? "on" : ""}`}
        aria-label={title}
        aria-pressed={!!on}
        onClick={() => onChange(!on)}
      >
        <span />
      </button>
    </div>
  );
}

/** Result order, and the viewer's own addon order. */
export function SortingPage({ state, update }) {
  const s = state.settings;
  const streamAddons = state.addons.filter(
    (a) => a.enabled && a.resources.includes("stream"),
  );
  const priority = cleanAddonPriority(s.addonPriority);
  // One entry per addon ID: copies of the same addon (installed twice with
  // different settings) move together and keep their install order.
  const byId = new Map();
  for (const a of streamAddons) {
    const entry = byId.get(a.id);
    if (entry) entry.copies++;
    else byId.set(a.id, { ...a, copies: 1 });
  }
  const ordered = [
    ...priority.map((id) => byId.get(id)).filter(Boolean),
    ...[...byId.values()].filter((a) => !priority.includes(a.id)),
  ];
  const move = (index, delta) => {
    const ids = ordered.map((a) => a.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    update("settings", { addonPriority: ids });
  };
  return (
    <>
      <section className="settings-card">
        <h2>ترتيب النتائج</h2>
        <p>كيف تُرتّب مصادر المشاهدة في القائمة وعند التشغيل التلقائي.</p>
        <div className="frame-options" role="radiogroup">
          {[
            [
              "riwaq",
              "ترتيب رِواق",
              "الافتراضي. يقرأ محرّك رِواق كل مصدر ويقيّمه ويضع الأفضل جودةً ولغةً وموثوقيةً أولاً، ويشرح سبب كل ترتيب.",
            ],
            [
              "addon",
              "ترتيب إضافاتي",
              "نتائج الإضافة الأعلى في قائمتك تحت تأتي أولاً، مثل ستريميو.",
            ],
          ].map(([id, title, text]) => (
            <button
              key={id}
              role="radio"
              aria-checked={(s.streamOrder || "riwaq") === id}
              className={(s.streamOrder || "riwaq") === id ? "selected" : ""}
              onClick={() => update("settings", { streamOrder: id })}
            >
              <span>
                <b>{title}</b>
                <small>{text}</small>
              </span>
              {(s.streamOrder || "riwaq") === id && <Check size={16} />}
            </button>
          ))}
        </div>
      </section>
      {s.streamOrder === "addon" && (
        <section className="settings-card">
          <h2>داخل كل إضافة</h2>
          <div className="frame-options" role="radiogroup">
            {[
              [
                "addon",
                "ترتيب الإضافة نفسها",
                "الافتراضي. المصادر بالترتيب اللي ترسله الإضافة، يعني حسب إعدادات الفرز اللي ضبطتها فيها (مثل AIOStreams وTorrentio).",
              ],
              [
                "riwaq",
                "ترتيب رِواق",
                "رِواق يعيد ترتيب مصادر كل إضافة بالجودة واللغة والموثوقية.",
              ],
            ].map(([id, title, text]) => (
              <button
                key={id}
                role="radio"
                aria-checked={(s.streamOrderInside || "addon") === id}
                className={
                  (s.streamOrderInside || "addon") === id ? "selected" : ""
                }
                onClick={() => update("settings", { streamOrderInside: id })}
              >
                <span>
                  <b>{title}</b>
                  <small>{text}</small>
                </span>
                {(s.streamOrderInside || "addon") === id && <Check size={16} />}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="settings-card">
        <h2>أولوية الإضافات</h2>
        <p>
          رتّب إضافات المصادر. تُستخدم مع «ترتيب إضافاتي»، وإن لم تجد إضافة
          شيئاً تكمل التي بعدها.
        </p>
        {ordered.length ? (
          <ol className="home-editor">
            {ordered.map((a, i) => (
              <li key={a.id}>
                <span dir="auto">
                  <b>
                    {a.name}
                    {a.copies > 1 ? ` (${a.copies} نسخ)` : ""}
                  </b>
                  <small>{a.host}</small>
                </span>
                <div className="button-row">
                  <button
                    title="أعلى"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    title="أسفل"
                    disabled={i === ordered.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="subtle">لا توجد إضافات مصادر مفعّلة.</p>
        )}
        {s.streamOrder !== "addon" && ordered.length > 1 && (
          <small className="subtle">
            هذا الترتيب لا يُستخدم الآن لأن «ترتيب رِواق» هو المختار.
          </small>
        )}
      </section>
    </>
  );
}

/** How the picker looks, and which kinds of links it offers. */
export function PickerPage({ state, update }) {
  const s = state.settings;
  return (
    <>
      <section className="settings-card">
        <h2>شكل قائمة المصادر</h2>
        <div className="picker-layouts">
          {[
            ["detailed", "مفصّل", "اسم المصدر واسم النسخة وكل الشارات"],
            ["compact", "مختصر", "سطر واحد لكل مصدر"],
          ].map(([id, title, text]) => (
            <button
              key={id}
              className={
                (s.pickerLayout || "detailed") === id ? "selected" : ""
              }
              onClick={() => update("settings", { pickerLayout: id })}
            >
              <span className={`picker-art picker-${id}`}>
                <i />
                <i />
                <i />
              </span>
              <b>{title}</b>
              <small>{text}</small>
            </button>
          ))}
        </div>
        <Toggle
          on={s.pickerReleaseName !== false}
          title="إظهار اسم النسخة"
          text="اسم ملف النسخة كما أرسلته الإضافة، تحت اسم المصدر."
          onChange={(pickerReleaseName) =>
            update("settings", { pickerReleaseName })
          }
        />
      </section>
      <section className="settings-card">
        <h2>نوع المصادر</h2>
        <p>
          اختر الروابط التي تظهر. إن لم يوجد مصدر من النوع المختار يعرض رِواق كل
          المصادر ويخبرك.
        </p>
        <Choices
          options={[
            ["all", "الكل"],
            ["direct", "روابط مباشرة وخدمات Debrid"],
            ["p2p", "تورنت (P2P)"],
          ]}
          value={s.sourceMode || "all"}
          onPick={(sourceMode) => update("settings", { sourceMode })}
        />
      </section>
    </>
  );
}

const LABELS = {
  resolution: "الدقة",
  source: "نوع النسخة",
  codec: "ترميز الفيديو",
  audio: "الصوت",
};
const blank = () => ({
  id: newId(),
  name: "",
  resolution: [],
  source: [],
  codec: [],
  audio: [],
  requireHdr: false,
  cachedOnly: false,
  minSeeders: 0,
  maxSizeGb: 0,
});
const summary = (f) =>
  [
    ...f.resolution,
    ...f.source,
    ...f.codec,
    ...f.audio,
    f.requireHdr && "HDR",
    f.cachedOnly && "مخزّن",
    f.minSeeders && `${f.minSeeders}+ مشارك`,
    f.maxSizeGb && `حتى ${f.maxSizeGb} GB`,
  ]
    .filter(Boolean)
    .join(" · ");

/** Saved stream filters: the quality the viewer prefers, one active. */
export function FiltersPage({ state, update, act, setState, notice }) {
  const s = state.settings;
  const filters = s.streamFilters || [];
  const [draft, setDraft] = useState(null);
  const save = (list, extra = {}) =>
    update("settings", { streamFilters: list, ...extra });
  const commit = async () => {
    const name = draft.name.trim() || "مرشح بلا اسم";
    const next = filters.some((f) => f.id === draft.id)
      ? filters.map((f) => (f.id === draft.id ? { ...draft, name } : f))
      : [...filters, { ...draft, name }];
    if (await save(next, filters.length ? {} : { activeFilter: draft.id }))
      setDraft(null);
  };
  const toggle = (key, value) =>
    setDraft({
      ...draft,
      [key]: draft[key].includes(value)
        ? draft[key].filter((v) => v !== value)
        : [...draft[key], value],
    });
  // One press deletes one filter, no question first (issue #153); the
  // notice offers Undo, which puts it back in its place, active again if
  // it was. Only this filter goes: there is no delete-all here. Both are
  // done by main on the profile's list as it is then, and both name the
  // profile they were pressed in: an Undo pressed after switching profile,
  // even with this page closed, is refused there and changes neither
  // profile (PR #155 review, F2).
  const remove = async (filter) => {
    // The activation it was pressed in (second review, F2): an Undo after a
    // switch away and back, or a re-lock, finds nothing to restore.
    const profileSession = state.profiles?.session;
    const r = await act("streamFilterEdit", {
      profileSession,
      action: "remove",
      id: filter.id,
    });
    if (!r) return;
    setState(r.state);
    notice(`حُذف المرشح «${filter.name}»`, {
      label: "تراجع",
      run: async () => {
        const back = await act("streamFilterEdit", {
          profileSession,
          action: "restore",
          id: filter.id,
        });
        if (back) setState(back.state);
      },
    });
  };
  return (
    <section className="settings-card">
      <div className="section-heading">
        <div>
          <h2>مرشحات البث المحفوظة</h2>
          <p>
            احفظ الجودة التي تفضلها. يجب أن يطابق المصدر كل فئة تختارها، والفئة
            الفارغة تقبل أي قيمة. إن لم يطابق شيء، يعرض رِواق الأفضل المتاح.
          </p>
        </div>
        <button
          className="primary"
          disabled={filters.length >= FILTER_LIMIT || !!draft}
          onClick={() => setDraft(blank())}
        >
          <Plus size={16} /> مرشح جديد
        </button>
      </div>
      <div className="filter-list" role="radiogroup">
        <button
          role="radio"
          aria-checked={!s.activeFilter}
          className={`filter-item ${!s.activeFilter ? "selected" : ""}`}
          onClick={() => update("settings", { activeFilter: "" })}
        >
          <span>
            <b>بدون مرشح</b>
            <small>كل المصادر بترتيبها.</small>
          </span>
          {!s.activeFilter && <Check size={16} />}
        </button>
        {filters.map((f) => (
          <div
            key={f.id}
            className={`filter-item ${s.activeFilter === f.id ? "selected" : ""}`}
          >
            <button
              role="radio"
              aria-checked={s.activeFilter === f.id}
              className="filter-pick"
              onClick={() => update("settings", { activeFilter: f.id })}
            >
              <span>
                <b dir="auto">{f.name}</b>
                <small>{summary(f) || "لم تُختر أي تفضيلات بعد"}</small>
              </span>
              {s.activeFilter === f.id && <Check size={16} />}
            </button>
            <div className="button-row">
              <button title="تعديل" onClick={() => setDraft({ ...f })}>
                <Pencil size={14} />
              </button>
              <button
                title="حذف"
                aria-label={`حذف المرشح «${f.name}»`}
                onClick={() => remove(f)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {draft && (
        <div className="filter-editor">
          <label className="studio-field">
            اسم المرشح
            <input
              autoFocus
              maxLength={40}
              placeholder="مثال: 4K بصوت أتموس"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          {Object.entries(FILTER_OPTIONS).map(([key, values]) => (
            <div className="studio-field" key={key}>
              {LABELS[key]}
              <div className="choice-row">
                {values.map((v) => (
                  <button
                    key={v}
                    aria-pressed={draft[key].includes(v)}
                    className={draft[key].includes(v) ? "selected" : ""}
                    onClick={() => toggle(key, v)}
                  >
                    {v === "Other" ? "أخرى" : v}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="choice-row">
            <button
              aria-pressed={draft.requireHdr}
              className={draft.requireHdr ? "selected" : ""}
              onClick={() =>
                setDraft({ ...draft, requireHdr: !draft.requireHdr })
              }
            >
              HDR فقط
            </button>
            <button
              aria-pressed={draft.cachedOnly}
              className={draft.cachedOnly ? "selected" : ""}
              onClick={() =>
                setDraft({ ...draft, cachedOnly: !draft.cachedOnly })
              }
            >
              المخزّن في Debrid فقط
            </button>
          </div>
          <div className="filter-numbers">
            <label className="studio-field">
              أقل عدد مشاركين للتورنت
              <input
                type="number"
                min="0"
                max="10000"
                value={draft.minSeeders || ""}
                placeholder="بلا حد"
                onChange={(e) =>
                  setDraft({ ...draft, minSeeders: Number(e.target.value) })
                }
              />
            </label>
            <label className="studio-field">
              أكبر حجم (GB)
              <input
                type="number"
                min="0"
                max="500"
                step="0.5"
                value={draft.maxSizeGb || ""}
                placeholder="بلا حد"
                onChange={(e) =>
                  setDraft({ ...draft, maxSizeGb: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <div className="button-row">
            <button className="primary" onClick={commit}>
              <Check size={15} /> احفظ المرشح
            </button>
            <button className="secondary" onClick={() => setDraft(null)}>
              إلغاء
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const SAMPLE = {
  resolution: "4K",
  hdr: "DV+HDR10",
  codec: "HEVC",
  source: "REMUX",
  audio: "Atmos 7.1",
  size: "58.4 GB",
  seeders: "212",
  cached: "RD",
  group: "FraMeSToR",
  arabic: "ترجمة عربية",
};

/**
 * "Stream badge appearance" (core/badge-look.mjs), replacing the Harbor
 * badge packs page (issue #152): Riwaq's chips, Liquid Glass, three
 * FR-Badges styles fetched from their pinned file when chosen, or none.
 */
const LOOKS = [
  ["riwaq", "رِواق الافتراضي", "الشارات النصية كما كانت."],
  ["liquid", "زجاج سائل", "شارات زجاجية بلون السمة، مرسومة محلياً بلا تحميل."],
  [
    "fr-glass",
    "FR Glass",
    "صور FR-Badges الداكنة. تُجلب من GitHub عند اختيارها.",
  ],
  ["fr-frost", "FR Frost", "صور FR-Badges الزجاجية، تناسب الملصقات والخلفيات."],
  ["fr-minimal", "Minimal", "صور FR-Badges المختصرة."],
  ["off", "بدون شارات", "يخفي شارات الصيغة كلها؛ تبقى شاراتك المخصصة."],
];

function BadgeLookCard({ state, update, act, setState, notice }) {
  const s = state.settings;
  const on = s.badgesOn !== false;
  const current = on ? s.badgeLook || "riwaq" : "off";
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const choose = async (look) => {
    if (busy || look === current) return;
    setError("");
    setReport(null);
    if (look === "off") return update("settings", { badgesOn: false });
    if (!isFrLook(look)) return update("settings", chooseLook(s, look));
    setBusy(look);
    // Main fetches the style and adds it to this profile's settings only
    // if this profile is still the active one when the file arrives; a
    // switch meanwhile leaves both profiles as they were (F2).
    try {
      const r = await call("badgeStyleApply", {
        look,
        profileSession: state.profiles?.session,
      });
      setState(r.state);
      const done = r.report;
      setReport(done);
      notice(
        done.over
          ? `«${done.style}»: حُمّلت ${done.loaded} شارة و${done.pictures} صورة، ولم تتسع ${done.over}`
          : `«${done.style}»: حُمّلت ${done.loaded} شارة و${done.pictures} صورة`,
      );
    } catch (e) {
      // A newer choice won (made elsewhere, or after this page was closed
      // and opened again): nothing failed and nothing changes (R3).
      if (e.message !== LOOK_SUPERSEDED)
        setError(
          `${e.message}. بقي المظهر كما كان؛ تحقق من الاتصال وحاول مرة ثانية.`,
        );
    }
    setBusy("");
  };
  return (
    <section className="settings-card badge-look-card">
      <h2>مظهر شارات المصادر</h2>
      <p>
        كيف تظهر شارات الدقة وHDR والصوت والمصدر بجانب كل مصدر. لا يُفرض شيء:
        «رِواق الافتراضي» يبقى كما هو حتى تختار غيره.
      </p>
      <div className="badge-looks" role="radiogroup" aria-label="مظهر الشارات">
        {LOOKS.map(([id, title, text]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={current === id}
            aria-busy={busy === id}
            disabled={!!busy}
            className={`badge-look ${current === id ? "selected" : ""}`}
            onClick={() => choose(id)}
          >
            <span className={`badge-look-sample look-${id}`} aria-hidden="true">
              <i>4K</i>
              <i>DV</i>
              <i>Atmos</i>
            </span>
            <b>{busy === id ? "نجلب النمط…" : title}</b>
            <small>{text}</small>
          </button>
        ))}
      </div>
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
      {report && (
        <p className="subtle" role="status">
          {`${report.style}: ${report.loaded} شارة بصورتها و${report.pictures} صورة للشارات المدمجة، من ${report.total} شارة في ملف FR-Badges المختصر.`}
          {report.over > 0 &&
            ` ${report.over} لم تتسع بعد قواعدك الخاصة (${report.own}): الحد ${RULE_LIMIT} قاعدة.`}
        </p>
      )}
      <p className="subtle">
        أنماط FR تأتي من FR-Badges لـ farizmohd70 (رخصة MIT)؛ صورها تُحمّل من
        GitHub عند عرض المصادر، وإن تعذّر تحميل صورة تظهر شارتها زجاجية بنصها.
        اختيار نمط آخر يزيل شارات النمط السابق ويُبقي شاراتك الخاصة.
      </p>
    </section>
  );
}

/** Built-in format chips: their look, and single kinds hidden. */
export function BadgesPage({ state, update, act, setState, notice }) {
  const s = state.settings;
  const hidden = new Set(s.badgesHidden || []);
  const on = s.badgesOn !== false;
  return (
    <>
      <BadgeLookCard
        state={state}
        update={update}
        act={act}
        setState={setState}
        notice={notice}
      />
      <section className="settings-card">
        <div
          className={`badge-preview badges-${on ? s.badgeLook || "riwaq" : "off"}`}
          aria-label="معاينة"
        >
          <span className="stream-quality">
            {on && !hidden.has("resolution") ? "4K" : "▶"}
          </span>
          <span>
            <b>Torrentio · RD+</b>
            <small>
              {on &&
                BADGE_KINDS.filter(
                  ([k]) => k !== "resolution" && !hidden.has(k),
                ).map(([k]) => <em key={k}>{SAMPLE[k]}</em>)}
            </small>
          </span>
        </div>
      </section>
      <section className="settings-card">
        <h2>كل الشارات</h2>
        <p>اختر ما يظهر من الشارات. التغيير يطبّق على كل قوائم المصادر.</p>
        <div className="choice-row">
          {BADGE_KINDS.map(([id, label]) => {
            const shown = !hidden.has(id);
            return (
              <button
                key={id}
                aria-pressed={shown}
                className={shown ? "selected" : ""}
                disabled={!on}
                onClick={() =>
                  update("settings", {
                    badgesHidden: shown
                      ? [...hidden, id]
                      : [...hidden].filter((k) => k !== id),
                  })
                }
              >
                {shown && <Check size={13} />} {label}
              </button>
            );
          })}
        </div>
        {hidden.size > 0 && (
          <button
            className="secondary small"
            onClick={() => update("settings", { badgesHidden: [] })}
          >
            أظهر كل الشارات
          </button>
        )}
      </section>
    </>
  );
}

/** The viewer's own badges, each a label, a colour and a pattern. */
export function BadgeRulesPage({ state, update, notice }) {
  const s = state.settings;
  const rules = s.badgeRules || [];
  const [draft, setDraft] = useState({
    label: "",
    pattern: "",
    color: "#E7B66E",
  });
  const [search, setSearch] = useState("");
  const [showPacks, setShowPacks] = useState(false);
  const fromPacks = rules.filter((r) => r.pack).length;
  const [sample, setSample] = useState(
    "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1-FraMeSToR",
  );
  const problem = draft.pattern ? patternProblem(draft.pattern) : "";
  const save = (list) => update("settings", { badgeRules: list });
  const visible = rules.filter(
    (r) =>
      (showPacks || !r.pack || search) &&
      (!search ||
        `${r.label} ${r.pattern} ${r.pack || ""}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const earned = useMemo(
    () => ruleBadges({ name: "", title: sample }, rules),
    [sample, rules],
  );
  return (
    <>
      <section className="settings-card">
        <h2>أضف قاعدة</h2>
        <p>
          شاراتك الخاصة: يختبر رِواق النمط على اسم كل مصدر، وكل مصدر يطابقه يحمل
          الشارة. مناسبة لمجموعات الإصدار والمزوّدين وما لا تغطيه الشارات
          المدمجة.
        </p>
        <div className="rule-form">
          <label className="studio-field">
            نص الشارة
            <input
              maxLength={24}
              placeholder="مثال: REMUX"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>
          <label className="studio-field">
            النمط (تعبير نمطي)
            <input
              dir="ltr"
              maxLength={200}
              placeholder="remux|bdremux"
              value={draft.pattern}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
            />
          </label>
          <label className="studio-field rule-color">
            اللون
            <input
              type="color"
              value={draft.color.toLowerCase()}
              onChange={(e) =>
                setDraft({ ...draft, color: e.target.value.toUpperCase() })
              }
            />
          </label>
        </div>
        {problem && <p className="inline-warning">{problem}</p>}
        <button
          className="primary"
          disabled={
            !draft.label.trim() ||
            !draft.pattern.trim() ||
            !!problem ||
            rules.length >= RULE_LIMIT
          }
          onClick={async () => {
            if (
              await save([{ id: newId(), ...draft, enabled: true }, ...rules])
            ) {
              setDraft({ label: "", pattern: "", color: draft.color });
              notice("أُضيفت القاعدة في أعلى القائمة");
            }
          }}
        >
          <Plus size={15} /> احفظ القاعدة
        </button>
      </section>
      <section className="settings-card">
        <h2>جرّب اسم مصدر</h2>
        <input
          dir="ltr"
          className="rule-sample"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
        />
        <div className="rule-earned">
          {earned.length ? (
            earned.map((b) => <RuleBadge key={b.label} badge={b} />)
          ) : (
            <small className="subtle">لا تطابقه أي قاعدة مفعّلة.</small>
          )}
        </div>
      </section>
      <section className="settings-card">
        <div className="section-heading">
          <div>
            <h2>قواعدك</h2>
            <p>
              {rules.filter((r) => r.enabled).length} من {rules.length} مفعّلة
            </p>
          </div>
          {rules.length > 0 && (
            <div className="button-row">
              <button
                className="secondary small"
                onClick={() =>
                  save(
                    rules.map((r) =>
                      visible.includes(r) ? { ...r, enabled: true } : r,
                    ),
                  )
                }
              >
                فعّل الكل
              </button>
              <button
                className="secondary small"
                onClick={() =>
                  save(
                    rules.map((r) =>
                      visible.includes(r) ? { ...r, enabled: false } : r,
                    ),
                  )
                }
              >
                عطّل الكل
              </button>
            </div>
          )}
        </div>
        {rules.length > 3 && (
          <input
            className="rule-search"
            placeholder="ابحث بالاسم أو النمط"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
        {fromPacks > 0 && (
          <button
            className="text-button"
            onClick={() => setShowPacks(!showPacks)}
          >
            {showPacks
              ? "أخفِ شارات الأنماط المثبّتة"
              : `أظهر ${fromPacks} شارة من الأنماط المثبّتة`}
          </button>
        )}
        {visible.length ? (
          <ul className="rule-list">
            {visible.map((r) => (
              <li key={r.id} className={r.enabled ? "" : "off"}>
                <RuleBadge badge={r} />
                <code dir="ltr">
                  {r.pack ? `${r.pack} · ` : ""}
                  {r.pattern}
                </code>
                <button
                  className={`toggle ${r.enabled ? "on" : ""}`}
                  aria-label={`تفعيل ${r.label}`}
                  aria-pressed={r.enabled}
                  onClick={() =>
                    save(
                      rules.map((x) =>
                        x.id === r.id ? { ...x, enabled: !x.enabled } : x,
                      ),
                    )
                  }
                >
                  <span />
                </button>
                <button
                  className="icon-plain"
                  title="حذف"
                  onClick={() => save(rules.filter((x) => x.id !== r.id))}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle">
            {rules.length
              ? "لا قواعد تطابق بحثك."
              : "لا توجد قواعد بعد. أضف واحدة بالأعلى."}
          </p>
        )}
      </section>
    </>
  );
}
