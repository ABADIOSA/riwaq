// Codex's fourth review of PR #155 (Q8, docs/REVIEW-PR-155.md, "Fifth
// pass"): Riwaq's export at b9d946e wrote a stored folder ID
// "nuvio-riwaq-folder" as "riwaq-folder", which reads back today as
// Riwaq's own "folder". Under a collection the viewer has by its own ID,
// the preview asked nothing and Merge kept both folders. The file's IDs
// below are exactly what that exporter wrote (its exportId: "nuvio-X" → X,
// anything else → "riwaq-" + the ID); Codex's harness runs the actual
// b9d946e module against this code (VERIFICATION.md).
import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanCollections,
  fromNuvio,
  importCollections,
  legacyMatches,
  toNuvio,
} from "../core/collections.mjs";
import { Client, PROFILE_CHANGED } from "../core/client.mjs";

/** b9d946e's exportId. */
const oldExportId = (id) => {
  const nuvio = /^nuvio-([\w-]+)$/.exec(id);
  return nuvio ? nuvio[1] : `riwaq-${id}`;
};
const ART = `local:${"e".repeat(32)}`;
const drama = [
  {
    provider: "tmdb",
    tmdbSourceType: "discover",
    filters: { withGenres: "18" },
  },
];
const mineWith = (...folders) =>
  cleanCollections([
    {
      id: "same-parent",
      title: "My collection",
      pinned: true,
      cover: ART,
      folders,
    },
  ]);
const myFolder = (id, title = "My folder") => ({
  id,
  title,
  cover: ART,
  tmdb: [{ kind: "discover", filters: { withGenres: "18" } }],
  titles: [{ id: "tt0000101", type: "movie", name: "Picked by hand" }],
});
/** The JSON b9d946e exported for these collections. */
const oldFile = (collections) =>
  JSON.stringify(
    collections.map((c) => ({
      id: oldExportId(c.id),
      title: c.title,
      folders: c.folders.map((f) => ({
        id: oldExportId(f.id),
        title: f.title,
        sources: drama,
      })),
    })),
  );
const read = (text) => fromNuvio(text);
const merge = (current, converted, legacy) =>
  importCollections(current, converted.collections, {
    mode: "merge",
    aliases: converted.report.aliases,
    legacy,
  }).collections;

test("Q8: a b9d946e folder under a matching collection is asked about, by its ID, never by name", () => {
  const current = mineWith(myFolder("nuvio-riwaq-folder"));
  const converted = read(oldFile(current));
  assert.equal(converted.collections[0].id, "same-parent");
  assert.equal(converted.collections[0].folders[0].id, "folder");
  const matches = legacyMatches(current, converted);
  assert.deepEqual(matches, [
    {
      id: "same-parent/folder",
      title: "My folder",
      match: "nuvio-riwaq-folder",
      mine: "My folder",
      folder: true,
      collection: "My collection",
    },
  ]);
  // Unanswered, a merge changes nothing and says why.
  assert.throws(() => merge(current, converted, {}), /مجلد من نسخة أقدم/);
  // A folder of the same NAME but another ID is never matched.
  const other = mineWith(myFolder("nuvio-something-else", "My folder"));
  assert.deepEqual(legacyMatches(other, read(oldFile(current))), []);
});

test("Q8: Update keeps one folder, the viewer's ID, picture and titles; merging again adds nothing", () => {
  const current = mineWith(myFolder("nuvio-riwaq-folder"));
  const converted = read(oldFile(current));
  const legacy = { "same-parent/folder": "match" };
  const once = merge(current, converted, legacy);
  assert.equal(once.length, 1);
  assert.deepEqual(
    once[0].folders.map((f) => f.id),
    ["nuvio-riwaq-folder"],
  );
  const folder = once[0].folders[0];
  assert.equal(folder.cover, ART);
  assert.deepEqual(
    folder.titles.map((t) => t.id),
    ["tt0000101"],
  );
  assert.equal(once[0].cover, ART);
  // The same file again, the same answer: still one folder.
  const twice = merge(once, read(oldFile(current)), legacy);
  assert.deepEqual(twice, once);
});

