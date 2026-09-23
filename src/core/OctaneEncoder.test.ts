import { describe, it, expect } from 'vitest';
import {
  OctaneEncoder,
  OCTANE_LINE_ID,
  OCTANE_VOID_SIGNAL,
  formatOctaneAmount,
  formatOctaneQuantity,
  OCTANE_LOCALE_LABELS,
  octaneLocaleForTenant,
  octaneTimestamp,
  type OctaneLocale,
} from './OctaneEncoder';
import { DEFAULT_PLAYER_CONFIG } from './posTypes';

/** Fixed clock so timestamp/date/time fields are deterministic. */
const CLOCK = (): Date => new Date(2026, 8, 9, 14, 5, 3, 250);

function encoder(locale: OctaneLocale = 'ie'): OctaneEncoder {
  return new OctaneEncoder({
    locale,
    playerCode: 'ie-59971-1',
    operatorId: '12399',
    operatorName: 'TimC',
    clock: CLOCK,
    receiptUuidGen: () => 'fixed-uuid',
  });
}

/** Parse one encoded message back into an object (strips the CRLF terminator). */
function decode(line: string): Record<string, unknown> {
  expect(line.endsWith('\r\n')).toBe(true);
  return JSON.parse(line) as Record<string, unknown>;
}

describe('formatOctaneAmount', () => {
  it('uses a dot decimal for ie/en', () => {
    expect(formatOctaneAmount(150, 'ie')).toBe('1.50');
    expect(formatOctaneAmount(150, 'en')).toBe('1.50');
  });

  it('uses a comma decimal for the Nordic/Baltic locales', () => {
    expect(formatOctaneAmount(3000, 'no')).toBe('30,00');
    expect(formatOctaneAmount(3000, 'sv')).toBe('30,00');
    expect(formatOctaneAmount(3000, 'da')).toBe('30,00');
    expect(formatOctaneAmount(3000, 'lv')).toBe('30,00');
  });

  it('always emits two decimals', () => {
    expect(formatOctaneAmount(0, 'ie')).toBe('0.00');
    expect(formatOctaneAmount(5, 'ie')).toBe('0.05');
    expect(formatOctaneAmount(100, 'ie')).toBe('1.00');
  });

  it('marks negatives with Octane trailing-minus, never a leading sign', () => {
    expect(formatOctaneAmount(-1000, 'no')).toBe('10,00-');
    expect(formatOctaneAmount(-150, 'ie')).toBe('1.50-');
    expect(formatOctaneAmount(-150, 'ie').startsWith('-')).toBe(false);
  });

  it('groups thousands with a separator that is never the decimal separator', () => {
    expect(formatOctaneAmount(123456, 'ie')).toBe('1,234.56');
    expect(formatOctaneAmount(123456, 'da')).toBe('1.234,56');
    // no/sv use U+00A0, which both players' parsers strip as whitespace.
    expect(formatOctaneAmount(123456, 'no')).toBe('1\u00A0234,56');
  });

  it('builds from integer cents with no float drift', () => {
    expect(formatOctaneAmount(1010, 'ie')).toBe('10.10');
    expect(formatOctaneAmount(2999, 'ie')).toBe('29.99');
  });
});

describe('formatOctaneQuantity', () => {
  it('emits whole quantities bare', () => {
    expect(formatOctaneQuantity(1, 'no')).toBe('1');
    expect(formatOctaneQuantity(3, 'ie')).toBe('3');
  });

  it('uses the locale decimal separator for fractional quantities', () => {
    // A dot-decimal "1.5" under a comma locale would be parsed as 15 by both
    // players' currency parsers — the separator has to follow the locale.
    expect(formatOctaneQuantity(1.5, 'no')).toBe('1,5');
    expect(formatOctaneQuantity(1.5, 'ie')).toBe('1.5');
  });
});

describe('octaneTimestamp', () => {
  it('emits an offset-bearing ISO-8601 stamp, not the Z form', () => {
    const stamp = octaneTimestamp(CLOCK());
    expect(stamp).toMatch(/^2026-09-09T14:05:03\.250[+-]\d{2}:\d{2}$/);
    expect(stamp.endsWith('Z')).toBe(false);
  });

  it('round-trips through Date, which is how CK Player 2.0 reads it', () => {
    expect(new Date(octaneTimestamp(CLOCK())).getTime()).toBe(CLOCK().getTime());
  });
});

