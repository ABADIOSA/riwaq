/**
 * Collection pictures chosen from this computer, in the web edition: kept in
 * this browser's IndexedDB (their own database, beside the sealed state),
 * shown through object URLs. core/collection-art.mjs has the rules; like
 * the desktop's files, they stay in this browser and never travel with a
 * backup or an account.
 */
import { ArtStore } from "../core/collection-art.mjs";

const DB_NAME = "riwaq-collection-art";
const STORE = "art";

const request = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
let opened = null;
const db = () =>
  (opened ||= (() => {
    const open = globalThis.indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    return request(open);
  })());
const tx = async (mode, run) => {
  const base = await db();
  return new Promise((resolve, reject) => {
    const t = base.transaction(STORE, mode);
    const result = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
};

export const browserArtStore = new ArtStore({
  write: (id, bytes, mime) =>
    tx("readwrite", (s) =>
      s.put(
        { blob: new Blob([bytes], { type: mime }), mime, at: Date.now() },
        id,
      ),
    ),
  read: async (id) => {
    const found = await tx("readonly", (s) => s.get(id));
    return found?.blob ? { blob: found.blob, mime: found.mime } : null;
  },
  // The guard runs inside the transaction's creation, in the same turn as
  // the delete request (second review: sweep races); a removed picture's
  // object address is let go.
  remove: async (id, guard) => {
    let gone = false;
    await tx("readwrite", (s) => {
      if (guard && !guard()) return null;
      gone = true;
      return s.delete(id);
    });
    if (gone) forgetUrl(`local:${id}`);
    return gone;
  },
  list: async () => {
    const out = [];
    await tx("readonly", (s) => {
      const cursor = s.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        out.push({ id: String(c.key), at: c.value?.at || 0 });
        c.continue();
      };
      return cursor;
    });
    return out;
  },
});

// One object URL per stored picture, until it is deleted or the profile
// changes (forgetArtUrls).
const urls = new Map();
// Reads under way, so two asks for one picture share one address.
const reading = new Map();
// Bumped by forgetArtUrls: a read that started before a switch or a lock
// lands in an older generation and makes no address (third review, N12),
// so nothing is cached, or left unreleased, after the cache was cleared.
let generation = 0;
function forgetUrl(ref) {
  const url = urls.get(ref);
  if (url) URL.revokeObjectURL(url);
  urls.delete(ref);
}
/** Lets every object address go (a profile switch or lock). */
export function forgetArtUrls() {
  generation++;
  reading.clear();
  for (const ref of [...urls.keys()]) forgetUrl(ref);
}
export async function artObjectUrl(ref) {
  if (urls.has(ref)) return urls.get(ref);
  if (reading.has(ref)) return reading.get(ref);
  const started = generation;
  const read = (async () => {
    const found = await browserArtStore.read(ref);
    if (started !== generation || !found?.blob) return "";
    if (urls.has(ref)) return urls.get(ref);
    const url = URL.createObjectURL(found.blob);
    urls.set(ref, url);
    return url;
  })();
  reading.set(ref, read);
  try {
    return await read;
  } finally {
    if (reading.get(ref) === read) reading.delete(ref);
  }
}
/** How many object addresses are held (tests). */
export const heldArtUrls = () => urls.size;
