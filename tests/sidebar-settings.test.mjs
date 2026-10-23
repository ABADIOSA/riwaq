import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, safeSettings } from "../core/protocol.mjs";
import { Client } from "../core/client.mjs";

test("legacy/imported shells normalize without changing independent preferences", () => {
  const old = {
    ...DEFAULT_SETTINGS,
    interfaceStyle: "classic",
    showSession: false,
    uiLanguage: "en",
    rememberVolume: true,
    lastVolume: 145,
  };
  const next = safeSettings({}, old);
  assert.equal(next.interfaceStyle, "riwaq");
  assert.equal(next.showSession, false);
  assert.equal(next.uiLanguage, "en");
  assert.equal(next.lastVolume, 145);
  assert.equal(
    safeSettings({ interfaceStyle: "classic" }).interfaceStyle,
    "riwaq",
  );
});

test("sidebar and showcase preferences persist independently and reject non-booleans", () => {
  let saved = {};
  const options = {
    load: () => saved,
    save: (s) => {
      saved = structuredClone(s);
    },
  };
  const client = new Client(options);
  assert.equal(client.state.settings.showShowcase, false);
  client.settings({
    sidebarCollapsed: true,
    showShowcase: true,
    showSession: false,
  });
  const next = new Client(options).state.settings;
  assert.equal(next.sidebarCollapsed, true);
  assert.equal(next.showShowcase, true);
  assert.equal(next.showSession, false);
  assert.equal(
    safeSettings({ sidebarCollapsed: "true", showShowcase: "false" })
      .sidebarCollapsed,
    false,
  );
  assert.equal(safeSettings({ showShowcase: "true" }).showShowcase, false);
});