describe('OctaneEncoder envelope', () => {
  it('stamps every message with the journal envelope', () => {
    const msg = decode(encoder().voidTicket());
    expect(msg).toMatchObject({
      msgType: 'journal',
      siteNumber: '59971',
      posNo: '1',
      languageCodeIso639_1: 'ie',
      currencyCodeIso4217: '978',
      countryCodeIso4217: '',
      lineId: OCTANE_LINE_ID.VOID_TICKET,
    });
  });

  it('slices siteNumber/posNo out of {tenant}-{location}-{player}', () => {
    const msg = decode(new OctaneEncoder({ playerCode: 'no-12345-7' }).voidTicket());
    expect(msg.siteNumber).toBe('12345');
    expect(msg.posNo).toBe('7');
  });

  it('leaves siteNumber/posNo empty when no player code is configured', () => {
    const msg = decode(new OctaneEncoder().voidTicket());
    expect(msg.siteNumber).toBe('');
    expect(msg.posNo).toBe('');
  });

  it('carries the tenant currency code', () => {
    expect(decode(new OctaneEncoder({ locale: 'no' }).voidTicket()).currencyCodeIso4217).toBe('578');
    expect(decode(new OctaneEncoder({ locale: 'sv' }).voidTicket()).currencyCodeIso4217).toBe('752');
    expect(decode(new OctaneEncoder({ locale: 'da' }).voidTicket()).currencyCodeIso4217).toBe('208');
  });

  it('terminates each message with CRLF (the documented lineSeparator)', () => {
    expect(encoder().voidTicket().endsWith('\r\n')).toBe(true);
  });
});

describe('OctaneEncoder.createBasket', () => {
  it('emits lineId 6 with the cashier, receipt and terminal', () => {
    const msg = decode(encoder().createBasket({ receiptNumber: 1438, terminalNumber: 1 }));
    expect(msg).toMatchObject({
      lineId: OCTANE_LINE_ID.CREATE_BASKET,
      shiftNo: '1',
      operatorNo: '12399',
      operatorName: 'TimC',
      receiptNo: '1438',
      terminalNo: '1',
      siteNo: '59971',
      receiptUniqueId: 'fixed-uuid',
      date: '9/9/2026',
      time: '14:5',
      lineText: [],
    });
  });
});

describe('OctaneEncoder item lines', () => {
  it('emits lineId 1 with the EXTENDED total and the barcode in `ean`', () => {
    // CK Player 2.0 divides `total` by `qty` to recover the unit price, so a
    // 3 × €2.00 line must go out as 6.00, not 2.00.
    const msg = decode(
      encoder().itemAdd({ description: 'COKE 500ML', barcode: '5449000000996', quantity: 3, extendedCents: 600 }),
    );
    expect(msg).toMatchObject({
      lineId: OCTANE_LINE_ID.ADD_VOID_ITEM,
      textLong: 'COKE 500ML',
      total: '6.00',
      qty: '3',
      ean: '5449000000996',
      itemMask: [],
    });
  });

  it('marks a void with itemMask ABORT and a trailing-minus total', () => {
    const msg = decode(
      encoder().itemVoid({ description: 'COKE 500ML', barcode: '5449000000996', quantity: 1, extendedCents: 200 }),
    );
    expect(msg).toMatchObject({
      lineId: OCTANE_LINE_ID.ADD_VOID_ITEM,
      total: '2.00-',
      itemMask: [OCTANE_VOID_SIGNAL],
    });
  });

  it('negates an already-negative void amount only once', () => {
    const msg = decode(
      encoder().itemVoid({ description: 'X', barcode: '1', quantity: 1, extendedCents: -200 }),
    );
    expect(msg.total).toBe('2.00-');
  });

  it('emits fuel as lineId 2 with litres and no barcode', () => {
    const msg = decode(encoder().fuelAdd({ description: 'miles 95', litres: 7, extendedCents: 10000 }));
    expect(msg).toMatchObject({
      lineId: OCTANE_LINE_ID.ADD_VOID_FUEL,
      text: 'miles 95',
      litres: '7',
      total: '100.00',
      itemMask: [],
    });
    expect(msg.ean).toBeUndefined();
  });

  it('emits a fuel void as lineId 2 + ABORT with a POSITIVE total', () => {
    // The player negates a fuel void itself (handleAddVoidFuel: `price =
    // price.negate()` when ABORT is present), so a trailing-minus here would
    // flip it back to a charge.
    const msg = decode(encoder().fuelVoid({ description: 'miles 95', litres: 7, extendedCents: 10000 }));
    expect(msg).toMatchObject({
      lineId: OCTANE_LINE_ID.ADD_VOID_FUEL,
      total: '100.00',
      itemMask: [OCTANE_VOID_SIGNAL],
    });
  });
});

