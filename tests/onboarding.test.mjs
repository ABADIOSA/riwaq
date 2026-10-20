import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import { collectBackup, restoreState } from "../core/backup.mjs";

const create = (loaded = {}, save = () => {}) =>
  new Client({ load: () => structuredClone(loaded), save, version: "0.48.0" });

test("first run stays pending across initialization, dismissal and restart are device-local", async () => {
  let saved;
  const c = create({}, (s) => {
    saved = structuredClone(s);
  });
  assert.deepEqual(c.publicState().onboarding, { required: true });
  // init may save the default catalog before the user finishes the guide.
  c.persist();
  const restarted = create(saved);
  assert.equal(restarted.publicState().onboarding.required, true);
  restarted.onboarding.complete();
  assert.equal(
    create(restarted.state).publicState().onboarding.required,
    false,
  );
  assert.deepEqual(restarted.usage.publicState(), { enabled: false });
});

test("upgrades do not force setup or alter existing provider keys and consent", () => {
  const token = "a".repeat(64);
  const c = create({
    settings: { uiLanguage: "en" },
    providers: { tmdb: { key: "private-key", enabled: true } },
    usageMetrics: { enabled: true, token },
  });
  assert.equal(c.publicState().onboarding.required, false);
  c.onboarding.complete();
  assert.equal(c.state.providers.tmdb.key, "private-key");
  assert.deepEqual(c.state.usageMetrics, { enabled: true, token });
  assert.equal(c.state.settings.uiLanguage, "en");
});

test("a failed encrypted write keeps the guide pending and never enables sharing", () => {
  const c = create({}, () => {
    throw Error("encrypted write failed");
  });
  assert.throws(() => c.onboarding.complete(), /encrypted write failed/);
  assert.equal(c.publicState().onboarding.required, true);
  assert.equal(c.usage.publicState().enabled, false);
});

test("guide progress is global to this device and cannot travel in a backup", () => {
  const c = create();
  c.onboarding.complete();
  c.profiles.capture();
  assert.equal(
    Object.hasOwn(c.state.profiles.data.default, "onboarding"),
    false,
  );
  for (const includeSecrets of [false, true]) {
    const { payload } = collectBackup(c.state, { includeSecrets });
    assert.equal(Object.hasOwn(payload, "onboarding"), false);
    const other = create();
    const restored = restoreState(other.state, {
      ...payload,
      onboarding: { version: 1, status: "complete" },
    });
    assert.deepEqual(restored.onboarding, other.state.onboarding);
    assert.equal(create(restored).publicState().onboarding.required, true);
  }
});
