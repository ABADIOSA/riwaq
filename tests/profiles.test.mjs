import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "../core/client.mjs";
import { buildActivity, DiscordPresence } from "../core/presence.mjs";
import { discordPayload, telegramPayload, Notifier } from "../core/notify.mjs";
import { EventEmitter } from "node:events";

function client(initial = {}) {
  let saved = initial;
  const instance = new Client({
    load: () => structuredClone(saved),
    save: (state) => {
      saved = structuredClone(state);
    },
    request: async () => {
      throw new Error("no network in test");
    },
  });
  return { instance, saved: () => saved };
}

test("a first run creates one profile and adopts the data already stored", () => {
  const { instance } = client({
    favorites: [{ id: "tt1", type: "movie", name: "قديم" }],
    progress: {
      "movie:tt1": {
        position: 12,
        updated: 1,
        meta: { id: "tt1", type: "movie" },
      },
    },
    settings: { accent: "teal" },
  });
  const state = instance.publicState();
  assert.equal(state.profiles.list.length, 1);
  assert.equal(state.profiles.active, "default");
  assert.equal(state.favorites.length, 1);
  assert.equal(state.settings.accent, "teal");
  assert.equal(state.profiles.list[0].titles, 1);
});

test("each profile keeps its own library, progress and settings", () => {
  const { instance } = client();
  instance.favorite({ id: "tt1", type: "movie", name: "الأول" });
  instance.settings({ accent: "rose" });
  instance.profiles.create({ name: "ضيف" });
  const guest = instance
    .publicState()
    .profiles.list.find((p) => p.name === "ضيف");
  instance.profiles.switch({ id: guest.id });
  assert.equal(instance.publicState().favorites.length, 0);
  assert.equal(instance.publicState().settings.accent, "amber");
  instance.favorite({ id: "tt2", type: "movie", name: "الثاني" });
  instance.profiles.switch({ id: "default" });
  const back = instance.publicState();
  assert.equal(back.favorites.length, 1);
  assert.equal(back.favorites[0].id, "tt1");
  assert.equal(back.settings.accent, "rose");
});

test("profile data survives a reload from the stored profile", () => {
  const first = client();
  first.instance.favorite({ id: "tt1", type: "movie", name: "الأول" });
  first.instance.profiles.create({ name: "ضيف" });
  const guestId = first.instance
    .publicState()
    .profiles.list.find((p) => p.name === "ضيف").id;
  first.instance.profiles.switch({ id: guestId });
  first.instance.favorite({ id: "tt9", type: "movie", name: "للضيف" });
  const stored = first.saved();
  const reopened = new Client({
    load: () => structuredClone(stored),
    save: () => {},
  });
  const state = reopened.publicState();
  assert.equal(state.profiles.active, guestId);
  assert.equal(state.favorites[0].id, "tt9");
  reopened.profiles.switch({ id: "default" });
  assert.equal(reopened.publicState().favorites[0].id, "tt1");
});

test("a PIN protects switching into a profile and is never published", () => {
  const { instance, saved } = client();
  instance.profiles.create({ name: "الوالد" });
  const parent = instance
    .publicState()
    .profiles.list.find((p) => p.name === "الوالد");
  instance.profiles.setPin({ id: parent.id, pin: "4821" });
  assert.equal(
    instance.publicState().profiles.list.find((p) => p.id === parent.id)
      .protected,
    true,
  );
  assert.ok(!JSON.stringify(instance.publicState()).includes("4821"));
  assert.ok(!JSON.stringify(saved()).includes("4821"));
  assert.throws(
    () => instance.profiles.switch({ id: parent.id, pin: "0000" }),
    /رمز الحماية/,
  );
  assert.throws(
    () => instance.profiles.switch({ id: parent.id }),
    /رمز الحماية/,
  );
  instance.profiles.switch({ id: parent.id, pin: "4821" });
  assert.equal(instance.publicState().profiles.active, parent.id);
});

test("changing a PIN requires the current one", () => {
  const { instance } = client();
  instance.profiles.setPin({ id: "default", pin: "1234" });
  assert.throws(
    () =>
      instance.profiles.setPin({ id: "default", pin: "9999", current: "0000" }),
    /الحالي/,
  );
  instance.profiles.setPin({ id: "default", pin: "9999", current: "1234" });
  instance.profiles.lock();
  assert.throws(() => instance.profiles.unlock("1234"), /غير صحيح/);
  instance.profiles.unlock("9999");
  assert.equal(instance.publicState().profiles.unlocked, true);
});

