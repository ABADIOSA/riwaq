const $ = (id) => document.getElementById(id);
const api = window.riwaqAdmin;
let state = {},
  nonce = "",
  previewing = false;
const status = (text) => {
  $("status").textContent = text;
};
async function action(method, args) {
  try {
    return await api.call(method, args);
  } catch (error) {
    status(error.message);
    throw error;
  }
}
function apply(next) {
  state = next;
  $("connection").textContent = state.connected
    ? "متصل بحساب الأدمن"
    : "غير متصل";
  $("workspace").textContent = state.workspace
    ? `${state.workspace.root}\n${state.workspace.branch} · ${state.workspace.commit} · v${state.workspace.version}${state.workspace.dirty ? " · توجد تعديلات محلية" : ""}`
    : "لم تحدد مصدرًا بعد.";
  for (const id of ["build", "test", "launch"])
    $(id).disabled = !state.workspace || !!state.task;
  $("choose").disabled = !!state.task;
  $("source").disabled = !state.workspace;
  $("stop").disabled = !state.task || state.task === "launch";
  $("log").textContent =
    state.log ||
    (state.task === "launch"
      ? "النسخة التجريبية مفتوحة ببيانات معزولة. أغلق نافذتها لإنهاء التجربة."
      : "نتائج البناء والفحص تظهر هنا.");
}
const draft = () => Object.fromEntries(new FormData($("editor")));
function invalidate() {
  nonce = "";
  $("publish").disabled = true;
  $("previewCard").hidden = true;
}
$("editor").addEventListener("input", invalidate);
$("editor").addEventListener("change", invalidate);
const click = (id, fn) =>
  $(id).addEventListener("click", () =>
    Promise.resolve()
      .then(fn)
      .catch(() => {}),
  );
click("connect", async () => {
  const token = $("token").value;
  $("token").value = "";
  invalidate();
  apply(await action("connect", { token }));
  status("تم الاتصال. اكتب الرسالة ثم عاينها.");
});
click("disconnect", async () => {
  invalidate();
  apply(await action("disconnect"));
  status("تم قطع الاتصال.");
});
click("choose", async () => apply(await action("chooseWorkspace")));
for (const id of ["build", "test", "launch"])
  click(id, async () => {
    apply(await action("task", { id }));
    status(id === "launch" ? "تشغيل التجربة المعزولة…" : "جار تنفيذ المهمة…");
  });
click("stop", async () => apply(await action("stopTask")));
for (const id of ["repo", "reviews", "source"])
  click(id, () => action("open", { id }));
click("tokenHelp", () => action("open", { id: "token" }));
click("save", async () => {
  invalidate();
  apply(await action("draft", draft()));
  status("حُفظت المسودة محليًا.");
});
$("editor").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (previewing) return;
  invalidate();
  previewing = true;
  $("preview").disabled = true;
  try {
    const d = draft();
    await action("draft", d);
    const result = await action("preview", {
      ar: { title: d.arTitle, body: d.arBody },
      ...(d.enTitle || d.enBody
        ? { en: { title: d.enTitle, body: d.enBody } }
        : {}),
      platform: d.platform,
      expires: Date.now() + Number(d.days) * 86400000,
      minVersion: d.minVersion,
      maxVersion: d.maxVersion,
      link: d.link,
    });
    // An edit during the request invalidates the returned preview.
    if (JSON.stringify(d) !== JSON.stringify(draft())) {
      status("تغيرت المسودة، أعد المعاينة.");
      return;
    }
    nonce = result.nonce;
    $("previewTitle").textContent = result.item.ar.title;
    $("previewBody").textContent = result.item.ar.body;
    $("previewEnTitle").textContent = result.item.en?.title || "";
    $("previewEnBody").textContent = result.item.en?.body || "";
    const platforms = { all: "الجميع", desktop: "تطبيق ويندوز", web: "الويب" };
    $("previewAudience").textContent =
      `${platforms[result.item.platform]} · حتى ${new Date(result.item.expires).toLocaleDateString("ar-SA")}${result.item.minVersion ? ` · من ${result.item.minVersion}` : ""}${result.item.maxVersion ? ` · حتى ${result.item.maxVersion}` : ""}${result.item.link ? ` · ${result.item.link}` : ""}`;
    $("previewCard").hidden = false;
    $("publish").disabled = false;
    status("راجع الرسالة والجمهور قبل النشر.");
  } catch {
  } finally {
    previewing = false;
    $("preview").disabled = false;
  }
});
click("publish", async () => {
  const reviewed = nonce;
  $("publish").disabled = true;
  const result = await action("publish", { nonce: reviewed });
  invalidate();
  status(
    result.published ? `نُشر الإشعار. معرّفه: ${result.id}` : "أُلغي النشر.",
  );
});
click("refreshReleases", async () => {
  const releases = await action("releases");
  $("releases").replaceChildren();
  for (const r of releases) {
    const button = document.createElement("button");
    button.textContent = `${r.tag} · ${r.prerelease ? "تجريبي" : "مستقر"} · ${new Date(r.at).toLocaleDateString("ar-SA")}`;
    button.addEventListener("click", () =>
      action("open", { id: "release", tag: r.tag }).catch(() => {}),
    );
    $("releases").append(button);
  }
  if (!releases.length) $("releases").textContent = "لا توجد إصدارات منشورة.";
});
api.onLog(({ log, task }) => apply({ ...state, log, task }));
apply(await action("state"));
for (const [name, value] of Object.entries(state.draft || {})) {
  const input = $("editor").elements.namedItem(name);
  if (input) input.value = value;
}
