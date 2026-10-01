import React, { useEffect, useState } from "react";
import { BellRing, Pin, PinOff, X, PartyPopper } from "lucide-react";
import {
  cleanCountdowns,
  midnightOf,
  releaseTarget,
  remaining,
} from "../../core/countdown.mjs";
import { imgUrl } from "../lib/helpers.js";
import { call } from "../lib/api.js";
import { ScrollRow } from "./UI.jsx";

const offset = () => -new Date().getTimezoneOffset();
const dayLabel = (day) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(
    "ar-SA-u-ca-gregory-nu-latn",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
  );

/** The time now, every second while the page is visible. */
function useTick() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Days, hours, minutes and seconds in four boxes. */
export function CountdownClock({ target, now, size = "" }) {
  const left = remaining(target, now);
  const parts = [
    [left.days, "يوم"],
    [left.hours, "ساعة"],
    [left.minutes, "دقيقة"],
    [left.seconds, "ثانية"],
  ];
  return (
    <div className={`countdown-clock ${size}`} role="timer" aria-live="off">
      {parts.map(([value, unit]) => (
        <span key={unit} className="countdown-unit">
          <b dir="ltr">{String(value).padStart(unit === "يوم" ? 1 : 2, "0")}</b>
          <small>{unit}</small>
        </span>
      ))}
    </div>
  );
}

/** Pins or unpins a title's countdown, bringing the home section along. */
async function setPinned(state, update, entry, on) {
  const list = cleanCountdowns(state.settings.countdowns);
  const next = on
    ? cleanCountdowns([
        entry,
        ...list.filter((c) => !(c.type === entry.type && c.id === entry.id)),
      ])
    : list.filter((c) => !(c.type === entry.type && c.id === entry.id));
  const sections = state.settings.homeSections || [];
  const patch = { countdowns: next };
  if (on && !sections.includes("countdowns")) {
    const at = sections.indexOf("hero");
    patch.homeSections =
      at < 0
        ? ["countdowns", ...sections]
        : [
            ...sections.slice(0, at + 1),
            "countdowns",
            ...sections.slice(at + 1),
          ];
  }
  return update("settings", patch);
}

/**
 * A title page's countdown: shown when the film, the series or its next
 * episode is not out yet. With a TMDB key, a film's date in the viewer's
 * region (Saudi cinemas by default) leads, with the worldwide date beside.
 */
export function TitleCountdown({ meta, state, update, notice }) {
  const now = useTick();
  const [local, setLocal] = useState(null);
  const target = releaseTarget(meta, now, offset());
  useEffect(() => {
    if (meta.type !== "movie" || !target) return;
    let live = true;
    call("releaseDates", { id: meta.id })
      .then((r) => live && setLocal(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [meta.id, !!target]);
  if (!target) return null;
  const localFuture =
    local && midnightOf(local.day, offset()) > now ? local : null;
  const day = localFuture ? localFuture.day : target.day;
  const at = midnightOf(day, offset());
  const pinned = cleanCountdowns(state.settings.countdowns).some(
    (c) => c.type === meta.type && c.id === meta.id,
  );
  const entry = {
    type: meta.type,
    id: meta.id,
    name: meta.name,
    day: target.day,
    label: target.label,
    ...(localFuture
      ? { localDay: localFuture.day, localLabel: localFuture.label }
      : {}),
    poster: meta.poster,
    background: meta.background,
    logo: meta.logo,
  };
  return (
    <section className="title-countdown" aria-label="العد التنازلي">
      <div className="title-countdown-head">
        <BellRing size={16} />
        <b>
          {target.kind === "episode"
            ? `${target.label} بعد`
            : localFuture
              ? `${localFuture.label} في ${localFuture.region === "SA" ? "السعودية" : localFuture.region} بعد`
              : `${target.label} بعد`}
        </b>
      </div>
      <CountdownClock target={at} now={now} size="large" />
      <p className="title-countdown-dates">
        {localFuture ? (
          <>
            {localFuture.label}: {dayLabel(localFuture.day)} · عالمياً:{" "}
            {dayLabel(target.day)}
          </>
        ) : (
          dayLabel(target.day)
        )}
      </p>
      <button
        className={pinned ? "secondary small" : "primary small"}
        onClick={async () => {
          if (await setPinned(state, update, entry, !pinned))
            notice(
              pinned ? "أزيل العدّاد من الرئيسية" : "ثُبّت العدّاد في الرئيسية",
            );
        }}
      >
        {pinned ? <PinOff size={15} /> : <Pin size={15} />}{" "}
        {pinned ? "إزالة من الرئيسية" : "ثبّت العدّاد في الرئيسية"}
      </button>
    </section>
  );
}

/** The home page's pinned countdowns, ticking. */
export function CountdownRail({ state, update, onOpen }) {
  const now = useTick();
  const list = cleanCountdowns(state.settings.countdowns);
  if (!list.length) return null;
  return (
    <section className="rail countdown-rail">
      <div className="section-heading">
        <div>
          <h2>العد التنازلي</h2>
          <span>الأعمال اللي تنتظرها</span>
        </div>
      </div>
      <ScrollRow className="countdown-row">
        {list.map((c) => {
          const day = c.localDay || c.day;
          const at = midnightOf(day, offset());
          const done = at <= now;
          return (
            <article
              key={`${c.type}:${c.id}`}
              className={`countdown-card ${done ? "done" : ""}`}
              style={{
                backgroundImage: imgUrl(c.background || c.poster)
                  ? `url("${imgUrl(c.background || c.poster)}")`
                  : undefined,
              }}
            >
              <button
                className="countdown-open"
                onClick={() =>
                  onOpen({
                    type: c.type,
                    id: c.id,
                    name: c.name,
                    poster: c.poster,
                    background: c.background,
                  })
                }
                aria-label={`افتح ${c.name}`}
              >
                <span className="countdown-shade" />
                <span className="countdown-body">
                  {imgUrl(c.logo) ? (
                    <img
                      className="countdown-logo"
                      src={imgUrl(c.logo)}
                      alt={c.name}
                      onError={(e) => (e.currentTarget.style.display = "none")}
                    />
                  ) : (
                    <b className="countdown-name" dir="auto">
                      {c.name}
                    </b>
                  )}
                  {done ? (
                    <span className="countdown-done">
                      <PartyPopper size={18} /> صدر! افتحه وشوف مصادره
                    </span>
                  ) : (
                    <CountdownClock target={at} now={now} />
                  )}
                  <small>
                    {c.localDay
                      ? `${c.localLabel}: `
                      : c.label
                        ? `${c.label}: `
                        : ""}
                    {dayLabel(day)}
                  </small>
                </span>
              </button>
              <button
                className="countdown-remove"
                title="إزالة"
                aria-label={`إزالة عدّاد ${c.name}`}
                onClick={() => setPinned(state, update, c, false)}
              >
                <X size={15} />
              </button>
            </article>
          );
        })}
      </ScrollRow>
    </section>
  );
}
