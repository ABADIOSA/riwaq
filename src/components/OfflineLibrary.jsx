import React, { useState, useEffect } from "react";
import { Modal } from "./UI.jsx";
import { call, isWeb } from "../lib/api.js";
const LABELS = {
  downloading: "جارٍ التنزيل",
  ready: "جاهز دون إنترنت",
  cancelled: "أُوقف التنزيل",
  interrupted: "توقف عند إغلاق التطبيق",
  error: "تعذر التنزيل؛ جرّب مصدرًا آخر",
};
export default function OfflineLibrary({ state, onClose, notice }) {
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
      <p>
        نزّل المصدر من قائمة الزر الأيمن أثناء المشاهدة، ثم شاهده من هنا دون
        إنترنت.
      </p>
      {isWeb ? (
        <p>التنزيل والمشاهدة دون إنترنت متاحان في تطبيق ويندوز.</p>
      ) : !items.length ? (
        <p>لا توجد تنزيلات بعد.</p>
      ) : (
        items.map((x) => (
          <article key={x.id}>
            <header>
              <b dir="auto">{x.meta.name}</b>
              <small>{LABELS[x.status]}</small>
            </header>
            <p>
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
                  onClick={() => act("offlineCancel", x.id)}
                >
                  إيقاف التنزيل
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
        ))
      )}
    </Modal>
  );
}
