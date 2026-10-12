import React, { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderOpen,
  Loader2,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { isWeb } from "../../lib/api.js";
import { arabicCount, SHADER_FILES } from "../../../core/arabic.mjs";
import { chosenPreset, cleanShaderChain } from "../../../core/shaders.mjs";

const size = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} م.ب`
    : `${Math.round(bytes / 1024)} ك.ب`;

const GROUPS = [
  [
    "anime4k-hq",
    "Anime4K · HQ",
    (o) => o.pack === "anime4k" && /-hq$/.test(o.id),
  ],
  [
    "anime4k-fast",
    "Anime4K · Fast",
    (o) => o.pack === "anime4k" && /-fast$/.test(o.id),
  ],
  ["fsrcnnx", "FSRCNNX", (o) => o.pack === "fsrcnnx"],
  ["own", "من مجلدك", (o) => o.pack === "own" || o.pack === "file"],
];

/**
 * GLSL shaders (issue #70): Anime4K and FSRCNNX as Harbor offers them, from
 * a pinned download or the viewer's own folder, plus a chain of their own.
 * The interface sees pack names and file names; folders stay in main.
 */
export function ShaderCard({ state, update, act, notice }) {
  const s = state.settings;
  const set = (patch) => update("settings", patch);
  const [library, setLibrary] = useState(null);
  const [busy, setBusy] = useState("");
  const load = async () => {
    const result = await act("shaderLibrary");
    if (result) setLibrary(result);
  };
  useEffect(() => {
    if (!isWeb) load();
  }, [s.shaderDir]);
  if (isWeb) return null;
  const options = library?.options || [];
  const current = chosenPreset(s);
  const files = (library?.own.files || []).map((f) => f.name);
  const chain = cleanShaderChain(s.shaderChain, files);
  const pick = (shaderPreset) =>
    set({
      shaderPreset,
      // The old single-file profile would come back when nothing is chosen.
      ...(s.shader === "custom" ? { shader: "none" } : {}),
    });
  const download = async (pack) => {
    setBusy(pack.id);
    const result = await act("shaderDownload", { pack: pack.id });
    setBusy("");
    if (result) {
      setLibrary(result);
      notice(`نُزّلت ${pack.name} وتحقق رِواق من بصمتها`);
    }
  };
  const remove = async (pack) => {
    const result = await act("shaderRemove", { pack: pack.id });
    if (result) setLibrary(result);
  };
  const folder = async (clear) => {
    const result = await update("chooseShaderFolder", clear ? { clear } : {});
    if (result) load();
  };
  const move = (name, step) => {
    const next = [...chain];
    const at = next.indexOf(name);
    const to = at + step;
    if (at < 0 || to < 0 || to >= next.length) return;
    [next[at], next[to]] = [next[to], next[at]];
    set({ shaderChain: next });
  };
  return (
    <section className="settings-card shader-card">
      <h2>شيدرات GLSL</h2>
      <p>
        مثل Harbor: Anime4K يرمّم الأنمي ويكبّره، وFSRCNNX يكبّر الأفلام
        والمسلسلات بحدّة. رِواق لا يرفق ملفات شيدر: نزّل الإصدار الرسمي من
        GitHub بضغطة (يتحقق رِواق من حجمه وبصمته قبل حفظه)، أو اختر مجلدك الخاص.
      </p>
      {!library ? (
        <p className="subtle">
          <Loader2 className="spin" size={15} /> يقرأ المكتبة…
        </p>
      ) : (
        <>
          <div className="shader-packs">
            {library.packs.map((pack) => (
              <div className="setting-row" key={pack.id}>
                <div>
                  <b>
                    {pack.name} <small dir="ltr">{pack.version}</small>
                    {pack.installed && <em className="setting-tag">مثبّتة</em>}
                  </b>
                  <p>
                    رخصة {pack.license} · {size(pack.size)} ·{" "}
                    <span dir="ltr">
                      {pack.home.replace("https://github.com/", "")}
                    </span>
                  </p>
                </div>
                {pack.installed ? (
                  <button
                    className="secondary small"
                    onClick={() => remove(pack)}
                  >
                    <Trash2 size={15} /> حذف
                  </button>
                ) : (
                  <button
                    className="secondary small"
                    disabled={!!busy}
                    onClick={() => download(pack)}
                  >
                    {busy === pack.id ? (
                      <Loader2 className="spin" size={15} />
                    ) : (
                      <Download size={15} />
                    )}{" "}
                    {busy === pack.id ? "ينزّل…" : "تنزيل"}
                  </button>
                )}
              </div>
            ))}
            <div className="setting-row">
              <div>
                <b>مجلدك الخاص</b>
                <p className="path" dir="ltr">
                  {library.own.dir || "—"}
                </p>
                <p>
                  {library.own.missing
                    ? "المجلد غير موجود على هذا الجهاز"
                    : library.own.dir
                      ? `${arabicCount(library.own.files.length, SHADER_FILES)}. إن كان فيه Anime4K أو FSRCNNX ظهرت أوضاعها هنا.`
                      : "ملفات ‎.glsl و‎.hook عندك: Anime4K أو FSR أو CAS أو غيرها."}
                </p>
              </div>
              <div className="row-actions">
                <button className="secondary small" onClick={() => folder()}>
                  <FolderOpen size={15} /> اختيار…
                </button>
                {s.shaderDir && (
                  <button
                    className="ghost small"
                    title="انسَ المجلد"
                    onClick={() => folder(true)}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <h3>الشيدر أثناء المشاهدة</h3>
          {options.length === 0 ? (
            <p className="subtle">
              نزّل حزمة أو اختر مجلداً، وتظهر هنا الأوضاع المتاحة.
            </p>
          ) : (
            <>
              <div className="choice-row" role="radiogroup" aria-label="الشيدر">
                <button
                  role="radio"
                  aria-checked={current === ""}
                  className={current === "" ? "selected" : ""}
                  onClick={() => pick("")}
                >
                  بدون
                </button>
              </div>
              {GROUPS.map(([id, title, test]) => {
                const group = options.filter(test);
                if (!group.length) return null;
                return (
                  <div className="shader-group" key={id}>
                    <small>{title}</small>
                    <div
                      className="choice-row"
                      role="radiogroup"
                      aria-label={title}
                    >
                      {group.map((o) => (
                        <button
                          key={o.id}
                          role="radio"
                          title={o.hint}
                          aria-checked={current === o.id}
                          className={current === o.id ? "selected" : ""}
                          onClick={() => pick(o.id)}
                        >
                          {o.label.replace(/^Anime4K |^FSRCNNX /, "")}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {options.find((o) => o.id === current)?.hint && (
                <p className="subtle" dir="auto">
                  {options.find((o) => o.id === current).hint}
                </p>
              )}
              <h3>أين يعمل Anime4K</h3>
              <div
                className="choice-row"
                role="radiogroup"
                aria-label="أين يعمل Anime4K"
              >
                {[
                  ["auto", "على الأنمي فقط"],
                  ["all", "على كل شيء"],
                ].map(([id, text]) => (
                  <button
                    key={id}
                    role="radio"
                    aria-checked={(s.shaderScope || "auto") === id}
                    className={
                      (s.shaderScope || "auto") === id ? "selected" : ""
                    }
                    onClick={() => set({ shaderScope: id })}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <p className="subtle">
                زر الشيدر في أدوات المشاهدة ومفتاح «تبديل الشيدر» يتنقلان بين
                أوضاع الحزمة نفسها. اختيارك أثناء المشاهدة يعمل حتى على غير
                الأنمي. وضع التوافق يوقف الشيدرات.
              </p>
            </>
          )}

          {files.length > 0 && (
            <>
              <h3>سلسلتك</h3>
              <p className="subtle">
                رتّب ملفات مجلدك بالترتيب الذي يمرّ به الفيديو (حتى 16 ملفاً)،
                ثم اختر «سلسلتك» فوق.
              </p>
              {chain.length > 0 && (
                <ol className="shader-chain">
                  {chain.map((name, i) => (
                    <li key={name}>
                      <span dir="ltr">{name}</span>
                      <button
                        className="ghost small"
                        title="للأعلى"
                        disabled={i === 0}
                        onClick={() => move(name, -1)}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        className="ghost small"
                        title="للأسفل"
                        disabled={i === chain.length - 1}
                        onClick={() => move(name, 1)}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        className="ghost small"
                        title="أزل"
                        onClick={() =>
                          set({ shaderChain: chain.filter((n) => n !== name) })
                        }
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="shader-files">
                {library.own.files
                  .filter((f) => !chain.includes(f.name))
                  .slice(0, 60)
                  .map((f) => (
                    <button
                      key={f.name}
                      className="chip"
                      disabled={chain.length >= 16}
                      title={f.family || f.name}
                      onClick={() => set({ shaderChain: [...chain, f.name] })}
                    >
                      <Plus size={13} /> <span dir="ltr">{f.name}</span>
                    </button>
                  ))}
              </div>
            </>
          )}

          <div className="setting-row">
            <div>
              <b>ملف GLSL واحد</b>
              <p className="path" dir="ltr">
                {s.shaderPath || "—"}
              </p>
            </div>
            <button
              className="secondary small"
              onClick={async () => {
                const result = await update("chooseShader");
                if (result) {
                  notice("تم اختيار ملف الشيدر");
                  load();
                }
              }}
            >
              اختيار…
            </button>
          </div>
        </>
      )}
    </section>
  );
}
