/**
 * The web edition's profile store: the browser's counterpart of profile.bin.
 *
 * The desktop seals its state with Windows DPAPI (Electron safeStorage). Here
 * the state is sealed with AES-256-GCM under a key WebCrypto generated as
 * NON-EXTRACTABLE and kept in IndexedDB: scripts on this origin can use it,
 * but nobody can read it out, and the stored state is never plaintext. When
 * the browser cannot keep an encrypted store (no IndexedDB, no WebCrypto, a
 * private window that refuses storage) nothing is written at all and the
 * viewer is told: there is no plaintext fallback, as on the desktop.
 *
 * The state is opened before the client starts. A save is answered with a
 * promise that settles only when the browser has COMMITTED the write (the
 * transaction's `complete`, never a request's `success`), and rejects on an
 * abort or an error: core/durable.mjs rolls a commit back in memory before
 * any later snapshot is taken, so a refused write is never reported as done
 * and never rides along with a later save (PR #155 third review, N1).
 */
import { DurableWriter } from "../core/durable.mjs";
import { stateArt } from "../core/collection-art.mjs";
const DB_NAME = "riwaq-web";
const STORE = "vault";
const KEY_ID = "key";
const STATE_ID = "profile";
const BACKUP_ID = "profile-before-restore";

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
/** What a refused write says (an abort carries no error of its own). */
export const WRITE_FAILED =
  "تعذّر حفظ بيانات رِواق في هذا المتصفح، فلم يُحفظ التغيير";
const failure = (t) => {
  const error = new Error(WRITE_FAILED);
  const cause = t.error;
  if (cause) {
    error.cause = cause;
    if (cause.name) error.name = cause.name;
  }
  return error;
};

function openDb() {
  const open = globalThis.indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  return request(open);
}
// Settles with the transaction: `complete` is the commit; a request's
// `success` before an abort (a quota refusal arrives that way) is not.
const tx = (db, mode, run) =>
  new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let done = false;
    t.oncomplete = () => {
      done = true;
      resolve(result?.result);
    };
    t.onabort = () => {
      if (!done) reject(failure(t));
      done = true;
    };
    // An error event is followed by the abort, which rejects; nothing here
    // resolves early.
    t.onerror = () => {};
    let result;
    try {
      result = run(t.objectStore(STORE));
    } catch (error) {
      done = true;
      try {
        t.abort();
      } catch {}
      reject(error);
    }
  });

async function vaultKey(db) {
  const existing = await tx(db, "readonly", (s) => s.get(KEY_ID));
  if (existing) return existing;
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  await tx(db, "readwrite", (s) => s.put(key, KEY_ID));
  return key;
}

async function seal(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text),
  );
  return { v: 1, iv, data };
}
async function open(key, record) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: record.iv },
    key,
    record.data,
  );
  return new TextDecoder().decode(plain);
}

/**
 * Opens the store. Resolves to { load, save, persistent, saveBeforeRestore,
 * settled }. `persistent` is false when nothing can be kept in this browser.
 */
export async function openStore() {
  let db, key;
  try {
    if (!globalThis.indexedDB || !globalThis.crypto?.subtle)
      throw new Error("unavailable");
    db = await openDb();
    key = await vaultKey(db);
  } catch {
    return memoryStore();
  }
  let initial = {};
  const record = await tx(db, "readonly", (s) => s.get(STATE_ID));
  if (record) {
    try {
      initial = JSON.parse(await open(key, record));
    } catch {
      // Same rule as the desktop: an unreadable store is kept, never
      // silently replaced, so nothing the viewer had is overwritten.
      throw new Error(
        "تعذّر قراءة بيانات رِواق المحفوظة في هذا المتصفح. لم نغيّر شيئاً؛ جرّب متصفحاً محدّثاً أو امسح بيانات الموقع للبدء من جديد.",
      );
    }
  }
  // Ask the browser not to evict the store under storage pressure.
  navigator.storage?.persist?.().catch?.(() => {});
  const put = async (id, text) => {
    const sealed = await seal(key, text);
    await tx(db, "readwrite", (s) => s.put(sealed, id));
  };
  // The state handed to the last save; snapshots are taken from it when a
  // write starts, so one write carries every change asked for before it.
  let current = initial;
  const store = {
    persistent: true,
    // Called after commits were rolled back (the bridge re-sends state).
    onUndo: null,
    get failed() {
      return writer.failures > 0;
    },
    load: () => initial,
    /** Resolves once this change is committed; rejects when it was not. */
    save: (data, undo) => {
      current = data;
      return writer.request(undo);
    },
    // The web's profile.before-restore.bin: an undo kept in this browser,
    // written after every save asked for so far, and refused loudly.
    saveBeforeRestore: async (data) => {
      const text = JSON.stringify(data);
      await writer.settled();
      await put(BACKUP_ID, text);
    },
    /** Resolves when nothing is being written; never rejects. */
    settled: () => writer.settled(),
    /** The pictures the durable state and the one being written name. */
    durableArt: () => writer.metas(),
  };
  const writer = new DurableWriter({
    snapshot: () => ({
      text: JSON.stringify(current),
      meta: stateArt(current),
    }),
    write: (text) => put(STATE_ID, text),
    onUndo: (error) => store.onUndo?.(error),
    initialMeta: stateArt(initial),
  });
  return store;
}

function memoryStore() {
  return {
    persistent: false,
    failed: false,
    onUndo: null,
    load: () => ({}),
    save: () => {},
    saveBeforeRestore: async () => {},
    settled: async () => {},
    durableArt: () => [],
  };
}
