import React, { useState } from "react";
import {
  Disc3,
  FolderPlus,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  ListMusic,
  Plus,
  Trash2,
  X,
  Volume2,
  ArrowUp,
} from "lucide-react";
import { matchesWords } from "../../core/arabic.mjs";
const time = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function LocalMusicRoom({ music }) {
  const { library, playback, busy, problem, edit, play } = music;
  const [query, setQuery] = useState(""),
    [tab, setTab] = useState("all"),
    [name, setName] = useState("");
  const playlist = library.playlists.find((p) => p.id === tab);
  const ids = tab === "queue" ? library.queue : playlist?.ids;
  const tracks = (
    ids
      ? ids.map((id) => library.tracks.find((t) => t.id === id)).filter(Boolean)
      : library.tracks
  ).filter(
    (t) => (tab !== "favorites" || t.favorite) && matchesWords(t.title, query),
  );
  const addQueue = (id) =>
    edit({ action: "queue", ids: [...library.queue, id] });
  const savePlaylist = async (e) => {
    e.preventDefault();
    const data = await edit({ action: "playlist", name, ids: library.queue });
    if (data) {
      setName("");
      setTab(data.playlists.at(-1).id);
    }
  };
  return (
    <section className="local-music" aria-label="مشغّل رِواق للموسيقى">
      <header className="local-music-heading">
        <div>
          <span className="eyebrow">RIWAQ / LISTEN</span>
          <h2>مساحة لصوتك.</h2>
          <p>أغانيك كاملة داخل رِواق. شغّلها وتصفّح بقية المنصة.</p>
        </div>
        <button className="primary" disabled={busy} onClick={music.importFiles}>
          <FolderPlus size={18} /> أضف ملفات صوتية
        </button>
      </header>
      <div className="local-music-summary">
        <Disc3 size={32} />
        <span>
          <b>{library.tracks.length} أغنية</b>
          <small>MP3 · FLAC · WAV · OGG · OPUS · M4A · AAC</small>
        </span>
        <p>
          ملفاتك تبقى في مكانها، ولا تُرفع لأي منصة. روابط خدمات الموسيقى تجدها
          أسفل المكتبة.
        </p>
      </div>
      <div className="local-music-toolbar">
        <nav aria-label="مكتبة الموسيقى">
          {[
            ["all", "كل الأغاني"],
            ["favorites", "أحببتها"],
            ["queue", `قائمة الانتظار (${library.queue.length})`],
            ...library.playlists.map((p) => [p.id, p.name]),
          ].map(([id, title]) => (
            <button
              key={id}
              aria-pressed={tab === id}
              className={tab === id ? "chosen" : ""}
              onClick={() => setTab(id)}
            >
              {title}
            </button>
          ))}
        </nav>
        <input
          aria-label="ابحث في أغانيك"
          placeholder="ابحث في أغانيك…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="local-music-actions">
        <button
          className="secondary"
          disabled={busy || !tracks.length}
          onClick={() =>
            play(
              tracks[0].id,
              tracks.map((t) => t.id),
            )
          }
        >
          <Play size={16} /> شغّل المعروض
        </button>
        <form onSubmit={savePlaylist}>
          <input
            aria-label="اسم قائمة الموسيقى"
            placeholder="احفظ الانتظار باسم…"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <button disabled={busy || !name.trim() || !library.queue.length}>
            <Plus size={15} /> احفظ القائمة
          </button>
        </form>
        {playlist && (
          <button
            disabled={busy}
            onClick={async () => {
              if (await edit({ action: "deletePlaylist", id: playlist.id }))
                setTab("all");
            }}
          >
            احذف هذه القائمة
          </button>
        )}
      </div>
      {problem && <p role="alert">{problem}</p>}
      {tracks.length ? (
        <ol className="local-track-list">
          {tracks.map((t) => (
            <li
              key={t.id}
              className={playback.id === t.id ? "current" : ""}
              data-track-id={t.id}
            >
              <button
                className="track-start"
                disabled={busy}
                onClick={() =>
                  play(
                    t.id,
                    tracks.map((x) => x.id),
                  )
                }
                aria-label={`شغّل ${t.title}`}
              >
                <Play size={16} />
              </button>
              <span className="local-track-title">
                <b dir="auto">{t.title}</b>
                <small>
                  {t.format}
                  {playback.id === t.id ? " · في المشغّل" : ""}
                </small>
              </span>
              <button
                disabled={busy}
                aria-label={`أحببت ${t.title}`}
                aria-pressed={t.favorite}
                onClick={() => edit({ action: "favorite", id: t.id })}
              >
                <Heart size={17} fill={t.favorite ? "currentColor" : "none"} />
              </button>
              <button
                disabled={busy || library.queue.includes(t.id)}
                title="أضف إلى الانتظار"
                aria-label={`أضف ${t.title} إلى الانتظار`}
                onClick={() => addQueue(t.id)}
              >
                <ListMusic size={18} />
              </button>
              {tab === "queue" && (
                <button
                  disabled={busy || library.queue[0] === t.id}
                  aria-label={`قدّم ${t.title}`}
                  onClick={() => {
                    const q = [...library.queue],
                      i = q.indexOf(t.id);
                    [q[i - 1], q[i]] = [q[i], q[i - 1]];
                    edit({ action: "queue", ids: q });
                  }}
                >
                  <ArrowUp size={16} />
                </button>
              )}
              <button
                disabled={busy}
                aria-label={`أزل ${t.title}`}
                title={
                  ids
                    ? "أزل من هذه القائمة"
                    : "أزل من المكتبة (يبقى الملف على جهازك)"
                }
                onClick={() =>
                  ids
                    ? edit(
                        playlist
                          ? {
                              action: "playlist",
                              id: playlist.id,
                              name: playlist.name,
                              ids: ids.filter((id) => id !== t.id),
                            }
                          : {
                              action: "queue",
                              ids: ids.filter((id) => id !== t.id),
                            },
                      )
                    : edit({ action: "remove", id: t.id })
                }
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="local-music-empty">
          <Disc3 size={46} />
          <h3>
            {library.tracks.length
              ? "لا توجد أغاني هنا بعد"
              : "ابدأ بأغنية تحبها"}
          </h3>
          <p>
            {library.tracks.length
              ? "غيّر البحث أو أضف أغاني إلى هذه القائمة."
              : "اختر ملفاتك الصوتية، ثم أنشئ قوائمك وأكمل الاستماع وأنت تتصفح."}
          </p>
        </div>
      )}
      <p className="local-music-note">
        المكتبة والقوائم لهذا الملف الشخصي وعلى هذا الجهاز. النسخة الاحتياطية
        العامة لا تنقل الملفات الصوتية أو مساراتها.
      </p>
    </section>
  );
}

export function LocalMusicBar({ music, hidden, onRoom }) {
  const { playback: p, library, engine } = music;
  const track = library.tracks.find((t) => t.id === p.id);
  if (!track || hidden) return null;
  return (
    <aside className="local-music-bar" aria-label="مشغّل الأغاني المدمج">
      <div className="local-bar-top">
        <Disc3 size={29} className={p.playing ? "spinning" : ""} />
        <button className="local-bar-title" onClick={onRoom}>
          <b dir="auto">{track.title}</b>
          <small>
            {p.error ||
              (p.loading
                ? "جارٍ التحميل…"
                : `مكتبتك · ${p.queue.indexOf(p.id) + 1} / ${p.queue.length}`)}
          </small>
        </button>
        <div className="local-bar-controls" dir="ltr">
          <button
            aria-label="تشغيل عشوائي"
            aria-pressed={p.shuffle}
            onClick={() => engine.option("shuffle", !p.shuffle)}
          >
            <Shuffle size={17} />
          </button>
          <button
            aria-label="الأغنية السابقة"
            onClick={() => engine.previous()}
          >
            <SkipBack size={19} />
          </button>
          <button
            className="local-toggle"
            aria-label={
              p.playing || p.loading ? "أوقف الأغنية مؤقتاً" : "استأنف الأغنية"
            }
            onClick={() =>
              p.playing || p.loading ? engine.pause() : engine.resume()
            }
          >
            {p.playing || p.loading ? <Pause size={21} /> : <Play size={21} />}
          </button>
          <button aria-label="الأغنية التالية" onClick={() => engine.next()}>
            <SkipForward size={19} />
          </button>
          <button
            aria-label={`التكرار: ${p.repeat === "off" ? "متوقف" : p.repeat === "all" ? "القائمة" : "أغنية واحدة"}`}
            aria-pressed={p.repeat !== "off"}
            onClick={() =>
              engine.option(
                "repeat",
                { off: "all", all: "one", one: "off" }[p.repeat],
              )
            }
          >
            {p.repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>
        <label className="local-volume">
          <Volume2 size={17} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={p.volume}
            onChange={(e) => engine.option("volume", Number(e.target.value))}
            aria-label="صوت الأغاني"
          />
        </label>
        <button aria-label="أغلق مشغّل الأغاني" onClick={() => engine.stop()}>
          <X size={18} />
        </button>
      </div>
      <div className="local-seek" dir="ltr">
        <span>{time(p.position)}</span>
        <input
          type="range"
          min="0"
          max={p.duration || 1}
          step="0.1"
          value={Math.min(p.position, p.duration || 1)}
          disabled={!p.duration}
          onChange={(e) => engine.seek(Number(e.target.value))}
          aria-label="موضع الأغنية"
        />
        <span>{time(p.duration)}</span>
      </div>
      {p.error && (
        <span className="sr-only" role="alert">
          {p.error}
        </span>
      )}
    </aside>
  );
}