describe('OctaneEncoder.discount', () => {
  it('emits lineId 3 with a trailing-minus amount', () => {
    // A POSITIVE discount means "void the earlier discount" to both parsers.
    const msg = decode(encoder().discount({ text: 'MEAL DEAL', amountCents: 100 }));
    expect(msg).toMatchObject({ lineId: OCTANE_LINE_ID.DISCOUNT, text: 'MEAL DEAL', discount: '1.00-' });
  });
});

describe('OctaneEncoder tender sequence', () => {
  it('emits lineId 5 with total + vat', () => {
    const msg = decode(encoder().basketTotal({ totalCents: 900, taxCents: 180 }));
    expect(msg).toMatchObject({ lineId: OCTANE_LINE_ID.BASKET_TOTAL, total: '9.00', vat: '1.80' });
  });

  it('emits lineId 55 with tenderType 0 so the player treats it as cash', () => {
    const msg = decode(encoder().tender({ amountCents: 1000, totalCents: 900, description: 'CASH PAYMENT' }));
    expect(msg).toMatchObject({
      lineId: OCTANE_LINE_ID.TENDER,
      amount: '10.00',
      total: '9.00',
      tenderText: 'CASH PAYMENT',
      tenderType: '0',
    });
  });

  it('omits tenderType for a non-cash tender', () => {
    const msg = decode(
      encoder().tender({ amountCents: 900, totalCents: 900, description: 'CARD', cash: false }),
    );
    expect(msg.tenderType).toBeUndefined();
  });

  it('emits lineId 60 change as a trailing-minus amountDue', () => {
    const msg = decode(encoder().change({ changeCents: 100 }));
    expect(msg).toMatchObject({ lineId: OCTANE_LINE_ID.CHANGE, amountDue: '1.00-' });
  });

  it('emits lineId 379 with the basket vat', () => {
    const msg = decode(encoder().taxInBasket({ taxCents: 180 }));
    expect(msg).toMatchObject({ lineId: OCTANE_LINE_ID.TAX_IN_BASKET, vat: '1.80' });
  });

  it('emits lineId 7 with the receipt and terminal', () => {
    const msg = decode(encoder().endOfTransaction({ receiptNumber: 1438, terminalNumber: 1 }));
    expect(msg).toMatchObject({
      lineId: OCTANE_LINE_ID.END_OF_TRANSACTION,
      receiptNo: '1438',
      terminalNo: '1',
    });
  });
});

describe('OctaneEncoder basket-level lines', () => {
  it('emits lineId 27 for a ticket void, with no fields of its own', () => {
    const msg = decode(encoder().voidTicket());
    expect(msg.lineId).toBe(OCTANE_LINE_ID.VOID_TICKET);
  });

  it('emits lineId 33 for a stored (suspended) transaction', () => {
    const msg = decode(encoder().storedTransaction());
    expect(msg.lineId).toBe(OCTANE_LINE_ID.STORED_TRANSACTION);
  });
});

