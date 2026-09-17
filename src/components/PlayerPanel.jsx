import React, { useState, useEffect, useRef } from "react";
import {
  MonitorPlay,
  Play,
  Pause,
  Maximize,
  PictureInPicture2,
  Volume2,
  Subtitles,
} from "lucide-react";
import { typeName, clock, imgUrl, episodeList } from "../lib/helpers.js";
import { IconButton, Busy, Empty, Modal } from "./UI.jsx";
import { call } from "../lib/api.js";
export default function PlayerPanel({ player, state, act, onClose }) {
  const [delay, setDelay] = useState(
    player.subtitleDelay ?? state.settings.subtitleDelay,
  );
  const tracks = player.tracks || [];
  return (
    <Modal onClose={onClose} className="player-modal">
      <span className="eyebrow">المشغل المدمج</span>
      <h1>كل التفاصيل بيدك.</h1>
      {!player.active ? (
        <Empty icon={MonitorPlay} title="لا توجد مشاهدة حالية">
          اختر مصدراً من صفحة أحد العناوين.
        </Empty>
      ) : (
        <>
          <p className="muted" dir="auto">
            {player.name}
          </p>
          <div className="player-controls">
            <button
              className="primary"
              onClick={() => act("playerCommand", { action: "pause" })}
            >
              {player.pause ? <Play size={18} /> : <Pause size={18} />}{" "}
              {player.pause ? "تشغيل" : "إيقاف مؤقت"}
            </button>
            <button
              className="secondary"
              onClick={() => act("playerCommand", { action: "fullscreen" })}
            >
              <Maximize size={18} />
              ملء الشاشة
            </button>
            <button
              className="secondary"
              onClick={() => act("playerCommand", { action: "pip" })}
            >
              <PictureInPicture2 size={18} />
              مصغّر داخل التطبيق
            </button>
          </div>
          <div className="setting-row">
            <b>
              <Volume2 size={18} /> مستوى الصوت
            </b>
            <input
              type="range"
              aria-label="مستوى الصوت"
              min="0"
              max="100"
              value={player.volume || 0}
              onChange={(e) =>
                act("playerCommand", {
                  action: "volume",
                  value: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="settings-fields">
            <label>
              المسار الصوتي
              <select
                value={
                  tracks.find((t) => t.type === "audio" && t.selected)?.id || ""
                }
                onChange={(e) =>
                  act("playerCommand", {
                    action: "aid",
                    value: Number(e.target.value),
                  })
                }
              >
                <option value="" disabled>
                  اختر مساراً
                </option>
                {tracks
                  .filter((t) => t.type === "audio")
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.lang || "غير محدد"} · {t.title || `مسار ${t.id}`}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              الترجمة المضمنة
              <select
                value={
                  tracks.find((t) => t.type === "sub" && t.selected)?.id || "no"
                }
                onChange={(e) =>
                  act("playerCommand", {
                    action: "sid",
                    value:
                      e.target.value === "no" ? "no" : Number(e.target.value),
                  })
                }
              >
                <option value="no">إيقاف الترجمة</option>
                {tracks
                  .filter((t) => t.type === "sub")
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.lang || "غير محدد"} · {t.title || `ترجمة ${t.id}`}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              تأخير الترجمة (ثانية)
              <input
                type="number"
                min="-60"
                max="60"
                step="0.1"
                value={delay}
                onChange={(e) => {
                  setDelay(e.target.value);
                  act("playerCommand", {
                    action: "subtitleDelay",
                    value: Number(e.target.value),
                  });
                }}
              />
            </label>
            <label>
              حجم الترجمة
              <input
                type="range"
                aria-label="حجم الترجمة الحالية"
                min="18"
                max="80"
                value={player.subtitleSize ?? state.settings.subtitleSize}
                onChange={(e) =>
                  act("playerCommand", {
                    action: "subtitleSize",
                    value: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
          <button className="secondary" onClick={() => act("localSubtitle")}>
            <Subtitles size={18} />
            إضافة ملف ترجمة
          </button>
          <div className="settings-fields">
            <label>
              سرعة التشغيل
              <select
                value={player.speed ?? 1}
                onChange={(e) =>
                  act("playerCommand", {
                    action: "speed",
                    value: Number(e.target.value),
                  })
                }
              >
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </select>
            </label>
            <label>
              نسبة الصورة
              <select
                value={player.aspect ?? -1}
                onChange={(e) =>
                  act("playerCommand", {
                    action: "aspect",
                    value: e.target.value,
                  })
                }
              >
                <option value="-1">تلقائي</option>
                <option value="16:9">16:9</option>
                <option value="4:3">4:3</option>
                <option value="2.35:1">Cinema 2.35:1</option>
              </select>
            </label>
          </div>
          <details className="picture-settings">
            <summary>ضبط الصورة</summary>
            {[
              ["brightness", "السطوع"],
              ["contrast", "التباين"],
              ["saturation", "التشبع"],
              ["gamma", "جاما"],
            ].map(([action, label]) => (
              <label className="setting-row" key={action}>
                {label}
                <input
                  aria-label={label}
                  type="range"
                  min="-100"
                  max="100"
                  value={player[action] ?? 0}
                  onChange={(e) =>
                    act("playerCommand", {
                      action,
                      value: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </details>
          <p className="subtle">
            اختصارات المشغل: Space للإيقاف، F لملء الشاشة، J لتبديل الترجمة، #
            للصوت، والأسهم للتقديم.
          </p>
        </>
      )}
    </Modal>
  );
}
