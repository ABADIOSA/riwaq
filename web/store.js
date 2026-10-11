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
 * core/Client expects load() and save() to be synchronous, so the state is
 * opened before the client starts and every save is a snapshot sealed in
 * the background, newest last.
 */
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

function openDb() {
  const open = globalThis.indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  return request(open);
}
const tx = (db, mode, run) =>
  new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
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
  let chain = Promise.resolve();
  let failed = false;
  const write = (id, text) => {
    chain = chain
      .then(() => seal(key, text))
      .then((sealed) => tx(db, "readwrite", (s) => s.put(sealed, id)))
      .catch(() => {
        failed = true;
      });
    return chain;
  };
  return {
    persistent: true,
    get failed() {
      return failed;
    },
    load: () => initial,
    // A snapshot now; sealing and writing follow in order.
    save: (data) => {
      write(STATE_ID, JSON.stringify(data));
    },
    // The web's profile.before-restore.bin: an undo kept in this browser.
    saveBeforeRestore: (data) => write(BACKUP_ID, JSON.stringify(data)),
    settled: () => chain,
  };
}

function memoryStore() {
  return {
    persistent: false,
    failed: false,
    load: () => ({}),
    save: () => {},
    saveBeforeRestore: async () => {},
    settled: async () => {},
  };
}
