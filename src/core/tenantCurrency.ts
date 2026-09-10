/**
 * Tenant-driven currency formatting for the emulator's OWN UI (basket totals,
 * quick-key prices, log lines) — never for the wire.
 *
 * The tenant is the leading segment of the player code (`pl-79989-1` → `pl`),
 * so registering a player is all it takes to make the UI show the right money.
 * Nothing here is user-selectable: a manual currency picker can only ever
 * disagree with the registered player.
 *
 * Ported from CK Player 2.0, which resolves this in two steps:
 *   tenant → locale   `electron/core/utils/TenantUtils.ts` (getDefaultLocale)
 *   locale → format   `src/renderer/utils/RegionalCurrencyFormatter.ts`
 * Both maps are reproduced verbatim below so the emulator renders money exactly
 * as the player does beside it.
 *
 * NOTE: this is display only. The Radiant6/pole WIRE strings stay in
 * `currency.ts` (CAD-only, byte-for-byte what the CA parsers expect), and the
 * Octane wire uses `formatOctaneAmount` (bare numbers, no symbol).
 *
 * Pure / browser-safe (no Node or Electron imports).
 */

/** How one locale renders an amount. Mirrors CKP2.0's `LocaleFormatConfig`. */
export interface CurrencyFormat {
  thousandsSeparator: string;
  decimalSeparator: string;
  currencySymbol: string;
  symbolPosition: 'before' | 'after';
  symbolSpacing: boolean;
  /** Sub-unit symbol used below `fractionalThreshold` (Ireland renders `50c`). */
  fractionalSymbol?: string;
  fractionalThreshold?: number;
}

/**
 * Backend tenant code → locale. Verbatim from CK Player 2.0's
 * `TenantUtils.getDefaultLocale`, including its `en-US` fallback for an
 * unknown tenant.
 */
const TENANT_LOCALE: Record<string, string> = {
  ie: 'en-IE',
  no: 'no-NO',
  se: 'sv-SE',
  dk: 'da-DK',
  ee: 'et-EE',
  lt: 'lt-LT',
  lv: 'lv-LV',
  pl: 'pl-PL',
  us: 'en-US',
  ca: 'en-CA',
};

/**
 * ISO-4217 currency per tenant. Verbatim from CK Player 2.0's
 * `TenantUtils.getDefaultCurrency` (EUR fallback).
 */
const TENANT_CURRENCY: Record<string, string> = {
  ie: 'EUR',
  no: 'NOK',
  se: 'SEK',
  dk: 'DKK',
  ee: 'EUR',
  lt: 'EUR',
  lv: 'EUR',
  pl: 'PLN',
  us: 'USD',
  ca: 'CAD',
};

/**
 * Currency → symbol. Verbatim from CK Player 2.0's
 * `src/core/models/Currency.ts` (CURRENCY_SYMBOLS).
 *
 * This is the currency-level table; the LOCALE_FORMAT entries below carry the
 * same symbols plus the placement and separators a bare symbol can't express
 * (€ leads in Ireland but trails in Estonia). CKP2.0 says so itself in
 * Currency.ts: "For locale-aware formatting, use RegionalCurrencyFormatter."
 * `currencySymbolsAgree()` keeps the two in step.
 *
 * They differ on exactly one entry: CAD is `CA$` here and `$` in the
 * `en-CA`/`fr-CA` locale configs. The locale configs win for display, because
 * `$` is what CKP2.0 renders on a Canadian lane, what the CA pole/VJ wire
 * carries, and what this emulator has always shown; `CA$` is the
 * disambiguating form CKP2.0 uses in microsite price bubbles.
 */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: '€',
  USD: '$',
  CAD: 'CA$',
  SEK: 'kr',
  DKK: 'kr',
  NOK: 'kr',
  PLN: 'zł',
};

/** The bare symbol for an ISO-4217 code (`PLN` → `zł`); '' when unknown. */
export function symbolForCurrency(currency: string): string {
  return CURRENCY_SYMBOLS[(currency ?? '').trim().toUpperCase()] ?? '';
}

/**
 * Whether a tenant's locale format uses the same symbol as the currency table.
 * True for every tenant except `ca` (see CURRENCY_SYMBOLS) — a regression guard
 * so a new tenant can't be added to one map with a symbol the other disputes.
 */
export function currencySymbolsAgree(tenant: string, canadaLocale: 'en' | 'fr' = 'en'): boolean {
  const config = LOCALE_FORMAT[resolveLocaleKey(localeForTenant(tenant, canadaLocale))];
  return config.currencySymbol === symbolForCurrency(currencyForTenant(tenant));
}

/**
 * Locale → format. Verbatim from CK Player 2.0's `LOCALE_FORMAT_MAP`
 * (EU + CA + US groups).
 */
