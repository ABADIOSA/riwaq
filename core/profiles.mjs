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
import { DEFAULT_SETTINGS, retireLineless } from "./protocol.mjs";

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
    // The activation of the active profile (PR #155 second review, F2):
    // every switch, re-lock and restore starts a new one, so work begun
    // under an older one can never write, even when the same profile is
    // active again (A → B → A, or locked and unlocked). Memory only.
    this.epoch = 0;
    this.appliedId = undefined;
    this.open = false;
  }
  /** Whether the active profile's PIN was entered; a re-lock ends the activation. */
  get unlocked() {
    return this.open;
  }
  set unlocked(value) {
    const next = !!value;
    if (this.open && !next) this.epoch++;
    this.open = next;
  }
  /** Starts a new activation of the active profile. */
  renew() {
    this.epoch++;
  }
  /** The active profile and its activation, as work started now names them. */
  ticket() {
    return { id: this.store.active, epoch: this.epoch };
  }
  /** The same, as the interface carries it (`profileSession`). */
  session() {
    return `${this.store.active}:${this.epoch}`;
  }
  /** True while `ticket` names the active profile's current activation. */
  holds(ticket) {
    return (
      !!ticket && ticket.id === this.store.active && ticket.epoch === this.epoch
    );
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
        settings: retireLineless({
          ...DEFAULT_SETTINGS,
          ...(this.client.state.settings || {}),
        }),
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
    bucket.settings = retireLineless({
      ...DEFAULT_SETTINGS,
      ...(bucket.settings || {}),
    });
    return bucket;
  }
  /** Points the live client state at the active profile's bucket. */
  apply() {
    if (this.appliedId !== this.store.active) {
      this.appliedId = this.store.active;
      this.epoch++;
    }
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
      session: this.session(),
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
  /**
   * One profile change as a commit (PR #155 fifth pass, Q6). `change`
   * validates first, then changes the store and returns its undo. When the
   * write is refused (the desktop throws at once, the web's vault answers
   * later through core/durable.mjs) the undo puts the profile DATA back
   * before any later snapshot is taken, so a later, unrelated save can never
   * write a change the viewer was told had failed. An undo never restores
   * authority: it starts a new activation where the active profile moves,
   * and a profile with a PIN comes back locked, so work begun under the
   * failed change (or before it) can never write afterwards.
   */
  transact(change) {
    const undo = change();
    try {
      this.client.persist(undo);
    } catch (error) {
      undo();
      throw error;
    }
    return this.client.publicState();
  }
  /** Makes `id` the active profile again after an undo: new, locked. */
  reactivate(id) {
    const store = this.store;
    const profile = store.list.find((entry) => entry.id === id);
    if (!profile || store.active === id) return;
    this.capture();
    store.active = id;
    this.unlocked = !profile.pin;
    this.renew();
    this.apply();
    this.client.cache.clear();
  }
  create({ name, avatar }) {
    if (this.store.list.length >= MAX_PROFILES)
      throw new Error("وصلت إلى الحد الأقصى من الملفات الشخصية");
    const label = String(name || "").trim();
    if (!label || label.length > 40) throw new Error("أدخل اسماً للملف الشخصي");
    const id = randomBytes(8).toString("hex");
    const previous = this.store.active;
    return this.transact(() => {
      this.store.list.push({
        id,
        name: label,
        avatar: AVATARS.includes(avatar)
          ? avatar
          : AVATARS[this.store.list.length % AVATARS.length],
        createdAt: Date.now(),
      });
      this.store.data[id] = emptyBucket();
      return () => {
        const store = this.store;
        // A switch to it was built on it and was undone first; should it
        // still be active, the profile active before takes over, locked.
        if (store.active === id) this.reactivate(previous);
        if (store.active === id) return;
        store.list = store.list.filter((entry) => entry.id !== id);
        delete store.data[id];
      };
    });
  }
  update({ id, name, avatar, lockedRooms, hideAdult, pin }) {
    const profile = this.find(id);
    // Protect the target profile, even when a different profile is active.
    // Check before mutating any fields so a refused edit is atomic.
    if (
      profile.pin &&
      (Array.isArray(lockedRooms) ||
        (hideAdult === false &&
          profile.hideAdult &&
          profile.lockedRooms?.includes("settings"))) &&
      !(id === this.store.active && this.unlocked) &&
      !matchesPin(profile.pin, pin || "")
    )
      throw new Error(
        "هذا الملف محمي. أدخل رمز حماية هذا الملف لتعديل الحماية",
      );
    let label;
    if (name !== undefined) {
      label = String(name).trim();
      if (!label || label.length > 40)
        throw new Error("أدخل اسماً للملف الشخصي");
    }
    const FIELDS = ["name", "avatar", "lockedRooms", "hideAdult"];
    const before = FIELDS.map((key) => [
      key,
      Object.hasOwn(profile, key) ? structuredClone(profile[key]) : undefined,
      Object.hasOwn(profile, key),
    ]);
    return this.transact(() => {
      if (label !== undefined) profile.name = label;
      if (avatar !== undefined && AVATARS.includes(avatar))
        profile.avatar = avatar;
      if (Array.isArray(lockedRooms))
        profile.lockedRooms = lockedRooms.filter((room) =>
          LOCKABLE_ROOMS.includes(room),
        );
      if (typeof hideAdult === "boolean" && hideAdult !== !!profile.hideAdult)
        profile.hideAdult = hideAdult;
      return () => {
        // The entry as the store holds it now (a restore's undo may have
        // put back another copy of it).
        const entry = this.store.list.find((p) => p.id === id);
        if (!entry) return;
        for (const [key, value, had] of before)
          if (had) entry[key] = value;
          else delete entry[key];
      };
    });
  }
  /**
   * Removes a profile in one write. `also` (desktop main, sixth pass V1)
   * makes further changes that belong in that same write and returns their
   * undo: the desktop moves the profile's download records into a durable
   * clean-up list there, and deletes their files only once this write is
   * durable (electron/offline.mjs). A refused write undoes both, so nothing
   * of the profile is lost.
   */
  remove({ id, pin }, { also } = {}) {
    this.check({ id, pin, intent: "remove" });
    // The active profile's live references into its bucket first, so an
    // undo puts back what it held at this moment.
    this.capture();
    const store = this.store;
    const index = store.list.findIndex((entry) => entry.id === id);
    const profile = store.list[index];
    const bucket = store.data[id];
    const wasActive = store.active === id;
    // Its local songs (desktop, encrypted state.localMusic) go with it, in
    // the same write: deleting them before the write, as main once did,
    // lost them for good when the write was refused.
    const music = this.client.state.localMusic;
    const hadMusic = !!music && Object.hasOwn(music, id);
    const songs = hadMusic ? music[id] : undefined;
    return this.transact(() => {
      // Its own part first: should it throw, nothing of the profile moved.
      const alsoUndo = typeof also === "function" ? also() : undefined;
      store.list = store.list.filter((entry) => entry.id !== id);
      delete store.data[id];
      if (hadMusic) delete music[id];
      if (wasActive) {
        store.active = store.list[0].id;
        this.unlocked = false;
        this.apply();
      }
      return () => {
        if (typeof alsoUndo === "function")
          try {
            alsoUndo();
          } catch {}
        const now = this.store;
        if (!now.list.some((entry) => entry.id === id))
          now.list.splice(Math.min(index, now.list.length), 0, profile);
        if (bucket && !now.data[id]) now.data[id] = bucket;
        if (hadMusic) {
          const local = (this.client.state.localMusic ||= {});
          if (!Object.hasOwn(local, id)) local[id] = songs;
        }
        // Back to the profile that was active, as a new activation: locked
        // when it has a PIN, even if it was unlocked before the removal.
        if (wasActive) this.reactivate(id);
      };
    });
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
    const previous = this.store.active;
    return this.transact(() => {
      this.capture();
      this.store.active = id;
      // A new profile starts locked even when the previous one was unlocked.
      this.unlocked = !profile.pin;
      // Even back to the same profile: what was started before is not ours.
      this.renew();
      this.apply();
      this.client.cache.clear();
      // The previous profile comes back as a new activation, locked when it
      // has a PIN: its old activation ended with this switch.
      return () => {
        if (this.store.active === id) this.reactivate(previous);
      };
    });
  }
  setPin({ id, pin, current }) {
    const profile = this.find(id);
    if (profile.pin && !matchesPin(profile.pin, current || ""))
      throw new Error("رمز الحماية الحالي غير صحيح");
    const clear = pin === null || pin === "";
    if (!clear && !/^\d{4,8}$/.test(String(pin)))
      throw new Error("الرمز من 4 إلى 8 أرقام");
    const had = Object.hasOwn(profile, "pin");
    const previous = profile.pin;
    return this.transact(() => {
      if (clear) {
        delete profile.pin;
        if (profile.id === this.store.active) this.unlocked = true;
      } else {
        profile.pin = hashPin(pin);
        this.unlocked = profile.id === this.store.active;
      }
      return () => {
        const entry = this.store.list.find((p) => p.id === id);
        if (!entry) return;
        if (had) entry.pin = previous;
        else delete entry.pin;
        // The PIN that is kept decides: with one, the profile is locked
        // again (a new activation); without one, nothing is behind it.
        if (entry.id === this.store.active) this.unlocked = !entry.pin;
      };
    });
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