describe('octaneLocaleForTenant', () => {
  it('maps the Octane tenants to their price dialect', () => {
    expect(octaneLocaleForTenant('ie')).toBe('ie');
    expect(octaneLocaleForTenant('no')).toBe('no');
    expect(octaneLocaleForTenant('lv')).toBe('lv');
    expect(octaneLocaleForTenant('pl')).toBe('pl');
  });

  it('translates the tenant codes that differ from the locale codes', () => {
    // The two vocabularies are not the same: Sweden is tenant `se` / locale
    // `sv`, Denmark is tenant `dk` / locale `da`.
    expect(octaneLocaleForTenant('se')).toBe('sv');
    expect(octaneLocaleForTenant('dk')).toBe('da');
  });

  it('is case- and whitespace-insensitive (player codes vary)', () => {
    expect(octaneLocaleForTenant(' PL ')).toBe('pl');
    expect(octaneLocaleForTenant('SE')).toBe('sv');
  });

  it('returns null rather than guessing for a non-Octane or unsupported tenant', () => {
    // A silent fallback to `ie` would format Polish amounts with a dot and
    // scale every one of them by 100 on the player.
    expect(octaneLocaleForTenant('ca')).toBeNull();
    expect(octaneLocaleForTenant('us')).toBeNull();
    // ee/lt are Octane markets the legacy player handles, but CK Player 2.0's
    // Locale union has no entry for them — nothing valid to select.
    expect(octaneLocaleForTenant('ee')).toBeNull();
    expect(octaneLocaleForTenant('lt')).toBeNull();
    expect(octaneLocaleForTenant('')).toBeNull();
    expect(octaneLocaleForTenant(undefined)).toBeNull();
  });
});

describe('Octane pl (Poland) dialect', () => {
  it('formats Polish amounts with a COMMA — what CK Player 2.0 parses', () => {
    // Verified against CKP2.0's CurrencyManipulator: locale pl reads "1,50" as
    // 1.5 and "1.50" as 150. Its __tests__/CurrencyManipulator.test.ts locks
    // 'pl' into the European (comma) set.
    expect(formatOctaneAmount(150, 'pl')).toBe('1,50');
    expect(formatOctaneAmount(-150, 'pl')).toBe('1,50-');
  });

  it('stamps PLN as the currency code', () => {
    expect(decode(new OctaneEncoder({ locale: 'pl' }).voidTicket()).currencyCodeIso4217).toBe('985');
  });
});

describe('OCTANE_LOCALE_LABELS', () => {
  const locales = Object.keys(OCTANE_LOCALE_LABELS) as OctaneLocale[];

  it('labels every supported locale', () => {
    expect(locales).toEqual(['ie', 'en', 'no', 'sv', 'da', 'lv', 'pl']);
  });

  it('keeps labels short enough for the fixed-width Config chip', () => {
    // The picker is a 104px chip at 11px/700/.5px-tracking; anything past ~8
    // characters clips (the first cut showed "Ireland (1" for "Ireland (1.50)").
    for (const loc of locales) {
      expect(OCTANE_LOCALE_LABELS[loc].length, OCTANE_LOCALE_LABELS[loc]).toBeLessThanOrEqual(8);
    }
  });

  it('shows the locale CODE — the literal virtualjournal.priceLocale value', () => {
    for (const loc of locales) {
      expect(OCTANE_LOCALE_LABELS[loc].startsWith(loc.toUpperCase()), loc).toBe(true);
    }
  });

  it('samples the dialect so comma vs dot is visible without opening the docs', () => {
    expect(OCTANE_LOCALE_LABELS.ie).toContain('1.50');
    expect(OCTANE_LOCALE_LABELS.no).toContain('1,50');
    // Each sample must match how that locale actually formats 150 cents.
    for (const loc of locales) {
      expect(OCTANE_LOCALE_LABELS[loc], loc).toContain(formatOctaneAmount(150, loc));
    }
  });
});

describe('OctaneEncoder locale wiring', () => {
  it('formats every amount in the configured dialect', () => {
    const msg = decode(
      encoder('no').itemAdd({ description: 'IMSDAL', barcode: '7044610874876', quantity: 1, extendedCents: 3000 }),
    );
    expect(msg.total).toBe('30,00');
    expect(msg.languageCodeIso639_1).toBe('no');
  });
});

describe('OctaneEncoder operator defaults', () => {
  it('defaults to the Java emulator cashier, matching RegisterSession', () => {
    // The encoder and RegisterSession must not drift: both take their default
    // from DEFAULT_PLAYER_CONFIG, so an Octane lane can never sign on as a
    // different cashier than the Radiant6 lane next to it.
    const msg = decode(new OctaneEncoder().createBasket({ receiptNumber: 1, terminalNumber: 1 }));
    expect(msg).toMatchObject({
      operatorNo: DEFAULT_PLAYER_CONFIG.operatorId,
      operatorName: DEFAULT_PLAYER_CONFIG.operatorName,
    });
    expect(msg.operatorNo).toBe('12399');
    expect(msg.operatorName).toBe('TimC');
  });
});