test("a PIN must be four to eight digits", () => {
  const { instance } = client();
  for (const pin of ["12", "abcd", "123456789", "12 34"])
    assert.throws(
      () => instance.profiles.setPin({ id: "default", pin }),
      /أرقام/,
    );
});

test("locked rooms gate until the PIN is entered, and re-lock on switch", () => {
  const { instance } = client();
  instance.profiles.setPin({ id: "default", pin: "1234" });
  instance.profiles.update({
    id: "default",
    lockedRooms: ["live", "settings", "nonsense"],
  });
  instance.profiles.lock();
  assert.equal(instance.profiles.isLocked("live"), true);
  assert.equal(instance.profiles.isLocked("home"), false);
  assert.throws(() => instance.profiles.gate("live"), /محمي/);
  instance.profiles.unlock("1234");
  assert.equal(instance.profiles.isLocked("live"), false);
  instance.profiles.create({ name: "ضيف" });
  const guest = instance
    .publicState()
    .profiles.list.find((p) => p.name === "ضيف");
  instance.profiles.switch({ id: guest.id });
  instance.profiles.switch({ id: "default", pin: "1234" });
  // Coming back in means the rooms are locked again until the PIN is re-entered.
  assert.equal(instance.profiles.isLocked("live"), true);
});

test("the last profile cannot be deleted", () => {
  const { instance } = client();
  assert.throws(() => instance.profiles.remove({ id: "default" }), /الوحيد/);
  instance.profiles.create({ name: "ضيف" });
  const guest = instance
    .publicState()
    .profiles.list.find((p) => p.name === "ضيف");
  instance.profiles.remove({ id: guest.id });
  assert.equal(instance.publicState().profiles.list.length, 1);
});

test("Discord activity follows the detail level the viewer chose", () => {
  const at = 1_000_000;
  const full = buildActivity({
    playing: true,
    title: "ديون",
    episode: "S01E02",
    position: 100,
    duration: 1000,
    at,
  });
  assert.equal(full.details, "ديون");
  assert.equal(full.state, "S01E02");
  assert.equal(full.timestamps.end, at + 900_000);
  const generic = buildActivity({
    playing: true,
    title: "ديون",
    detail: "generic",
  });
  assert.equal(generic.details, "يشاهد شيئاً");
  assert.ok(!JSON.stringify(generic).includes("ديون"));
  assert.equal(buildActivity({ detail: "off" }), null);
  assert.equal(buildActivity({ playing: false }).details, "يتصفّح رِواق");
});

test("a paused or live stream reports no countdown", () => {
  assert.equal(
    buildActivity({
      playing: true,
      title: "x",
      paused: true,
      position: 10,
      duration: 100,
    }).timestamps,
    undefined,
  );
  const live = buildActivity({
    playing: true,
    title: "x",
    live: true,
    position: 30,
    at: 1000,
  });
  assert.equal(live.timestamps.start, 1000 - 30_000);
});

test("presence refuses an invalid application id and survives no Discord", async () => {
  const presence = new DiscordPresence({
    connect: () => {
      const socket = new EventEmitter();
      socket.destroy = () => {};
      queueMicrotask(() => socket.emit("error", new Error("ENOENT")));
      return socket;
    },
    paths: () => ["a", "b"],
  });
  await assert.rejects(() => presence.enable("nope"), /Discord/);
  await assert.rejects(() => presence.enable("123456789012345678"), /Discord/);
  assert.equal(presence.ready, false);
});

test("presence handshakes and sends an activity frame once connected", async () => {
  const written = [];
  const socket = new EventEmitter();
  socket.writable = true;
  socket.destroy = () => {};
  socket.write = (chunk) => written.push(chunk);
  const presence = new DiscordPresence({
    connect: () => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    },
    paths: () => ["only"],
  });
  await presence.enable("123456789012345678");
  assert.equal(presence.ready, true);
  presence.set(buildActivity({ playing: true, title: "ديون" }));
  assert.equal(written.length, 2);
  assert.equal(written[0].readInt32LE(0), 0);
  assert.equal(
    JSON.parse(written[0].subarray(8).toString()).client_id,
    "123456789012345678",
  );
  assert.equal(written[1].readInt32LE(0), 1);
  const frame = JSON.parse(written[1].subarray(8).toString());
  assert.equal(frame.cmd, "SET_ACTIVITY");
  assert.equal(frame.args.activity.details, "ديون");
});

