import test from "node:test";
import assert from "node:assert/strict";
import { foldArabic, matchesArabic } from "../core/arabic.mjs";
import { filterLibrary } from "../core/library.mjs";
import { searchChannels } from "../core/livetv.mjs";

test("spellings a reader treats as the same word fold together", () => {
  for (const [a, b] of [
    ["القاهرة", "القاهره"],
    ["أحمد", "احمد"],
    ["إسلام", "اسلام"],
    ["آمنة", "امنه"],
    ["مُسَلْسَل", "مسلسل"],
    ["مستشفى", "مستشفي"],
    ["مـسـلـسـل", "مسلسل"],
    ["سؤال", "سوال"],
    ["شاطئ", "شاطي"],
    ["ٱلرحمن", "الرحمن"],
    ["کتاب", "كتاب"],
  ])
    assert.equal(foldArabic(a), foldArabic(b), `${a} / ${b}`);
});

test("digits, spacing, hyphens and Latin accents stop mattering", () => {
  assert.equal(foldArabic("إم بي سي ٢"), foldArabic("ام بي سي 2"));
  assert.equal(foldArabic("۳"), "3");
  assert.equal(foldArabic("Spider-Man"), foldArabic("spider man"));
  assert.equal(foldArabic("Pokémon"), "pokemon");
});

test("an empty or punctuation-only query matches everything", () => {
  assert.equal(matchesArabic("أي شيء", ""), true);
  assert.equal(matchesArabic("أي شيء", " - "), true);
  assert.equal(matchesArabic("مسلسل القاهرة الجديد", "القاهره"), true);
  assert.equal(matchesArabic("مسلسل", "فيلم"), false);
});

test("library search and Live TV search agree", () => {
  // Before 0.5 the two folded differently, so the same typed word found a
  // channel but not the film of the same name.
  const title = [{ id: "a", type: "movie", name: "القاهرة كابول" }];
  const channel = [{ name: "القاهرة كابول", group: "" }];
  for (const query of ["القاهره", "القاهرة", "قاهره كابول", "القاهرة-كابول"])
    assert.equal(
      filterLibrary(title, { search: query }).length,
      searchChannels(channel, query).length,
      query,
    );
});
