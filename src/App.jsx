import React, { useState, useEffect, useRef } from "react";
import {
  Home,
  Compass,
  Search,
  Library,
  Puzzle,
  Settings,
  Play,
  Plus,
  Check,
  ChevronLeft,
  X,
  RefreshCw,
  LogIn,
  FolderOpen,
  Star,
  Heart,
  Wifi,
  AlertCircle,
  MonitorPlay,
  Pause,
  SlidersHorizontal,
} from "lucide-react";
import { api, call } from "./lib/api.js";
import { typeName, clock, imgUrl, episodeList } from "./lib/helpers.js";
import { IconButton, Busy, Empty, Poster, Rail } from "./components/UI.jsx";
import Details from "./components/Details.jsx";
import Account from "./components/Account.jsx";
import Addons from "./components/Addons.jsx";
import Preferences from "./components/SettingsStudio.jsx";
import PlayerView from "./components/PlayerView.jsx";
import PlayerPanel from "./components/PlayerPanel.jsx";
const initial = {
  addons: [],
  favorites: [],
  progress: {},
  settings: {
    accent: "amber",
    quality: "2160",
    hideCam: true,
    subtitleLanguage: "ara,ar,eng,en",
    audioLanguage: "ara,ar,eng,en",
    subtitleSize: 44,
    subtitleDelay: 0,
    hardwareDecoding: true,
    hdr: false,
    serverUrl: "http://127.0.0.1:11470",
    autoplay: false,
  },
  user: null,
};
export default function App() {
  const [state, setState] = useState(initial),
    [ready, setReady] = useState(false),
    [view, setView] = useState("home"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [catalog, setCatalog] = useState(""),
    [rows, setRows] = useState([]),
    [failures, setFailures] = useState([]),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [selected, setSelected] = useState(null),
    [account, setAccount] = useState(false),
    [toast, setToast] = useState(""),
    [player, setPlayer] = useState({ active: false }),
    [playerOpen, setPlayerOpen] = useState(false),
    [refresh, setRefresh] = useState(0),
    [heroIndex, setHeroIndex] = useState(0),
    [paging, setPaging] = useState(false);
  const searchRef = useRef(),
    stateRef = useRef(state),
    toastTimer = useRef();
  stateRef.current = state;
  const notice = (message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  };
  const act = async (method, args) => {
    try {
      return await call(method, args);
    } catch (e) {
      notice(e.message);
      return null;
    }
  };
  const update = async (method, args) => {
    const result = await act(method, args);
    if (result) setState(result);
    return result;
  };
  useEffect(() => {
    let live = true;
    call("init")
      .then((s) => {
        if (live) {
          setState(s);
          setReady(true);
        }
      })
      .catch((e) => {
        if (live) {
          setLoadError(e.message);
          setLoading(false);
        }
      });
    const subscriptions = api
      ? [
          api.on("state", (s) => {
            setState(s);
            setAccount(false);
          }),
          api.on("player", (s) => {
            setPlayer(s);
            if (s.error) notice(s.error);
          }),
          api.on("notice", notice),
          api.on("ended", async ({ meta, videoId }) => {
            if (!stateRef.current.settings.autoplay || meta.type === "local")
              return;
            try {
              const details = await call("metadata", {
                type: meta.type,
                id: meta.id,
              });
              const videos = episodeList(details);
              const currentIndex = videos.findIndex((v) => v.id === videoId);
              const next = videos[currentIndex + 1];
              if (currentIndex < 0 || !next || next.id === videoId) return;
              notice("جاري تجهيز الحلقة التالية…");
              const result = await call("streams", {
                type: meta.type,
                id: next.id,
              });
              const stream = result.streams.find(
                (s) => s.supported && !s.external,
              );
              if (!stream) {
                setSelected({ meta: details, videoId: next.id });
                notice("اختر مصدراً للحلقة التالية");
                return;
              }
              await call("play", {
                key: stream.key,
                meta: details,
                videoId: next.id,
              });
              setSelected(null);
            } catch (e) {
              notice(e.message);
            }
          }),
        ]
      : [];
    return () => {
      live = false;
      subscriptions.forEach((f) => f());
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (player.active) {
      setSelected(null);
      setAccount(false);
      setPlayerOpen(false);
    }
  }, [player.active, player.videoId]);
  const addonSignature = state.addons
    .map((a) => `${a.key}:${a.enabled}`)
    .join("|");
  useEffect(() => {
    if (!ready || !["home", "discover", "search"].includes(view)) return;
    let current = true;
    setLoading(true);
    setLoadError("");
    setRows([]);
    call("catalog", {
      type: view === "home" ? "" : filter,
      search: view === "search" ? query : "",
      catalogKey: view !== "home" ? catalog : "",
    })
      .then((result) => {
        if (current) {
          setRows(
            result.rows.map((row) => ({
              ...row,
              metas: stateRef.current.settings.hideWatched
                ? row.metas.filter(
                    (m) =>
                      !Object.values(stateRef.current.progress).some(
                        (p) =>
                          p.meta.id === m.id &&
                          p.meta.type === m.type &&
                          p.duration > 0 &&
                          p.position / p.duration >= 0.95,
                      ),
                  )
                : row.metas,
            })),
          );
          setFailures(result.failures);
          setHeroIndex(0);
        }
      })
      .catch((e) => {
        if (current) setLoadError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    ready,
    view,
    filter,
    query,
    catalog,
    addonSignature,
    refresh,
    state.settings.hideWatched,
  ]);
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const open = (meta, videoId) => setSelected({ meta, videoId });
  const navigate = (v) => {
    setView(v);
    setCatalog("");
    setFilter("");
  };
  const favorites = state.favorites;
  const progress = Object.values(state.progress)
    .filter(
      (p) =>
        p.meta.type !== "local" &&
        p.position > 10 &&
        (!p.duration || p.position / p.duration < 0.95),
    )
    .sort((a, b) => b.updated - a.updated);
  const uniqueProgress = [
    ...new Map(progress.map((p) => [p.meta.id, p]).reverse()).values(),
  ].sort((a, b) => b.updated - a.updated);
  const heroItems = rows
    .flatMap((r) => r.metas)
    .filter((m) => m.background)
    .slice(0, 5);
  const hero = heroItems[heroIndex] || rows[0]?.metas?.[0];
  const favorite = (meta) => update("favorite", meta);
  const more = (row) => {
    setCatalog(row.key);
    setFilter(row.type);
    if (view !== "search") setView("discover");
  };
  const loadMore = async () => {
    if (paging || !rows[0]) return;
    setPaging(true);
    try {
      const result = await call("catalog", {
        catalogKey: catalog,
        type: filter,
        search: view === "search" ? query : "",
        skip: rows[0].metas.length,
      });
      const next = result.rows[0];
      if (next)
        setRows((old) => [
          {
            ...old[0],
            hasMore: next.metas.length > 0,
            metas: [
              ...new Map(
                [...old[0].metas, ...next.metas].map((m) => [m.id, m]),
              ).values(),
            ],
          },
        ]);
    } catch (e) {
      notice(e.message);
    } finally {
      setPaging(false);
    }
  };
  return (
    <div
      className={`app theme-${state.settings.accent} layout-${state.settings.layout || "cinematic"} cards-${state.settings.cardSize || "comfortable"} cardstyle-${state.settings.cardStyle || "glass"} ${state.settings.reduceMotion ? "reduced-motion" : ""} ${state.settings.showRatings === false ? "hide-ratings" : ""}`}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <span />
            <span />
            <span />
          </span>
          <div>
            <b>رِواق</b>
            <small>RIWAQ</small>
          </div>
        </div>
        <span className="nav-label">مساحتك السينمائية</span>
        <nav>
          {[
            [Home, "home", "الرئيسية"],
            [Compass, "discover", "اكتشف"],
            [Library, "library", "مكتبتي"],
            [Puzzle, "addons", "الإضافات"],
          ].map(([Icon, id, label]) => (
            <button
              key={id}
              className={view === id ? "nav-item active" : "nav-item"}
              onClick={() => navigate(id)}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === "library" && favorites.length > 0 && (
                <small>{favorites.length}</small>
              )}
              {id === "addons" && <small>{state.addons.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="status-dot" /> إضافاتك. اختياراتك. تجربتك.
          <p>متوافق مع إضافات ستريميو</p>
        </div>
        <div className="sidebar-bottom">
          <button
            className={view === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("settings")}
          >
            <Settings size={20} />
            الإعدادات
          </button>
          <button className="account-button" onClick={() => setAccount(true)}>
            <span className="avatar">
              {state.user ? (
                (state.user.name || state.user.email || "R")[0].toUpperCase()
              ) : (
                <LogIn size={19} />
              )}
            </span>
            <span>
              <b>{state.user?.name || "حساب ستريميو"}</b>
              <small>
                {state.user
                  ? "متصل • الإضافات مستوردة"
                  : "اربط حسابك وانقل إضافاتك"}
              </small>
            </span>
            <ChevronLeft size={16} />
          </button>
        </div>
      </aside>
      <main className={player.active ? "content with-player" : "content"}>
        <header className="topbar">
          <div className="topbar-title">
            <span className="tiny-dot" /> تجربة مشاهدة، على ذوقك
          </div>
          <form
            className="search-box"
            onSubmit={(e) => {
              e.preventDefault();
              if (search.trim()) {
                setQuery(search.trim());
                setFilter("");
                setView("search");
                setCatalog("");
              }
            }}
          >
            <Search size={17} />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث عن فيلم أو مسلسل…"
              aria-label="البحث عن فيلم أو مسلسل"
            />
            <kbd>Ctrl K</kbd>
          </form>
          <IconButton title="فتح ملف فيديو" onClick={() => act("localVideo")}>
            <FolderOpen size={20} />
          </IconButton>
        </header>
        {["home", "discover", "search"].includes(view) && (
          <>
            {view === "home" &&
              state.settings.showHero !== false &&
              !loading &&
              hero && (
                <section
                  className="hero"
                  style={{
                    backgroundImage: imgUrl(hero.background)
                      ? `url("${imgUrl(hero.background)}")`
                      : undefined,
                  }}
                >
                  <div className="hero-gradient" />
                  <div className="hero-content">
                    <span className="eyebrow">
                      <span /> من عالم السينما إلى رِواقك
                    </span>
                    <h1 dir="auto">{hero.name}</h1>
                    <div className="hero-meta">
                      {hero.imdbRating && (
                        <span className="hero-rating">
                          <Star size={15} fill="currentColor" />{" "}
                          {hero.imdbRating}
                        </span>
                      )}
                      <span>{hero.releaseInfo}</span>
                      <span>{typeName(hero.type)}</span>
                      {hero.genres?.slice(0, 2).map((g) => (
                        <span key={g}>{g}</span>
                      ))}
                    </div>
                    <p dir="auto">
                      {hero.description ||
                        "اكتشف التفاصيل، واختر مصدر المشاهدة المناسب من إضافاتك."}
                    </p>
                    <div className="button-row">
                      <button className="primary" onClick={() => open(hero)}>
                        <Play fill="currentColor" size={18} />
                        استكشف وشاهد
                      </button>
                      <button
                        className="secondary"
                        onClick={() => favorite(hero)}
                      >
                        {favorites.some((m) => m.id === hero.id) ? (
                          <Check size={20} />
                        ) : (
                          <Plus size={20} />
                        )}
                        مكتبتي
                      </button>
                    </div>
                  </div>
                  <div className="hero-footer">
                    <span>
                      اختيارات من إضافاتك <span className="hero-line" />
                    </span>
                    <div className="hero-pages">
                      {heroItems.map((m, i) => (
                        <button
                          key={i}
                          aria-label={`عرض ${m.name}`}
                          className={i === heroIndex ? "selected" : ""}
                          onClick={() => setHeroIndex(i)}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              )}
            {view === "home" && !state.user && !loading && (
              <div className="connect-banner">
                <span className="banner-icon">
                  <Puzzle size={23} />
                </span>
                <div>
                  <b>كل إضافاتك، في مكانها.</b>
                  <p>
                    اربط حساب ستريميو لاستيراد إضافاتك ومكتبتك بإعداداتها
                    الحالية.
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setAccount(true)}
                >
                  ربط الحساب <ArrowLeftIcon />
                </button>
              </div>
            )}
            <div className="page-body">
              {view !== "home" && (
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">
                      {view === "search"
                        ? "نتائج من إضافاتك"
                        : "مساحة للاكتشاف"}
                    </span>
                    <h1>
                      {view === "search"
                        ? `نتائج «${query}»`
                        : catalog
                          ? rows[0]?.name || "اكتشف"
                          : "شيء يستحق المشاهدة"}
                    </h1>
                  </div>
                  <IconButton
                    title="تحديث"
                    onClick={() => setRefresh((x) => x + 1)}
                  >
                    <RefreshCw size={19} />
                  </IconButton>
                </div>
              )}
              {view !== "home" && !catalog && (
                <div className="filter-tabs">
                  {[
                    ["", "الكل"],
                    ["movie", "أفلام"],
                    ["series", "مسلسلات"],
                    ...[...new Set(rows.map((r) => r.type))]
                      .filter((t) => !["movie", "series"].includes(t))
                      .map((t) => [t, typeName(t)]),
                  ].map(([t, label]) => (
                    <button
                      className={filter === t ? "selected" : ""}
                      key={t}
                      onClick={() => setFilter(t)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {loading ? (
                <div className="skeleton-wrap">
                  <div className="skeleton-title" />
                  <div className="skeleton-row">
                    {Array.from({ length: 6 }, (_, i) => (
                      <div className="skeleton" key={i} />
                    ))}
                  </div>
                  <Busy text="نحمّل الكتالوجات من إضافاتك…" />
                </div>
              ) : loadError ? (
                <Empty
                  icon={Wifi}
                  title="تعذّر تحميل الكتالوجات"
                  action={
                    <button
                      className="primary"
                      onClick={() => setRefresh((x) => x + 1)}
                    >
                      إعادة المحاولة
                    </button>
                  }
                >
                  {loadError}
                </Empty>
              ) : (
                <>
                  {view === "home" && uniqueProgress.length > 0 && (
                    <Rail
                      title="نكمل الحكاية؟"
                      subtitle="متابعة المشاهدة"
                      metas={uniqueProgress.map((p) => p.meta)}
                      progressMap={Object.fromEntries(
                        uniqueProgress.map((p) => [p.meta.id, p]),
                      )}
                      onOpen={open}
                    />
                  )}
                  {catalog ? (
                    <>
                      <div className="poster-grid">
                        {rows
                          .flatMap((r) => r.metas)
                          .map((m, i) => (
                            <Poster
                              key={`${m.id}:${i}`}
                              meta={m}
                              onOpen={open}
                            />
                          ))}
                      </div>
                      {rows[0]?.hasMore && (
                        <button
                          className="secondary load-more"
                          onClick={loadMore}
                          disabled={paging}
                        >
                          {paging ? "جاري التحميل…" : "تحميل المزيد"}
                        </button>
                      )}
                    </>
                  ) : (
                    rows
                      .filter((r) => r.metas.length)
                      .map((row) => (
                        <Rail
                          key={row.key}
                          title={
                            row.name === "Popular" ? "الأكثر شعبية" : row.name
                          }
                          subtitle={`${typeName(row.type)} · ${row.provider}`}
                          metas={row.metas}
                          onOpen={open}
                          onMore={() => more(row)}
                        />
                      ))
                  )}
                  {!rows.some((r) => r.metas.length) && (
                    <Empty
                      icon={view === "search" ? Search : Puzzle}
                      title={
                        view === "search"
                          ? "لم نجد نتائج لهذا البحث"
                          : "ابدأ بإضافة عوالم جديدة"
                      }
                      action={
                        view === "search" ? undefined : (
                          <button
                            className="primary"
                            onClick={() => navigate("addons")}
                          >
                            إدارة الإضافات
                          </button>
                        )
                      }
                    >
                      {view === "search"
                        ? "جرّب اسم العمل بلغته الأصلية، أو أضف كتالوجاً يدعم البحث."
                        : "أضف كتالوجاً أو اربط حساب ستريميو لتظهر العناوين هنا."}
                    </Empty>
                  )}
                  {failures.length > 0 && (
                    <div className="inline-warning">
                      <AlertCircle size={16} />
                      بعض الإضافات لم تستجب: {failures.join("، ")}
                      <button onClick={() => setRefresh((x) => x + 1)}>
                        إعادة المحاولة
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
        {view === "library" && (
          <div className="page-body">
            <div className="page-heading">
              <div>
                <span className="eyebrow">مجموعتك الخاصة</span>
                <h1>لكل حكاية، مكان.</h1>
                <p>{favorites.length} عنوان في مكتبتك</p>
              </div>
              <Library size={30} />
            </div>
            {uniqueProgress.length > 0 && (
              <Rail
                title="متابعة المشاهدة"
                metas={uniqueProgress.map((p) => p.meta)}
                progressMap={Object.fromEntries(
                  uniqueProgress.map((p) => [p.meta.id, p]),
                )}
                onOpen={open}
              />
            )}
            {(state.connectedLists || [])
              .filter((l) => l.metas.length)
              .map((l) => (
                <Rail
                  key={l.key}
                  title={l.name}
                  metas={l.metas}
                  onOpen={open}
                />
              ))}
            <div className="section-heading">
              <h2>قائمتي</h2>
            </div>
            {favorites.length ? (
              <div className="poster-grid">
                {favorites.map((m) => (
                  <Poster key={`${m.type}:${m.id}`} meta={m} onOpen={open} />
                ))}
              </div>
            ) : (
              <Empty
                icon={Heart}
                title="مكتبتك تنتظر أول حكاية"
                action={
                  <button
                    className="primary"
                    onClick={() => navigate("discover")}
                  >
                    اكتشف العناوين
                  </button>
                }
              >
                احفظ ما يعجبك بزر «مكتبتي»، أو استورد مكتبتك من حساب ستريميو.
              </Empty>
            )}
          </div>
        )}
        {view === "addons" && (
          <Addons
            state={state}
            update={update}
            act={act}
            notice={notice}
            setState={setState}
            onAccount={() => setAccount(true)}
          />
        )}
        {view === "settings" && (
          <Preferences
            state={state}
            update={update}
            act={act}
            notice={notice}
          />
        )}
        <footer className="page-footer">
          <span>
            رِواق <b>·</b> مساحة للحكايات
          </span>
          <small>عميل مستقل لمنظومة Stremio · 0.2.0</small>
        </footer>
      </main>
      {toast && (
        <div role="status" className="toast">
          <AlertCircle size={18} />
          <span>{toast}</span>
          <button aria-label="إغلاق التنبيه" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {account && (
        <Account
          state={state}
          onClose={() => setAccount(false)}
          act={act}
          update={update}
          setState={setState}
          notice={notice}
        />
      )}
      {selected && (
        <Details
          key={`${selected.meta.type}:${selected.meta.id}`}
          selection={selected}
          state={state}
          onClose={() => setSelected(null)}
          onFavorite={favorite}
          act={act}
          notice={notice}
          onPlayer={() => setPlayerOpen(true)}
        />
      )}
      {player.active && (
        <PlayerView
          player={player}
          state={state}
          act={act}
          hidden={!!selected || account || playerOpen}
          onSettings={() => setPlayerOpen(true)}
        />
      )}
      {playerOpen && (
        <PlayerPanel
          player={player}
          state={state}
          act={act}
          onClose={() => setPlayerOpen(false)}
        />
      )}
    </div>
  );
}
function ArrowLeftIcon() {
  return <ChevronLeft size={17} />;
}