test("notification payloads carry the event without leaking anything else", () => {
  const event = { kind: "finished", title: "ديون", episode: "S01E02", at: 5 };
  const discord = discordPayload(event);
  assert.equal(discord.embeds[0].title, "أنهى المشاهدة: ديون — S01E02");
  assert.equal(discord.embeds[0].timestamp, new Date(5).toISOString());
  assert.equal(telegramPayload(event, "-100123").chat_id, "-100123");
  assert.ok(telegramPayload(event, "-100123").text.includes("ديون"));
});

function notifier(requests) {
  const fake = {
    state: { notify: {}, settings: { notifyOnFinish: true } },
    persist() {},
    publicState() {
      return {};
    },
    request: async (url, init) => {
      requests.push({
        url,
        body: JSON.parse(init.body),
        redirect: init.redirect,
      });
      return {};
    },
  };
  return new Notifier(fake);
}

test("only official Discord webhook URLs and well formed bot tokens are accepted", () => {
  const instance = notifier([]);
  assert.throws(
    () =>
      instance.save({
        id: "discord",
        webhook: "https://evil.test/api/webhooks/1/x",
      }),
    /Discord/,
  );
  assert.throws(
    () => instance.save({ id: "discord", webhook: "https://discord.com/nope" }),
    /Discord/,
  );
  instance.save({
    id: "discord",
    webhook: "https://discord.com/api/webhooks/1/token",
  });
  assert.throws(
    () => instance.save({ id: "telegram", token: "short" }),
    /البوت/,
  );
  assert.throws(
    () => instance.save({ id: "telegram", chatId: "not-an-id" }),
    /المحادثة/,
  );
  instance.save({
    id: "telegram",
    token: "12345:abcdefghijklmnopqrstuvwxyz",
    chatId: "-100123",
  });
});

test("delivery posts to both targets and refuses redirects", async () => {
  const requests = [];
  const instance = notifier(requests);
  instance.save({
    id: "discord",
    webhook: "https://discord.com/api/webhooks/1/token",
  });
  instance.save({
    id: "telegram",
    token: "12345:abcdefghijklmnopqrstuvwxyz",
    chatId: "-100123",
  });
  await instance.notify({ kind: "finished", title: "ديون" });
  assert.equal(requests.length, 2);
  assert.ok(requests.every((entry) => entry.redirect === "error"));
  assert.ok(requests[0].url.startsWith("https://discord.com/api/webhooks/"));
  assert.ok(requests[1].url.startsWith("https://api.telegram.org/bot"));
});

test("a disabled target is skipped and finish notices honour the setting", async () => {
  const requests = [];
  const instance = notifier(requests);
  instance.save({
    id: "discord",
    webhook: "https://discord.com/api/webhooks/1/token",
    enabled: false,
  });
  await instance.notify({ kind: "finished", title: "ديون" });
  assert.equal(requests.length, 0);
  instance.save({ id: "discord", enabled: true });
  instance.client.state.settings.notifyOnFinish = false;
  await instance.notify({ kind: "finished", title: "ديون" });
  assert.equal(requests.length, 0);
  await instance.notify({ kind: "added", title: "ديون" });
  assert.equal(requests.length, 1);
});

test("deleting a protected profile needs its own PIN", () => {
  const { instance } = client();
  instance.profiles.create({ name: "الوالد" });
  const parent = instance
    .publicState()
    .profiles.list.find((p) => p.name === "الوالد");
  instance.profiles.setPin({ id: parent.id, pin: "4821" });
  // Setting a PIN on a profile that is not active must not unlock the one in use.
  instance.profiles.setPin({ id: parent.id, pin: null, current: "4821" });
  instance.profiles.setPin({ id: parent.id, pin: "4821" });
  assert.throws(
    () => instance.profiles.remove({ id: parent.id }),
    /رمز الحماية/,
  );
  assert.throws(
    () => instance.profiles.remove({ id: parent.id, pin: "0000" }),
    /رمز الحماية/,
  );
  instance.profiles.remove({ id: parent.id, pin: "4821" });
  assert.equal(instance.publicState().profiles.list.length, 1);
});

test("a disabled live source stops resolving its channels", async () => {
  const { instance } = client();
  instance.requestText = async () =>
    "#EXTM3U\n#EXTINF:-1,قناة\nhttps://stream.test/one.m3u8\n";
  await instance.live.addSource({
    kind: "m3u",
    name: "مصدر",
    url: "https://list.test/a.m3u",
  });
  const [channel] = (await instance.live.list({})).channels;
  assert.ok(instance.live.resolve(channel.key).url);
  const id = instance.live.publicState().sources[0].id;
  instance.live.updateSource({ id, action: "toggle" });
  assert.throws(() => instance.live.resolve(channel.key), /القناة/);
});
