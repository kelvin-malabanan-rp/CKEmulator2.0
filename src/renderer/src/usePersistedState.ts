import { useCallback, useState } from 'react';

/**
 * Parse a stored string into `T`, or return `null` to signal "invalid — fall
 * back to the default". Keeping the null-means-fallback contract here lets the
 * read path stay uniform for strings and validated numbers alike.
 */
export type Parse<T> = (raw: string) => T | null;

/**
 * Read `key` from storage and parse it. Returns `fallback` when the key is
 * absent, `parse` rejects the stored value, or storage access throws (private
 * mode, disabled storage). Pure over an injected `Storage`, so it is unit
 * testable without a DOM.
 */
export function readPersisted<T>(
  storage: Storage | undefined,
  key: string,
  fallback: T,
  parse: Parse<T>,
): T {
  try {
    const raw = storage?.getItem(key) ?? null;
    if (raw === null) return fallback;
    const parsed = parse(raw);
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/**
 * Write `value` to storage as a string. Storage failures (private mode, quota)
 * are swallowed so persistence never breaks in-memory state.
 */
export function writePersisted<T>(
  storage: Storage | undefined,
  key: string,
  value: T,
  serialize: (v: T) => string,
): void {
  try {
    storage?.setItem(key, serialize(value));
  } catch {
    // ignore storage failures (private mode etc.)
  }
}

/**
 * `useState` mirrored into `localStorage`. The initial value is read once from
 * storage (falling back to `defaultValue` when absent/invalid); every setter
 * call persists the new value. `parse`/`serialize` must be stable references
 * (module-level constants) so the returned setter keeps a stable identity.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  parse: Parse<T>,
  serialize: (v: T) => string = String,
): [T, (value: T) => void] {
  const storage = typeof localStorage === 'undefined' ? undefined : localStorage;
  const [value, setValue] = useState<T>(() => readPersisted(storage, key, defaultValue, parse));
  const set = useCallback(
    (next: T) => {
      setValue(next);
      writePersisted(storage, key, next, serialize);
    },
    [key, serialize, storage],
  );
  return [value, set];
}
