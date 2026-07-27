import type { QuickKeyEntry } from '../../core/quickkeys';

/**
 * Case-insensitive match of a quick key against a search query, by item
 * description or UPC/PLU. An empty (or whitespace-only) query matches every
 * entry, so callers can pass the raw input without a separate empty check.
 */
export function matchesQuery(entry: QuickKeyEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return entry.description.toLowerCase().includes(q) || entry.upc.toLowerCase().includes(q);
}

/** Filter entries by `matchesQuery`, preserving their original order. */
export function filterQuickKeys(entries: QuickKeyEntry[], query: string): QuickKeyEntry[] {
  return entries.filter((entry) => matchesQuery(entry, query));
}

/**
 * Stable partition that floats pinned (favorited) entries to the top while
 * preserving the relative order within the pinned and unpinned groups.
 */
export function sortPinned(entries: QuickKeyEntry[], pinned: ReadonlySet<string>): QuickKeyEntry[] {
  const isPinned = (e: QuickKeyEntry): boolean => pinned.has(e.upc);
  return [...entries.filter(isPinned), ...entries.filter((e) => !isPinned(e))];
}

/** Toggle a UPC in the pinned list, returning a new array (add if absent, else remove). */
export function togglePin(pinned: string[], upc: string): string[] {
  return pinned.includes(upc) ? pinned.filter((u) => u !== upc) : [...pinned, upc];
}
