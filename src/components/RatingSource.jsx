import React from "react";

/** Compact source marks; readable names stay in accessible text/tooltips. */
export default function RatingSource({ source }) {
  const name = String(source || "");
  const key = name.toLowerCase();
  const [kind, mark] = /imdb|internet movie database/.test(key)
    ? ["imdb", "IMDb"]
    : /tmdb|the movie database/.test(key)
      ? ["tmdb", "TMDB"]
      : /rotten|tomato/.test(key)
        ? ["tomato", "🍅"]
        : /metacritic/.test(key)
          ? ["metacritic", "M"]
          : ["other", name.slice(0, 5)];
  return (
    <span
      className={`rating-source rating-source-${kind}`}
      role="img"
      aria-label={name}
      title={name}
    >
      {mark}
    </span>
  );
}
