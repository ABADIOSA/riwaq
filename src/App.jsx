import {
  resolveAppearance,
  themeClasses,
  themeVariables,
} from "../core/appearance.mjs";
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
  Tv,
  Lock,
  Users,
  Folders,
} from "lucide-react";
import { api, call } from "./lib/api.js";
import { typeName, clock, imgUrl, episodeList } from "./lib/helpers.js";
import { IconButton, Busy, Empty, Poster, Rail } from "./components/UI.jsx";
import Details from "./components/Details.jsx";
import { ExploreModal, PeopleRow } from "./components/Credits.jsx";
import Account from "./components/Account.jsx";
import Addons from "./components/Addons.jsx";
import Preferences from "./components/SettingsStudio.jsx";
import PlayerView from "./components/PlayerView.jsx";
import PlayerPanel from "./components/PlayerPanel.jsx";
import LiveTV from "./components/LiveTV.jsx";
import Profiles from "./components/Profiles.jsx";
import LibraryView from "./components/LibraryView.jsx";
import { arrangeRows, safeHomeSections } from "../core/home.mjs";
import CollectionsPage, {
  NuvioLink,
  PinnedCollections,
} from "./components/Collections.jsx";
import { UpNextRail } from "./components/Episodes.jsx";
import {
  continueWatching,
  releasedEpisodes,
  isCompleted,
  titleKey,
} from "../core/library.mjs";
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
    [settingsTab, setSettingsTab] = useState("appearance"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState(""),
    [catalog, setCatalog] = useState(""),
    [rows, setRows] = useState([]),
    [failures, setFailures] = useState([]),
    [loading, setLoading] = useState(true),
    [dockRequest, setDockRequest] = useState(0),
    [loadError, setLoadError] = useState(""),
    [selected, setSelected] = useState(null),
    [explore, setExplore] = useState(null),
    [collectionTarget, setCollectionTarget] = useState(null),
    [nuvioOpen, setNuvioOpen] = useState(false),
    [account, setAccount] = useState(false),
    [toast, setToast] = useState(""),
    [player, setPlayer] = useState({ active: false }),
    [playerOpen, setPlayerOpen] = useState(false),
    [refresh, setRefresh] = useState(0),
    [heroIndex, setHeroIndex] = useState(0),
    [paging, setPaging] = useState(false),
    [profilesOpen, setProfilesOpen] = useState(false),
    [unlockRoom, setUnlockRoom] = useState(""),
    [upNext, setUpNext] = useState([]);
  const searchRef = useRef(),
    stateRef = useRef(state),
    playerRef = useRef(null),
    toastTimer = useRef(),
    advancing = useRef(false),
    advanceGeneration = useRef(0);
  stateRef.current = state;
  const notice = (message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6500);
  };
  /** Queue playback is opt-in through autoplay; explicit episode buttons stay episodic. */
  const advance = async (
    meta,
    videoId,
    direction,
    fromEnd = false,
    jumpTo = null,
  ) => {
    if (advancing.current || !meta || ["local", "live"].includes(meta.type))
      return;
    const profileId = stateRef.current.profiles?.active;
    const generation = advanceGeneration.current;
    advancing.current = true;
    try {
      const queued = fromEnd ? stateRef.current.queue?.[0] : null;
      const details = await call(
        "metadata",
        queued
          ? { type: queued.meta.type, id: queued.meta.id }
          : { type: meta.type, id: meta.id },
      );
      const videos = releasedEpisodes(details);
      const index = videos.findIndex((v) => v.id === videoId);
      const target =
        queued ||
        (jumpTo
          ? videos.find((v) => v.id === jumpTo)
          : index >= 0
            ? videos[index + direction]
            : null);
      if (!target) {
        if (!fromEnd)
          notice(direction > 0 ? "هذه آخر حلقة متاحة" : "هذه أول حلقة");
        return;
      }
      const targetId = queued ? queued.videoId : target.id;
      notice(
        queued ? "جاري تجهيز العنوان التالي في الطابور…" : "جاري تجهيز الحلقة…",
      );
      const result = await call("streams", {
        type: details.type,
        id: targetId,
      });
      if (
        stateRef.current.profiles?.active !== profileId ||
        advanceGeneration.current !== generation
      )
        return;
      const stream = result.streams.find((s) => s.supported && !s.external);
      if (!stream) {
        setSelected({ meta: details, videoId: targetId });
        notice("اختر مصدراً للمتابعة؛ بقي العنوان في الطابور");
        return;
      }
      await call("play", {
        key: stream.key,
        meta: details,
        videoId: targetId,
        profileId,
      });
      setSelected(null);
    } catch (e) {
      notice(e.message);
    } finally {
      advancing.current = false;
    }
  };
  const act = async (method, args) => {
    if (
      [
        "play",
        "stop",
        "profileSwitch",
        "profileRemove",
        "localVideo",
        "playChannel",
      ].includes(method)
    )
      advanceGeneration.current++;
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
            playerRef.current = s;
            if (s.error) notice(s.error);
          }),
          api.on("notice", notice),
          api.on("ended", ({ meta, videoId }) => {
            if (!stateRef.current.settings.autoplay) return;
            advance(meta, videoId, 1, true);
          }),
          api.on("playerRequest", ({ type, videoId: jump }) => {
            if (type === "panel") return setDockRequest((n) => n + 1);
            if (type === "settings") return setPlayerOpen(true);
            const current = playerRef.current;
            if (!current?.active || !current.meta) return;
            if (type === "episode")
              return advance(current.meta, current.videoId, 0, false, jump);
            advance(
              current.meta,
              current.videoId,
              type === "previous" ? -1 : 1,
            );
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
  useEffect(() => {
    setSelected(null);
    setPlayerOpen(false);
    setView("home");
    setRows([]);
    setQuery("");
    setSearch("");
    setCatalog("");
  }, [state.profiles?.active]);
  const addonSignature = state.addons
    .map((a) => `${a.key}:${a.enabled}`)
    .join("|");
  useEffect(() => {
    if (!ready || !["home", "discover", "search"].includes(view)) return;
    let current = true;
    setLoading(true);
    setLoadError("");
    setRows([]);
    setFailures([]);
    setHeroIndex(0);
    const args = {
      type: view === "home" ? "" : filter,
      search: view === "search" ? query : "",
      catalogKey: view !== "home" ? catalog : "",
    };
    const unwatched = (row) => ({
      ...row,
      metas: stateRef.current.settings.hideWatched
        ? row.metas.filter(
            (m) =>
              !Object.values(stateRef.current.progress).some(
                (p) =>
                  p.meta.id === m.id &&
                  p.meta.type === m.type &&
                  m.type === "movie" &&
                  isCompleted(p),
              ),
          )
        : row.metas,
    });
    // Each catalog is its own request, so rows appear as addons answer
    // instead of waiting for the slowest of dozens. Order follows the plan.
    let flush = 0;
    (async () => {
      const plan = await call("catalogPlan", args);
      if (!current) return;
      const found = new Array(plan.length);
      const failed = new Set();
      const show = () => {
        if (flush) return;
        flush = setTimeout(() => {
          flush = 0;
          if (!current) return;
          setRows(found.filter(Boolean));
          setFailures([...failed]);
        }, 120);
      };
      let next = 0;
      const worker = async () => {
        while (current && next < plan.length) {
          const item = plan[next];
          const index = next++;
          try {
            const result = await call("catalog", {
              ...args,
              catalogKey: item.key,
            });
            if (result.rows[0]) found[index] = unwatched(result.rows[0]);
            result.failures.forEach((name) => failed.add(name));
          } catch {
            failed.add(item.provider);
          }
          show();
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(8, plan.length) }, worker),
      );
      if (!current) return;
      clearTimeout(flush);
      flush = 0;
      setRows(found.filter(Boolean));
      setFailures([...failed]);
    })()
      .catch((e) => {
        if (current) setLoadError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
      clearTimeout(flush);
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
    state.profiles?.active,
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
  const activeProfile = state.profiles?.list?.find(
    (p) => p.id === state.profiles.active,
  );
  // Mirrors the gate in core/profiles.mjs: a room only locks behind a real PIN.
  const isLocked = (room) =>
    !!activeProfile?.protected &&
    !!activeProfile.lockedRooms?.includes(room) &&
    state.profiles?.unlocked === false;
  const navigate = (v) => {
    // Collections live with the library, behind the same lock.
    const room = v === "collections" ? "library" : v;
    if (isLocked(room)) {
      setUnlockRoom(room);
      return;
    }
    setView(v);
    setCatalog("");
    setFilter("");
  };
  const favorites = state.favorites;
  const uniqueProgress = continueWatching(state.progress);
  // Progress is saved every few seconds during playback. Up next only changes
  // when an episode is finished or a series is saved, so refetch on those.
  const finishedCount = Object.values(state.progress || {}).filter(
    isCompleted,
  ).length;
  useEffect(() => {
    if (!ready || view !== "home") return;
    let current = true;
    call("episodes", {})
      .then((result) => current && setUpNext(result.upNext || []))
      .catch(() => current && setUpNext([]));
    return () => {
      current = false;
    };
  }, [
    ready,
    view,
    state.profiles?.active,
    finishedCount,
    state.favorites.length,
  ]);
  const homeSections = safeHomeSections(state.settings.homeSections);
  // Home rows as the viewer arranged them; other listings keep addon order.
  const shownRows =
    view === "home"
      ? arrangeRows(rows, {
          order: state.settings.homeOrder || [],
          hidden: state.settings.homeHidden || [],
        })
      : rows;
  const catalogRails = shownRows
    .filter((r) => r.metas.length)
    .map((row) => (
      <Rail
        key={row.key}
        title={row.name === "Popular" ? "الأكثر شعبية" : row.name}
        subtitle={`${typeName(row.type)} · ${row.provider}`}
        metas={row.metas}
        onOpen={open}
        onMore={() => more(row)}
      />
    ));
  const heroItems = shownRows
    .flatMap((r) => r.metas)
    .filter((m) => m.background)
    .slice(0, 5);
  const hero = heroItems[heroIndex] || shownRows[0]?.metas?.[0];
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
  const appearance = resolveAppearance(state.settings);
  return (
    <div
      style={themeVariables(appearance)}
      className={`app ${themeClasses(appearance)} theme-${state.settings.accent} layout-${state.settings.layout || "cinematic"} cards-${state.settings.cardSize || "comfortable"} cardstyle-${state.settings.cardStyle || "glass"} ${state.settings.reduceMotion ? "reduced-motion" : ""} ${state.settings.showRatings === false ? "hide-ratings" : ""}`}
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
            [Folders, "collections", "المجموعات"],
            [Tv, "live", "بث مباشر"],
            [Puzzle, "addons", "الإضافات"],
          ]
            .filter(
              ([, id]) => !appearance.navHidden.includes(id) || view === id,
            )
            .map(([Icon, id, label]) => (
              <button
                key={id}
                className={view === id ? "nav-item active" : "nav-item"}
                onClick={() => navigate(id)}
              >
                <Icon size={20} />
                <span>{label}</span>
                {isLocked(id === "collections" ? "library" : id) && (
                  <Lock size={13} className="nav-lock" />
                )}
                {id === "library" && favorites.length > 0 && (
                  <small>{favorites.length}</small>
                )}
                {id === "addons" && <small>{state.addons.length}</small>}
                {id === "collections" && state.collections?.length > 0 && (
                  <small>{state.collections.length}</small>
                )}
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
            {state.update?.available && (
              <small className="update-dot" title="يتوفر إصدار جديد">
                جديد
              </small>
            )}
          </button>
          <button
            className="profile-button"
            onClick={() => setProfilesOpen(true)}
            title="تبديل الملف الشخصي"
          >
            <Users size={17} />
            <span>{activeProfile?.name || "المشاهد"}</span>
            {state.profiles?.list?.length > 1 && (
              <small>{state.profiles.list.length}</small>
            )}
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
        {!player.active &&
          view !== "settings" &&
          ["available", "downloading", "ready"].includes(
            state.update?.status,
          ) && (
            <div className="connect-banner update-banner" role="status">
              <span className="banner-icon">
                <RefreshCw size={23} />
              </span>
              <div>
                <b>
                  {state.update.status === "ready"
                    ? "تحديث رِواق جاهز"
                    : state.update.status === "downloading"
                      ? `جاري تنزيل التحديث · ${Math.floor(state.update.percent || 0)}%`
                      : "جديد رِواق وصل"}
                </b>
                <p>
                  الإصدار {state.update.packageVersion} ·{" "}
                  {state.update.status === "ready"
                    ? "واصل التصفح أو ثبّته في الوقت المناسب لك."
                    : "تحديثاتك ومزاياك الجديدة في مكان واحد."}
                </p>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setSettingsTab("updates");
                  setView("settings");
                }}
              >
                عرض التحديث
              </button>
            </div>
          )}
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
                navigate("search");
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
              homeSections.includes("hero") &&
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
              {view === "search" && query && !catalog && (
                <PeopleRow query={query} onExplore={setExplore} />
              )}
              {loading && rows.length === 0 ? (
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
                  ) : view === "home" ? (
                    // The viewer's own order of home sections (Settings).
                    homeSections
                      .filter((id) => id !== "hero")
                      .map((id) => (
                        <React.Fragment key={id}>
                          {id === "continue" && uniqueProgress.length > 0 && (
                            <Rail
                              title="نكمل الحكاية؟"
                              subtitle="متابعة المشاهدة"
                              metas={uniqueProgress.map((p) => p.meta)}
                              progressMap={Object.fromEntries(
                                uniqueProgress.map((p) => [
                                  titleKey(p.meta),
                                  p,
                                ]),
                              )}
                              onOpen={open}
                            />
                          )}
                          {id === "upnext" && (
                            <UpNextRail items={upNext} onOpen={open} />
                          )}
                          {id === "collections" && (
                            <PinnedCollections
                              state={state}
                              onOpen={(cid, folderId) => {
                                setCollectionTarget({ id: cid, folderId });
                                navigate("collections");
                              }}
                            />
                          )}
                          {id === "catalogs" && catalogRails}
                        </React.Fragment>
                      ))
                  ) : (
                    catalogRails
                  )}
                  {loading && <Busy text="نحمّل بقية الكتالوجات من إضافاتك…" />}
                  {!loading && !rows.some((r) => r.metas.length) && (
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
          <LibraryView
            key={state.profiles?.active}
            state={state}
            update={update}
            onOpen={open}
            notice={notice}
          />
        )}
        {view === "collections" && (
          <CollectionsPage
            key={state.profiles?.active}
            state={state}
            update={update}
            act={act}
            notice={notice}
            onOpen={open}
            target={collectionTarget}
            setTarget={setCollectionTarget}
            onNuvio={() => setNuvioOpen(true)}
            onSettings={(tab) => {
              setSettingsTab(tab);
              navigate("settings");
            }}
          />
        )}
        {view === "live" && (
          <LiveTV state={state} act={act} notice={notice} update={update} />
        )}
        {view === "addons" && (
          <Addons
            state={state}
            update={update}
            act={act}
            notice={notice}
            setState={setState}
            onAccount={() => setAccount(true)}
            onNuvio={() => setNuvioOpen(true)}
          />
        )}
        {view === "settings" && (
          <Preferences
            key={settingsTab}
            initialTab={settingsTab}
            onNuvio={() => setNuvioOpen(true)}
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
          <small>
            عميل مستقل لمنظومة Stremio
            {state.update?.current ? ` · ${state.update.current}` : ""}
          </small>
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
      {(profilesOpen || unlockRoom) && (
        <Profiles
          state={state}
          act={act}
          update={update}
          notice={notice}
          unlockRoom={unlockRoom}
          onUnlocked={() => {
            const room = unlockRoom;
            setUnlockRoom("");
            if (room) {
              setView(room);
              setCatalog("");
              setFilter("");
            }
          }}
          onClose={() => {
            setProfilesOpen(false);
            setUnlockRoom("");
          }}
        />
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
          update={update}
          act={act}
          notice={notice}
          onPlayer={() => setPlayerOpen(true)}
          onOpenTitle={(meta) => setSelected({ meta })}
        />
      )}
      {nuvioOpen && (
        <NuvioLink
          act={act}
          setState={setState}
          notice={notice}
          onClose={() => setNuvioOpen(false)}
        />
      )}
      {explore && (
        <ExploreModal
          key={explore.qid || explore.tmdb}
          start={explore}
          onClose={() => setExplore(null)}
          onOpenTitle={(meta) => {
            setExplore(null);
            setSelected({ meta });
          }}
        />
      )}
      {player.active && (
        <PlayerView
          player={player}
          state={state}
          act={act}
          hidden={
            !!selected || account || playerOpen || profilesOpen || !!unlockRoom
          }
          onSettings={() => setPlayerOpen(true)}
          update={update}
          dockRequest={dockRequest}
          onAdvance={(direction) =>
            advance(player.meta, player.videoId, direction)
          }
          onEpisode={(id) => advance(player.meta, player.videoId, 0, false, id)}
        />
      )}
      {playerOpen && (
        <PlayerPanel
          player={player}
          state={state}
          act={act}
          update={update}
          onClose={() => setPlayerOpen(false)}
        />
      )}
    </div>
  );
}
function ArrowLeftIcon() {
  return <ChevronLeft size={17} />;
}
