import { describe, it, expect } from 'vitest';
import { parseQuickKeys, paginate, orderQuickKeyFiles, quickKeyColor, resolveQuickKeyDir } from './quickkeys';

describe('parseQuickKeys', () => {
  it('parses a standard upc|sendScan|desc|qty|price row', () => {
    const [e] = parseQuickKeys('028200009654|true|Marlboro 72 GLD BX KG|1|5.99');
    expect(e).toEqual({
      upc: '028200009654',
      sendScan: true,
      description: 'Marlboro 72 GLD BX KG',
      quantity: 1,
      priceCents: 599,
      io: [],
    });
  });

  it('skips comment and blank lines', () => {
    const text = '#upc|sendScan|description|quantity|price\n\n   \n333|true|Roller Grill|1|100';
    const entries = parseQuickKeys(text);
    expect(entries).toHaveLength(1);
    expect(entries[0].upc).toBe('333');
    expect(entries[0].priceCents).toBe(10000);
  });

  it('defaults quantity to 1 and price to 0 when missing (3-field row)', () => {
    const [e] = parseQuickKeys('078000082463|true|Dr Pepper 2L');
    expect(e.description).toBe('Dr Pepper 2L');
    expect(e.quantity).toBe(1);
    expect(e.priceCents).toBe(0);
  });

  it('falls back to the upc as description when description is absent', () => {
    const [e] = parseQuickKeys('999|true');
    expect(e.description).toBe('999');
  });

  it('treats sendScan as false when the field is not "true"', () => {
    const [e] = parseQuickKeys('227|polar pop|true|1|1.00');
    // positional parity with legacy: field[1] "polar pop" !== "true"
    expect(e.sendScan).toBe(false);
    expect(e.description).toBe('true');
  });

  it('captures trailing io fields', () => {
    const [e] = parseQuickKeys('111|true|Thing|1|2.00|poledisplay|500|HELLO');
    expect(e.io).toEqual(['poledisplay', '500', 'HELLO']);
  });

  it('handles long loyalty-card UPCs with a 0.00 price', () => {
    const [e] = parseQuickKeys('8018782603900002665855|true|EZRewards 1|0.00');
    // 4-field row: quantity field is absent, so "0.00" lands in the quantity slot
    expect(e.upc).toBe('8018782603900002665855');
    expect(e.quantity).toBe(0);
    expect(e.priceCents).toBe(0);
  });

  it('skips rows with an empty upc', () => {
    expect(parseQuickKeys('|true|nope|1|1.00')).toHaveLength(0);
  });
});

describe('orderQuickKeyFiles', () => {
  it('puts usualsuspects first, then alphabetical', () => {
    expect(orderQuickKeyFiles(['beverages.qk', 'usualsuspects.qk', 'aisle.qk'])).toEqual([
      'usualsuspects.qk',
      'aisle.qk',
      'beverages.qk',
    ]);
  });

  it('does not mutate the input array', () => {
    const input = ['b.qk', 'usualsuspects.qk'];
    orderQuickKeyFiles(input);
    expect(input).toEqual(['b.qk', 'usualsuspects.qk']);
  });
});

describe('resolveQuickKeyDir', () => {
  const fallback = '/bundled/quickkey';

  it('uses the requested dir when it is non-empty', () => {
    expect(resolveQuickKeyDir('/my/custom/dir', fallback)).toBe('/my/custom/dir');
  });

  it('falls back to the bundled dir when requested is empty', () => {
    expect(resolveQuickKeyDir('', fallback)).toBe(fallback);
  });

  it('falls back when requested is whitespace only', () => {
    expect(resolveQuickKeyDir('   ', fallback)).toBe(fallback);
  });

  it('falls back when requested is undefined', () => {
    expect(resolveQuickKeyDir(undefined, fallback)).toBe(fallback);
  });

  it('trims a requested dir with surrounding whitespace', () => {
    expect(resolveQuickKeyDir('  /my/dir  ', fallback)).toBe('/my/dir');
  });
});

describe('quickKeyColor', () => {
  const base = {
    pricebookLoaded: false,
    pricebookCodes: new Set<string>(),
    adCodes: new Set<string>(),
    ageCodes: new Set<string>(),
  };

  it('is green when the upc has an ad trigger', () => {
    expect(quickKeyColor('123', { ...base, adCodes: new Set(['123']) })).toBe('green');
  });

  it('is grey when a pricebook is loaded and the upc is not in it', () => {
    expect(quickKeyColor('123', { ...base, pricebookLoaded: true, pricebookCodes: new Set(['999']) })).toBe('grey');
  });

  it('is normal when no pricebook is loaded (no greying yet)', () => {
    expect(quickKeyColor('123', base)).toBe('normal');
  });

  it('prefers green over grey when the upc has an ad but is not in the pricebook', () => {
    expect(
      quickKeyColor('123', { ...base, pricebookLoaded: true, pricebookCodes: new Set(['999']), adCodes: new Set(['123']) }),
    ).toBe('green');
  });

  it('is orange when the upc is age-restricted', () => {
    expect(quickKeyColor('123', { ...base, ageCodes: new Set(['123']) })).toBe('orange');
  });

  it('prefers orange over a plain ad trigger (legacy checks age first)', () => {
    expect(quickKeyColor('123', { ...base, ageCodes: new Set(['123']), adCodes: new Set(['999']) })).toBe('orange');
  });

  it('is dark-green when the upc is both age-restricted and an ad trigger', () => {
    expect(quickKeyColor('123', { ...base, ageCodes: new Set(['123']), adCodes: new Set(['123']) })).toBe('dark-green');
  });
});

describe('paginate', () => {
  it('splits items into pages of the given size', () => {
    const pages = paginate([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 9);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toHaveLength(9);
    expect(pages[1]).toEqual([10]);
  });

  it('returns a single empty page for no items', () => {
    expect(paginate([], 9)).toEqual([[]]);
  });
});
