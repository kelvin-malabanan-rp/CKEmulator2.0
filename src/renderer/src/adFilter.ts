import type { AdManifestEntry, AdTriggersCompleters } from '../../core/adTriggers';

/**
 * Case-insensitive match of an ad against a search query, by ad name, ad id,
 * or any trigger/completer UPC (once its details have loaded). An empty or
 * whitespace-only query matches every ad.
 */
export function matchesAd(ad: AdManifestEntry, detail: AdTriggersCompleters | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (ad.name.toLowerCase().includes(q) || ad.id.toLowerCase().includes(q)) return true;
  if (!detail) return false;
  return [...detail.triggers, ...detail.completers].some((it) => it.code.toLowerCase().includes(q));
}

/** Filter ads by `matchesAd`, preserving manifest order. */
export function filterAds(
  ads: AdManifestEntry[],
  details: Record<string, AdTriggersCompleters>,
  query: string,
): AdManifestEntry[] {
  return ads.filter((ad) => matchesAd(ad, details[ad.id], query));
}
