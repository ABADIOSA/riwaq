/**
 * The player menu's "تنزيل الترجمة" (issue #157), in main. Which subtitles of
 * this viewing can be saved, and saving one where the viewer chooses.
 *
 * - Savable: a subtitle MPV loaded from an addon (its address stays in main,
 *   found by the addon key Riwaq loaded it under) or from a subtitle file the
 *   viewer opened or dropped. A track inside the video stream is not a file
 *   of its own and is not offered; the menu says why.
 * - The page sees choices as `{ id, label, selected }` only: an id is "t"
 *   and MPV's track number, looked up again when the viewer picks it, so a
 *   track that went away is refused rather than another one saved.
 * - Saving: the bytes are fetched (core/subtitle-export.mjs) or read (a
 *   subtitle extension, a regular file, at most SUBTITLE_MAX), must be a
 *   subtitle file, and are written unchanged where the system's Save dialog
 *   says, through a temporary file renamed into place. Cancelling the dialog
 *   writes nothing.
 * - Codex's final acceptance (2026-11-21): an addon subtitle is fetched only
 *   while the configured addon that supplied it is still installed and
 *   enabled, and may reach a local address only at that addon's own local
 *   origin (`trustedOrigin`), over main's transport, which checks the
 *   address the socket connects to (electron/subtitle-http.mjs). The save
 *   is bound to the viewing, the profile's activation and the chosen
 *   track's source: `stillValid(source)` is asked before the fetch, after
 *   it, before the dialog opens, after it closes and right before the
 *   write, and any change ends the save with nothing written.
 *
 * No `electron` import: main passes the dialog and paths, tests pass fakes.
 */
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { languageOf } from "../core/subtitles.mjs";
import {
  SUBTITLE_EXTENSIONS,
  SUBTITLE_MAX,
  fetchSubtitle,
  subtitleFileName,
  subtitleFormat,
  trustedOrigin,
} from "../core/subtitle-export.mjs";

const isUrl = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || ""));

/**
 * This viewing's subtitle tracks, each with where its bytes come from.
 * `tracks` is MPV's raw track list; `externalSubs` maps a loaded address to
 * its addon key; `addonUrl(key)` is the address main holds for a key, and
 * `addonOrigin(key)` the configured addon that supplied it ("" once that
 * addon is gone or disabled).
 */
export function subtitleSources({
  tracks,
  externalSubs,
  addonUrl,
  addonOrigin = () => "",
}) {
  const out = [];
  for (const track of Array.isArray(tracks) ? tracks : []) {
    if (track?.type !== "sub" || !Number.isSafeInteger(track.id)) continue;
    const file = track["external-filename"];
    const base = {
      id: `t${track.id}`,
      track: track.id,
      lang: typeof track.lang === "string" ? track.lang : "",
      title:
        typeof track.title === "string" && !/https?:\/\//i.test(track.title)
          ? track.title.slice(0, 80)
          : "",
      selected: !!track.selected,
    };
    if (!track.external || typeof file !== "string" || !file) {
      out.push({ ...base, kind: "embedded" });
      continue;
    }
    const key = externalSubs?.get?.(file)?.key;
    const url = key ? addonUrl(key) : "";
    if (url && url === file)
      out.push({ ...base, kind: "addon", url, origin: addonOrigin(key) || "" });
    else if (
      !isUrl(file) &&
      isAbsolute(file) &&
      SUBTITLE_EXTENSIONS.includes(extname(file).slice(1).toLowerCase())
    )
      out.push({ ...base, kind: "file", path: file });
    else out.push({ ...base, kind: "other" });
  }
  return out;
}

/** A readable name for a choice: its language, its title, where it came from. */
export function sourceLabel(source) {
  const parts = [languageOf(source.lang).name];
  if (source.title && source.title !== source.lang) parts.push(source.title);
  if (source.kind === "file") parts.push("ملف على هذا الجهاز");
  return parts.join(" · ");
}

const SAVABLE = new Set(["addon", "file"]);

/**
 * What the menu shows: the savable choices (the selected one first) and,
 * when there are none, the reason.
 */
