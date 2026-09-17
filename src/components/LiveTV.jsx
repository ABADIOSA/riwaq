import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Tv,
  Radio,
  Search,
  Star,
  RefreshCw,
  Plus,
  Trash2,
  Power,
  LayoutGrid,
  CalendarClock,
  History,
  LoaderCircle,
} from "lucide-react";
import { IconButton, Busy, Empty, Modal } from "./UI.jsx";
import { call } from "../lib/api.js";

const time = (value) =>
  new Date(value).toLocaleTimeString("ar-SA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    numberingSystem: "latn",
  });

/**
 * The Live TV room. Channels arrive by opaque key: the playlist URL and any
 * subscription credentials stay in the main process, so nothing here can leak
 * them into a screenshot, a log or a copied link.
 */
export default function LiveTV({ state, act, notice, update }) {
  const [mode, setMode] = useState("grid");
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [listing, setListing] = useState(null);
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [playingKey, setPlayingKey] = useState("");
  const [refresh, setRefresh] = useState(0);
  const sources = state.live?.sources || [];
  const configured = sources.length > 0;
  const hours = state.settings.epgHours || 4;
  const windowStart = useMemo(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);
    return now.getTime();
  }, [refresh, hours]);
  const typing = useRef();

  useEffect(() => {
    clearTimeout(typing.current);
    typing.current = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(typing.current);
  }, [search]);

  useEffect(() => {
    if (!configured) return;
    let live = true;
    setLoading(true);
    const request =
      mode === "grid"
        ? call("liveChannels", { group, search: query, favoritesOnly })
        : call("liveGuide", {
            group,
            search: query,
            start: windowStart,
            hours,
          });
    request
      .then((result) => {
        if (!live) return;
        if (mode === "grid") setListing(result);
        else setGuide(result);
      })
      .catch((error) => live && notice(error.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [
    mode,
    group,
    query,
    favoritesOnly,
    configured,
    refresh,
    windowStart,
    hours,
  ]);

  const groups =
    (mode === "grid" ? listing : guide)?.groups || state.live?.groups || [];
  const playChannel = async (key, programme) => {
    setPlayingKey(key);
    const result = await act(
      "playChannel",
      programme
        ? { key, start: programme.start, stop: programme.stop }
        : { key },
    );
    setPlayingKey("");
    if (result)
      notice(programme ? "جاري تشغيل إعادة البث" : "جاري تشغيل البث المباشر");
  };

  return (
    <div className="page-body live-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">بث مباشر</span>
          <h1>قنواتك، على الهواء.</h1>
          <p>
            {configured
              ? `${sources.length} مصدر · ${(mode === "grid" ? listing?.total : guide?.total) ?? 0} قناة`
              : "أضف قائمة M3U أو اشتراك Xtream لتظهر قنواتك هنا"}
          </p>
        </div>
        <div className="button-row">
          <IconButton
            title="تحديث"
            onClick={() => setRefresh((value) => value + 1)}
          >
            <RefreshCw size={19} />
          </IconButton>
          <button className="primary" onClick={() => setAdding(true)}>
            <Plus size={17} /> مصدر قنوات
          </button>
        </div>
      </div>

      {sources.length > 0 && (
        <div className="live-sources">
          {sources.map((source) => (
            <div
              key={source.id}
              className={source.enabled ? "live-source" : "live-source off"}
            >
              <span className="live-source-name">
                <Radio size={16} />
                <b dir="auto">{source.name}</b>
                <small>{source.host}</small>
              </span>
              <span className="live-source-stat">
                {source.error ? (
                  <em className="warn">{source.error}</em>
                ) : (
                  <>
                    {source.channels} قناة
                    {source.programmes
                      ? ` · ${source.programmes} برنامج`
                      : " · بلا دليل"}
                  </>
                )}
              </span>
              <span className="button-row">
                <IconButton
                  title="تحديث المصدر"
                  onClick={async () => {
                    await update("liveRefresh", { id: source.id });
                    setRefresh((value) => value + 1);
                  }}
                >
                  <RefreshCw size={15} />
                </IconButton>
                <IconButton
                  title={source.enabled ? "تعطيل" : "تفعيل"}
                  onClick={() =>
                    update("liveUpdate", { id: source.id, action: "toggle" })
                  }
                >
                  <Power size={15} />
                </IconButton>
                <IconButton
                  title="حذف المصدر"
                  onClick={() =>
                    update("liveUpdate", { id: source.id, action: "remove" })
                  }
                >
                  <Trash2 size={15} />
                </IconButton>
              </span>
            </div>
          ))}
        </div>
      )}

      {!configured ? (
        <Empty
          icon={Tv}
          title="لا توجد قنوات بعد"
          action={
            <button className="primary" onClick={() => setAdding(true)}>
              إضافة مصدر قنوات
            </button>
          }
        >
          رِواق لا يوفّر قنوات. أضف قائمة M3U أو بيانات اشتراك Xtream تملكها،
          ويُقرأ دليل البرامج تلقائياً إن وفّره المزوّد.
        </Empty>
      ) : (
        <>
          <div className="live-toolbar">
            <form
              className="search-box"
              onSubmit={(event) => event.preventDefault()}
            >
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ابحث عن قناة…"
                aria-label="البحث عن قناة"
              />
            </form>
            <div className="button-row">
              <button
                className={
                  favoritesOnly ? "secondary small selected" : "secondary small"
                }
                onClick={() => setFavoritesOnly(!favoritesOnly)}
              >
                <Star size={15} /> المفضلة
              </button>
              <button
                className={
                  mode === "grid"
                    ? "secondary small selected"
                    : "secondary small"
                }
                onClick={() => setMode("grid")}
              >
                <LayoutGrid size={15} /> القنوات
              </button>
              <button
                className={
                  mode === "guide"
                    ? "secondary small selected"
                    : "secondary small"
                }
                onClick={() => setMode("guide")}
              >
                <CalendarClock size={15} /> دليل البرامج
              </button>
            </div>
          </div>

          <div className="filter-tabs live-groups">
            <button
              className={group === "" ? "selected" : ""}
              onClick={() => setGroup("")}
            >
              كل التصنيفات
            </button>
            {groups.slice(0, 24).map((entry) => (
              <button
                key={entry.name}
                className={group === entry.name ? "selected" : ""}
                onClick={() => setGroup(entry.name)}
              >
                {entry.name} <small>{entry.count}</small>
              </button>
            ))}
          </div>

          {loading ? (
            <Busy text="نقرأ قنواتك ودليل البرامج…" />
          ) : mode === "grid" ? (
            <ChannelGrid
              listing={listing}
              playingKey={playingKey}
              onPlay={playChannel}
              onFavorite={(key) => update("liveFavorite", { key })}
            />
          ) : (
            <Guide
              guide={guide}
              start={windowStart}
              hours={hours}
              onPlay={playChannel}
            />
          )}
        </>
      )}

      {adding && (
        <AddSource
          onClose={() => setAdding(false)}
          notice={notice}
          onAdded={() => {
            setAdding(false);
            setRefresh((value) => value + 1);
          }}
          update={update}
        />
      )}
    </div>
  );
}

function ChannelGrid({ listing, playingKey, onPlay, onFavorite }) {
  if (!listing?.channels?.length)
    return (
      <Empty icon={Tv} title="لا توجد قنوات مطابقة">
        جرّب تصنيفاً آخر أو امسح كلمة البحث.
      </Empty>
    );
  return (
    <div className="channel-grid">
      {listing.channels.map((channel) => (
        <div key={channel.key} className="channel-card">
          <button
            className="channel-main"
            onClick={() => onPlay(channel.key)}
            disabled={!!playingKey}
            aria-label={`تشغيل ${channel.name}`}
          >
            <span className="channel-logo">
              {channel.logo ? (
                <img
                  src={channel.logo}
                  alt=""
                  loading="lazy"
                  onError={(event) => (event.currentTarget.style.opacity = "0")}
                />
              ) : (
                <Tv size={22} />
              )}
              {playingKey === channel.key && (
                <LoaderCircle className="spin" size={18} />
              )}
            </span>
            <span className="channel-text">
              <b dir="auto">{channel.name}</b>
              {channel.now ? (
                <>
                  <span dir="auto">{channel.now.title}</span>
                  <span className="channel-progress">
                    <i
                      style={{
                        width: `${Math.round(channel.now.progress * 100)}%`,
                      }}
                    />
                  </span>
                  <small>
                    {time(channel.now.start)} – {time(channel.now.stop)}
                    {channel.next ? ` · التالي: ${channel.next.title}` : ""}
                  </small>
                </>
              ) : (
                <small>{channel.group}</small>
              )}
            </span>
          </button>
          <IconButton
            title={channel.favorite ? "إزالة من المفضلة" : "إضافة إلى المفضلة"}
            onClick={() => onFavorite(channel.key)}
          >
            <Star size={16} fill={channel.favorite ? "currentColor" : "none"} />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

function Guide({ guide, start, hours, onPlay }) {
  if (!guide?.rows?.length)
    return (
      <Empty icon={CalendarClock} title="لا يوجد دليل برامج">
        لم يوفّر المزوّد ملف XMLTV لهذه القنوات، أو لم تصل برامج ضمن هذه الفترة.
      </Empty>
    );
  const marks = Array.from(
    { length: hours * 2 },
    (_, index) => start + index * 1800000,
  );
  const now = Date.now();
  const nowOffset = Math.min(1, Math.max(0, (now - start) / (hours * 3600000)));
  return (
    <div className="epg" dir="rtl">
      <div className="epg-ruler">
        <span className="epg-channel-head">القناة</span>
        <div className="epg-scale">
          {marks.map((mark) => (
            <span key={mark}>{time(mark)}</span>
          ))}
          {nowOffset > 0 && nowOffset < 1 && (
            <i
              className="epg-now"
              style={{ insetInlineStart: `${nowOffset * 100}%` }}
            />
          )}
        </div>
      </div>
      {guide.rows.map((row) => (
        <div key={row.key} className="epg-row">
          <span className="epg-channel">
            {row.logo ? (
              <img src={row.logo} alt="" loading="lazy" />
            ) : (
              <Tv size={16} />
            )}
            <b dir="auto">{row.name}</b>
          </span>
          <div className="epg-track">
            {row.blocks.map((block, index) => (
              <button
                key={index}
                className={`epg-block ${block.live ? "live" : ""} ${block.past ? "past" : ""}`}
                style={{
                  insetInlineStart: `${block.offset * 100}%`,
                  width: `${Math.max(block.width * 100, 2)}%`,
                }}
                title={`${block.title} · ${time(block.start)}`}
                onClick={() => onPlay(row.key, block.past ? block : null)}
              >
                <b dir="auto">{block.title}</b>
                <small>
                  {block.past && <History size={11} />} {time(block.start)}
                </small>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AddSource({ onClose, onAdded, update, notice }) {
  const [kind, setKind] = useState("m3u");
  const [form, setForm] = useState({
    name: "",
    url: "",
    epgUrl: "",
    host: "",
    username: "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const field = (key) => ({
    value: form[key],
    onChange: (event) => setForm({ ...form, [key]: event.target.value }),
  });
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    const payload =
      kind === "m3u"
        ? {
            kind,
            name: form.name,
            url: form.url,
            epgUrl: form.epgUrl || undefined,
          }
        : {
            kind,
            name: form.name,
            host: form.host,
            username: form.username,
            password: form.password,
          };
    const result = await update("liveAdd", payload);
    setBusy(false);
    if (result) {
      notice("تمت إضافة المصدر");
      onAdded();
    }
  };
  return (
    <Modal onClose={onClose} className="live-modal">
      <h2>مصدر قنوات جديد</h2>
      <p>
        بياناتك تُحفظ مشفّرة على جهازك ولا تُعرض في الواجهة. رِواق لا يوفّر أي
        اشتراك أو قناة.
      </p>
      <div className="filter-tabs">
        <button
          className={kind === "m3u" ? "selected" : ""}
          onClick={() => setKind("m3u")}
        >
          قائمة M3U
        </button>
        <button
          className={kind === "xtream" ? "selected" : ""}
          onClick={() => setKind("xtream")}
        >
          اشتراك Xtream
        </button>
      </div>
      <form className="stacked-form" onSubmit={submit}>
        <label>
          اسم المصدر
          <input
            {...field("name")}
            required
            maxLength={80}
            placeholder="اشتراكي"
          />
        </label>
        {kind === "m3u" ? (
          <>
            <label>
              رابط القائمة
              <input
                {...field("url")}
                required
                type="url"
                placeholder="https://…/playlist.m3u"
              />
            </label>
            <label>
              رابط دليل البرامج (اختياري)
              <input
                {...field("epgUrl")}
                type="url"
                placeholder="https://…/epg.xml"
              />
            </label>
          </>
        ) : (
          <>
            <label>
              عنوان الخادم
              <input
                {...field("host")}
                required
                type="url"
                placeholder="http://host:8080"
              />
            </label>
            <label>
              اسم المستخدم
              <input {...field("username")} required autoComplete="off" />
            </label>
            <label>
              كلمة المرور
              <input
                {...field("password")}
                required
                type="password"
                autoComplete="off"
              />
            </label>
          </>
        )}
        <div className="button-row">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "جاري التحقق…" : "إضافة"}
          </button>
          <button className="secondary" type="button" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </form>
    </Modal>
  );
}
