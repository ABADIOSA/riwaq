import React, { useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  FILTER_LIMIT,
  FILTER_OPTIONS,
  cleanAddonPriority,
} from "../../../core/stream-prefs.mjs";
import {
  BADGE_KINDS,
  RULE_LIMIT,
  exportBadgePack,
  importBadgePack,
  patternProblem,
  ruleBadges,
} from "../../../core/badges.mjs";
import { call } from "../../lib/api.js";

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
  const ordered = [
    ...priority
      .map((id) => streamAddons.find((a) => a.id === id))
      .filter(Boolean),
    ...streamAddons.filter((a) => !priority.includes(a.id)),
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
              "نتائج الإضافة الأعلى في قائمتك تحت تأتي أولاً، وداخل كل إضافة يبقى ترتيب رِواق.",
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
                  <b>{a.name}</b>
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
export function FiltersPage({ state, update, notice }) {
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
                onClick={async () =>
                  window.confirm(`حذف المرشح «${f.name}»؟`) &&
                  (await save(filters.filter((x) => x.id !== f.id))) &&
                  notice("حُذف المرشح")
                }
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

/** Built-in format chips: all on or off, and single kinds hidden. */
export function BadgesPage({ state, update }) {
  const s = state.settings;
  const hidden = new Set(s.badgesHidden || []);
  const on = s.badgesOn !== false;
  return (
    <>
      <section className="settings-card">
        <Toggle
          on={on}
          title="إظهار شارات الصيغة على المصادر"
          text="الشارات الصغيرة للدقة وHDR والترميز والصوت بجانب كل مصدر في قائمة التشغيل. إطفاؤها يخفيها كلها، وتبقى شاراتك المخصصة."
          onChange={(badgesOn) => update("settings", { badgesOn })}
        />
        <div className="badge-preview" aria-label="معاينة">
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
  const [sample, setSample] = useState(
    "Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.Atmos.7.1-FraMeSToR",
  );
  const problem = draft.pattern ? patternProblem(draft.pattern) : "";
  const save = (list) => update("settings", { badgeRules: list });
  const visible = rules.filter(
    (r) =>
      !search ||
      `${r.label} ${r.pattern}`.toLowerCase().includes(search.toLowerCase()),
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
            earned.map((b) => (
              <em
                key={b.label}
                className="tag-custom"
                style={{ "--badge": b.color }}
              >
                {b.label}
              </em>
            ))
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
        {visible.length ? (
          <ul className="rule-list">
            {visible.map((r) => (
              <li key={r.id} className={r.enabled ? "" : "off"}>
                <em className="tag-custom" style={{ "--badge": r.color }}>
                  {r.label}
                </em>
                <code dir="ltr">{r.pattern}</code>
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
              : "لا توجد قواعد بعد. أضف واحدة أو استورد حزمة."}
          </p>
        )}
      </section>
    </>
  );
}

/** Packs: a JSON file of rules and hidden kinds, to share or import. */
export function BadgePacksPage({ state, update, notice }) {
  const s = state.settings;
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const file = useRef(null);
  const apply = async (json) => {
    try {
      const pack = importBadgePack(json, () => newId());
      const merged = [...pack.rules, ...(s.badgeRules || [])].slice(
        0,
        RULE_LIMIT,
      );
      if (
        await update("settings", {
          badgeRules: merged,
          badgesHidden: [
            ...new Set([...(s.badgesHidden || []), ...pack.hidden]),
          ],
        })
      ) {
        setText("");
        setError("");
        notice(
          `أُضيفت ${pack.rules.length} قاعدة${pack.skipped ? ` وتُركت ${pack.skipped} غير صالحة` : ""}`,
        );
      }
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <>
      <section className="settings-card">
        <h2>استيراد حزمة</h2>
        <p>
          الحزمة ملف badges.json يضيف قواعد شارات جاهزة. تُفحص كل قاعدة قبل
          إضافتها، ولا يُنفّذ أي شيء من الملف.
        </p>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > 200000) return setError("الملف أكبر من المسموح");
            apply(await f.text());
          }}
        />
        <button className="secondary" onClick={() => file.current?.click()}>
          <Upload size={15} /> استيراد من ملف
        </button>
        <label className="studio-field">
          أو الصق محتوى الحزمة
          <textarea
            dir="ltr"
            rows={5}
            placeholder='{"rules":[{"label":"REMUX","pattern":"remux","color":"#E7B66E"}]}'
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError("");
            }}
          />
        </label>
        {error && <p className="inline-warning">{error}</p>}
        <button
          className="primary"
          disabled={!text.trim()}
          onClick={() => apply(text)}
        >
          استيراد
        </button>
      </section>
      <section className="settings-card">
        <h2>شارك إعدادك</h2>
        <p>انسخ قواعدك والشارات المخفية كملف JSON لتشاركها.</p>
        <div className="button-row">
          <button
            className="secondary"
            onClick={async () =>
              (await call("copyBadgePack", {
                json: exportBadgePack(s),
              }).catch(() => false)) && notice("نُسخ إعدادك كـ JSON")
            }
          >
            <Copy size={15} /> نسخ JSON
          </button>
          {(s.badgeRules || []).length > 0 && (
            <button
              className="secondary danger"
              onClick={() =>
                window.confirm("حذف كل القواعد المخصصة؟") &&
                update("settings", { badgeRules: [] }).then(
                  (ok) => ok && notice("حُذفت كل القواعد"),
                )
              }
            >
              <X size={15} /> حذف كل القواعد
            </button>
          )}
        </div>
      </section>
    </>
  );
}
