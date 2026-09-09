/**
 * Deletes that wait out an undo window before they actually happen.
 *
 * Extracted from the collection page after a real data loss: a collection was deleted, Undo
 * was pressed, the tile came back — and it vanished again seconds later. The cause was that
 * the timer was created inside a React state updater. React deliberately invokes updaters
 * twice under StrictMode, so two timers were scheduled and only the second id was kept.
 * Undo cleared the one it knew about; the orphan fired and deleted the collection anyway.
 *
 * Two independent protections, because one of them failing must not cost data:
 *
 *  1. Scheduling is idempotent per key. Asking twice reuses the first timer and returns
 *     false, so a double-invoked caller cannot create a second one.
 *  2. Firing is gated on the key still being armed, and undo disarms *before* it clears the
 *     timer. Even a timer that escaped tracking entirely finds the key disarmed and does
 *     nothing. The commit is guarded, not just the cancel.
 *
 * Deliberately plain objects and closures rather than a hook: this is the part that must be
 * testable without a DOM.
 */
export interface UndoQueue {
  /** Arms a delete. Returns false when this key is already pending. */
  schedule: (key: string, commit: () => void | Promise<void>) => boolean;
  /** Cancels a pending delete. With no key, cancels the most recently armed one. */
  undo: (key?: string) => boolean;
  isArmed: (key: string) => boolean;
  armedKeys: () => string[];
  /** Drops every pending delete without running any of them. */
  cancelAll: () => void;
}

export function createUndoQueue(windowMs: number): UndoQueue {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  // Insertion-ordered, which is what makes a keyless undo mean "the last one".
  const armed = new Set<string>();

  const disarm = (key: string) => {
    armed.delete(key);
    const timer = timers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.delete(key);
    }
  };

  return {
    schedule(key, commit) {
      if (armed.has(key)) return false;
      armed.add(key);
      const timer = setTimeout(() => {
        timers.delete(key);
        // The guard. A timer that outlived its cancel — or one scheduled twice by a
        // double-invoked caller — stops here rather than destroying anything.
        if (!armed.has(key)) return;
        armed.delete(key);
        void commit();
      }, windowMs);
      timers.set(key, timer);
      return true;
    },

    undo(key) {
      const target = key ?? [...armed].pop();
      if (target === undefined || !armed.has(target)) return false;
      // Disarmed first, cleared second: between the two lines the delete is already
      // impossible, so it cannot matter whether clearTimeout finds anything.
      disarm(target);
      return true;
    },

    isArmed: (key) => armed.has(key),
    armedKeys: () => [...armed],
    cancelAll() {
      for (const key of [...armed]) disarm(key);
    },
  };
}
