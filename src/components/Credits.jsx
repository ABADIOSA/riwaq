import React, { useEffect, useState } from "react";
import {
  Award,
  Trophy,
  Briefcase,
  Building2,
  Cake,
  Clapperboard,
  Globe,
  MapPin,
  User,
} from "lucide-react";
import { call } from "../lib/api.js";
import { Busy, Empty, Modal, Poster, ScrollRow } from "./UI.jsx";
import { mapTiles } from "../../core/credits.mjs";
import { arabicCount, ACTORS, AWARDS, WORKS } from "../../core/arabic.mjs";
import { awardFamilies } from "../../core/awards.mjs";

const initials = (name) =>
  String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");
const gregorian = (date) => {
  const d = new Date(date);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("ar-SA-u-nu-latn", {
        calendar: "gregory",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
};
const openable = (entry) => !!(entry?.qid || entry?.tmdb);

/** Loads a title's credits once; a failure leaves the rest of Details alone. */
export function useCredits(meta, enabled) {
  const [credits, setCredits] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled || !/^tt\d+$/.test(meta?.id || "")) return;
    let current = true;
    call("titleCredits", { type: meta.type, id: meta.id })
      .then((data) => current && setCredits(data))
      .catch((e) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [meta?.id, enabled]);
  return { credits, error };
}

function Face({ image, name, size = "" }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`credit-face ${size}`}>
      {image && !broken ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <b>{initials(name) || <User size={18} />}</b>
      )}
    </span>
  );
}

/** The cast as a row of portraits under the synopsis. */
export function CastRail({ credits, onExplore }) {
  const cast = credits?.cast || [];
  if (!cast.length) return null;
  return (
    <section className="credits-cast" aria-label="طاقم التمثيل">
      <div className="section-heading">
        <h2>طاقم التمثيل</h2>
        <span>{arabicCount(cast.length, ACTORS)}</span>
      </div>
      <ScrollRow className="credits-cast-row">
        {cast.map((person, i) => (
          <button
            key={`${person.qid || person.tmdb || person.name}:${i}`}
            className="credit-person"
            disabled={!openable(person)}
            onClick={() => onExplore({ ...person, kind: "person" })}
          >
            <Face image={person.image} name={person.name} />
            <b dir="auto">{person.name}</b>
            {person.character && <small dir="auto">{person.character}</small>}
          </button>
        ))}
      </ScrollRow>
    </section>
  );
}

