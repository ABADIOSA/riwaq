/**
 * Viewer profiles.
 *
 * A profile owns what a person watches: their library, their progress, their
 * connected lists and their settings. Addons and API credentials stay shared,
 * because they are the household's setup rather than one viewer's taste.
 *
 * The parental PIN is stored as a scrypt hash with a per-profile salt, and an
 * unlock lives in memory only, so closing Riwaq or switching profile re-locks
 * everything without the viewer having to remember to.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DEFAULT_SETTINGS } from "./protocol.mjs";

export const LOCKABLE_ROOMS = [
  "live",
  "addons",
  "settings",
  "library",
  "search",
];
const MAX_PROFILES = 6;
const AVATARS = ["amber", "teal", "violet", "rose", "forest", "nord"];

const emptyBucket = () => ({
  favorites: [],
  progress: {},
  queue: [],
  connectedLists: [],
  collections: [],
  settings: { ...DEFAULT_SETTINGS },
});

function hashPin(pin, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(String(pin), salt, 32).toString("hex") };
}
function matchesPin(record, pin) {
  if (!record?.salt || !record?.hash) return false;
  const candidate = scryptSync(String(pin), record.salt, 32);
  const stored = Buffer.from(record.hash, "hex");
  return (
    stored.length === candidate.length && timingSafeEqual(stored, candidate)
  );
}

export class Profiles {
  constructor(client) {
    this.client = client;
    this.unlocked = false;
  }
  get store() {
    const state = this.client.state;
    state.profiles ||= { list: [], active: "", data: {} };
    state.profiles.list ||= [];
    state.profiles.data ||= {};
    return state.profiles;
  }
  /** Creates the first profile and adopts any pre-profile data it finds. */
  ensure() {
    const store = this.store;
    if (!store.list.length) {
      const id = "default";
      store.list.push({
        id,
        name: "المشاهد",
        avatar: "amber",
        createdAt: Date.now(),
      });
      store.data[id] = {
        favorites: Array.isArray(this.client.state.favorites)
          ? this.client.state.favorites
          : [],
        progress:
          this.client.state.progress &&
          typeof this.client.state.progress === "object"
            ? this.client.state.progress
            : {},
        connectedLists: Array.isArray(this.client.state.connectedLists)
          ? this.client.state.connectedLists
          : [],
        queue: Array.isArray(this.client.state.queue)
          ? this.client.state.queue
          : [],
        collections: Array.isArray(this.client.state.collections)
          ? this.client.state.collections
          : [],
        settings: {
          ...DEFAULT_SETTINGS,
          ...(this.client.state.settings || {}),
        },
      };
      store.active = id;
    }
    if (!store.list.some((profile) => profile.id === store.active))
      store.active = store.list[0].id;
    this.apply();
    return store.active;
  }
  active() {
    return (
      this.store.list.find((profile) => profile.id === this.store.active) ||
      this.store.list[0]
    );
  }
  bucket(id = this.store.active) {
    const store = this.store;
    store.data[id] ||= emptyBucket();
    const bucket = store.data[id];
    bucket.favorites ||= [];
    bucket.progress ||= {};
    bucket.queue ||= [];
    bucket.connectedLists ||= [];
    bucket.collections ||= [];
    bucket.settings = { ...DEFAULT_SETTINGS, ...(bucket.settings || {}) };
    return bucket;
  }
  /** Points the live client state at the active profile's bucket. */
  apply() {
    const bucket = this.bucket();
    const state = this.client.state;
    state.favorites = bucket.favorites;
    state.progress = bucket.progress;
    state.queue = bucket.queue;
    state.connectedLists = bucket.connectedLists;
    state.collections = bucket.collections;
    state.settings = bucket.settings;
  }
  /** Writes the live references back before the profile is serialised. */
  capture() {
    if (!this.store.list.length) return;
    const bucket = this.bucket();
    const state = this.client.state;
    if (state.favorites) bucket.favorites = state.favorites;
    if (state.progress) bucket.progress = state.progress;
    if (state.queue) bucket.queue = state.queue;
    if (state.connectedLists) bucket.connectedLists = state.connectedLists;
    if (state.collections) bucket.collections = state.collections;
    if (state.settings) bucket.settings = state.settings;
  }
  publicState() {
    const active = this.active();
    return {
      active: active?.id || "",
      unlocked: this.unlocked,
      list: this.store.list.map((profile) => ({
        id: profile.id,
        name: profile.name,
        avatar: profile.avatar,
        protected: !!profile.pin,
        lockedRooms: profile.lockedRooms || [],
        hideAdult: !!profile.hideAdult,
        titles: (this.store.data[profile.id]?.favorites || []).length,
      })),
    };
  }
  find(id) {
    const profile = this.store.list.find((entry) => entry.id === id);
    if (!profile) throw new Error("الملف الشخصي غير موجود");
    return profile;
  }
  create({ name, avatar }) {
    if (this.store.list.length >= MAX_PROFILES)
      throw new Error("وصلت إلى الحد الأقصى من الملفات الشخصية");
    const label = String(name || "").trim();
    if (!label || label.length > 40) throw new Error("أدخل اسماً للملف الشخصي");
    const id = randomBytes(8).toString("hex");
    this.store.list.push({
      id,
      name: label,
      avatar: AVATARS.includes(avatar)
        ? avatar
        : AVATARS[this.store.list.length % AVATARS.length],
      createdAt: Date.now(),
    });
    this.store.data[id] = emptyBucket();
    this.client.persist();
    return this.client.publicState();
  }
  update({ id, name, avatar, lockedRooms, hideAdult }) {
    const profile = this.find(id);
    if (name !== undefined) {
      const label = String(name).trim();
      if (!label || label.length > 40)
        throw new Error("أدخل اسماً للملف الشخصي");
      profile.name = label;
    }
    if (avatar !== undefined && AVATARS.includes(avatar))
      profile.avatar = avatar;
    if (Array.isArray(lockedRooms))
      profile.lockedRooms = lockedRooms.filter((room) =>
        LOCKABLE_ROOMS.includes(room),
      );
    if (typeof hideAdult === "boolean" && hideAdult !== !!profile.hideAdult) {
      // Showing adult content again is a settings change, behind its lock.
      if (!hideAdult) this.gate("settings");
      profile.hideAdult = hideAdult;
    }
    this.client.persist();
    return this.client.publicState();
  }
  remove({ id, pin }) {
    this.check({ id, pin, intent: "remove" });
    this.store.list = this.store.list.filter((entry) => entry.id !== id);
    delete this.store.data[id];
    if (this.store.active === id) {
      this.store.active = this.store.list[0].id;
      this.unlocked = false;
      this.apply();
    }
    this.client.persist();
    return this.client.publicState();
  }
  /**
   * Throws unless `intent` would succeed, without changing anything. Main runs
   * this before stopping playback, so a wrong PIN leaves the current viewer's
   * film running instead of cutting it off and then refusing the switch.
   */
  check({ id, pin, intent = "switch" }) {
    if (intent === "remove" && this.store.list.length <= 1)
      throw new Error("لا يمكن حذف الملف الشخصي الوحيد");
    const profile = this.find(id);
    if (!profile.pin) return true;
    if (
      intent === "remove" &&
      profile.id === this.store.active &&
      this.unlocked
    )
      return true;
    if (!matchesPin(profile.pin, pin || ""))
      throw new Error(
        intent === "remove"
          ? "أدخل رمز الحماية لحذف هذا الملف الشخصي"
          : "رمز الحماية غير صحيح",
      );
    return true;
  }
  switch({ id, pin }) {
    this.check({ id, pin, intent: "switch" });
    const profile = this.find(id);
    this.capture();
    this.store.active = id;
    // A new profile starts locked even when the previous one was unlocked.
    this.unlocked = !profile.pin;
    this.apply();
    this.client.cache.clear();
    this.client.persist();
    return this.client.publicState();
  }
  setPin({ id, pin, current }) {
    const profile = this.find(id);
    if (profile.pin && !matchesPin(profile.pin, current || ""))
      throw new Error("رمز الحماية الحالي غير صحيح");
    if (pin === null || pin === "") {
      delete profile.pin;
      if (profile.id === this.store.active) this.unlocked = true;
    } else {
      if (!/^\d{4,8}$/.test(String(pin)))
        throw new Error("الرمز من 4 إلى 8 أرقام");
      profile.pin = hashPin(pin);
      this.unlocked = profile.id === this.store.active;
    }
    this.client.persist();
    return this.client.publicState();
  }
  unlock(pin) {
    const profile = this.active();
    if (!profile?.pin) {
      this.unlocked = true;
      return this.client.publicState();
    }
    if (!matchesPin(profile.pin, pin || ""))
      throw new Error("رمز الحماية غير صحيح");
    this.unlocked = true;
    return this.client.publicState();
  }
  lock() {
    this.unlocked = false;
    return this.client.publicState();
  }
  /** True when a room is behind the PIN and the PIN has not been entered. */
  isLocked(room) {
    const profile = this.active();
    if (!profile?.pin) return false;
    return (profile.lockedRooms || []).includes(room) && !this.unlocked;
  }
  gate(room) {
    if (this.isLocked(room))
      throw new Error("هذا القسم محمي برمز. أدخل الرمز للمتابعة.");
  }
}