const LOCALE_FORMAT: Record<string, CurrencyFormat> = {
  et: { thousandsSeparator: '.', decimalSeparator: ',', currencySymbol: '€', symbolPosition: 'after', symbolSpacing: false },
  sv: { thousandsSeparator: ' ', decimalSeparator: ',', currencySymbol: 'kr', symbolPosition: 'after', symbolSpacing: true },
  da: { thousandsSeparator: '.', decimalSeparator: ',', currencySymbol: 'kr', symbolPosition: 'after', symbolSpacing: true },
  fr: { thousandsSeparator: '.', decimalSeparator: ',', currencySymbol: '€', symbolPosition: 'after', symbolSpacing: false },
  no: { thousandsSeparator: '.', decimalSeparator: ',', currencySymbol: 'kr', symbolPosition: 'after', symbolSpacing: true },
  lv: { thousandsSeparator: '.', decimalSeparator: ',', currencySymbol: '€', symbolPosition: 'after', symbolSpacing: false },
  lt: { thousandsSeparator: '.', decimalSeparator: ',', currencySymbol: '€', symbolPosition: 'after', symbolSpacing: false },
  pl: { thousandsSeparator: '.', decimalSeparator: ',', currencySymbol: 'zł', symbolPosition: 'after', symbolSpacing: true },
  ie: { thousandsSeparator: ',', decimalSeparator: '.', currencySymbol: '€', symbolPosition: 'before', symbolSpacing: false, fractionalSymbol: 'c', fractionalThreshold: 100 },
  'en-CA': { thousandsSeparator: ',', decimalSeparator: '.', currencySymbol: '$', symbolPosition: 'before', symbolSpacing: false },
  'fr-CA': { thousandsSeparator: ' ', decimalSeparator: ',', currencySymbol: '$', symbolPosition: 'after', symbolSpacing: false },
  'en-US': { thousandsSeparator: ',', decimalSeparator: '.', currencySymbol: '$', symbolPosition: 'before', symbolSpacing: false },
};

/**
 * The tenant used before a player is registered. CA keeps the emulator's
 * historical `$1.94` display until a real tenant is known.
 */
export const DEFAULT_TENANT = 'ca';

/** Tenant code from a player code (`pl-79989-1` → `pl`); '' when unusable. */
export function tenantFromPlayerCode(playerCode: string | undefined | null): string {
  return (playerCode ?? '').trim().toLowerCase().split('-')[0] ?? '';
}

/**
 * Resolve a locale string to a key in LOCALE_FORMAT. Verbatim from CKP2.0's
 * `resolveLocaleKey`: exact match, then the language subtag, then the COUNTRY
 * subtag — the last is what makes `en-IE` find the `ie` (Euro) config rather
 * than falling back to a dollar format.
 */
function resolveLocaleKey(locale: string): string {
  if (locale in LOCALE_FORMAT) return locale;
  const parts = locale.split('-');
  if (parts[0] in LOCALE_FORMAT) return parts[0];
  if (parts[1]) {
    const country = parts[1].toLowerCase();
    if (country in LOCALE_FORMAT) return country;
  }
  return locale;
}

/**
 * The locale a tenant formats money in. Canada is bilingual, so its transaction
 * language picks `en-CA` vs `fr-CA`; every other tenant has exactly one.
 */
export function localeForTenant(tenant: string, canadaLocale: 'en' | 'fr' = 'en'): string {
  const key = (tenant ?? '').trim().toLowerCase();
  if (key === 'ca') return canadaLocale === 'fr' ? 'fr-CA' : 'en-CA';
  // Unknown tenant → CKP2.0's own fallback (TenantUtils.getDefaultLocale).
  // Callers that simply have no player registered yet pass DEFAULT_TENANT.
  return TENANT_LOCALE[key] ?? 'en-US';
}

/** ISO-4217 code the tenant transacts in (`pl` → `PLN`); EUR for an unknown tenant. */
export function currencyForTenant(tenant: string): string {
  return TENANT_CURRENCY[(tenant ?? '').trim().toLowerCase()] ?? 'EUR';
}

/** Group an integer-string into thousands using `sep`. */
function groupThousands(intStr: string, sep: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Format integer cents the way CK Player 2.0 would for this tenant:
 * `ca` → `$1.94` / `1,94$`, `pl` → `1,94 zł`, `no` → `1,94 kr`,
 * `ie` → `€1.94` (and `94c` under a euro), `us` → `$1.94`.
 *
 * Built from integer cents so there is no float drift, and the sign is a
 * leading `-` (CKP2.0's `prefix`), not the wire's trailing minus.
 */
export function formatTenantCurrency(
  cents: number,
  tenant: string,
  canadaLocale: 'en' | 'fr' = 'en',
): string {
  const config = LOCALE_FORMAT[resolveLocaleKey(localeForTenant(tenant, canadaLocale))];
  const abs = Math.abs(Math.trunc(cents));
  const sign = cents < 0 ? '-' : '';

  // Ireland shows sub-euro amounts in cents ("94c") — CKP2.0 does the same,
  // and only for a NON-zero amount below the threshold (zero stays "€0.00").
  if (config.fractionalSymbol && config.fractionalThreshold && abs > 0 && abs < config.fractionalThreshold) {
    return `${sign}${abs}${config.fractionalSymbol}`;
  }

  const whole = groupThousands(Math.floor(abs / 100).toString(), config.thousandsSeparator);
  const frac = (abs % 100).toString().padStart(2, '0');
  const number = `${whole}${config.decimalSeparator}${frac}`;
  const space = config.symbolSpacing ? ' ' : '';
  return config.symbolPosition === 'before'
    ? `${sign}${config.currencySymbol}${space}${number}`
    : `${sign}${number}${space}${config.currencySymbol}`;
}
