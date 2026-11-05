/**
 * The text menu (issue #131): a right-click in a text field offers Cut,
 * Copy, Paste, Delete and Select all, as on any Windows program; selected
 * text elsewhere offers Copy. Chromium decides what each field allows
 * (`editFlags`): a password field never offers Cut or Copy, a read-only
 * field never offers Paste. Electron shows no menu of its own, which is why
 * fields had none. Only the main window gets it; the HUD keeps its own HTML
 * menu, and a page that draws its own menu (posters, the player) prevents
 * the browser's, so this never appears there.
 */
export function textMenuItems(params = {}, t = (text) => text) {
  const flags = params.editFlags || {};
  const secret = params.inputFieldType === "password";
  if (params.isEditable)
    return [
      { role: "cut", label: t("قص"), enabled: !!flags.canCut && !secret },
      { role: "copy", label: t("نسخ"), enabled: !!flags.canCopy && !secret },
      { role: "paste", label: t("لصق"), enabled: !!flags.canPaste },
      { role: "delete", label: t("حذف"), enabled: !!flags.canDelete },
      { type: "separator" },
      {
        role: "selectAll",
        label: t("تحديد الكل"),
        enabled: flags.canSelectAll !== false,
      },
    ];
  if (String(params.selectionText || "").trim() && flags.canCopy !== false)
    return [{ role: "copy", label: t("نسخ") }];
  return [];
}

/**
 * Shows the menu for `contents` at the pointer, in the interface language.
 * Only for the main window: the player's menu stays HTML (PlayerMenu.jsx),
 * because a native menu owned by the HUD can open out of sight.
 */
export function attachTextMenu(contents, { t, beforeShow = () => {}, Menu }) {
  contents.on("context-menu", async (_event, params) => {
    beforeShow();
    const items = textMenuItems(params, t);
    if (!items.length) return;
    Menu ||= (await import("electron")).Menu;
    Menu.buildFromTemplate(items).popup({
      window: contents.getOwnerBrowserWindow?.() || undefined,
      x: params.x,
      y: params.y,
    });
  });
}