test("Q8: Add copy keeps both, and merging the same file again updates the copy instead of adding a third", () => {
  const current = mineWith(myFolder("nuvio-riwaq-folder"));
  const once = merge(current, read(oldFile(current)), {
    "same-parent/folder": "copy",
  });
  assert.deepEqual(
    once[0].folders.map((f) => f.id),
    ["nuvio-riwaq-folder", "folder"],
  );
  // No question any more: the file's ID is here now.
  const again = read(oldFile(current));
  assert.deepEqual(legacyMatches(once, again), []);
  const twice = merge(once, again, {});
  assert.deepEqual(
    twice[0].folders.map((f) => f.id),
    ["nuvio-riwaq-folder", "folder"],
  );
});

test("Q8: several ambiguous folders and nested prefixes are each asked; every one needs its answer", () => {
  const current = mineWith(
    myFolder("nuvio-riwaq-folder", "First"),
    myFolder("nuvio-riwaq-nuvio-x", "Nested"),
    myFolder("plain", "Plain"),
  );
  const converted = read(oldFile(current));
  assert.deepEqual(
    converted.collections[0].folders.map((f) => f.id),
    ["folder", "nuvio-x", "plain"],
  );
  assert.deepEqual(
    legacyMatches(current, converted).map((m) => [m.id, m.match]),
    [
      ["same-parent/folder", "nuvio-riwaq-folder"],
      ["same-parent/nuvio-x", "nuvio-riwaq-nuvio-x"],
    ],
  );
  assert.throws(
    () => merge(current, converted, { "same-parent/folder": "match" }),
    /Nested/,
  );
  const done = merge(current, converted, {
    "same-parent/folder": "match",
    "same-parent/nuvio-x": "copy",
  });
  assert.deepEqual(
    done[0].folders.map((f) => f.id),
    ["nuvio-riwaq-folder", "nuvio-riwaq-nuvio-x", "plain", "nuvio-x"],
  );
});

test("Q8: Add and Replace ask nothing; a file from today's export round-trips without a question or a copy", () => {
  const current = mineWith(myFolder("nuvio-riwaq-folder"));
  const converted = read(oldFile(current));
  const added = importCollections(current, converted.collections, {
    mode: "add",
    aliases: converted.report.aliases,
  }).collections;
  assert.equal(added.length, 2);
  const replaced = importCollections(current, converted.collections, {
    mode: "replace",
    aliases: converted.report.aliases,
  }).collections;
  assert.deepEqual(
    replaced.map((c) => c.folders.map((f) => f.id)),
    [["folder"]],
  );
  const today = read(JSON.stringify(toNuvio(current)));
  assert.deepEqual(legacyMatches(current, today), []);
  const merged = merge(current, today, {});
  assert.deepEqual(
    merged[0].folders.map((f) => f.id),
    ["nuvio-riwaq-folder"],
  );
});

test("Q8: the Client import carries the folder answer, and a preview from another activation is refused", () => {
  const c = new Client({ load: () => ({}), save: () => {} });
  c.state.collections = mineWith(myFolder("nuvio-riwaq-folder"));
  c.profiles.capture();
  const text = oldFile(c.state.collections);
  const session = c.profiles.session();
  assert.throws(
    () =>
      c.importNuvioCollections({
        text,
        mode: "merge",
        profileSession: session,
      }),
    /مجلد من نسخة أقدم/,
  );
  const a = c.profiles.store.active;
  c.profiles.create({ name: "B" });
  const b = c.profiles.store.list.find((p) => p.id !== a).id;
  c.profiles.switch({ id: b });
  c.profiles.switch({ id: a });
  const before = structuredClone(c.state.collections);
  assert.throws(
    () =>
      c.importNuvioCollections({
        text,
        mode: "merge",
        legacy: { "same-parent/folder": "match" },
        profileSession: session,
      }),
    { message: PROFILE_CHANGED },
  );
  assert.deepEqual(c.state.collections, before);
  const { state } = c.importNuvioCollections({
    text,
    mode: "merge",
    legacy: { "same-parent/folder": "match" },
    profileSession: c.profiles.session(),
  });
  assert.deepEqual(
    state.collections[0].folders.map((f) => f.id),
    ["nuvio-riwaq-folder"],
  );
});
