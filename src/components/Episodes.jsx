import React from "react";
import { Film, Sparkles, CalendarDays, Check, Tv } from "lucide-react";
import { imgUrl } from "../lib/helpers.js";
import { ScrollRow } from "./UI.jsx";
import { groupByDay } from "../../core/episodes.mjs";
import { arabicCount, EPISODES } from "../../core/arabic.mjs";

const dayKey = (time) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));

function dayLabel(day) {
  const today = dayKey(Date.now());
  if (day === today) return "اليوم";
  if (day === dayKey(Date.now() + 86400000)) return "غداً";
  if (day === dayKey(Date.now() - 86400000)) return "أمس";
  // Local noon keeps the label on the right day whatever the time zone.
  return new Date(`${day}T12:00:00`).toLocaleDateString("ar-SA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    calendar: "gregory",
    numberingSystem: "latn",
  });
}

/** The next episode of every series the viewer is keeping up with. */
export function UpNextRail({ items, onOpen }) {
  if (!items?.length) return null;
  return (
    <section className="rail">
      <div className="section-heading">
        <div>
          <h2>الحلقات التالية</h2>
          <span>من المسلسلات التي تتابعها</span>
        </div>
      </div>
      <ScrollRow className="poster-row">
        {items.slice(0, 20).map((item) => (
          <button
            key={`${item.meta.type}:${item.meta.id}`}
            className="up-next-card"
            onClick={() => onOpen(item.meta, item.video.id)}
            aria-label={`${item.meta.name}، ${item.label}`}
          >
            <span className="up-next-art">
              {imgUrl(
                item.video.thumbnail ||
                  item.meta.background ||
                  item.meta.poster,
              ) ? (
                <img
                  src={imgUrl(
                    item.video.thumbnail ||
                      item.meta.background ||
                      item.meta.poster,
                  )}
                  alt=""
                  loading="lazy"
                  onError={(event) => (event.currentTarget.style.opacity = "0")}
                />
              ) : (
                <Film size={30} />
              )}
              {item.fresh && (
                <em className="up-next-fresh">
                  <Sparkles size={11} /> جديدة
                </em>
              )}
            </span>
            <strong dir="auto">{item.meta.name}</strong>
            <span className="up-next-label">
              {item.label}
              {item.video.title ? ` · ${item.video.title}` : ""}
            </span>
            {item.remaining > 1 && (
              <small>{arabicCount(item.remaining, EPISODES)} بانتظارك</small>
            )}
          </button>
        ))}
      </ScrollRow>
    </section>
  );
}

/** Aired and upcoming episodes of followed series, one block per day. */
export function EpisodeCalendar({ entries, onOpen }) {
  if (!entries?.length)
    return (
      <div className="empty">
        <div className="empty-icon">
          <CalendarDays size={32} />
        </div>
        <h3>لا حلقات في الأسابيع القريبة</h3>
        <p>
          يعرض التقويم حلقات المسلسلات المحفوظة في مكتبتك أو التي شاهدتها،
          للأسبوع الماضي والشهر القادم.
        </p>
      </div>
    );
  return (
    <div className="calendar">
      {groupByDay(entries).map(({ day, entries: list }) => (
        <section
          key={day}
          className={
            day === dayKey(Date.now()) ? "calendar-day today" : "calendar-day"
          }
        >
          <h3>{dayLabel(day)}</h3>
          <div className="calendar-list">
            {list.map((entry) => (
              <button
                key={entry.video.id}
                className={
                  entry.aired ? "calendar-entry" : "calendar-entry upcoming"
                }
                onClick={() =>
                  onOpen(entry.meta, entry.aired ? entry.video.id : undefined)
                }
              >
                <span className="calendar-poster">
                  {imgUrl(entry.meta.poster) ? (
                    <img
                      src={imgUrl(entry.meta.poster)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <Tv size={18} />
                  )}
                </span>
                <span className="calendar-text">
                  <b dir="auto">{entry.meta.name}</b>
                  <span>
                    {entry.label}
                    {entry.video.title ? ` · ${entry.video.title}` : ""}
                  </span>
                </span>
                {entry.watched ? (
                  <Check size={16} className="calendar-watched" />
                ) : !entry.aired ? (
                  <small>قريباً</small>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
