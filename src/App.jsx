import {
  resolveAppearance,
  themeClasses,
  themeVariables,
} from "../core/appearance.mjs";
import React, {
  lazy,
  memo,
  Suspense,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
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
import {
  IconButton,
  Busy,
  Empty,
  Poster,
  Rail,
  ScrollRow,
} from "./components/UI.jsx";
import Details from "./components/Details.jsx";
import { ExploreModal, PeopleRow } from "./components/Credits.jsx";
import AiSearchRow from "./components/AiSearch.jsx";
import { PrayerChip } from "./components/Prayer.jsx";
import { CountdownRail } from "./components/Countdown.jsx";
import HomeHero from "./components/HomeHero.jsx";
import RiwaqNav from "./components/RiwaqNav.jsx";
import SessionHome from "./components/SessionHome.jsx";
import SmartShelves from "./components/SmartHome.jsx";
import DiscoverSections from "./components/DiscoverSections.jsx";
import WhatsNew from "./components/WhatsNew.jsx";
import ShortcutsHelp from "./components/ShortcutsHelp.jsx";
import { lastSeen, shouldShowWhatsNew } from "../core/whats-new.mjs";
import TraktSuggestions from "./components/Suggestions.jsx";
import {
  groupRows,
  groupsBesideFeed,
  homeLayout,
  SMART_IDS,
} from "../core/smart-groups.mjs";
import { arabicCount, CATALOGS } from "../core/arabic.mjs";
import AmbientLayer from "./components/Ambient.jsx";
import { WatchedContext } from "./lib/watched.js";
import Account from "./components/Account.jsx";
import PlayerView from "./components/PlayerView.jsx";
import PlayerPanel from "./components/PlayerPanel.jsx";
import Profiles from "./components/Profiles.jsx";
import { arrangeRows, visibleHomeSections } from "../core/home.mjs";
import { prefetchDue, prefetchTarget, prefetched } from "../core/prefetch.mjs";
// Rooms opened now and then load when first visited, so the start of the
// app parses only what home needs.
const Addons = lazy(() => import("./components/Addons.jsx"));
const Preferences = lazy(() => import("./components/SettingsStudio.jsx"));
const LiveTV = lazy(() => import("./components/LiveTV.jsx"));
const LibraryView = lazy(() => import("./components/LibraryView.jsx"));
const FolderPage = lazy(() => import("./components/FolderPage.jsx"));
import CollectionsPage, {
  NuvioLink,
  PinnedCollections,
} from "./components/Collections.jsx";
import WindowBar, {
  isEmptySpace,
  useWindowState,
} from "./components/WindowChrome.jsx";
import Screensaver from "./components/Screensaver.jsx";
import ServiceRails from "./components/ServiceRails.jsx";
import { drawAppIcon } from "./lib/app-icon.js";
import { UpNextRail } from "./components/Episodes.jsx";
import {
  continueWatching,
  releasedEpisodes,
  isCompleted,
  titleKey,
  watchedTitles,
  withoutWatched,
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
    // Discover and search tabs: one of Riwaq's groups, or "all".
    [group, setGroup] = useState("all"),
    // Discover's section (core/discover.mjs), kept between visits.
    [discoverTab, setDiscoverTab] = useState("movies"),
    [catalog, setCatalog] = useState(""),
    [rows, setRows] = useState([]),
    [failures, setFailures] = useState([]),
    [loading, setLoading] = useState(true),
    [dockRequest, setDockRequest] = useState(0),
    [loadError, setLoadError] = useState(""),
    [selected, setSelected] = useState(null),
    [explore, setExplore] = useState(null),
    [collectionTarget, setCollectionTarget] = useState(null),
    [folderTarget, setFolderTarget] = useState(null),
    [folderFrom, setFolderFrom] = useState("home"),
    [nuvioOpen, setNuvioOpen] = useState(false),
    // "What's new" after an update, and the keyboard shortcuts ("?").
    [whatsNew, setWhatsNew] = useState(null),
    [shortcutsOpen, setShortcutsOpen] = useState(false),
    [account, setAccount] = useState(false),
    [toast, setToast] = useState(""),
    [player, setPlayer] = useState({ active: false }),
    [scrolled, setScrolled] = useState(false),
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
    advanceGeneration = useRef(0),
    // The next title's sources, asked for before the episode ends.
    prefetchRef = useRef(null);
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
      // Sources fetched during the last minutes (core/prefetch.mjs) are used
      // when they are for this title and profile and still fresh; an answer
      // without a playable source is asked for again.
      const early = prefetched(prefetchRef.current, {
        id: targetId,
        profileId,
      });
      prefetchRef.current = null;
      let result = early ? await early.catch(() => null) : null;
      if (!result?.streams?.some((s) => s.supported && !s.external))
        result = await call("streams", {
          type: details.type,
          id: targetId,
          seriesId: details.id,
        });
      if (
        stateRef.current.profiles?.active !== profileId ||
        advanceGeneration.current !== generation
      )
        return;
      const stream = result.streams.find((s) => s.supported && !s.external);
      if (!stream) {
        setSelected({ meta: details, videoId: targetId, showSources: true });
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
  // In an episode's last minutes with autoplay on, ask for the next title's
  // sources once, so the end of the episode does not wait for every addon.
  useEffect(() => {
    if (!prefetchDue(player, state.settings)) return;
    const profileId = state.profiles?.active;
    const from = player.videoId;
    const was = prefetchRef.current;
    if (was?.from === from && was.profileId === profileId) return;
    const entry = { from, profileId, at: Date.now(), id: null, promise: null };
    prefetchRef.current = entry;
    const queue = state.queue || [];
    const meta = player.meta;
    (async () => {
      const details = queue.length
        ? null
        : await call("metadata", { type: meta.type, id: meta.id });
      const target = prefetchTarget({
        queue,
        meta,
        videoId: from,
        videos: details ? releasedEpisodes(details) : [],
      });
      if (!target || prefetchRef.current !== entry) return;
      entry.id = target.id;
      entry.at = Date.now();
      entry.promise = call("streams", target);
      entry.promise.catch(() => {});
    })().catch(() => {});
  }, [player.position, player.videoId, player.active]);
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
  // Home's layout: Riwaq's own rows (core/feed.mjs) until the viewer builds
  // collections, the addons' groups, or one row per catalog.
  const tmdbOn = (state.providers || []).some(
    (p) => p.id === "tmdb" && p.configured && p.enabled,
  );
  const layout = homeLayout(state.settings.homeGrouping, state.collections);
  const feedSignature =
    layout === "riwaq"
      ? `${tmdbOn}|${(state.settings.feedHidden || []).join(",")}`
      : "off";
  useEffect(() => {
    if (!ready || !["home", "discover", "search"].includes(view)) return;
    let current = true;
    setLoading(true);
    setLoadError("");
    setRows([]);
    setFailures([]);
    setHeroIndex(0);
    const args = {
      feed: view === "home" && feedSignature !== "off",
      ...(view === "discover" && !catalog ? { discover: discoverTab } : {}),
      type: view === "home" ? "" : filter,
      search: view === "search" ? query : "",
      catalogKey: view !== "home" ? catalog : "",
    };
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
            if (result.rows[0]) found[index] = result.rows[0];
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
    feedSignature,
    view === "discover" ? `${discoverTab}|${tmdbOn}` : "",
    refresh,
    state.profiles?.active,
  ]);
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      // "?" anywhere outside a text field opens the shortcuts.
      const t = e.target;
      if (
        e.key === "?" &&
        !e.ctrlKey &&
        !e.altKey &&
        !/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || "") &&
        !t?.isContentEditable &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  // Once per profile and version: the highlights since the release the
  // viewer last saw (core/whats-new.mjs). A fresh install just records it.
  const runningVersion = state.update?.current || "";
  useEffect(() => {
    if (!ready || !runningVersion) return;
    const used =
      (state.favorites || []).length > 0 ||
      Object.keys(state.progress || {}).length > 0;
    const seenVersion = state.settings.seenVersion;
    if (shouldShowWhatsNew({ seenVersion, used, current: runningVersion }))
      setWhatsNew({
        seen: lastSeen({ seenVersion, used, current: runningVersion }),
      });
    else if (seenVersion !== runningVersion)
      call("settings", { seenVersion: runningVersion }).catch(() => {});
  }, [ready, runningVersion, state.profiles?.active]);
  const [win] = useWindowState();
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // The taskbar icon follows the accent when the viewer asks for it.
  const look = resolveAppearance(state.settings);
  const iconSet = useRef(false);
  useEffect(() => {
    if (!ready) return;
    if (look.appIcon === "accent") {
      const dataUrl = drawAppIcon(look.colors.accent, look.colors.bg);
      if (dataUrl)
        call("setAppIcon", { dataUrl })
          .then(() => (iconSet.current = true))
          .catch(() => {});
    } else if (iconSet.current) {
      iconSet.current = false;
      call("setAppIcon", {}).catch(() => {});
    }
  }, [ready, look.appIcon, look.colors.accent, look.colors.bg]);
  // A title opens on its own page over the current view, which stays mounted
  // underneath; going back returns to where the viewer was scrolled.
  const scrollBefore = useRef(0);
  const openTitle = (next) => {
    if (!selected) scrollBefore.current = window.scrollY;
    setSelected(next);
    window.scrollTo(0, 0);
  };
  const closeTitle = () => {
    setSelected(null);
    requestAnimationFrame(() => window.scrollTo(0, scrollBefore.current));
  };
  const open = (meta, videoId) => openTitle({ meta, videoId });
  // Stable handles for memoized rows and cards: they always call the
  // latest handler, so a re-render of the app does not redraw every card.
  const latest = useRef({});
  latest.current.open = open;
  const openStable = useCallback(
    (meta, videoId) => latest.current.open(meta, videoId),
    [],
  );
  const moreStable = useCallback((row) => latest.current.more(row), []);
  const noticeStable = useCallback((m) => latest.current.notice(m), []);
  const settingsStable = useCallback((tab) => latest.current.settings(tab), []);
  // Trakt's state for the suggestions section, stable between state events.
  const traktAccount = (state.integrations || []).find((i) => i.id === "trakt");
  const traktConnected = !!traktAccount?.connected;
  const traktUser = traktAccount?.username || "";
  const traktState = useMemo(
    () => ({ connected: traktConnected, username: traktUser }),
    [traktConnected, traktUser],
  );
  const favoriteStable = useCallback(
    (meta) => latest.current.favorite(meta),
    [],
  );
  const activeProfile = state.profiles?.list?.find(
    (p) => p.id === state.profiles.active,
  );
  // Mirrors the gate in core/profiles.mjs: a room only locks behind a real PIN.
  const isLocked = (room) =>
    !!activeProfile?.protected &&
    !!activeProfile.lockedRooms?.includes(room) &&
    state.profiles?.unlocked === false;
  const navigate = (v) => {
    // Collections and their folder pages live with the library, behind the
    // same lock.
    const room = v === "collections" || v === "folder" ? "library" : v;
    if (isLocked(room)) {
      setUnlockRoom(room);
      return;
    }
    setSelected(null);
    setView(v);
    setCatalog("");
    setFilter("");
    setGroup("all");
  };
  const favorites = state.favorites;
  const uniqueProgress = useMemo(
    () => continueWatching(state.progress),
    [state.progress],
  );
  const continueRail = useMemo(
    () => ({
      metas: uniqueProgress.map((p) => p.meta),
      progressMap: Object.fromEntries(
        uniqueProgress.map((p) => [titleKey(p.meta), p]),
      ),
    }),
    [uniqueProgress],
  );
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
  const homeSections = visibleHomeSections(
    state.settings.homeSections,
    state.settings.homeSeen,
  );
  // Finished films leave the rows the moment they are finished, without a
  // reload. Search keeps them, as Nuvio HTPC does.
  // Progress is saved every few seconds while watching; the set of finished
  // titles keeps its identity until it really changes, so every card that
  // reads it does not redraw on each save.
  const finishedNow = useMemo(
    () => watchedTitles(state?.progress),
    [state?.progress],
  );
  const finishedKey = [...finishedNow].sort().join("|");
  const finished = useMemo(() => finishedNow, [finishedKey]);
  const watched = state.settings.hideWatched ? finished : null;
  const homeOrder = state.settings.homeOrder;
  const homeHidden = state.settings.homeHidden;
  const shownRows = useMemo(() => {
    const liveRows =
      watched?.size && view !== "search"
        ? rows.map((r) => ({ ...r, metas: withoutWatched(r.metas, watched) }))
        : rows;
    // Home rows as the viewer arranged them; other listings keep addon order.
    return view === "home"
      ? arrangeRows(liveRows, {
          order: homeOrder || [],
          hidden: homeHidden || [],
        })
      : liveRows;
  }, [rows, watched, view, homeOrder, homeHidden]);
  // Riwaq's groups of the rows on screen: Discover's tabs and home's shelves.
  const rowGroups = useMemo(() => groupRows(shownRows), [shownRows]);
  const groupKeys = useMemo(
    () =>
      group === "all"
        ? null
        : new Set(
            (rowGroups.find((g) => g.id === group)?.rows || []).map(
              (r) => r.key,
            ),
          ),
    [rowGroups, group],
  );
  const feedRows = useMemo(() => shownRows.filter((r) => r.feed), [shownRows]);
  const addonRows = useMemo(
    () => shownRows.filter((r) => !r.feed),
    [shownRows],
  );
  // Under Riwaq's rows, only the addon groups those rows do not cover.
  const besideFeed = useMemo(() => {
    const keep = groupsBesideFeed(tmdbOn);
    return [
      ...(state.settings.smartHidden || []),
      ...SMART_IDS.filter((id) => !keep.includes(id)),
    ];
  }, [tmdbOn, state.settings.smartHidden]);
  const catalogRails = useMemo(
    () =>
      shownRows
        .filter((r) => r.metas.length)
        .filter((r) => view === "home" || !groupKeys || groupKeys.has(r.key))
        .map((row) => (
          <CatalogRail
            key={row.key}
            row={row}
            onOpen={openStable}
            onMore={moreStable}
          />
        )),
    [shownRows, groupKeys, view],
  );
  const heroItems = useMemo(
    () =>
      shownRows
        .flatMap((r) => r.metas.slice(0, 20))
        .filter((m) => m.background)
        .filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i)
        .slice(0, 8),
    [shownRows],
  );
  const hero =
    heroItems[heroIndex % (heroItems.length || 1)] || shownRows[0]?.metas?.[0];
  const heroList = useMemo(
    () => (heroItems.length ? heroItems : hero ? [hero] : []),
    [heroItems, heroItems.length ? null : hero],
  );
  const favorite = (meta) => update("favorite", meta);
  const more = (row) => {
    setCatalog(row.key);
    setFilter(row.type);
    if (view !== "search") setView("discover");
  };
  latest.current.favorite = favorite;
  latest.current.more = more;
  latest.current.notice = notice;
  latest.current.settings = (tab) => {
    setSettingsTab(tab);
    navigate("settings");
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
        // Riwaq's TMDB rows page by number; their pages lose unmatched titles.
        page: (rows[0].page || 1) + 1,
      });
      const next = result.rows[0];
      if (next)
        setRows((old) => [
          {
            ...old[0],
            page: (old[0].page || 1) + 1,
            hasMore: next.hasMore ?? next.metas.length > 0,
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
  const riwaqExperience = state.settings.interfaceStyle !== "classic";
  const barShown = win.frame !== "native" && !win.fullscreen;
  // The artwork glow follows what is on screen: an open title, else the hero.
  // Riwaq's interface shows no hero, so its glow rests on the open title
  // only instead of the backdrop of a hero nobody can see.
  const ambientArt =
    appearance.ambient === "artwork"
      ? imgUrl(selected?.meta?.background) ||
        (riwaqExperience ? "" : imgUrl(hero?.background))
      : "";
  return (
    <WatchedContext.Provider value={finished}>
      <div
        style={{
          ...themeVariables(appearance),
        }}
        className={`app ${riwaqExperience ? "experience-riwaq" : "experience-classic"} ${themeClasses(appearance)} theme-${state.settings.accent} layout-${state.settings.layout || "cinematic"} cards-${state.settings.cardSize || "comfortable"} cardstyle-${state.settings.cardStyle || "glass"} ${state.settings.reduceMotion ? "reduced-motion" : ""} ${state.settings.showRatings === false ? "hide-ratings" : ""} ${barShown ? "chrome-bar" : ""} ${state.settings.frostTopBar ? "frost-on" : ""}`}
        onMouseDown={(e) => {
          if (
            !state.settings.dragAnywhere ||
            e.button !== 0 ||
            e.ctrlKey ||
            e.shiftKey ||
            !isEmptySpace(e.target)
          )
            return;
          call("windowDrag", { phase: "start" }).catch(() => {});
          const end = () => {
            call("windowDrag", { phase: "end" }).catch(() => {});
            window.removeEventListener("mouseup", end);
          };
          window.addEventListener("mouseup", end);
        }}
      >
        <WindowBar
          win={win}
          controls={state.settings.windowControls}
          title="رِواق"
        />
        {appearance.ambient === "artwork" && (
          <AmbientLayer
            appearance={appearance}
            fallback={ambientArt}
            reduceMotion={!!state.settings.reduceMotion}
          />
        )}
        <Screensaver
          minutes={state.settings.screensaver || 0}
          clock={state.settings.screensaverClock !== false}
          items={shownRows.flatMap((r) => r.metas).concat(favorites)}
          blocked={player.active}
        />
        {riwaqExperience ? (
          <RiwaqNav
            view={view}
            navigate={navigate}
            appearance={appearance}
            profile={activeProfile}
            user={state.user}
            onProfiles={() => setProfilesOpen(true)}
            onAccount={() => setAccount(true)}
            isLocked={isLocked}
            updateAvailable={state.update?.available}
          />
        ) : (
          <aside className="sidebar">
            <div className="brand">
              {appearance.logoStyle === "image" ? (
                <img
                  className="brand-image"
                  src={appearance.logoImage}
                  alt="رِواق"
                />
              ) : (
                <>
                  <span className="brand-mark">
                    <span />
                    <span />
                    <span />
                  </span>
                  <div className="brand-name">
                    <b>رِواق</b>
                    <small>RIWAQ</small>
                  </div>
                </>
              )}
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
                    className={
                      view === id || (view === "folder" && folderFrom === id)
                        ? "nav-item active"
                        : "nav-item"
                    }
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
              <button
                className="account-button"
                onClick={() => setAccount(true)}
              >
                <span className="avatar">
                  {state.user ? (
                    (state.user.name ||
                      state.user.email ||
                      "R")[0].toUpperCase()
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
        )}
        <main
          className={`content ${player.active ? "with-player" : ""} ${selected ? "title-open" : ""}`}
        >
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
          <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
            <div className="topbar-title">
              <span className="tiny-dot" />{" "}
              {riwaqExperience
                ? "أهلاً بك في مساحتك."
                : "تجربة مشاهدة، على ذوقك"}
            </div>
            <form
              className="search-box"
              onSubmit={(e) => {
                e.preventDefault();
                if (search.trim()) {
                  setQuery(search.trim());
                  setFilter("");
                  setGroup("all");
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
            <PrayerChip
              settings={state.settings}
              onSettings={(tab) => {
                setSettingsTab(tab);
                navigate("settings");
              }}
            />
            <IconButton
              title="فتح ملف فيديو (أو اسحبه إلى النافذة)"
              onClick={() => act("localVideo")}
            >
              <FolderOpen size={20} />
            </IconButton>
          </header>
          {selected && (
            <Details
              key={`${selected.meta.type}:${selected.meta.id}`}
              selection={selected}
              state={state}
              onClose={closeTitle}
              onFavorite={favorite}
              update={update}
              act={act}
              notice={notice}
              onPlayer={() => setPlayerOpen(true)}
              onOpenTitle={(meta) => openTitle({ meta })}
              onSettings={(tab) => {
                closeTitle();
                setSettingsTab(tab);
                navigate("settings");
              }}
            />
          )}
          {["home", "discover", "search"].includes(view) && (
            <>
              {view === "home" &&
                !riwaqExperience &&
                state.settings.showHero !== false &&
                homeSections.includes("hero") &&
                hero && (
                  <HomeHero
                    items={heroList}
                    index={heroIndex}
                    setIndex={setHeroIndex}
                    settings={state.settings}
                    favorites={favorites}
                    running={!selected && !player.active && !playerOpen}
                    onOpen={openStable}
                    onFavorite={favoriteStable}
                    fromRiwaq={feedRows.length > 0}
                  />
                )}
              {view === "home" && riwaqExperience && ready && (
                <SessionHome
                  key={state.profiles?.active || "default"}
                  state={state}
                  rows={shownRows}
                  onOpen={openStable}
                  update={update}
                  notice={notice}
                />
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
                {view === "search" && !catalog && rowGroups.length > 0 && (
                  // Riwaq's groups instead of one tab per addon type: a
                  // dozen addons used to give twenty tabs.
                  <ScrollRow className="filter-tabs" role="tablist">
                    {[
                      [
                        "all",
                        "الكل",
                        shownRows.filter((r) => r.metas.length).length,
                      ],
                      ...rowGroups.map((g) => [g.id, g.name, g.rows.length]),
                    ].map(([id, label, count]) => (
                      <button
                        className={group === id ? "selected" : ""}
                        key={id}
                        role="tab"
                        aria-selected={group === id}
                        title={`${label}: ${arabicCount(count, CATALOGS)}`}
                        onClick={() => setGroup(id)}
                      >
                        {label} <small>{count}</small>
                      </button>
                    ))}
                  </ScrollRow>
                )}
                {view === "search" && query && !catalog && (
                  <>
                    <PeopleRow query={query} onExplore={setExplore} />
                    <AiSearchRow
                      query={query}
                      ai={state.aiSearch}
                      onOpen={open}
                      onSettings={(tab) => {
                        setSettingsTab(tab);
                        navigate("settings");
                      }}
                    />
                  </>
                )}
                {loading && rows.length === 0 ? (
                  <div className="skeleton-wrap">
                    <div className="skeleton-title" />
                    <div className="skeleton-row">
                      {Array.from({ length: 6 }, (_, i) => (
                        <div className="skeleton" key={i} />
                      ))}
                    </div>
                    <Busy
                      text={
                        view === "discover"
                          ? "نجهّز لك الأعمال…"
                          : "نحمّل الكتالوجات من إضافاتك…"
                      }
                    />
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
                          {shownRows
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
                                metas={continueRail.metas}
                                progressMap={continueRail.progressMap}
                                onOpen={openStable}
                              />
                            )}
                            {id === "suggestions" && (
                              <TraktSuggestions
                                trakt={traktState}
                                onOpen={openStable}
                                onSettings={settingsStable}
                                notice={noticeStable}
                              />
                            )}
                            {id === "upnext" && (
                              <UpNextRail items={upNext} onOpen={open} />
                            )}
                            {id === "countdowns" && (
                              <CountdownRail
                                state={state}
                                update={update}
                                onOpen={(meta) => open(meta)}
                              />
                            )}
                            {id === "services" && (
                              <ServiceRails
                                state={state}
                                watched={watched}
                                onOpen={open}
                                onSettings={(tab) => {
                                  setSettingsTab(tab);
                                  navigate("settings");
                                }}
                              />
                            )}
                            {id === "collections" && (
                              <PinnedCollections
                                state={state}
                                onOpen={(cid, folderId) => {
                                  // A folder opens on its own page; the
                                  // collection's heading opens the collection.
                                  if (folderId) {
                                    setFolderTarget({
                                      collectionId: cid,
                                      folderId,
                                    });
                                    setFolderFrom("home");
                                    navigate("folder");
                                    return;
                                  }
                                  setCollectionTarget({ id: cid });
                                  navigate("collections");
                                }}
                              />
                            )}
                            {id === "catalogs" &&
                              (layout === "rows" ? (
                                catalogRails
                              ) : layout === "riwaq" && feedRows.length ? (
                                <>
                                  {feedRows.map((row) => (
                                    <CatalogRail
                                      key={row.key}
                                      row={row}
                                      onOpen={openStable}
                                      onMore={moreStable}
                                    />
                                  ))}
                                  <SmartShelves
                                    rows={addonRows}
                                    hidden={besideFeed}
                                    onOpen={openStable}
                                    onMore={moreStable}
                                  />
                                </>
                              ) : (
                                <SmartShelves
                                  rows={addonRows}
                                  hidden={state.settings.smartHidden}
                                  onOpen={openStable}
                                  onMore={moreStable}
                                />
                              ))}
                          </React.Fragment>
                        ))
                    ) : view === "discover" ? (
                      <DiscoverSections
                        tab={discoverTab}
                        setTab={setDiscoverTab}
                        rows={shownRows}
                        tmdb={tmdbOn}
                        loading={loading}
                        onOpen={openStable}
                        onMore={moreStable}
                        onSettings={settingsStable}
                      />
                    ) : (
                      catalogRails
                    )}
                    {loading && (
                      <Busy
                        text={
                          view === "discover"
                            ? "نكمل تجهيز بقية الأعمال…"
                            : "نحمّل بقية الكتالوجات من إضافاتك…"
                        }
                      />
                    )}
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
                        {/* Discover names no addon, not even a failing one. */}
                        {view === "discover"
                          ? "بعض الأعمال لم تصل بعد."
                          : `بعض الإضافات لم تستجب: ${failures.join("، ")}`}
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
          <Suspense fallback={<Busy />}>
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
                onFolderPage={(cid, folderId) => {
                  setFolderTarget({ collectionId: cid, folderId });
                  setFolderFrom("collections");
                  navigate("folder");
                }}
                onNuvio={() => setNuvioOpen(true)}
                onSettings={(tab) => {
                  setSettingsTab(tab);
                  navigate("settings");
                }}
              />
            )}
            {view === "folder" && (
              <FolderPage
                key={state.profiles?.active}
                state={state}
                target={folderTarget}
                onTarget={setFolderTarget}
                onOpen={open}
                onBack={() => navigate(folderFrom)}
                onEdit={(cid, folderId) => {
                  setCollectionTarget({ id: cid, folderId });
                  navigate("collections");
                }}
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
          </Suspense>
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
                setGroup("all");
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

        {whatsNew && (
          <WhatsNew
            current={runningVersion}
            seen={whatsNew.seen}
            onClose={() => {
              setWhatsNew(null);
              update("settings", { seenVersion: runningVersion });
            }}
          />
        )}
        {shortcutsOpen && (
          <ShortcutsHelp
            hotkeys={state.hotkeys || []}
            onClose={() => setShortcutsOpen(false)}
            onCustomize={() => {
              setShortcutsOpen(false);
              setSettingsTab("hotkeys");
              navigate("settings");
            }}
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
              openTitle({ meta });
            }}
          />
        )}
        {player.active && (
          <PlayerView
            player={player}
            state={state}
            act={act}
            hidden={
              !!selected ||
              account ||
              playerOpen ||
              profilesOpen ||
              !!unlockRoom
            }
            onSettings={() => setPlayerOpen(true)}
            update={update}
            dockRequest={dockRequest}
            onAdvance={(direction) =>
              advance(player.meta, player.videoId, direction)
            }
            onEpisode={(id) =>
              advance(player.meta, player.videoId, 0, false, id)
            }
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
    </WatchedContext.Provider>
  );
}
/** One addon catalog on home, discover or search; redrawn only when its row changes. */
const CatalogRail = memo(function CatalogRail({ row, onOpen, onMore }) {
  return (
    <Rail
      title={row.name === "Popular" ? "الأكثر شعبية" : row.name}
      subtitle={`${typeName(row.type)} · ${row.provider}`}
      metas={row.metas}
      onOpen={onOpen}
      onMore={() => onMore(row)}
    />
  );
});

function ArrowLeftIcon() {
  return <ChevronLeft size={17} />;
}
