import { describe, it, expect } from 'vitest';
import { readPersisted, writePersisted, type Parse } from './usePersistedState';

/** In-memory Storage double good enough for readPersisted/writePersisted. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

/** Storage whose accessors always throw, mimicking disabled/blocked storage. */
function throwingStorage(): Storage {
  return {
    get length(): number {
      throw new Error('blocked');
    },
    clear: () => {
      throw new Error('blocked');
    },
    getItem: () => {
      throw new Error('blocked');
    },
    key: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  } as Storage;
}

const asString: Parse<string> = (raw) => raw;
const asPositiveInt: Parse<number> = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

describe('readPersisted', () => {
  it('returns the fallback when the key is absent', () => {
    expect(readPersisted(fakeStorage(), 'missing', 'def', asString)).toBe('def');
  });

  it('returns the parsed value when present and valid', () => {
    expect(readPersisted(fakeStorage({ k: 'hello' }), 'k', 'def', asString)).toBe('hello');
    expect(readPersisted(fakeStorage({ k: '42' }), 'k', 7, asPositiveInt)).toBe(42);
  });

  it('keeps an empty string when the parser accepts it', () => {
    expect(readPersisted(fakeStorage({ k: '' }), 'k', 'def', asString)).toBe('');
  });

  it('returns the fallback when the parser rejects the stored value', () => {
    expect(readPersisted(fakeStorage({ k: 'nope' }), 'k', 7, asPositiveInt)).toBe(7);
    expect(readPersisted(fakeStorage({ k: '-3' }), 'k', 7, asPositiveInt)).toBe(7);
  });

  it('returns the fallback when storage throws', () => {
    expect(readPersisted(throwingStorage(), 'k', 'def', asString)).toBe('def');
  });

  it('returns the fallback when storage is undefined', () => {
    expect(readPersisted(undefined, 'k', 'def', asString)).toBe('def');
  });
});

describe('writePersisted', () => {
  it('serializes and stores the value', () => {
    const storage = fakeStorage();
    writePersisted(storage, 'k', 42, String);
    expect(storage.getItem('k')).toBe('42');
  });

  it('uses a custom serializer', () => {
    const storage = fakeStorage();
    writePersisted(storage, 'k', { a: 1 }, (v) => JSON.stringify(v));
    expect(storage.getItem('k')).toBe('{"a":1}');
  });

  it('swallows storage failures', () => {
    expect(() => writePersisted(throwingStorage(), 'k', 'v', String)).not.toThrow();
  });

  it('is a no-op when storage is undefined', () => {
    expect(() => writePersisted(undefined, 'k', 'v', String)).not.toThrow();
  });
});
