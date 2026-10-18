import { Client } from "../core/client.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { Player } from "../electron/player.mjs";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { collectBackup, restoreState } from "../core/backup.mjs";
import { parseTheIntroDb, THEINTRODB_API } from "../core/skip-online.mjs";

test("fit modes preserve aspect, crop, or stretch through distinct MPV properties; advanced ratios remain usable", () => {
  const commands = [],
    player = new Player({ onState() {} });
  player.send = (c) => commands.push(c);
  player.state = { active: true };
  for (const mode of ["crop", "stretch", "fit"]) {
    commands.length = 0;
    player.command({ action: "pictureMode", value: mode });
    assert.ok(
      commands.some(
        (c) => c[1] === "keepaspect" && c[2] === (mode !== "stretch"),
      ),
    );
    assert.ok(
      commands.some(
        (c) => c[1] === "panscan" && c[2] === (mode === "crop" ? 1 : 0),
      ),
    );
    assert.ok(
      commands.some((c) => c[1] === "video-aspect-override" && c[2] === "-1"),
    );
    assert.equal(player.state.pictureMode, mode);
  }
  player.command({ action: "pictureMode", value: "stretch" });
  commands.length = 0;
  player.command({ action: "aspect", value: "16:9" });
  assert.ok(commands.some((c) => c[1] === "keepaspect" && c[2] === true));
  assert.equal(player.state.pictureMode, "custom");
});

test("hiding the session is a validated profile preference preserved by backups", () => {
  assert.equal(DEFAULT_SETTINGS.showSession, true);
  assert.equal(safeSettings({ showSession: false }).showSession, false);
  assert.equal(safeSettings({ showSession: "false" }).showSession, true);
  const c = new Client({ load: () => ({}), save: () => {} });
  c.state.settings.showSession = false;
  c.persist();
  const { payload } = collectBackup(c.state);
  const next = restoreState(c.state, payload);
  assert.equal(next.settings.showSession, false);
});

test("TheIntroDB v4 uses TVDB-keyed segment bodies and safely ignores versions/episode-list responses", () => {
  assert.equal(THEINTRODB_API, "https://api.theintrodb.org/v4/media");
  assert.deepEqual(
    parseTheIntroDb(
      {
        tvdb_id: 71663,
        type: "tv",
        season: 1,
        episode: 2,
        intro: [{ start_ms: null, end_ms: 30000 }],
      },
      120,
    ),
    [{ kind: "intro", start: 0, end: 30, source: "theintrodb" }],
  );
  assert.deepEqual(
    parseTheIntroDb({
      tvdb_id: 71663,
      episodes: [{ season: 1, episode: 2, submission_count: 1 }],
    }),
    [],
  );
  assert.deepEqual(
    parseTheIntroDb({ tvdb_id: 71663, versions: [{ duration_ms: 100000 }] }),
    [],
  );
});
