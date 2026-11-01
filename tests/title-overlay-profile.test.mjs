import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("profile switching repaints native chrome after applying the destination profile", async () => {
  const main = readFileSync(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  const start = main.indexOf("profileSwitch: async (a) => {");
  const source = main
    .slice(
      start + "profileSwitch: ".length,
      main.indexOf("\n  profilePin:", start),
    )
    .trim()
    .replace(/,$/, "");
  let profile = "light";
  const painted = [];
  const switchProfile = runInNewContext(`(${source})`, {
    client: {
      profiles: {
        check() {},
        switch(a) {
          profile = a.id;
          return { active: profile };
        },
      },
    },
    offline: { cancelArtwork() {} },
    playbackRequest: { cancel() {} },
    stopLocalMusic() {},
    player: { async stop() {} },
    applyZoom() {},
    applyPresence: async () => {},
    applyTitleOverlay: () => painted.push(profile),
  });
  await switchProfile({ id: "dark" });
  assert.deepEqual(painted, ["dark"]);
});
