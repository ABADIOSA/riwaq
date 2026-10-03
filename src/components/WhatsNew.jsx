import React from "react";
import { Sparkles } from "lucide-react";
import { Modal } from "./UI.jsx";
import { unseenNotes, WHATS_NEW } from "../../core/whats-new.mjs";

/**
 * The highlights of the releases since the one the viewer last saw
 * (core/whats-new.mjs), or the recent ones when opened from Settings.
 */
export default function WhatsNew({ current, seen, all = false, onClose }) {
  const notes = all
    ? unseenNotes({ current, list: WHATS_NEW, limit: 6 })
    : unseenNotes({ seen, current });
  return (
    <Modal onClose={onClose} className="whats-new">
      <span className="eyebrow">
        <Sparkles size={14} /> الجديد في رِواق
      </span>
      <h2>{all ? "آخر التحديثات" : `أهلاً بك في ${current}`}</h2>
      <div className="whats-new-list">
        {notes.map((note) => (
          <section key={note.version}>
            <header>
              <b>{note.title}</b>
              <bdi>{note.version}</bdi>
            </header>
            <ul>
              {note.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="button-row">
        <button className="primary" onClick={onClose}>
          تمام، يلا نشاهد
        </button>
      </div>
    </Modal>
  );
}
