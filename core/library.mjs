// Shared by main and React. No network or platform dependencies.
export const titleKey = (meta) => JSON.stringify([meta?.type, meta?.id]);
export const queueKey = (type, videoId) => JSON.stringify([type, videoId]);
export const isCompleted = (p) =>
  !!p &&
  (p.completed === true || (p.duration > 0 && p.position / p.duration >= 0.95));
export function latestProgress(progress = {}) {
  const items = Object.values(progress).filter(
    (p) => p?.meta?.id && !["local", "live"].includes(p.meta.type),
  );
  const latest = new Map();
  for (const p of items.sort((a, b) => (b.updated || 0) - (a.updated || 0))) {
    const key = titleKey(p.meta);
    if (!latest.has(key)) latest.set(key, p);
  }
  return [...latest.values()];
}
export const continueWatching = (progress) =>
  latestProgress(progress).filter((p) => !isCompleted(p) && p.position > 10);
export function normalizeSearch(value) {
  return String(value || "")
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي");
}
export function filterLibrary(
  items,
  { search = "", type = "", sort = "recent" } = {},
) {
  const query = normalizeSearch(search.trim());
  const selected = items.filter((item) => {
    const meta = item.meta || item;
    return (
      (!type || meta.type === type) &&
      (!query ||
        normalizeSearch(meta.name + " " + (item.label || "")).includes(query))
    );
  });
  if (sort === "name")
    selected.sort((a, b) =>
      (a.meta || a).name.localeCompare((b.meta || b).name, "ar"),
    );
  else if (sort === "year")
    selected.sort(
      (a, b) =>
        (parseInt((b.meta || b).releaseInfo || (b.meta || b).year) || 0) -
        (parseInt((a.meta || a).releaseInfo || (a.meta || a).year) || 0),
    );
  return selected;
}
export function releasedEpisodes(meta, now = Date.now()) {
  return (meta?.videos || [])
    .filter(
      (v) =>
        v?.id &&
        (!v.released ||
          !Number.isFinite(Date.parse(v.released)) ||
          Date.parse(v.released) <= now),
    )
    .slice()
    .sort(
      (a, b) =>
        (a.season ?? 1) - (b.season ?? 1) ||
        (a.episode || 0) - (b.episode || 0),
    );
}
export function cleanMedia(meta) {
  if (
    !meta ||
    !["id", "type", "name"].every(
      (k) =>
        typeof meta[k] === "string" && meta[k].trim() && meta[k].length <= 1000,
    ) ||
    ["local", "live"].includes(meta.type)
  )
    throw new Error("بيانات العنوان غير صالحة");
  const result = { id: meta.id, type: meta.type, name: meta.name };
  for (const key of ["poster", "background"])
    if (
      typeof meta[key] === "string" &&
      /^https?:\/\//i.test(meta[key]) &&
      meta[key].length < 4096
    )
      result[key] = meta[key];
  for (const key of ["releaseInfo", "year"])
    if (meta[key] != null) result[key] = String(meta[key]).slice(0, 100);
  return result;
}
export function editQueue(
  queue,
  { action, meta, videoId, label = "", key, direction },
) {
  const next = [...queue];
  if (action === "add") {
    const media = cleanMedia(meta);
    if (typeof videoId !== "string" || !videoId.trim() || videoId.length > 1000)
      throw new Error("اختر الحلقة أو الفيلم أولاً");
    key = queueKey(media.type, videoId);
    if (next.some((item) => item.key === key)) return next;
    if (next.length >= 200)
      throw new Error(
        "الطابور يتسع لـ 200 عنوان؛ أزل عنواناً قبل إضافة المزيد",
      );
    next.push({
      key,
      meta: media,
      videoId,
      label: String(label).slice(0, 200),
      added: Date.now(),
    });
  } else {
    const index = next.findIndex((item) => item.key === key);
    if (!["remove", "move"].includes(action))
      throw new Error("إجراء الطابور غير صالح");
    if (index < 0) return next;
    if (action === "remove") next.splice(index, 1);
    else {
      if (![-1, 1].includes(direction))
        throw new Error("اتجاه الترتيب غير صالح");
      const to = index + direction;
      if (to >= 0 && to < next.length)
        [next[index], next[to]] = [next[to], next[index]];
    }
  }
  return next;
}
