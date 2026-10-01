import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Integrations, traktProblem } from "../core/integrations.mjs";

function rig(reply, token) {
  const calls = [];
  const client = {
    version: "0.25.1",
    state: {
      integrations: {
        trakt: {
          clientId: "app-id",
          clientSecret: "secret",
          ...(token ? { token } : {}),
        },
      },
      addons: [],
      connectedLists: [],
    },
    cache: new Map(),
    persist() {},
    publicState: () => ({}),
    adultFilter: (m) => m,
    async request(url, options = {}) {
      calls.push({ url, headers: options.headers || {} });
      return reply(url, options);
    },
  };
  return { calls, integrations: new Integrations(client) };
}
const fresh = () => ({
  access_token: "a",
  refresh_token: "r",
  created_at: Math.floor(Date.now() / 1000),
  expires_in: 86400,
});

test("every Trakt request names Riwaq in its User-Agent, as Cloudflare requires", async () => {
  const { calls, integrations } = rig((url) =>
    url.endsWith("/device/code")
      ? {
          device_code: "d",
          user_code: "CODE1234",
          interval: 5,
          expires_in: 600,
          verification_url: "https://trakt.tv/activate",
        }
      : [],
  );
  await integrations.begin("trakt");
  integrations.client.state.integrations.trakt.token = fresh();
  await integrations.trakt("/users/settings");
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.match(
      c.headers["User-Agent"],
      /^Riwaq\/0\.25\.1 \(\+https:\/\/github\.com\/ABADIOSA\/riwaq\)$/,
    );
    assert.equal(c.headers["trakt-api-key"], "app-id");
    assert.equal(c.headers["trakt-api-version"], "2");
  }
  assert.equal(calls[0].headers["Content-Type"], "application/json");
  assert.equal(calls[1].headers.Authorization, "Bearer a");
  // The refresh carries it too.
  const expired = { ...fresh(), created_at: 1000, expires_in: 10 };
  const refreshing = rig(
    (url) =>
      url.endsWith("/oauth/token")
        ? { access_token: "n", refresh_token: "n2" }
        : [],
    expired,
  );
  await refreshing.integrations.trakt("/users/settings");
  assert.equal(refreshing.calls[0].url, "https://auth.trakt.tv/oauth/token");
  assert.match(refreshing.calls[0].headers["User-Agent"], /^Riwaq\//);
});

test("the activation page is the one Trakt sends, never another host", async () => {
  const pick = async (verification_url) => {
    const { integrations } = rig(() => ({
      device_code: "d",
      user_code: "U",
      interval: 5,
      verification_url,
    }));
    return (await integrations.begin("trakt")).url;
  };
  assert.equal(
    await pick("https://trakt.tv/activate"),
    "https://trakt.tv/activate",
  );
  assert.equal(
    await pick("https://app.trakt.tv/activate?x=1"),
    "https://app.trakt.tv/activate?x=1",
  );
  assert.equal(
    await pick("https://evil.example/activate"),
    "https://trakt.tv/activate",
  );
  assert.equal(
    await pick("http://trakt.tv/activate"),
    "https://trakt.tv/activate",
  );
  assert.equal(await pick(undefined), "https://trakt.tv/activate");
});

test("Trakt's refusals read as Arabic sentences that say what to do", async () => {
  const refused = rig(() => Promise.reject(new Error("HTTP 403")));
  await assert.rejects(
    refused.integrations.begin("trakt"),
    /Client ID وClient Secret/,
  );
  const expired = rig(() => Promise.reject(new Error("HTTP 401")), fresh());
  await assert.rejects(
    expired.integrations.trakt("/users/settings"),
    (e) => /انتهت جلسة تراكت/.test(e.message) && e.status === 401,
  );
  assert.match(traktProblem(new Error("HTTP 429")).message, /انتظر دقيقة/);
  assert.match(traktProblem(new Error("HTTP 503")).message, /خوادم تراكت/);
  assert.match(traktProblem(new Error("HTTP 499")).message, /برمز 499/);
  const other = new Error("تعذّر الاتصال");
  assert.equal(traktProblem(other), other, "non-HTTP errors pass through");
  // Device polling: denied and expired codes say so.
  for (const [status, words] of [
    ["HTTP 418", /رُفض الربط/],
    ["HTTP 410", /انتهت صلاحية/],
    ["HTTP 409", /استُخدم/],
  ]) {
    const { integrations } = rig((url) =>
      url.endsWith("/device/code")
        ? { device_code: "d", user_code: "U", interval: 5, expires_in: 600 }
        : Promise.reject(new Error(status)),
    );
    await integrations.begin("trakt");
    integrations.devices.get("trakt").next = 0;
    await assert.rejects(integrations.poll("trakt"), words);
  }
});

test("other services' bare status codes are shown instead of a blank generic sentence", () => {
  const main = readFileSync(
    new URL("../electron/main.mjs", import.meta.url),
    "utf8",
  );
  assert.match(main, /ردّ الخادم برمز \$\{status\}/);
  assert.ok(!main.includes("https://auth.trakt.tv/activate"));
});
