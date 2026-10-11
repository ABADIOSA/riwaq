// The deployed account service, end to end: a throwaway account is made on
// one device, signed in on a second, changed on both and merged, then
// deleted. Run by .github/workflows/accounts.yml after every deploy.
//
//   RIWAQ_ACCOUNT_SERVER=https://riwaq-accounts.…workers.dev \
//     node scripts/test-account-live.mjs
//
// It prints no password, token or key; the account it makes is deleted even
// when a check fails.

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client } from "../core/client.mjs";

const server = process.env.RIWAQ_ACCOUNT_SERVER;
if (!server) {
  console.error("Set RIWAQ_ACCOUNT_SERVER to the service's address.");
  process.exit(2);
}

function device() {
  let saved = {};
  return new Client({
    load: () => structuredClone(saved),
    save: (s) => {
      saved = structuredClone(s);
    },
    accountServer: server,
  });
}
const film = (id, name) => ({ id, type: "movie", name });
const names = (client) => client.state.favorites.map((f) => f.name).sort();
const step = (text) => console.log(`- ${text}`);

const username = `smoke-${randomBytes(6).toString("hex")}`;
const password = randomBytes(18).toString("base64url");
const pc = device();
const web = device();
let made = false;

try {
  pc.favorite(film("tt0111161", "الخلاص من شاوشانك"));
  pc.settings({ seekStep: 30 });
  const { recoveryCode } = await pc.account.signup({ username, password });
  made = true;
  assert.match(recoveryCode, /-/);
  // signup keeps the account when its first upload fails; this one must not.
  await pc.account.sync();
  assert.ok(pc.state.account.revision > 0, "the first upload was stored");
  step("signed up and uploaded");

  await assert.rejects(
    web.account.login({ username, password: `${password}x` }),
    /غير صحيحة/,
  );
  await web.account.login({ username, password });
  assert.deepEqual(names(web), ["الخلاص من شاوشانك"]);
  assert.equal(web.state.settings.seekStep, 30);
  step("a wrong password is refused; the second device receives the data");

  // Both change; the PC pulls the other device's change and merges it with
  // its own before uploading.
  web.settings({ seekStep: 15 });
  await web.account.sync();
  pc.favorite(film("tt0068646", "العرّاب"));
  await pc.account.sync();
  await web.account.sync();
  assert.deepEqual(names(web), ["الخلاص من شاوشانك", "العرّاب"]);
  assert.equal(pc.state.settings.seekStep, 15);
  assert.equal(web.state.settings.seekStep, 15);
  step("changes on both devices merge both ways");

  await pc.account.deleteAccount({ password });
  made = false;
  await assert.rejects(web.account.sync(), /انتهت جلستك/);
  await assert.rejects(device().account.login({ username, password }));
  step("the account is deleted and its sessions end");
  console.log("The live account service works.");
} finally {
  if (made) {
    await pc.account.deleteAccount({ password }).catch(async () => {
      await web.account.deleteAccount({ password }).catch(() => {
        console.error(`Could not delete the test account ${username}.`);
      });
    });
  }
}
