import React from "react";

/**
 * One custom badge: its picture when the rule or pack has one, otherwise
 * its label in the rule's colours. Pictures are HTTPS addresses validated
 * in core; a picture that fails to load falls back to the label.
 */
export function RuleBadge({ badge }) {
  const [broken, setBroken] = React.useState(false);
  // A pack picture that failed (offline, blocked, moved): its label as a
  // Liquid Glass chip. Its own colours are for the picture's frame, and
  // FR-Badges sets them fully transparent, so they would hide the text.
  if (badge.image && broken)
    return (
      <em className="tag-fallback" dir="auto" title={badge.label}>
        {badge.label}
      </em>
    );
  if (badge.image && !broken)
    return (
      <img
        className="badge-art"
        src={badge.image}
        alt={badge.label}
        title={badge.label}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  const style = badge.style || "filled";
  return (
    <em
      className={`tag-custom badge-${style.replace(/ /g, "-")}${badge.textColor ? " has-text" : ""}`}
      style={{
        "--badge": badge.color,
        ...(badge.textColor ? { "--badge-text": badge.textColor } : {}),
        ...(badge.borderColor ? { "--badge-border": badge.borderColor } : {}),
      }}
    >
      {badge.label}
    </em>
  );
}

/**
 * A built-in chip, shown as the pack's pictures when it has them; if one
 * fails to load, the chip goes back to its text.
 */
export function ArtChip({ images, label, children }) {
  const [broken, setBroken] = React.useState(false);
  if (!images?.length || broken) return children;
  return images.map((src) => (
    <img
      key={src}
      className="badge-art"
      src={src}
      alt={label}
      title={label}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ));
}
