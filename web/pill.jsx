import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Download, Globe, X } from "lucide-react";

const KEY = "riwaq-web-pill";
const RELEASES = "https://github.com/ABADIOSA/riwaq/releases";

/**
 * A small note that this is the web edition, with the desktop download for
 * those who can install it. Dismissed per browser (a convenience only).
 */
function WebPill({ version }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== version;
    } catch {
      return true;
    }
  });
  // A root of its own: it renders again when the interface language
  // changes the page's lang, so its words follow (core/i18n.mjs).
  const [, setLang] = useState(document.documentElement.lang);
  useEffect(() => {
    const watch = new MutationObserver(() =>
      setLang(document.documentElement.lang),
    );
    watch.observe(document.documentElement, { attributeFilter: ["lang"] });
    return () => watch.disconnect();
  }, []);
  if (!open) return null;
  return (
    <aside className="web-pill" aria-label="نسخة الويب">
      <Globe size={15} />
      <span>
        رِواق على الويب <b dir="ltr">{version}</b>
      </span>
      <a href={RELEASES} target="_blank" rel="noopener noreferrer">
        <Download size={14} /> نسخة ويندوز الكاملة
      </a>
      <button
        aria-label="إخفاء"
        title="إخفاء"
        onClick={() => {
          setOpen(false);
          try {
            localStorage.setItem(KEY, version);
          } catch {}
        }}
      >
        <X size={14} />
      </button>
    </aside>
  );
}

export function mountWebPill(version) {
  const host = document.createElement("div");
  host.id = "web-pill-root";
  document.body.append(host);
  createRoot(host).render(<WebPill version={version} />);
}
