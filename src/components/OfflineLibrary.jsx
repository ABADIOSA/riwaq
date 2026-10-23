import React, { useState, useEffect } from "react";
import { Modal } from "./UI.jsx";
import { call, isWeb } from "../lib/api.js";
import { offlineEpisode } from "../../core/offline-media.mjs";
import { episodeLabel } from "../../core/episodes.mjs";
const LABELS = {
  downloading: "جارٍ التنزيل",
  paused: "متوقف مؤقتاً · يمكن استئنافه",
  ready: "جاهز دون إنترنت",
  cancelled: "أُوقف التنزيل",
  interrupted: "توقف عند إغلاق التطبيق",
  error: "تعذر التنزيل؛ جرّب مصدرًا آخر",
};
export default function OfflineLibrary({
  state,
  onClose,
  notice,
  onLocalVideo,
}) {
  const profileId = state.profiles?.active;
  const [items, setItems] = useState([]),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isWeb) return;
    let active = true;
    const refresh = () =>
      call("offlineList", { profileId })
        .then((r) => {
          if (active) setItems(r.items);
        })
        .catch(() => {});
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [profileId]);
  const act = async (action, id) => {
    setBusy(true);
    try {
      const r = await call(action, { id, profileId });
      if (r?.items) setItems(r.items);
      if (action === "offlinePlay") onClose();
    } catch (e) {
      notice(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal className="offline-library" onClose={onClose}>
      <h2>التنزيلات</h2>
      {!isWeb && (
        <button className="secondary" onClick={onLocalVideo}>
          فتح ملف فيديو (أو اسحبه إلى النافذة)
        </button>
      )}
      <p>
        نزّل مباشرة من قائمة المصادر أو أثناء المشاهدة. يستمر التنزيل بعد إغلاق
        المشغل؛ عند إغلاق التطبيق يتوقف ويمكن استئنافه من هنا. إذا لم يدعم
        المصدر الاستئناف الآمن يبدأ من جديد.
      </p>
      {isWeb ? (
        <p>التنزيل والمشاهدة دون إنترنت متاحان في تطبيق ويندوز.</p>
      ) : !items.length ? (
        <p>لا توجد تنزيلات بعد.</p>
      ) : (
        items.map((x) => {
          const episode = offlineEpisode(x.meta, x.videoId, x.episode);
          return (
            <article key={x.id}>
              <header>
                <b dir="auto">{x.meta.name}</b>
                <small>{LABELS[x.status]}</small>
              </header>
              {episode && (
                <div className="offline-episode">
                  {episode.episode !== undefined && (
                    <small>{episodeLabel(episode)}</small>
                  )}
                  {episode.title && <p dir="auto">{episode.title}</p>}
                </div>
              )}
              {!episode &&
                typeof x.videoId === "string" &&
                x.videoId &&
                x.videoId !== x.meta.id && (
                  <p
                    className="offline-id"
                    dir="auto"
                  >{`معرّف الفيديو: ${x.videoId}`}</p>
                )}
              <p className="offline-size" dir="ltr">
                {(x.bytes / 1024 ** 2).toFixed(1)} MB
                {x.total ? ` / ${(x.total / 1024 ** 2).toFixed(1)} MB` : ""}
              </p>
              {x.status === "downloading" && (
                <progress value={x.bytes} max={x.total || undefined} />
              )}
              <div className="button-row">
                {x.status === "ready" && (
                  <button
                    className="primary small"
                    disabled={busy}
                    onClick={() => act("offlinePlay", x.id)}
                  >
                    تشغيل التنزيل
                  </button>
                )}
                {x.status === "downloading" && (
                  <button
                    className="secondary small"
                    disabled={busy}
                    onClick={() => act("offlinePause", x.id)}
                  >
                    إيقاف مؤقت
                  </button>
                )}
                {["paused", "interrupted", "error", "cancelled"].includes(
                  x.status,
                ) && (
                  <button
                    className="secondary small"
                    disabled={busy}
                    onClick={() => act("offlineResume", x.id)}
                  >
                    استئناف التنزيل
                  </button>
                )}
                <button
                  className="secondary small"
                  disabled={busy}
                  onClick={() => act("offlineRemove", x.id)}
                >
                  حذف التنزيل
                </button>
              </div>
            </article>
          );
        })
      )}
    </Modal>
  );
}