export function subtitleMenu(sources) {
  const choices = sources
    .filter((s) => SAVABLE.has(s.kind))
    .sort((a, b) => Number(b.selected) - Number(a.selected))
    .map((s) => ({ id: s.id, label: sourceLabel(s), selected: s.selected }));
  if (choices.length) return { choices, reason: "" };
  return {
    choices,
    // Short: the note sits under the item at the items' width (#150).
    reason: sources.some((s) => s.kind === "embedded")
      ? "مدمجة في ملف الفيديو"
      : "لا ترجمة محمّلة",
  };
}

async function readLocal(path) {
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile()) throw new Error("ملف الترجمة لم يعد موجوداً");
  if (info.size > SUBTITLE_MAX) throw new Error("ملف الترجمة كبير جداً");
  const bytes = new Uint8Array(await readFile(path));
  if (bytes.length > SUBTITLE_MAX) throw new Error("ملف الترجمة كبير جداً");
  return bytes;
}

/** Writes through a temporary file beside the target, renamed into place. */
export async function writeInPlace(path, bytes) {
  const temp = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${Date.now()}.part`,
  );
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

/** Whether two sources name the same track with the same file behind it. */
export function sameSource(a, b) {
  return (
    !!a &&
    !!b &&
    a.id === b.id &&
    a.kind === b.kind &&
    (a.url || "") === (b.url || "") &&
    (a.path || "") === (b.path || "") &&
    (a.origin || "") === (b.origin || "")
  );
}

/**
 * Saves one choice. `showSaveDialog(options)` is the system dialog (main
 * binds its parent window); it returns `{ canceled, filePath }`.
 * `stillValid(source)` throws once the viewing, profile or chosen track
 * changed; it is asked at every wait. Resolves `{ saved: false }` when the
 * viewer cancels, else `{ saved: true, name }` with the file's name only.
 */
export async function saveSubtitle({
  choice,
  sources,
  title,
  videoId,
  downloads,
  showSaveDialog,
  fetch,
  signal,
  stillValid = () => {},
  write = writeInPlace,
  heading = "حفظ الترجمة",
}) {
  if (typeof choice !== "string" || !/^t\d{1,9}$/.test(choice))
    throw new Error("اختر ترجمة من القائمة");
  const source = sources.find((s) => s.id === choice);
  if (!source) throw new Error("لم تعد هذه الترجمة في المشاهدة");
  if (!SAVABLE.has(source.kind))
    throw new Error("الترجمة هنا مدمجة في ملف الفيديو ولا تُحفظ منفصلة");
  if (source.kind === "addon" && !source.origin)
    throw new Error("الإضافة التي جاءت منها هذه الترجمة لم تعد مثبتة");
  stillValid(source);
  let bytes;
  try {
    bytes =
      source.kind === "addon"
        ? await fetchSubtitle(source.url, {
            fetch,
            signal,
            trusted: [trustedOrigin(source.origin)].filter(Boolean),
          })
        : await readLocal(source.path);
  } catch (error) {
    // Cancelled because the viewing ended: say that, not a network error.
    stillValid(source);
    throw error;
  }
  stillValid(source);
  const format = subtitleFormat(bytes);
  if (!format) throw new Error("الملف الذي وصل ليس ملف ترجمة");
  const lang = languageOf(source.lang).code;
  const name = subtitleFileName({
    title,
    videoId,
    lang: lang === "und" ? "" : lang,
    format,
  });
  stillValid(source);
  const answer = await showSaveDialog({
    title: heading,
    defaultPath: downloads ? join(downloads, name) : name,
    filters: [
      { name: format.toUpperCase(), extensions: [format] },
      { name: "Subtitles", extensions: SUBTITLE_EXTENSIONS },
    ],
    properties: ["showOverwriteConfirmation", "createDirectory"],
  });
  if (!answer || answer.canceled || !answer.filePath) return { saved: false };
  if (!isAbsolute(answer.filePath)) throw new Error("مكان الحفظ غير صالح");
  // The dialog may have stayed open while the viewing or profile changed.
  stillValid(source);
  await write(answer.filePath, bytes);
  return { saved: true, name: basename(answer.filePath), format };
}
