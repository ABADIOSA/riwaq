/**
 * Writes for a store whose writes finish later than the change that asked
 * for them: the web edition's sealed IndexedDB vault (PR #155 third review,
 * N1). The desktop writes its file synchronously, so a failure there throws
 * inside the change and Client.commit undoes it at once; here the browser
 * answers a turn or more later, and that answer decides.
 *
 * The rules this keeps:
 * - A save is answered only when a snapshot taken after it has COMMITTED
 *   (the IndexedDB transaction completed); an abort or an error rejects it.
 * - One write at a time; saves asked for while it runs share the next
 *   snapshot, taken when that write starts, so the latest state goes out.
 * - A commit hands its undo. When the write carrying it fails, it is undone
 *   in memory before any later snapshot is taken, together with every
 *   commit asked for after it (built on it), newest first, and each of them
 *   is told it failed. A later, unrelated save can therefore never write a
 *   change the viewer was told had failed.
 * - Plain saves (a position, a token the provider already rotated) are not
 *   undone: they are written again with the next snapshot.
 * - `metas()` gives what the last durable snapshot and the one being
 *   written describe (the pictures their collections name), so a clean-up
 *   never trusts memory alone.
 */
export class DurableWriter {
  constructor({ snapshot, write, onUndo, initialMeta } = {}) {
    if (typeof snapshot !== "function" || typeof write !== "function")
      throw new TypeError("snapshot and write are required");
    this.snapshot = snapshot;
    this.write = write;
    this.onUndo = onUndo;
    this.next = null;
    this.loop = null;
    this.durableMeta = initialMeta;
    this.runningMeta = undefined;
    this.failures = 0;
    this.lastError = null;
  }
  /** Asks for a write; `undo` makes it a commit. Resolves once durable. */
  request(undo) {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // A plain save's caller may never look; its failure is in `failures`.
    promise.catch(() => {});
    (this.next ||= { waiters: [] }).waiters.push({
      undo: typeof undo === "function" ? undo : null,
      resolve,
      reject,
    });
    if (!this.loop) this.loop = this.run();
    return promise;
  }
  /** True while a write runs or waits. */
  get busy() {
    return !!this.loop;
  }
  /** Resolves when nothing is being written or waiting; never rejects. */
  async settled() {
    while (this.loop) await this.loop;
  }
  /** What the durable snapshot and the one being written describe. */
  metas() {
    return [this.durableMeta, this.runningMeta].filter((m) => m !== undefined);
  }
  async run() {
    // The rest of the current turn joins this snapshot.
    await null;
    while (this.next) {
      const batch = this.next;
      this.next = null;
      let failure = null;
      try {
        const { text, meta } = this.snapshot();
        this.runningMeta = meta;
        await this.write(text);
        this.durableMeta = meta;
      } catch (error) {
        failure = asError(error);
      }
      this.runningMeta = undefined;
      if (!failure) {
        for (const w of batch.waiters) w.resolve();
        continue;
      }
      this.failures++;
      this.lastError = failure;
      // Built on the failed write: the commits waiting behind it, then the
      // failed write's own, each newest first.
      const later = this.next?.waiters.filter((w) => w.undo) || [];
      const undone = [...later.reverse(), ...[...batch.waiters].reverse()];
      for (const w of undone) {
        if (!w.undo) continue;
        try {
          w.undo();
        } catch {}
      }
      for (const w of batch.waiters) w.reject(failure);
      if (this.next) {
        const built = new Error(
          "لم يُحفظ هذا التغيير لأن حفظاً سبقه تعذّر في هذا المتصفح",
        );
        built.cause = failure;
        for (const w of later) w.reject(built);
        this.next.waiters = this.next.waiters.filter((w) => !w.undo);
        if (!this.next.waiters.length) this.next = null;
      }
      if (undone.some((w) => w.undo))
        try {
          this.onUndo?.(failure);
        } catch {}
    }
    // Cleared in the same turn as the last check, so a save asked for from
    // now on starts its own run.
    this.loop = null;
  }
}

function asError(error) {
  if (error instanceof Error) return error;
  const out = new Error(
    "تعذّر حفظ بيانات رِواق في هذا المتصفح، فلم يُحفظ التغيير",
  );
  if (error && typeof error === "object" && "name" in error)
    out.name = String(error.name);
  return out;
}