function Chips({ icon: Icon, title, items, kind, onExplore }) {
  if (!items?.length) return null;
  return (
    <div className="credits-group">
      <h3>
        <Icon size={15} /> {title}
      </h3>
      <div className="credits-chips">
        {items.map((item, i) => (
          <button
            key={`${item.qid || item.name}:${i}`}
            className="credit-chip"
            disabled={!openable(item)}
            onClick={() => onExplore({ ...item, kind })}
            title={item.description || item.name}
          >
            {item.image && kind === "company" && (
              <img src={item.image} alt="" loading="lazy" />
            )}
            <span dir="auto">{item.name}</span>
            {item.distributor && <small>توزيع</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** One trophy per award family, with how many the work received. */
export function AwardTrophies({ awards }) {
  const { families, other } = awardFamilies(awards);
  if (!families.length) return null;
  return (
    <div className="award-trophies" aria-label="الجوائز">
      {families.map((f) => (
        <span
          key={f.id}
          className="award-trophy"
          style={{ "--trophy": f.color }}
          title={`${f.label}: ${f.count}`}
        >
          <Trophy size={16} />
          <b>{f.count}</b> {f.label}
        </span>
      ))}
      {other > 0 && <span className="award-trophy other">+{other} أخرى</span>}
    </div>
  );
}

/** Crew by role, companies, filming locations, setting and awards. */
export function CreditsFacts({ credits, error, onExplore }) {
  if (!credits)
    return error ? (
      <section className="credits-facts">
        <p className="subtle">تعذّر جلب فريق العمل الآن: {error}</p>
      </section>
    ) : null;
  const byRole = new Map();
  for (const person of credits.crew || []) {
    const list = byRole.get(person.roleLabel) || [];
    list.push(person);
    byRole.set(person.roleLabel, list);
  }
  const empty =
    !byRole.size &&
    !credits.companies?.length &&
    !credits.locations?.length &&
    !credits.countries?.length;
  if (empty) return null;
  return (
    <section className="credits-facts">
      <div className="section-heading">
        <h2>صنّاع العمل</h2>
        <span>المصدر: {credits.sources?.join(" و")}</span>
      </div>
      {byRole.size > 0 && (
        <div className="credits-crew">
          {[...byRole.entries()].map(([role, people]) => (
            <div key={role} className="credits-role">
              <small>{role}</small>
              {people.map((person, i) => (
                <button
                  key={`${person.qid || person.tmdb || person.name}:${i}`}
                  className="credit-crew"
                  disabled={!openable(person)}
                  onClick={() => onExplore({ ...person, kind: "person" })}
                >
                  <Face image={person.image} name={person.name} size="small" />
                  <span dir="auto">{person.name}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <Chips
        icon={Building2}
        title="شركات الإنتاج والتوزيع"
        items={credits.companies}
        kind="company"
        onExplore={onExplore}
      />
      <Chips
        icon={MapPin}
        title="مواقع التصوير"
        items={credits.locations}
        kind="place"
        onExplore={onExplore}
      />
      <Chips
        icon={Clapperboard}
        title="تدور الأحداث في"
        items={credits.settings}
        kind="place"
        onExplore={onExplore}
      />
      <Chips
        icon={Globe}
        title="بلد الإنتاج"
        items={credits.countries}
        kind="place"
        onExplore={onExplore}
      />
      {credits.awards?.length > 0 && (
        <p className="credits-awards">
          <Award size={15} />
          <span>
            <b>{arabicCount(credits.awards.length, AWARDS)}</b> مسجّلة لهذا
            العمل:{" "}
            <span dir="auto">
              {credits.awards
                .slice(0, 4)
                .map((a) => a.name)
                .join("، ")}
            </span>
          </span>
        </p>
      )}
    </section>
  );
}

/** Every film of a trilogy or franchise, in order, from Wikidata's P179. */
export function CollectionRails({ credits, onOpenTitle }) {
  const collections = credits?.collections || [];
  if (!collections.length) return null;
  return collections.map((c) => (
    <section key={c.qid} className="credits-collection">
      <div className="section-heading">
        <h2>
          من نفس السلسلة · <span dir="auto">{c.name}</span>
        </h2>
        <span>{arabicCount(c.works.length, WORKS)}</span>
      </div>
      <ScrollRow className="poster-row">
        {c.works.map((work, i) => (
          <div
            key={work.id}
            className={`collection-work ${work.current ? "collection-current" : ""}`}
          >
            <span className="collection-index">{work.ordinal ?? i + 1}</span>
            <Poster
              meta={{
                id: work.id,
                type: work.type,
                name: work.name,
                poster: work.poster,
                releaseInfo: work.year ? String(work.year) : "",
                guessed: true,
              }}
              onOpen={(meta) => !work.current && onOpenTitle(meta)}
            />
            {work.current && <small>تتصفحه الآن</small>}
          </div>
        ))}
      </ScrollRow>
    </section>
  ));
}

/** People found by name in the search page; each opens the explore dialog. */
export function PeopleRow({ query, onExplore }) {
  const [people, setPeople] = useState(null);
  useEffect(() => {
    let live = true;
    setPeople(null);
    call("searchPeople", { query })
      .then((list) => live && setPeople(list))
      .catch(() => live && setPeople([]));
    return () => {
      live = false;
    };
  }, [query]);
  if (!people?.length) return null;
  return (
    <section className="credits-cast people-row" aria-label="أشخاص">
      <div className="section-heading">
        <h2>أشخاص</h2>
        <span>من Wikidata</span>
      </div>
      <ScrollRow className="credits-cast-row">
        {people.map((person) => (
          <button
            key={person.qid}
            className="credit-person"
            onClick={() => onExplore({ ...person, kind: "person" })}
          >
            <Face image={person.image} name={person.name} />
            <b dir="auto">{person.name}</b>
            {person.description && (
              <small dir="auto">{person.description}</small>
            )}
          </button>
        ))}
      </ScrollRow>
    </section>
  );
}

function PlaceMap({ coord }) {
  const map = mapTiles(coord);
  if (!map) return null;
  return (
    <figure className="explore-map">
      <div className="explore-map-tiles">
        {map.tiles.map((src) => (
          <img key={src} src={src} alt="" loading="lazy" />
        ))}
        <MapPin
          className="explore-map-pin"
          size={28}
          style={{ left: `${map.left}%`, top: `${map.top}%` }}
        />
      </div>
      <figcaption>© OpenStreetMap contributors</figcaption>
    </figure>
  );
}

const KIND_LABEL = { person: "شخص", company: "شركة", place: "مكان" };

/**
 * One person, company or place: who or what it is, and every other work
 * linked to it. A work opens its own Details, where the walk can continue.
 */
export function ExploreModal({ start, onClose, onOpenTitle }) {
  const current = start;
  const [entity, setEntity] = useState(null);
  useEffect(() => {
    let live = true;
    call("creditsEntity", { qid: current.qid || "", tmdb: current.tmdb || "" })
      .then((value) => live && setEntity(value))
      .catch((e) => live && setEntity({ error: e.message }));
    return () => {
      live = false;
    };
  }, []);
  const facts = [];
  if (entity && !entity.error) {
    if (entity.born)
      facts.push([
        Cake,
        `${gregorian(entity.born)}${entity.birthPlace ? ` · ${entity.birthPlace}` : ""}`,
      ]);
    if (entity.died) facts.push([User, `الوفاة ${gregorian(entity.died)}`]);
    if (entity.occupations?.length)
      facts.push([Briefcase, entity.occupations.join("، ")]);
    if (entity.citizenship?.length)
      facts.push([Globe, entity.citizenship.join("، ")]);
    if (entity.founded) facts.push([Building2, `تأسست ${entity.founded}`]);
    if (entity.headquarters) facts.push([MapPin, entity.headquarters]);
    if (entity.region || entity.country)
      facts.push([
        MapPin,
        [entity.region, entity.country].filter(Boolean).join("، "),
      ]);
    if (entity.awards) facts.push([Award, arabicCount(entity.awards, AWARDS)]);
  }
  return (
    <Modal onClose={onClose} className="explore-modal">
      <div className="explore-head">
        <div className="explore-identity">
          <Face
            image={entity?.image || current.image}
            name={entity?.name || current.name}
            size={`large ${current.kind}`}
          />
          <div>
            <span className="eyebrow">{KIND_LABEL[current.kind] || ""}</span>
            <h1 dir="auto">{entity?.name || current.name}</h1>
            {(entity?.description || current.description) && (
              <p className="explore-description" dir="auto">
                {entity?.description || current.description}
              </p>
            )}
          </div>
        </div>
      </div>
      {!entity ? (
        <Busy text="نجمع المعلومات والأعمال…" />
      ) : entity.error ? (
        <p className="inline-warning">{entity.error}</p>
      ) : (
        <>
          {facts.length > 0 && (
            <ul className="explore-facts">
              {facts.map(([Icon, text], i) => (
                <li key={i}>
                  <Icon size={15} />
                  <span dir="auto">{text}</span>
                </li>
              ))}
            </ul>
          )}
          <PlaceMap coord={entity.coord || current.coord} />
          {entity.biography && (
            <p className="explore-bio" dir="auto">
              {entity.biography}
            </p>
          )}
          <div className="section-heading">
            <h2>
              {current.kind === "place"
                ? "أعمال صُوّرت هنا"
                : current.kind === "company"
                  ? "من أعمال الشركة"
                  : "أعمال أخرى"}
            </h2>
            <span>{arabicCount(entity.works?.length || 0, WORKS)}</span>
          </div>
          {entity.works?.length ? (
            <div className="explore-works">
              {entity.works.slice(0, 120).map((work) => (
                <div key={work.id} className="explore-work">
                  <Poster
                    meta={{
                      id: work.id,
                      type: work.type,
                      name: work.name,
                      poster: work.poster,
                      releaseInfo: work.year ? String(work.year) : "",
                      guessed: true,
                    }}
                    onOpen={(meta) => onOpenTitle(meta)}
                  />
                  {work.roleLabels?.length > 0 && (
                    <small>{work.roleLabels.join(" · ")}</small>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={Clapperboard} title="لا توجد أعمال مسجّلة">
              لم نجد أعمالاً بمعرّف IMDb مرتبطة بهذا الاسم.
            </Empty>
          )}
          <p className="subtle explore-source">
            المصدر: {entity.sources?.join(" و") || "Wikidata"}. الصور من
            ويكيميديا كومنز وTMDB.
          </p>
        </>
      )}
    </Modal>
  );
}
