import React, { useEffect, useMemo, useState } from "react";
import {
  Music2,
  Star,
  Plus,
  Search,
  ExternalLink,
  ArrowUp,
  Trash2,
  Disc3,
  Play,
  Link2,
  Copy,
  Unlink,
} from "lucide-react";
import {
  MUSIC_KINDS,
  MUSIC_PLATFORMS,
  addMusicLink,
  cleanMusic,
  platformColor,
  platformName,
  preferredPlatform,
  soundtrackQuery,
  spotifyUri,
} from "../../core/music.mjs";
import { call } from "../lib/api.js";
import { continueWatching } from "../../core/library.mjs";
import { arabicCount, SONGS, WORKS } from "../../core/arabic.mjs";
import { imgUrl } from "../lib/helpers.js";
import { ScrollRow } from "./UI.jsx";

/**
 * The music room (core/music.mjs): the viewer's platforms, saved links,
 * searches and the music of what they watch. Riwaq opens; the platform plays.
 */
export default function MusicRoom({ state, update, act, notice }) {
  const music = useMemo(
    () => cleanMusic(state.settings.music),
    [state.settings.music],
  );
  const [link, setLink] = useState(""),
    [title, setTitle] = useState(""),
    [problem, setProblem] = useState(""),
    [query, setQuery] = useState(""),
    [only, setOnly] = useState("");
  const save = (next) => update("settings", { music: next });
  const open = (args) => act("musicOpen", args);
  const toggle = (id) =>
    save({
      ...music,
      platforms: music.platforms.includes(id)
        ? music.platforms.filter((p) => p !== id)
        : [...music.platforms, id],
    });
  const makeFirst = (id) =>
    save({
      ...music,
      platforms: [id, ...music.platforms.filter((p) => p !== id)],
    });
  const add = async (e) => {
    e.preventDefault();
    try {
      const next = addMusicLink(music, { url: link, title });
      setProblem("");
      if (await save(next)) {
        setLink("");
        setTitle("");
        notice("انحفظ في موسيقاك");
      }
    } catch (error) {
      setProblem(error.message);
    }
  };
  const move = (id) => {
    const i = music.items.findIndex((x) => x.id === id);
    if (i <= 0) return;
    const items = [...music.items];
    [items[i - 1], items[i]] = [items[i], items[i - 1]];
    save({ ...music, items });
  };
  const remove = (id) =>
    save({ ...music, items: music.items.filter((x) => x.id !== id) });
  const searchOn = music.platforms.length
    ? music.platforms
    : ["spotify", "anghami", "youtubemusic"];
  const present = [...new Set(music.items.map((i) => i.platform))];
  const shown = only
    ? music.items.filter((i) => i.platform === only)
    : music.items;
  // The music of what the viewer is watching and keeping.
  const works = useMemo(() => {
    const seen = new Set();
    return [
      ...continueWatching(state.progress).map((p) => p.meta),
      ...(state.favorites || []),
    ]
      .filter((m) => {
        const key = `${m?.type}:${m?.id}`;
        if (!m?.name || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 12);
  }, [state.progress, state.favorites]);
  const first = preferredPlatform(music);
  // Spotify Connect (core/spotify.mjs): Riwaq plays through the viewer's own
  // Spotify app and account.
  const spotify = state.spotify || {};
  const [clientId, setClientId] = useState(""),
    [playlists, setPlaylists] = useState(null),
    [noDevice, setNoDevice] = useState(false);
  useEffect(() => {
    if (!spotify.connected) {
      setPlaylists(null);
      return;
    }
    let live = true;
    call("spotifyPlaylists")
      .then((list) => live && setPlaylists(list))
      .catch(() => live && setPlaylists([]));
    return () => {
      live = false;
    };
  }, [spotify.connected]);
  const playOnSpotify = async (uri) => {
    setNoDevice(false);
    try {
      await call("spotifyControl", { action: "play", uri });
      notice("يشتغل على Spotify");
    } catch (error) {
      if (/جهاز Spotify/.test(error.message)) setNoDevice(true);
      notice(error.message);
    }
  };
  return (
    <section className="music-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RIWAQ / MUSIC</span>
          <h1>موسيقاك، بجنب حكاياتك.</h1>
          <p>
            منصاتك وقوائمك في مكان واحد. رِواق يفتحها في منصتك أو متصفحك؛ ما
            يشغّل الصوت بنفسه، ولا يطلب كلمة مرور أي منصة.
          </p>
        </div>
        <Music2 size={32} />
      </div>

      <section className="settings-card">
        <h2>منصاتك</h2>
        <p>
          اختر المنصات اللي تستخدمها. الأولى هي الأساسية: منها تفتح «موسيقى
          العمل» في صفحة كل فيلم ومسلسل.
        </p>
        <div className="music-platforms" role="group" aria-label="منصاتك">
          {MUSIC_PLATFORMS.map(([id, name, color]) => {
            const on = music.platforms.includes(id);
            return (
              <div
                key={id}
                className={`music-platform ${on ? "chosen" : ""}`}
                style={{ "--platform": color }}
              >
                <button aria-pressed={on} onClick={() => toggle(id)}>
                  <i aria-hidden="true" />
                  {name}
                </button>
                {on &&
                  (music.platforms[0] === id ? (
                    <small className="music-first">
                      <Star size={12} /> الأساسية
                    </small>
                  ) : (
                    <button
                      className="text-button"
                      onClick={() => makeFirst(id)}
                    >
                      اجعلها الأساسية
                    </button>
                  ))}
              </div>
            );
          })}
        </div>
      </section>

      <section className="settings-card music-spotify">
        <h2>
          <i className="music-dot" style={{ "--platform": "#1DB954" }} /> رِواق
          مشغّل Spotify
        </h2>
        {spotify.connected ? (
          <>
            <p>
              مربوط باسم <b dir="auto">{spotify.name || "حسابك"}</b>
              {spotify.premium
                ? " · Premium"
                : " · التحكم بالتشغيل يحتاج Premium (شرط من Spotify)"}
              . الصوت يطلع من تطبيق Spotify على جهازك، ورِواق يعرض ويتحكم:
              الشريط تحت يبين وش يشتغل، وتقدر توقف وتقدّم وتغيّر الصوت والجهاز.
            </p>
            <div className="button-row">
              {noDevice && (
                <button
                  className="secondary"
                  onClick={() => act("spotifyOpenApp")}
                >
                  افتح تطبيق Spotify
                </button>
              )}
              <button
                className="secondary"
                onClick={() => update("spotifyDisconnect")}
              >
                <Unlink size={15} /> افصل الحساب
              </button>
            </div>
            {playlists === null ? (
              <p className="subtle">نجيب قوائمك…</p>
            ) : playlists.length ? (
              <ScrollRow className="music-playlists">
                {playlists.map((p) => (
                  <button
                    key={p.uri}
                    className="music-playlist"
                    onClick={() => playOnSpotify(p.uri)}
                    title={`شغّل «${p.name}»`}
                  >
                    {p.image ? (
                      <img src={p.image} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <span className="music-work-initial">♪</span>
                    )}
                    <b dir="auto">{p.name}</b>
                    <small>
                      <Play size={11} /> {arabicCount(p.tracks, SONGS)}
                    </small>
                  </button>
                ))}
              </ScrollRow>
            ) : (
              <p className="subtle">ما لقينا قوائم تشغيل في حسابك.</p>
            )}
          </>
        ) : (
          <form
            className="music-spotify-link"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act("spotifyConnect", { clientId }))
                notice("كمّل الربط في المتصفح، ثم ارجع لرِواق");
            }}
          >
            <p>
              اربط حسابك ويصير رِواق هو المشغّل: يعرض اللي يشتغل ويتحكم فيه،
              ويشغّل قوائمك ومحفوظاتك على أجهزتك. ما نطلب كلمة مرورك؛ تسجّل في
              صفحة Spotify نفسها.
            </p>
            <ol>
              <li>
                افتح لوحة مطوري Spotify (developer.spotify.com/dashboard) وأنشئ
                تطبيقاً.
              </li>
              <li>
                أضف هذا العنوان في Redirect URIs:{" "}
                <code dir="ltr">{spotify.redirect}</code>{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    navigator.clipboard
                      ?.writeText(spotify.redirect)
                      .then(() => notice("تم نسخ العنوان"))
                  }
                >
                  <Copy size={13} /> انسخ
                </button>
              </li>
              <li>انسخ Client ID من التطبيق والصقه هنا:</li>
            </ol>
            <div className="music-spotify-row">
              <input
                dir="ltr"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Client ID (32 حرفاً)"
                aria-label="Spotify Client ID"
                maxLength={64}
              />
              <button className="primary" disabled={!clientId.trim()}>
                <Link2 size={15} /> اربط Spotify
              </button>
            </div>
          </form>
        )}
      </section>

      <div className="music-columns">
        <form className="settings-card music-add" onSubmit={add}>
          <h2>احفظ من منصتك</h2>
          <p>انسخ رابط قائمة تشغيل أو ألبوم أو فنان أو أغنية، والصقه هنا.</p>
          <input
            dir="ltr"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://open.spotify.com/playlist/…"
            aria-label="رابط من منصة موسيقى"
            maxLength={600}
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="اسم تختاره (اختياري)"
            aria-label="اسم للرابط"
            maxLength={80}
          />
          {problem && <p className="inline-warning">{problem}</p>}
          <button className="primary" disabled={!link.trim()}>
            <Plus size={16} /> احفظ
          </button>
        </form>

        <form
          className="settings-card music-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) open({ platform: first, query });
          }}
        >
          <h2>ابحث في منصاتك</h2>
          <p>اكتب أغنية أو فنان أو ألبوم، واختر المنصة.</p>
          <label className="source-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="مثلاً: محمد عبده، Hans Zimmer…"
              aria-label="ابحث في منصات الموسيقى"
              maxLength={120}
            />
          </label>
          <div className="music-search-targets">
            {searchOn.map((id) => (
              <button
                type="button"
                key={id}
                disabled={!query.trim()}
                style={{ "--platform": platformColor(id) }}
                onClick={() => open({ platform: id, query })}
              >
                <i aria-hidden="true" /> {platformName(id)}
              </button>
            ))}
          </div>
        </form>
      </div>

      <section className="music-saved">
        <div className="section-heading">
          <div>
            <h2>محفوظاتك</h2>
            <span>
              {music.items.length
                ? "تنفتح في منصتها"
                : "ما حفظت شي للحين. الصق رابطاً من منصتك."}
            </span>
          </div>
        </div>
        {present.length > 1 && (
          <ScrollRow className="source-chips">
            <button
              className={!only ? "chosen" : ""}
              aria-pressed={!only}
              onClick={() => setOnly("")}
            >
              الكل <bdi>{music.items.length}</bdi>
            </button>
            {present.map((id) => (
              <button
                key={id}
                className={only === id ? "chosen" : ""}
                aria-pressed={only === id}
                onClick={() => setOnly(only === id ? "" : id)}
              >
                {platformName(id)}{" "}
                <bdi>{music.items.filter((i) => i.platform === id).length}</bdi>
              </button>
            ))}
          </ScrollRow>
        )}
        {shown.length > 0 && (
          <div className="music-grid">
            {shown.map((item, index) => (
              <article
                key={item.id}
                className="music-item"
                style={{ "--platform": platformColor(item.platform) }}
              >
                <button
                  className="music-open"
                  onClick={() =>
                    spotify.connected && spotifyUri(item.url)
                      ? playOnSpotify(spotifyUri(item.url))
                      : open({ url: item.url })
                  }
                  title={
                    spotify.connected && spotifyUri(item.url)
                      ? "شغّل في رِواق عبر Spotify"
                      : "افتح في المنصة"
                  }
                >
                  <Disc3 size={26} />
                  <span>
                    <b dir="auto">
                      {item.title ||
                        `${MUSIC_KINDS[item.kind]} على ${platformName(item.platform)}`}
                    </b>
                    <small>
                      {MUSIC_KINDS[item.kind]} · {platformName(item.platform)}
                    </small>
                  </span>
                  <ExternalLink size={15} />
                </button>
                <div className="music-item-tools">
                  {spotify.connected && spotifyUri(item.url) && (
                    <button
                      title="افتح في Spotify"
                      aria-label="افتح في Spotify"
                      onClick={() => open({ url: item.url })}
                    >
                      <ExternalLink size={14} />
                    </button>
                  )}
                  {!only && index > 0 && (
                    <button
                      title="أعلى"
                      aria-label="انقله لأعلى"
                      onClick={() => move(item.id)}
                    >
                      <ArrowUp size={14} />
                    </button>
                  )}
                  <button
                    title="احذف"
                    aria-label="احذف من محفوظاتك"
                    onClick={() => remove(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {works.length > 0 && (
        <section className="music-works">
          <div className="section-heading">
            <div>
              <h2>موسيقى أعمالك</h2>
              <span>
                {arabicCount(works.length, WORKS)} من اللي تكمله ومكتبتك · تنفتح
                على {platformName(first)}
              </span>
            </div>
          </div>
          <ScrollRow className="music-works-row">
            {works.map((meta) => (
              <button
                key={`${meta.type}:${meta.id}`}
                className="music-work"
                onClick={() =>
                  open({ platform: first, query: soundtrackQuery(meta) })
                }
                title={`ابحث عن موسيقى «${meta.name}»`}
              >
                {imgUrl(meta.poster) ? (
                  <img
                    src={imgUrl(meta.poster)}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="music-work-initial">{meta.name[0]}</span>
                )}
                <b dir="auto">{meta.name}</b>
                <small>
                  <Music2 size={12} /> موسيقى العمل
                </small>
              </button>
            ))}
          </ScrollRow>
        </section>
      )}
    </section>
  );
}
