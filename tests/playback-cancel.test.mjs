// The PR #128 review's remaining P2: an immediate Stop prevented the late
// viewing but the play still answered with "could not connect to the
// player". A start taken over by Stop or a newer play now answers
// { cancelled: true }, which Details and App already treat as nothing
// started; a real failure is still an error.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PlaybackRequest, startOutcome } from "../core/playback-request.mjs";
import { cancelledStart } from "../electron/player.mjs";

test("a cancelled start answers cancelled; a real failure is thrown", async () => {
  assert.deepEqual(await startOutcome(Promise.resolve({ active: true })), {
    active: true,
  });
  assert.deepEqual(await startOutcome(Promise.reject(cancelledStart())), {
    cancelled: true,
  });
  await assert.rejects(
    startOutcome(Promise.reject(new Error("تعذّر الاتصال بالمشغل"))),
    /تعذّر الاتصال/,
  );
  // Another play or Stop took the request: whatever the error, nothing
  // started for this one.
  const requests = new PlaybackRequest();
  const mine = requests.begin();
  const outcome = startOutcome(
    Promise.reject(new Error("تعذّر الاتصال بالمشغل")),
    () => requests.owns(mine),
  );
  requests.cancel();
  assert.deepEqual(await outcome, { cancelled: true });
});

test("every start in main goes through the same outcome", () => {
  const main = readFileSync(
    fileURLToPath(new URL("../electron/main.mjs", import.meta.url)),
    "utf8",
  );
  const starts = main.match(/player\.start\(/g).length;
  const wrapped = main.match(/startOutcome\(\s*(started|player\.start\()/g);
  assert.equal(wrapped.length, starts, "each player.start has an outcome");
});
