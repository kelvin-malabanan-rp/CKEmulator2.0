/**
 * OCT2000-IMPORT pricebook parser — Circle K's standard pricebook export
 * format (POS-agnostic; used by Radiant6 Canada, Bulloch, etc.). Mirrors the
 * legacy liftck_player emulator, which loaded the shared `Pricebook` class to
 * build its quick keys and resolve scans.
 *
 * Pure / browser-safe. We parse the `<DRY>` article elements:
 *   <DRY><NLU-NO>plu</NLU-NO><NLU-TEXT-LONG>desc</NLU-TEXT-LONG>
 *        <PRICE>cents</PRICE> ... <BARC><BARCODE>upc</BARCODE>...</BARC> </DRY>
 * PRICE is integer cents (legacy/Octane convention: `<PRICE>60</PRICE>` = $0.60).
 */

export interface PricebookEntry {
  plu: string;
  description: string;
  priceCents: number;
  barcodes: string[];
}

/** UPC/PLU → resolved item details. */
export interface ResolvedItem {
  code: string;
  description: string;
  priceCents: number;
  plu: string;
}

/** A sellable item surfaced as a quick key in the emulator UI. */
export interface QuickKeyItem {
  code: string;
  description: string;
  priceCents: number;
}

/** Result of a pricebook file load (returned from main → renderer over IPC). */
export interface PricebookLoadResult {
  ok: boolean;
  count: number;
  entries: PricebookEntry[];
  path: string;
  error?: string;
}

function firstTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>(.*?)</${tag}>`, 's').exec(xml);
  return m ? m[1].trim() : null;
}

/** Parse an OCT2000-IMPORT pricebook into DRY article entries. */
export function parsePricebook(xml: string): PricebookEntry[] {
  const entries: PricebookEntry[] = [];
  const dryRe = /<DRY\b[^>]*>(.*?)<\/DRY>/gs;
  let m: RegExpExecArray | null;
  while ((m = dryRe.exec(xml)) !== null) {
    const body = m[1];
    // Article-level fields appear before the first <BARC> block; slice there so
    // we read the DRY's own PRICE, not a nested barcode PRICE.
    const head = body.split('<BARC')[0];
    const plu = firstTag(head, 'NLU-NO') ?? '';
    const description = firstTag(head, 'NLU-TEXT-LONG') ?? firstTag(head, 'NLU-TEXT') ?? '';
    const priceRaw = firstTag(head, 'PRICE');
    const priceCents = priceRaw !== null && /^-?\d+$/.test(priceRaw) ? parseInt(priceRaw, 10) : 0;

    const barcodes: string[] = [];
    const barcRe = /<BARCODE>(.*?)<\/BARCODE>/gs;
    let b: RegExpExecArray | null;
    while ((b = barcRe.exec(body)) !== null) {
      const code = b[1].trim();
      if (code) barcodes.push(code);
    }

    if (plu || barcodes.length > 0) {
      entries.push({ plu, description, priceCents, barcodes });
    }
  }
  return entries;
}

/** Like firstTag but tolerates attributes on the opening tag (`<Tag attr=…>`). */
function firstTagLoose(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>(.*?)</${tag}>`, 's').exec(xml);
  return m ? m[1].trim() : null;
}

/**
 * Parse a PDI / NAXML pricebook (`<NAXML-MaintenanceRequest>` →
 * `ItemMaintenance/ITTDetail`) into the same flat entries — the dialect US and CA
 * tenants serve (VendorName=PDI). This is a LIGHT extraction: per item we take the
 * POS code, description and regular sell price (dollars → cents); it deliberately
 * skips the combo/list/promo machinery a full player pricebook build does. The POS
 * code is the scannable code, so it doubles as the barcode.
 *
 * Field mapping mirrors loa-player's PricebookWorker: `ItemCode.POSCode`,
 * `ITTData.Description`, `ITTData.RegularSellPrice`.
 */
export function parsePdiPricebook(xml: string): PricebookEntry[] {
  const entries: PricebookEntry[] = [];
  const re = /<ITTDetail\b[^>]*>(.*?)<\/ITTDetail>/gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const body = m[1];
    const posCode = firstTagLoose(body, 'POSCode') ?? '';
    if (!posCode) continue;
    const description =
      firstTagLoose(body, 'Description') || firstTagLoose(body, 'ngrp_ShortDescription') || posCode;
    const priceRaw = firstTagLoose(body, 'RegularSellPrice');
    const priceCents =
      priceRaw !== null && /^-?\d+(\.\d+)?$/.test(priceRaw) ? Math.round(parseFloat(priceRaw) * 100) : 0;
    entries.push({ plu: posCode, description, priceCents, barcodes: [posCode] });
  }
  return entries;
}

