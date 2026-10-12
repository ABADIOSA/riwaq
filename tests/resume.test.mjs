import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import { cleanResumeSource, resumePick } from "../core/resume.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { restoreState } from "../core/backup.mjs";

const KEY = "a1b2c3d4e5f6a1b2c3d4e5f6";
const memory = {
  addonId: "com.example.torrents",
  provider: "Example",
  group: "FLUX",
  tier: "1080p",
  source: "WEB-DL",
};
const offer = (key, extra = {}) => ({
  key,
  supported: true,
  external: false,
  addonId: memory.addonId,
  group: "FLUX",
  tier: "1080p",
  source: "WEB-DL",
  ...extra,
});

test("a stored resume source keeps only a stream key and a loose identity", () => {
  assert.deepEqual(cleanResumeSource({ key: KEY, memory }), {
    key: KEY,
    memory,
  });
  assert.deepEqual(cleanResumeSource({ key: KEY }), { key: KEY });
  assert.equal(cleanResumeSource({ key: "https://cdn.example/a.mkv" }), null);
  assert.equal(cleanResumeSource({ key: KEY.toUpperCase() }), null);
  assert.equal(cleanResumeSource(null), null);
  // A link smuggled into the identity never survives.
  const dirty = cleanResumeSource({
    key: KEY,
    memory: { ...memory, url: "https://cdn.example/x?token=1" },
  });
  assert.ok(!JSON.stringify(dirty).includes("token"));
});

test("resume plays the same offer, else the closest from the same addon, else nothing", () => {
  const other = "f".repeat(24);
  const list = [offer(other, { group: "NTb" }), offer(KEY)];
  assert.deepEqual(resumePick(list, { key: KEY, memory }), {
    stream: list[1],
    exact: true,
  });
  // The link changed (a new debrid address): same addon, group and quality.
  const moved = [offer(other, { group: "NTb" }), offer("e".repeat(24))];
  assert.deepEqual(resumePick(moved, { key: KEY, memory }), {
    stream: moved[1],
    exact: false,
  });
  assert.equal(
    resumePick([offer(other, { group: "NTb" })], { key: KEY, memory }),
    null,
  );
  assert.equal(resumePick(moved, { key: KEY }), null);
  // External pages and unsupported offers never start by themselves.
  assert.equal(
    resumePick([offer(KEY, { external: true })], { key: KEY, memory }),
    null,
  );
  assert.equal(
    resumePick([offer(KEY, { supported: false })], { key: KEY, memory }),
    null,
  );
  assert.equal(resumePick(list, null), null);
});

test("the source a viewing used rides with its progress, through backups too", () => {
  const c = new Client({
    load: () => ({}),
    save: () => {},
    request: async () => ({}),
  });
  const meta = { id: "tt1", type: "movie", name: "فيلم" };
  c.rememberResume(meta, "tt1", { key: KEY, memory });
  c.recordProgress(meta, "tt1", 600, 6000);
  assert.deepEqual(c.state.progress["movie:tt1"].source, { key: KEY, memory });
  // A later save keeps it; a new source replaces it.
  c.recordProgress(meta, "tt1", 900, 6000);
  assert.equal(c.state.progress["movie:tt1"].source.key, KEY);
  const next = "b".repeat(24);
  c.rememberResume(meta, "tt1", { key: next });
  assert.deepEqual(c.state.progress["movie:tt1"].source, { key: next });
  c.rememberResume(meta, "tt1", { key: "not-a-key" });
  assert.equal(c.state.progress["movie:tt1"].source.key, next);
  // A restore keeps a valid source and drops a forged one.
  const restored = restoreState(c.state, {
    profiles: {
      active: "p",
      list: [{ id: "p", name: "أنا" }],
      data: {
        p: {
          progress: {
            "movie:tt1": { ...c.state.progress["movie:tt1"] },
            "movie:tt2": {
              meta: { id: "tt2", type: "movie", name: "ب" },
              videoId: "tt2",
              position: 10,
              source: { key: "https://cdn.example/b.mkv?token=1" },
            },
          },
        },
      },
    },
  });
  const progress = restored.profiles.data.p.progress;
  assert.equal(progress["movie:tt1"].source.key, next);
  assert.equal(progress["movie:tt2"].source, undefined);
});

test("resuming on the same source is on by default and can be turned off", () => {
  assert.equal(DEFAULT_SETTINGS.resumeSameSource, true);
  assert.equal(
    safeSettings({ resumeSameSource: false }).resumeSameSource,
    false,
  );
  assert.equal(safeSettings({ themeSongHinted: true }).themeSongHinted, true);
  assert.equal(safeSettings({ resumeSameSource: "no" }).resumeSameSource, true);
});
