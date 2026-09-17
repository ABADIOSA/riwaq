import React, { useState } from "react";
import {
  Users,
  Lock,
  Unlock,
  Trash2,
  Plus,
  Check,
  ShieldAlert,
} from "lucide-react";
import { Modal } from "./UI.jsx";

const AVATARS = ["amber", "teal", "violet", "rose", "forest", "nord"];
const ROOMS = [
  ["live", "البث المباشر"],
  ["library", "مكتبتي"],
  ["addons", "الإضافات"],
  ["settings", "الإعدادات"],
  ["search", "البحث"],
];

/**
 * Profile switching and the parental gate. A locked room routes here first, so
 * the same dialog serves both "who is watching" and "prove you may open this".
 */
export default function Profiles({
  state,
  act,
  update,
  notice,
  unlockRoom,
  onUnlocked,
  onClose,
}) {
  const profiles = state.profiles || { list: [], active: "", unlocked: true };
  const active = profiles.list.find(
    (profile) => profile.id === profiles.active,
  );
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [pinTarget, setPinTarget] = useState(null);
  const [pinForm, setPinForm] = useState({ current: "", next: "" });
  const [challenge, setChallenge] = useState(null);

  if (unlockRoom)
    return (
      <Modal onClose={onClose} className="profile-modal">
        <h2>
          <ShieldAlert size={22} /> قسم محمي
        </h2>
        <p>أدخل رمز حماية «{active?.name}» لفتح هذا القسم في هذه الجلسة.</p>
        <form
          className="stacked-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await update("profileUnlock", { pin });
            setPin("");
            if (result) onUnlocked();
          }}
        >
          <label>
            الرمز
            <input
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, ""))
              }
              inputMode="numeric"
              autoFocus
              maxLength={8}
              type="password"
            />
          </label>
          <div className="button-row">
            <button className="primary" type="submit">
              <Unlock size={16} /> فتح
            </button>
            <button className="secondary" type="button" onClick={onClose}>
              إلغاء
            </button>
          </div>
        </form>
      </Modal>
    );

  return (
    <Modal onClose={onClose} className="profile-modal">
      <h2>
        <Users size={22} /> من يشاهد؟
      </h2>
      <p>
        لكل ملف شخصي مكتبته وتقدّمه وإعداداته. الإضافات ومفاتيح الخدمات مشتركة
        بين الجميع.
      </p>
      <div className="profile-grid">
        {profiles.list.map((profile) => (
          <div
            key={profile.id}
            className={`profile-card theme-${profile.avatar} ${profile.id === profiles.active ? "current" : ""}`}
          >
            <button
              className="profile-pick"
              onClick={async () => {
                if (profile.id === profiles.active) return;
                // Electron renderers do not support window.prompt, so the
                // challenge is a form inside the dialog.
                if (profile.protected)
                  setChallenge({ profile, intent: "switch", pin: "" });
                else await update("profileSwitch", { id: profile.id });
              }}
            >
              <span className="profile-avatar">{profile.name.slice(0, 1)}</span>
              <b dir="auto">{profile.name}</b>
              <small>
                {profile.titles} عنوان{profile.protected ? " · محمي" : ""}
              </small>
              {profile.id === profiles.active && <Check size={16} />}
            </button>
            <div className="button-row">
              <button
                className="secondary small"
                onClick={() =>
                  setEditing(editing === profile.id ? "" : profile.id)
                }
              >
                تعديل
              </button>
              <button
                className="secondary small"
                onClick={() => {
                  setPinTarget(profile);
                  setPinForm({ current: "", next: "" });
                }}
              >
                <Lock size={14} />{" "}
                {profile.protected ? "تغيير الرمز" : "رمز حماية"}
              </button>
              {profiles.list.length > 1 && (
                <button
                  className="secondary small"
                  onClick={() =>
                    profile.protected
                      ? setChallenge({ profile, intent: "remove", pin: "" })
                      : update("profileRemove", { id: profile.id })
                  }
                  title="حذف الملف الشخصي"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {editing === profile.id && (
              <div className="profile-edit">
                <label>
                  الاسم
                  <input
                    defaultValue={profile.name}
                    maxLength={40}
                    onBlur={(event) =>
                      update("profileUpdate", {
                        id: profile.id,
                        name: event.target.value,
                      })
                    }
                  />
                </label>
                <span className="avatar-row">
                  {AVATARS.map((tone) => (
                    <button
                      key={tone}
                      className={`avatar-swatch theme-${tone} ${profile.avatar === tone ? "selected" : ""}`}
                      aria-label={`لون ${tone}`}
                      onClick={() =>
                        update("profileUpdate", {
                          id: profile.id,
                          avatar: tone,
                        })
                      }
                    />
                  ))}
                </span>
                <fieldset>
                  <legend>أقسام تتطلب الرمز</legend>
                  {ROOMS.map(([id, label]) => (
                    <label key={id} className="switch-row">
                      <input
                        type="checkbox"
                        checked={(profile.lockedRooms || []).includes(id)}
                        disabled={!profile.protected}
                        onChange={(event) => {
                          const rooms = new Set(profile.lockedRooms || []);
                          if (event.target.checked) rooms.add(id);
                          else rooms.delete(id);
                          update("profileUpdate", {
                            id: profile.id,
                            lockedRooms: [...rooms],
                          });
                        }}
                      />
                      {label}
                    </label>
                  ))}
                  {!profile.protected && (
                    <small>ضع رمز حماية أولاً لتفعيل القفل.</small>
                  )}
                </fieldset>
              </div>
            )}
          </div>
        ))}
        {profiles.list.length < 6 && (
          <button
            className="profile-card add"
            onClick={() => setCreating(true)}
          >
            <Plus size={26} />
            ملف شخصي جديد
          </button>
        )}
      </div>

      {profiles.unlocked && active?.protected && (
        <button
          className="secondary small"
          onClick={() => update("profileLock")}
        >
          <Lock size={14} /> إعادة القفل الآن
        </button>
      )}

      {challenge && (
        <form
          className="stacked-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await update(
              challenge.intent === "switch" ? "profileSwitch" : "profileRemove",
              { id: challenge.profile.id, pin: challenge.pin },
            );
            if (result) setChallenge(null);
          }}
        >
          <h3>
            {challenge.intent === "switch" ? "الدخول إلى" : "حذف"} «
            {challenge.profile.name}»
          </h3>
          <label>
            رمز الحماية
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              autoFocus
              value={challenge.pin}
              onChange={(event) =>
                setChallenge({
                  ...challenge,
                  pin: event.target.value.replace(/\D/g, ""),
                })
              }
            />
          </label>
          <div className="button-row">
            <button className="primary" type="submit">
              متابعة
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setChallenge(null)}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
      {creating && (
        <form
          className="stacked-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await update("profileCreate", { name, avatar });
            if (result) {
              setCreating(false);
              setName("");
              notice("تم إنشاء الملف الشخصي");
            }
          }}
        >
          <label>
            اسم الملف الشخصي
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={40}
            />
          </label>
          <span className="avatar-row">
            {AVATARS.map((tone) => (
              <button
                key={tone}
                type="button"
                className={`avatar-swatch theme-${tone} ${avatar === tone ? "selected" : ""}`}
                aria-label={`لون ${tone}`}
                onClick={() => setAvatar(tone)}
              />
            ))}
          </span>
          <div className="button-row">
            <button className="primary" type="submit">
              إنشاء
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setCreating(false)}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {pinTarget && (
        <form
          className="stacked-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await update("profilePin", {
              id: pinTarget.id,
              pin: pinForm.next === "" ? null : pinForm.next,
              current: pinForm.current,
            });
            if (result) {
              setPinTarget(null);
              notice(
                pinForm.next ? "تم حفظ رمز الحماية" : "تم إلغاء رمز الحماية",
              );
            }
          }}
        >
          <h3>رمز حماية «{pinTarget.name}»</h3>
          {pinTarget.protected && (
            <label>
              الرمز الحالي
              <input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pinForm.current}
                onChange={(event) =>
                  setPinForm({
                    ...pinForm,
                    current: event.target.value.replace(/\D/g, ""),
                  })
                }
              />
            </label>
          )}
          <label>
            الرمز الجديد (من 4 إلى 8 أرقام، واتركه فارغاً لإلغاء الحماية)
            <input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pinForm.next}
              onChange={(event) =>
                setPinForm({
                  ...pinForm,
                  next: event.target.value.replace(/\D/g, ""),
                })
              }
            />
          </label>
          <div className="button-row">
            <button className="primary" type="submit">
              حفظ
            </button>
            <button
              className="secondary"
              type="button"
              onClick={() => setPinTarget(null)}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
