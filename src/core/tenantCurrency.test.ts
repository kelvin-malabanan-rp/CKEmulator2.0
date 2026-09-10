import { describe, it, expect } from 'vitest';
import {
  formatTenantCurrency,
  localeForTenant,
  currencyForTenant,
  symbolForCurrency,
  currencySymbolsAgree,
  tenantFromPlayerCode,
  CURRENCY_SYMBOLS,
  DEFAULT_TENANT,
} from './tenantCurrency';

/** Every tenant CK Player 2.0 knows (TenantUtils maps). */
const TENANTS = ['ie', 'no', 'se', 'dk', 'ee', 'lt', 'lv', 'pl', 'us', 'ca'];

describe('tenantFromPlayerCode', () => {
  it('takes the leading segment of the player code', () => {
    expect(tenantFromPlayerCode('pl-79989-1')).toBe('pl');
    expect(tenantFromPlayerCode('ca-12345-2')).toBe('ca');
    expect(tenantFromPlayerCode('IE-1-1')).toBe('ie');
  });

  it('is empty for a missing or unusable code', () => {
    expect(tenantFromPlayerCode('')).toBe('');
    expect(tenantFromPlayerCode(undefined)).toBe('');
    expect(tenantFromPlayerCode(null)).toBe('');
  });
});

describe('localeForTenant', () => {
  it('maps each tenant to CK Player 2.0s default locale', () => {
    expect(localeForTenant('ie')).toBe('en-IE');
    expect(localeForTenant('no')).toBe('no-NO');
    expect(localeForTenant('se')).toBe('sv-SE');
    expect(localeForTenant('dk')).toBe('da-DK');
    expect(localeForTenant('ee')).toBe('et-EE');
    expect(localeForTenant('lt')).toBe('lt-LT');
    expect(localeForTenant('lv')).toBe('lv-LV');
    expect(localeForTenant('pl')).toBe('pl-PL');
    expect(localeForTenant('us')).toBe('en-US');
  });

  it('picks the Canadian variant from the transaction language', () => {
    expect(localeForTenant('ca', 'en')).toBe('en-CA');
    expect(localeForTenant('ca', 'fr')).toBe('fr-CA');
  });

  it('falls back to en-US for an unknown tenant, as CK Player 2.0 does', () => {
    expect(localeForTenant('zz')).toBe('en-US');
  });
});

describe('currencyForTenant', () => {
  it('maps each tenant to its ISO-4217 currency', () => {
    expect(currencyForTenant('pl')).toBe('PLN');
    expect(currencyForTenant('no')).toBe('NOK');
    expect(currencyForTenant('se')).toBe('SEK');
    expect(currencyForTenant('dk')).toBe('DKK');
    expect(currencyForTenant('ie')).toBe('EUR');
    expect(currencyForTenant('ca')).toBe('CAD');
    expect(currencyForTenant('us')).toBe('USD');
  });

  it('falls back to EUR, as CK Player 2.0 does', () => {
    expect(currencyForTenant('zz')).toBe('EUR');
  });
});

describe('symbolForCurrency (CKP2.0 CURRENCY_SYMBOLS)', () => {
  it('matches the reference table', () => {
    expect(CURRENCY_SYMBOLS).toEqual({
      EUR: '€',
      USD: '$',
      CAD: 'CA$',
      SEK: 'kr',
      DKK: 'kr',
      NOK: 'kr',
      PLN: 'zł',
    });
    expect(symbolForCurrency('pln')).toBe('zł');
    expect(symbolForCurrency('ZZZ')).toBe('');
  });
});

describe('currencySymbolsAgree', () => {
  it('agrees with the currency table for every tenant except CA', () => {
    for (const tenant of TENANTS) {
      // CAD is 'CA$' in CURRENCY_SYMBOLS but '$' in the en-CA/fr-CA locale
      // configs; the locale configs win for display. Any OTHER divergence
      // means the two maps drifted and one of them is wrong.
      expect(currencySymbolsAgree(tenant), tenant).toBe(tenant !== 'ca');
    }
  });
});

describe('formatTenantCurrency', () => {
  it('formats Poland as zloty with a comma decimal and a trailing symbol', () => {
    expect(formatTenantCurrency(210, 'pl')).toBe('2,10 zł');
    expect(formatTenantCurrency(100, 'pl')).toBe('1,00 zł');
  });

  it('keeps Canada on the dollar shapes the emulator has always shown', () => {
    expect(formatTenantCurrency(194, 'ca', 'en')).toBe('$1.94');
    expect(formatTenantCurrency(194, 'ca', 'fr')).toBe('1,94$');
    expect(formatTenantCurrency(500000, 'ca', 'en')).toBe('$5,000.00');
    expect(formatTenantCurrency(500000, 'ca', 'fr')).toBe('5 000,00$');
  });

  it('formats the Nordic tenants as kroner with a trailing space', () => {
    expect(formatTenantCurrency(3000, 'no')).toBe('30,00 kr');
    expect(formatTenantCurrency(3000, 'se')).toBe('30,00 kr');
    expect(formatTenantCurrency(3000, 'dk')).toBe('30,00 kr');
  });

  it('leads with the euro in Ireland but trails it in the Baltics', () => {
    expect(formatTenantCurrency(194, 'ie')).toBe('€1.94');
    expect(formatTenantCurrency(194, 'ee')).toBe('1,94€');
    expect(formatTenantCurrency(194, 'lv')).toBe('1,94€');
    expect(formatTenantCurrency(194, 'lt')).toBe('1,94€');
  });

  it('renders sub-euro Irish amounts in cents, as CK Player 2.0 does', () => {
    expect(formatTenantCurrency(94, 'ie')).toBe('94c');
    expect(formatTenantCurrency(1, 'ie')).toBe('1c');
    // The threshold is exclusive, and zero keeps the full form.
    expect(formatTenantCurrency(100, 'ie')).toBe('€1.00');
    expect(formatTenantCurrency(0, 'ie')).toBe('€0.00');
  });

  it('groups thousands per locale', () => {
    expect(formatTenantCurrency(123456, 'pl')).toBe('1.234,56 zł');
    expect(formatTenantCurrency(123456, 'se')).toBe('1 234,56 kr');
    expect(formatTenantCurrency(123456, 'ie')).toBe('€1,234.56');
    expect(formatTenantCurrency(123456, 'us')).toBe('$1,234.56');
  });

  it('signs negatives with a LEADING minus (display, not the wire)', () => {
    expect(formatTenantCurrency(-210, 'pl')).toBe('-2,10 zł');
    expect(formatTenantCurrency(-194, 'ca')).toBe('-$1.94');
  });

  it('builds from integer cents with no float drift', () => {
    expect(formatTenantCurrency(1010, 'pl')).toBe('10,10 zł');
    expect(formatTenantCurrency(2999, 'pl')).toBe('29,99 zł');
    expect(formatTenantCurrency(5, 'pl')).toBe('0,05 zł');
  });

  it('shows dollars before a player is registered (the CA default)', () => {
    expect(DEFAULT_TENANT).toBe('ca');
    expect(formatTenantCurrency(210, DEFAULT_TENANT)).toBe('$2.10');
  });

  it('uses the tenant currency symbol for every market', () => {
    for (const tenant of TENANTS) {
      const symbol =
        tenant === 'ca' ? '$' : symbolForCurrency(currencyForTenant(tenant));
      expect(formatTenantCurrency(1000, tenant), tenant).toContain(symbol);
    }
  });
});
