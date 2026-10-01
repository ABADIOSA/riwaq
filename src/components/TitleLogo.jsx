import React, { useEffect, useState } from "react";
import { logoCandidates } from "../../core/logos.mjs";
import { call } from "../lib/api.js";

// TMDB's ranked logos per title and mode, shared by every page this session.
const answers = new Map();
const waiting = new Map();
const keyOf = (meta, mode) => `${meta.type}:${meta.id}:${mode}`;

/** Asks main once per title for its TMDB logos; failures count as none. */
export function loadLogos(meta, mode) {
  if (!meta?.id || mode === "text") return Promise.resolve([]);
  const key = keyOf(meta, mode);
  if (answers.has(key)) return Promise.resolve(answers.get(key));
  if (!waiting.has(key))
    waiting.set(
      key,
      call("titleLogos", { type: meta.type, id: meta.id })
        .then((r) => r?.logos || [])
        .catch(() => [])
        .then((logos) => {
          answers.set(key, logos);
          waiting.delete(key);
          return logos;
        }),
    );
  return waiting.get(key);
}

/** Warms the logos (and their pictures) of titles about to be shown. */
export function preloadLogos(metas, mode) {
  for (const meta of metas || [])
    loadLogos(meta, mode).then((tmdb) => {
      const [first] = logoCandidates({
        tmdb,
        addonLogo: meta.logo,
        id: meta.id,
        mode,
      });
      if (first) new Image().src = first;
    });
}

/**
 * A title as its own logo: Arabic or original-language first, as the viewer
 * chose, falling back picture by picture and finally to the typed name.
 * The name stays the picture's alternative text for screen readers.
 */
export function TitleLogo({
  meta,
  mode = "arabic",
  as: Tag = "h1",
  className = "",
}) {
  const key = meta?.id ? keyOf(meta, mode) : "";
  const [tmdb, setTmdb] = useState(() => answers.get(key));
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    setTmdb(answers.get(key));
    setIndex(0);
    setShown(false);
    if (mode !== "text" && !answers.has(key))
      loadLogos(meta, mode).then((list) => live && setTmdb(list));
    return () => {
      live = false;
    };
  }, [key]);
  const name = meta?.name || "";
  if (mode === "text" || !meta?.id)
    return (
      <Tag className={className} dir="auto">
        {name}
      </Tag>
    );
  // Until main answers, hold the space without flashing the typed name.
  const candidates =
    tmdb === undefined
      ? []
      : logoCandidates({ tmdb, addonLogo: meta.logo, id: meta.id, mode });
  const src = candidates[index];
  if (tmdb !== undefined && !src)
    return (
      <Tag className={className} dir="auto">
        {name}
      </Tag>
    );
  return (
    <Tag
      className={`${className} title-wordmark ${shown ? "shown" : ""}`}
      title={name}
    >
      {src && (
        <img
          key={src}
          src={src}
          alt={name}
          decoding="async"
          onLoad={(e) => {
            // A one-pixel placeholder is not a logo.
            if (e.currentTarget.naturalWidth < 8) setIndex(index + 1);
            else setShown(true);
          }}
          onError={() => {
            setShown(false);
            setIndex(index + 1);
          }}
        />
      )}
    </Tag>
  );
}
