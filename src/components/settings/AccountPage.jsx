import React, { useState } from "react";
import {
  CloudCheck,
  Copy,
  KeyRound,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
} from "lucide-react";

const when = (time) =>
  new Date(time).toLocaleString("ar-SA-u-ca-gregory-nu-latn", {
    dateStyle: "medium",
    timeStyle: "short",
  });

/**
 * Riwaq accounts (core/account.mjs, docs/ACCOUNTS.md): optional, and
 * encrypted on this device before anything leaves it.
 */
export default function AccountPage({ state, update, act, notice }) {
  const account = state.account || {};
  const [mode, setMode] = useState("signup");
  const [form, setForm] = useState({
    username: account.username || "",
    password: "",
    again: "",
    code: "",
    current: "",
    remove: "",
  });
  const [secrets, setSecrets] = useState(false);
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState("");
  const set = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  const run = async (label, work) => {
    setBusy(label);
    try {
      return await work();
    } finally {
      setBusy("");
    }
  };
  const clearSecrets = () =>
    setForm((f) => ({
      ...f,
      password: "",
      again: "",
      code: "",
      current: "",
      remove: "",
    }));
  const mismatch = form.again && form.password !== form.again;
  const field = (key, label, type = "text", autoComplete = "off") => (
    <label>
      {label}
      <input
        type={type}
        dir="ltr"
        autoComplete={autoComplete}
        spellCheck={false}
        value={form[key]}
        onChange={set(key)}
      />
    </label>
  );

  if (!account.available)
    return (
      <section className="settings-card account-card">
        <h2>
          <UserRound size={18} /> حساب رِواق
        </h2>
        <p>
          حسابات رِواق تجهز قريباً: حساب اختياري تنتقل معه مكتبتك وإعداداتك بين
          أجهزتك وموقع رِواق، مشفّرة بكلمة مرورك. رِواق يشتغل كاملاً بدون حساب.
        </p>
      </section>
    );

  if (recovery)
    return (
      <section className="settings-card account-card">
        <h2>
          <KeyRound size={18} /> رمز الاسترداد
        </h2>
        <p>
          هذا الرمز هو الطريقة الوحيدة لاسترجاع حسابك إذا نسيت كلمة المرور.
          اكتبه أو احفظه في مكان آمن الآن: ما يظهر مرة ثانية، وما نقدر نسترجعه
          لك لأننا ما نشوف بياناتك.
        </p>
        <input
          className="recovery-code"
          dir="ltr"
          readOnly
          value={recovery}
          onFocus={(event) => event.target.select()}
        />
        <div className="button-row">
          <button
            className="secondary"
            onClick={async (event) => {
              const input = event.currentTarget
                .closest(".account-card")
                .querySelector(".recovery-code");
              input.select();
              try {
                await navigator.clipboard.writeText(recovery);
              } catch {
                document.execCommand?.("copy");
              }
              notice("نسخنا رمز الاسترداد");
            }}
          >
            <Copy size={16} /> نسخ الرمز
          </button>
          <button className="primary" onClick={() => setRecovery("")}>
            حفظته في مكان آمن
          </button>
        </div>
      </section>
    );

  if (account.signedIn)
    return (
      <>
        <section className="settings-card account-card">
          <h2>
            <CloudCheck size={18} /> حسابك: <b dir="ltr">{account.username}</b>
          </h2>
          <p>
            {account.deferred
              ? "وصلت تغييرات من جهاز آخر؛ نطبّقها تلقائياً بعد انتهاء المشاهدة."
              : account.syncing
                ? "نزامن الحين…"
                : account.lastSync
                  ? `آخر مزامنة: ${when(account.lastSync)}`
                  : "ما تمت مزامنة بعد."}{" "}
            تتزامن مكتبتك ومتابعتك ومجموعاتك وملفاتك الشخصية وإعداداتك تلقائياً
            مع كل أجهزتك المسجّلة.
          </p>
          {account.error && (
            <p role="alert" className="inline-warning">
              {account.error}
            </p>
          )}
          <label className="switch-row">
            <input
              type="checkbox"
              checked={!!account.secrets}
              disabled={!!busy}
              onChange={(event) =>
                run("secrets", () =>
                  update("accountConfigure", { secrets: event.target.checked }),
                )
              }
            />
            مزامنة مفاتيحي وحساباتي المربوطة أيضاً
          </label>
          <p className="subtle">
            المفاتيح وجلسات Trakt وSimkl وستريميو وروابط الإضافات المهيأة.
            مشفّرة مثل باقي بياناتك، لكنها تنتقل لكل جهاز يدخل حسابك؛ فعّلها إذا
            كانت أجهزتك كلها لك.
          </p>
          <div className="button-row">
            <button
              className="secondary"
              disabled={!!busy || account.syncing}
              onClick={() => run("sync", () => update("accountSync"))}
            >
              <RefreshCw size={16} className={account.syncing ? "spin" : ""} />{" "}
              زامن الآن
            </button>
            <button
              className="secondary"
              disabled={!!busy}
              onClick={() =>
                run("logout", async () => {
                  if (await update("accountLogout"))
                    notice("سجّلت الخروج من هذا الجهاز؛ بياناتك باقية عليه");
                })
              }
            >
              <LogOut size={16} /> تسجيل الخروج من هذا الجهاز
            </button>
          </div>
        </section>
        <form
          className="settings-card stacked-form"
          onSubmit={(event) => {
            event.preventDefault();
            run("password", async () => {
              const ok = await update("accountPassword", {
                password: form.current,
                newPassword: form.password,
              });
              if (ok) {
                clearSecrets();
                notice("تغيّرت كلمة المرور، وخرجت أجهزتك الأخرى من الحساب");
              }
            });
          }}
        >
          <h2>
            <LockKeyhole size={17} /> تغيير كلمة المرور
          </h2>
          {field(
            "current",
            "كلمة المرور الحالية",
            "password",
            "current-password",
          )}
          {field(
            "password",
            "كلمة المرور الجديدة (10 أحرف على الأقل)",
            "password",
            "new-password",
          )}
          {field("again", "أعد كتابتها", "password", "new-password")}
          {mismatch && <p className="inline-warning">الكلمتان غير متطابقتين</p>}
          <button
            className="primary"
            type="submit"
            disabled={
              !!busy ||
              mismatch ||
              [...form.password].length < 10 ||
              !form.current
            }
          >
            {busy === "password" ? "نجهز مفاتيحك…" : "غيّر كلمة المرور"}
          </button>
        </form>
        <form
          className="settings-card stacked-form danger-zone"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !window.confirm(
                "حذف الحساب يمسح بياناته من خادم رِواق نهائياً. نسختك على هذا الجهاز تبقى. متأكد؟",
              )
            )
              return;
            run("delete", async () => {
              if (await update("accountDelete", { password: form.remove })) {
                clearSecrets();
                notice("انحذف حسابك من الخادم؛ بياناتك باقية على هذا الجهاز");
              }
            });
          }}
        >
          <h2>
            <Trash2 size={17} /> حذف الحساب
          </h2>
          <p className="subtle">
            يمسح الحساب وبياناته المشفّرة من الخادم. بياناتك على هذا الجهاز تبقى
            كما هي.
          </p>
          {field(
            "remove",
            "كلمة المرور للتأكيد",
            "password",
            "current-password",
          )}
          <button
            className="secondary danger"
            type="submit"
            disabled={!!busy || !form.remove}
          >
            {busy === "delete" ? "نحذف…" : "احذف حسابي"}
          </button>
        </form>
      </>
    );

  const submit = (event) => {
    event.preventDefault();
    if (mode === "signup")
      run("signup", async () => {
        const result = await act("accountSignup", {
          username: form.username,
          password: form.password,
          secrets,
        });
        if (result?.recoveryCode) {
          clearSecrets();
          setRecovery(result.recoveryCode);
        }
      });
    else if (mode === "login")
      run("login", async () => {
        const result = await update("accountLogin", {
          username: form.username,
          password: form.password,
        });
        if (result) {
          clearSecrets();
          notice(
            result.account?.deferred
              ? "دخلت حسابك؛ نكمل مزامنة بياناته بعد المشاهدة"
              : "دخلت حسابك، وجبنا بياناتك",
          );
        }
      });
    else
      run("recover", async () => {
        if (
          await update("accountRecover", {
            username: form.username,
            code: form.code,
            password: form.password,
          })
        ) {
          clearSecrets();
          notice("تغيّرت كلمة المرور ودخلت حسابك");
        }
      });
  };
  const needsAgain = mode !== "login";
  return (
    <>
      <div className="feature-banner">
        <ShieldCheck size={34} />
        <div>
          <h2>إعداداتك معك في كل مكان.</h2>
          <p>
            حساب رِواق اختياري تماماً: سوّه إذا تبغى مكتبتك ومتابعتك وإعداداتك
            تنتقل بين أجهزتك وموقع رِواق. بدون إيميل ولا رقم جوال، وكل شي يتشفّر
            في جهازك بكلمة مرورك قبل ما يطلع، فحتى نحن ما نقدر نقرأه.
          </p>
        </div>
      </div>
      <form
        className="settings-card stacked-form account-card"
        onSubmit={submit}
      >
        <div className="segmented text" role="tablist">
          {[
            ["signup", "حساب جديد"],
            ["login", "تسجيل الدخول"],
            ["recover", "نسيت كلمة المرور"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={mode === id ? "selected" : ""}
              onClick={() => {
                setMode(id);
                clearSecrets();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {field(
          "username",
          "اسم المستخدم (حروف إنجليزية وأرقام)",
          "text",
          "username",
        )}
        {mode === "recover" && field("code", "رمز الاسترداد")}
        {field(
          "password",
          mode === "login"
            ? "كلمة المرور"
            : "كلمة المرور الجديدة (10 أحرف على الأقل)",
          "password",
          mode === "login" ? "current-password" : "new-password",
        )}
        {needsAgain &&
          field("again", "أعد كتابتها", "password", "new-password")}
        {mismatch && needsAgain && (
          <p className="inline-warning">الكلمتان غير متطابقتين</p>
        )}
        {mode === "signup" && (
          <>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={secrets}
                onChange={(event) => setSecrets(event.target.checked)}
              />
              مزامنة مفاتيحي وحساباتي المربوطة أيضاً
            </label>
            <p className="subtle">
              نعطيك بعد التسجيل رمز استرداد. إذا نسيت كلمة المرور والرمز، تبقى
              بياناتك على أجهزتك لكن ما نقدر نرجّع نسخة الحساب.
            </p>
          </>
        )}
        <button
          className="primary"
          type="submit"
          disabled={
            !!busy ||
            !form.username ||
            !form.password ||
            (needsAgain && (mismatch || [...form.password].length < 10))
          }
        >
          {busy
            ? "نجهز مفاتيحك…"
            : mode === "signup"
              ? "سوّ حسابي"
              : mode === "login"
                ? "ادخل"
                : "استرجع حسابي"}
        </button>
      </form>
    </>
  );
}
