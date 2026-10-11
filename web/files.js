/**
 * Files in the web edition. The desktop opens native dialogs in main and
 * reads paths; a page can only receive the files a viewer picks and offer
 * files to download. Nothing here reaches beyond what the viewer chose.
 */

/**
 * Opens the browser's file picker. Resolves to the picked File (or Files
 * with `multiple`), or null when the viewer cancels.
 */
export function pickFile({ accept = "", multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => {
      const files = [...(input.files || [])];
      finish(files.length ? (multiple ? files : files[0]) : null);
    });
    input.addEventListener("cancel", () => finish(null));
    document.body.append(input);
    input.click();
  });
}

/** Offers text or a Blob as a download named `name`. */
export function saveFile(name, data, type = "text/plain;charset=utf-8") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand?.("copy");
    area.remove();
    if (!ok) throw new Error("ما قدرنا ننسخ إلى الحافظة في هذا المتصفح");
    return true;
  }
}

/** Opens an address the app already validated, in a new tab, without a way back. */
export function openExternal(url) {
  // With noopener the browser returns null whether or not the tab opened.
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

/** "video", "subtitle" or null for a dropped or picked file, by extension. */
export function fileKind(name, { video, subtitle }) {
  const ext = (
    /\.([a-z0-9]{2,5})$/i.exec(String(name || ""))?.[1] || ""
  ).toLowerCase();
  if (video.includes(ext)) return "video";
  if (subtitle.includes(ext)) return "subtitle";
  return null;
}
