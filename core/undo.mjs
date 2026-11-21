/**
 * Undo for one reversible change (PR #155 sixth pass, V2), kept to what
 * that change touched. Client.transact writes the change as a commit; when
 * the write is refused the undo runs before any later snapshot is taken,
 * so a later save, a backup or account sync never carries it.
 *
 * `fields(target, keys)` records `keys` of `target` before the change and
 * returns `seal`; call `seal()` once the change is made to get the undo.
 * The undo puts back only the keys that still hold what the change left:
 * anything that changed one since (a newer change, a token the provider
 * rotated in the same object) is kept, never rolled back.
 */
const text = (value) =>
  value === undefined ? undefined : JSON.stringify(value);

export function fields(target, keys) {
  const before = keys.map((key) => [
    key,
    Object.hasOwn(target, key),
    target[key] === undefined ? undefined : structuredClone(target[key]),
  ]);
  return () => {
    const after = keys.map((key) => text(target[key]));
    return () => {
      before.forEach(([key, had, value], index) => {
        if (text(target[key]) !== after[index]) return;
        if (had) target[key] = value;
        else delete target[key];
      });
    };
  };
}

/** Runs undos newest first; one that throws does not stop the others. */
export function all(...undos) {
  return () => {
    for (const undo of [...undos].reverse())
      if (typeof undo === "function")
        try {
          undo();
        } catch {}
  };
}
