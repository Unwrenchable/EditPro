/**
 * Snapshot history for editor documents.
 * Slider drags share a coalesceKey so one gesture becomes one undo step.
 */
export const HISTORY_LIMIT = 100;

export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
  coalesceKey: string | null;
}

export function cloneSnapshot<T>(value: T): T {
  return structuredClone(value);
}

export function snapshotsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createHistory<T>(present: T): HistoryState<T> {
  return {
    past: [],
    present: cloneSnapshot(present),
    future: [],
    coalesceKey: null,
  };
}

export function canUndo<T>(history: HistoryState<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: HistoryState<T>): boolean {
  return history.future.length > 0;
}

export interface CommitOptions {
  coalesceKey?: string;
  limit?: number;
}

/**
 * Record `next` as the present snapshot.
 * Same coalesceKey as the previous commit replaces present without growing the past.
 */
export function commit<T>(history: HistoryState<T>, next: T, options?: CommitOptions): HistoryState<T> {
  if (snapshotsEqual(history.present, next)) return history;

  const coalesceKey = options?.coalesceKey ?? null;
  const limit = options?.limit ?? HISTORY_LIMIT;

  if (coalesceKey && coalesceKey === history.coalesceKey) {
    return { ...history, present: cloneSnapshot(next) };
  }

  const past = [...history.past, cloneSnapshot(history.present)];
  const trimmed = past.length > limit ? past.slice(past.length - limit) : past;
  return {
    past: trimmed,
    present: cloneSnapshot(next),
    future: [],
    coalesceKey,
  };
}

export function undo<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.past.length === 0) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    coalesceKey: null,
  };
}

export function redo<T>(history: HistoryState<T>): HistoryState<T> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
    coalesceKey: null,
  };
}

/**
 * Swap the baseline present without recording an undo step.
 * Used when media metadata fills in a value the user has not edited yet.
 */
export function replacePresent<T>(history: HistoryState<T>, next: T): HistoryState<T> {
  if (snapshotsEqual(history.present, next)) return history;
  return {
    ...history,
    present: cloneSnapshot(next),
    coalesceKey: null,
  };
}