/**
 * Parse a pricebook XML of unknown dialect: PDI/NAXML (US/CA — the format a real
 * `pricebook.url` serves) or the legacy OCT2000-IMPORT (`<DRY>`, our bundled
 * sample). Dispatches on the root/element markers. JDE and Octane dialects are
 * not handled yet — see the multi-tenant note; they'd slot in here.
 */
export function parsePricebookXml(xml: string): PricebookEntry[] {
  if (/<NAXML-MaintenanceRequest\b/i.test(xml) || /<ITTDetail\b/i.test(xml)) {
    return parsePdiPricebook(xml);
  }
  return parsePricebook(xml);
}

/**
 * Build a lookup index keyed by every barcode AND the PLU number, so a scan of
 * either resolves the item (mirrors legacy emulator item lookup by name/code).
 */
export function buildPricebookIndex(entries: PricebookEntry[]): Map<string, ResolvedItem> {
  const index = new Map<string, ResolvedItem>();
  for (const e of entries) {
    const resolved: ResolvedItem = { code: '', description: e.description, priceCents: e.priceCents, plu: e.plu };
    if (e.plu) index.set(e.plu, { ...resolved, code: e.plu });
    for (const code of e.barcodes) {
      index.set(code, { ...resolved, code });
    }
  }
  return index;
}

/** Convenience: parse + index in one step. */
export function loadPricebookIndex(xml: string): Map<string, ResolvedItem> {
  return buildPricebookIndex(parsePricebook(xml));
}

/**
 * Pick which folder to read pricebook XML from. A non-empty `requested`
 * directory (the UI override) wins; otherwise fall back to the bundled sample
 * so the emulator resolves items, prices, and quick-key colors on a fresh clone
 * without an external pricebook export.
 */
export function resolvePricebookDir(requested: string | undefined, fallback: string): string {
  const trimmed = (requested ?? '').trim();
  return trimmed !== '' ? trimmed : fallback;
}

/**
 * Pick the pricebook file that corresponds to a player/site code. Circle K
 * names pricebook exports `<siteCode>-<timestamp>.xml` (e.g.
 * `31989-1706723713125.xml`), so the emulator loads the one matching the
 * Player Code in use. Prefers the most recent (lexicographically last) match;
 * falls back to an exact `<code>.xml`.
 *
 * When `fallbackToFirst` is set (bundled-sample mode, where the file name can't
 * match an arbitrary player code), the first `.xml` is returned as a last resort
 * — including when no player code is set yet.
 */
export function resolvePricebookFilename(
  files: string[],
  playerCode: string,
  opts: { fallbackToFirst?: boolean } = {},
): string | null {
  const code = playerCode.trim();
  if (code) {
    const matches = files.filter((f) => new RegExp(`^${code}-.*\\.xml$`, 'i').test(f)).sort();
    if (matches.length > 0) return matches[matches.length - 1];
    const exact = files.find((f) => f.toLowerCase() === `${code.toLowerCase()}.xml`);
    if (exact) return exact;
  }
  if (opts.fallbackToFirst) {
    const xmls = files.filter((f) => f.toLowerCase().endsWith('.xml')).sort();
    if (xmls.length > 0) return xmls[0];
  }
  return null;
}

/**
 * Resolve a scan into a basket item. Explicit description/price from the
 * caller (a scenario step, an ad item — e.g. the demo's fuel prepay whose
 * amount is a scenario param, not a pricebook price) win over the local
 * pricebook entry; the pricebook fills in whatever the caller left out, with
 * `UPC <code>` / $1.00 as the last-resort defaults for unknown items.
 */
export function resolveScan(
  hit: { description: string; priceCents: number } | undefined,
  code: string,
  description?: string,
  priceCents?: number,
): { code: string; description: string; priceCents: number } {
  return {
    code,
    description: description?.trim() || hit?.description || `UPC ${code}`,
    priceCents: priceCents ?? hit?.priceCents ?? 100,
  };
}

/** Select sellable items (barcode + description + price) to surface as quick keys. */
export function pickQuickKeys(entries: PricebookEntry[], limit = 24): QuickKeyItem[] {
  const keys: QuickKeyItem[] = [];
  for (const e of entries) {
    if (keys.length >= limit) break;
    const code = e.barcodes[0];
    if (code && e.description && e.priceCents > 0) {
      keys.push({ code, description: e.description, priceCents: e.priceCents });
    }
  }
  return keys;
}
