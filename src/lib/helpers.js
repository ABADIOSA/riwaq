export const typeName = (t) =>
  ({
    movie: "أفلام",
    series: "مسلسلات",
    anime: "أنمي",
    tv: "تلفزيون",
    channel: "قنوات",
  })[t] || t;
export const clock = (s) => {
  s = Math.floor(s || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const imgUrl = (url) =>
  /^https?:\/\//i.test(url || "") ? url : undefined;

export function episodeList(meta) {
  return (meta.videos || [])
    .filter((v) => v.id)
    .sort(
      (a, b) =>
        (a.season || 0) - (b.season || 0) ||
        (a.episode || 0) - (b.episode || 0),
    );
}
