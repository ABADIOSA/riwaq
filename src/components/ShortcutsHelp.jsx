import React from "react";
import { Keyboard } from "lucide-react";
import { Modal } from "./UI.jsx";
import { bindingLabel } from "../../core/hotkeys.mjs";

const APP_KEYS = [
  ["Ctrl + K", "البحث عن فيلم أو مسلسل"],
  ["Esc", "الرجوع من صفحة العمل أو إغلاق النافذة"],
  ["?", "هذه القائمة"],
];

/** Keyboard shortcuts: the app's own, then the viewer's playback keys. */
export default function ShortcutsHelp({ hotkeys = [], onClose, onCustomize }) {
  return (
    <Modal onClose={onClose} className="shortcuts-help">
      <span className="eyebrow">
        <Keyboard size={14} /> لوحة المفاتيح
      </span>
      <h2>اختصارات رِواق</h2>
      <div className="shortcuts-columns">
        <section>
          <h3>في التطبيق</h3>
          <dl>
            {APP_KEYS.map(([keys, label]) => (
              <div key={keys}>
                <dt>
                  <kbd>{keys}</kbd>
                </dt>
                <dd>{label}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>أثناء المشاهدة</h3>
          <dl>
            {hotkeys.map((h) => (
              <div key={h.id}>
                <dt>
                  <kbd dir="ltr">{bindingLabel(h.binding)}</kbd>
                </dt>
                <dd>{h.label}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <div className="button-row">
        <button className="secondary" onClick={onCustomize}>
          خصّص اختصارات المشاهدة
        </button>
      </div>
    </Modal>
  );
}
