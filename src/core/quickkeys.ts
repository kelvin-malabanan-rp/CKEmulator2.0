/**
 * Quick-key (`.qk`) parsing — the legacy `usualsuspects.qk` format:
 *
 *   #upc|sendScan|description|quantity|price|iodevice1|iodelay1|iodata1|…
 *   028200009654|true|Marlboro 72 GLD BX KG|1|5.99
 *
 * Parsed positionally and leniently, matching the legacy emulator
 * (`EmulatorUI.java:508–549`): `#`/blank lines are skipped, `upc` is required,
 * later fields are optional, and malformed rows degrade rather than throw. We do
 * NOT reorder swapped/short rows — positional parity avoids guessing.
 *
 * Pure / browser-safe (no Node or Electron imports).
 */

export interface QuickKeyEntry {
  upc: string;
  sendScan: boolean;
  description: string;
  /** Quantity to fire (defaults to 1 when the field is absent). */
  quantity: number;
  /** Unit price in integer cents (defaults to 0 when the field is absent). */
  priceCents: number;
  /** Remaining `iodevice|iodelay|iodata…` fields, as-is. */
  io: string[];
}

/** Parse the full text of a `.qk` file into quick-key entries. */
export function parseQuickKeys(text: string): QuickKeyEntry[] {
  const entries: QuickKeyEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = raw.split('|');
    const upc = (parts[0] ?? '').trim();
    if (!upc) continue;

    const sendScan = (parts[1] ?? '').trim().toLowerCase() === 'true';
    const description = parts.length > 2 && parts[2].trim() !== '' ? parts[2].trim() : upc;

    const qtyRaw = parts.length > 3 ? parts[3].trim() : '';
    const quantity = qtyRaw !== '' && Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : 1;

    const priceRaw = parts.length > 4 ? parts[4].trim() : '';
    const priceCents =
      priceRaw !== '' && Number.isFinite(Number(priceRaw)) ? Math.round(Number(priceRaw) * 100) : 0;

    const io = parts.length > 5 ? parts.slice(5).map((s) => s.trim()) : [];

    entries.push({ upc, sendScan, description, quantity, priceCents, io });
  }
  return entries;
}

/** One parsed `.qk` file (becomes a tab in the UI). */
export interface QuickKeyFile {
  file: string;
  entries: QuickKeyEntry[];
}

/** Result of loading all `.qk` files from a folder. */
export interface QuickKeyLoadResult {
  ok: boolean;
  files: QuickKeyFile[];
  dir: string;
  error?: string;
}

/**
 * Pick which folder to scan for `.qk` files. A non-empty `requested` directory
 * (the UI override) always wins; otherwise fall back to the bundled defaults so
 * the emulator is self-contained on a fresh clone — no external liftck_player
 * checkout required.
 */
export function resolveQuickKeyDir(requested: string | undefined, fallback: string): string {
  const trimmed = (requested ?? '').trim();
  return trimmed !== '' ? trimmed : fallback;
}

/** Order `.qk` filenames with `usualsuspects` first, then alphabetical (legacy parity). */
export function orderQuickKeyFiles(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const ua = a.toLowerCase().startsWith('usualsuspects') ? 0 : 1;
    const ub = b.toLowerCase().startsWith('usualsuspects') ? 0 : 1;
    return ua - ub || a.localeCompare(b);
  });
}

/** How a quick key should be colored, given the loaded pricebook + ad-trigger + age codes. */
export type QuickKeyColor = 'normal' | 'grey' | 'green' | 'orange' | 'dark-green';

/**
 * Decide a quick key's color — legacy parity (EmulatorUI.java:533-546):
 *   - dark-green → the UPC is BOTH age-restricted AND an ad trigger (DARK_GREEN)
 *   - orange     → the UPC is age-restricted (minAge > 0)          (ACCENT_ORANGE)
 *   - green      → the UPC has an ad trigger                       (EMERALD_GREEN)
 *   - grey       → a pricebook is loaded and the UPC isn't in it   (DARKER_SHADE)
 *   - normal     → otherwise
 *
 * Age wins over a plain trigger (legacy checks age first), and a trigger still
 * wins over grey (an ad trigger not yet in the pricebook stays highlighted).
 */
export function quickKeyColor(
  upc: string,
  opts: { pricebookLoaded: boolean; pricebookCodes: Set<string>; adCodes: Set<string>; ageCodes: Set<string> },
): QuickKeyColor {
  const age = opts.ageCodes.has(upc);
  const trigger = opts.adCodes.has(upc);
  if (age && trigger) return 'dark-green';
  if (age) return 'orange';
  if (trigger) return 'green';
  if (opts.pricebookLoaded && !opts.pricebookCodes.has(upc)) return 'grey';
  return 'normal';
}

/** Split items into fixed-size pages. Empty input yields one empty page. */
export function paginate<T>(items: T[], perPage: number): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages;
}
