import React, { useState, useEffect, useRef } from "react";
import {
  Film,
  Play,
  FolderOpen,
  Trash2,
  Pause,
  Download,
  RotateCcw,
} from "lucide-react";
import { Modal, IconButton } from "./UI.jsx";
import { call, isWeb } from "../lib/api.js";
import { offlineEpisode } from "../../core/offline-media.mjs";
import { episodeLabel } from "../../core/episodes.mjs";
import "../downloads-quality.css";
const LABELS = {
  downloading: "جارٍ التنزيل",
  paused: "متوقف مؤقتاً · يمكن استئنافه",
  ready: "جاهز دون إنترنت",
  cancelled: "أُوقف التنزيل",
  interrupted: "توقف عند إغلاق التطبيق",
  error: "تعذر التنزيل؛ جرّب مصدرًا آخر",
};
function DownloadCard({ item: x, profileId, busy, act, confirm, request }) {
  const [art, setArt] = useState(null);
  useEffect(() => {
    let active = true;
    setArt(null);
    request("offlineArtwork", { profileId, id: x.id })
      .then((r) => {
        if (active) setArt(r?.image || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [profileId, x.id, request]);
  const episode = offlineEpisode(x.meta, x.videoId, x.episode);
  return (
    <article className="download-card" aria-label={x.meta.name}>
      <div className="download-art" aria-hidden="true">
        {art ? <img src={art} alt="" /> : <Film size={30} />}
      </div>
      <div className="download-info">
        <header>
          <b dir="auto">{x.meta.name}</b>
        </header>
        {episode && (
          <div className="offline-episode">
            {episode.episode !== undefined && (
              <small>{episodeLabel(episode)}</small>
            )}
            {episode.title && (
              <p dir="auto" translate="no">
                {episode.title}
              </p>
            )}
          </div>
        )}
        {!episode && x.videoId && x.videoId !== x.meta.id && (
          <p
            className="offline-id"
            dir="auto"
          >{`معرّف الفيديو: ${x.videoId}`}</p>
        )}
        <small className="download-status">
          {x.playing ? "قيد المشاهدة" : LABELS[x.status] || "التنزيل غير متاح"}
        </small>
        <p className="offline-size" dir="ltr">
          {(x.bytes / 1024 ** 2).toFixed(1)} MB
          {x.total ? ` / ${(x.total / 1024 ** 2).toFixed(1)} MB` : ""}
        </p>
        {x.status === "downloading" && (
          <progress
            aria-label="تقدم التنزيل"
            value={x.total ? x.bytes : undefined}
            max={x.total || undefined}
          />
        )}
        <div className="download-actions">
          {x.status === "ready" && (
            <>
              <IconButton
                title="تشغيل التنزيل"
                disabled={busy || x.playing}
                onClick={() => act("offlinePlay", x.id)}
              >
                <Play size={19} />
              </IconButton>
              <IconButton
                title="إظهار الملف في المستكشف"
                disabled={busy}
                onClick={() => act("offlineReveal", x.id)}
              >
                <FolderOpen size={19} />
              </IconButton>
            </>
          )}
          {x.status === "downloading" && (
            <IconButton
              title="إيقاف مؤقت"
              disabled={busy}
              onClick={() => act("offlinePause", x.id)}
            >
              <Pause size={19} />
            </IconButton>
          )}
          {["paused", "interrupted", "error", "cancelled"].includes(
            x.status,
          ) && (
            <IconButton
              title={
                x.status === "error"
                  ? "إعادة محاولة التنزيل"
                  : "استئناف التنزيل"
              }
              disabled={busy}
              onClick={() => act("offlineResume", x.id)}
            >
              {x.status === "error" ? (
                <RotateCcw size={19} />
              ) : (
                <Download size={19} />
              )}
            </IconButton>
          )}
          <IconButton
            title={x.playing ? "أوقف مشاهدة التنزيل قبل حذفه" : "حذف التنزيل"}
            disabled={busy || x.playing}
            onClick={() => confirm(x)}
          >
            <Trash2 size={19} />
          </IconButton>
        </div>
      </div>
    </article>
  );
}
export default function OfflineLibrary({
  state,
  onClose,
  notice,
  onLocalVideo,
  request = call,
}) {
  const profileId = state.profiles?.active;
  const scope = useRef(profileId);
  const cancelDelete = useRef(null);
  scope.current = profileId;
  const [items, setItems] = useState([]),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (pending) cancelDelete.current?.focus();
  }, [pending]);
  useEffect(() => {
    setItems([]);
    setPending(null);
    setError("");
    setBusy(false);
    if (isWeb) return;
    let active = true,
      refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const r = await request("offlineList", { profileId });
        if (active) {
          setItems(r.items);
          setError("");
        }
      } catch (e) {
        if (active) setError(e.message);
      } finally {
        refreshing = false;
      }
    };
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [profileId, request]);
  const act = async (action, id) => {
    setBusy(true);
    try {
      const r = await request(action, { id, profileId });
      if (scope.current !== profileId) return;
      if (r?.items) setItems(r.items);
      if (action === "offlinePlay" && !r?.cancelled) onClose();
      if (action === "offlineRemove") setPending(null);
    } catch (e) {
      if (scope.current === profileId) notice(e.message);
    } finally {
      if (scope.current === profileId) setBusy(false);
    }
  };
  return (
    <Modal
      className="offline-library"
      onClose={onClose}
      labelledBy="offline-heading"
    >
      <h2 id="offline-heading">التنزيلات</h2>
      <p className="downloads-explanation">
        نزّل مباشرة من قائمة المصادر أو أثناء المشاهدة. يستمر التنزيل بعد إغلاق
        المشغل؛ عند إغلاق التطبيق يتوقف ويمكن استئنافه من هنا. إذا لم يدعم
        المصدر الاستئناف الآمن يبدأ من جديد.
      </p>
      {!isWeb && (
        <details className="download-local">
          <summary>فيديو من جهازك</summary>
          <button className="secondary small" onClick={onLocalVideo}>
            فتح ملف فيديو (أو اسحبه إلى النافذة)
          </button>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      {isWeb ? (
        <p>التنزيل والمشاهدة دون إنترنت متاحان في تطبيق ويندوز.</p>
      ) : !items.length ? (
        <p>لا توجد تنزيلات بعد.</p>
      ) : (
        items.map((x) => (
          <DownloadCard
            key={`${profileId}:${x.id}`}
            item={x}
            profileId={profileId}
            busy={busy}
            act={act}
            confirm={setPending}
            request={request}
          />
        ))
      )}
      {pending && (
        <Modal
          className="download-confirm"
          labelledBy="offline-remove-title"
          onClose={() => !busy && setPending(null)}
        >
          <h2 id="offline-remove-title">حذف التنزيل نهائيًا؟</h2>
          <b dir="auto">{pending.meta.name}</b>
          <p>
            {pending.bytes || pending.status === "ready"
              ? "سيُحذف ملف الفيديو المحفوظ وأي جزء غير مكتمل، ويُزال السجل من التنزيلات. لا يمكن التراجع عن الحذف."
              : "سيُزال سجل التنزيل وأي جزء محفوظ منه. لا يمكن التراجع عن الحذف."}
          </p>
          <div className="button-row">
            <button
              ref={cancelDelete}
              autoFocus
              className="secondary"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              إلغاء
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() => act("offlineRemove", pending.id)}
            >
              حذف الملف وإزالة السجل
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
