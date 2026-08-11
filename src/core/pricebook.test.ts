import { describe, it, expect } from 'vitest';
import {
  parsePricebook,
  parsePdiPricebook,
  parsePricebookXml,
  buildPricebookIndex,
  loadPricebookIndex,
  resolvePricebookFilename,
  resolvePricebookDir,
  resolveScan,
  pickQuickKeys,
} from './pricebook';

const PDI_XML = `<?xml version="1.0" encoding="utf-8"?>
<NAXML-MaintenanceRequest version="3.6" xmlns="http://www.naxml.org/POSBO/Vocabulary/2003-10-16">
  <TransmissionHeader><VendorName>PDI</VendorName></TransmissionHeader>
  <ItemMaintenance>
    <ITTDetail>
      <ItemCode><POSCode>028200009654</POSCode><POSCodeModifier value="0" /></ItemCode>
      <ITTData><Description>Marlboro 72 GLD BX KG</Description><RegularSellPrice value="1">5.99</RegularSellPrice></ITTData>
    </ITTDetail>
    <ITTDetail>
      <ItemCode><POSCode>049000000443</POSCode><POSCodeModifier value="0" /></ItemCode>
      <ITTData><Description>Coke 20oz</Description><RegularSellPrice>2.29</RegularSellPrice></ITTData>
    </ITTDetail>
  </ItemMaintenance>
</NAXML-MaintenanceRequest>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<OCT2000-IMPORT siteno="31989">
<DRY action="Update"><NLU-NO>1032331</NLU-NO><NLU-TEXT>COKE</NLU-TEXT><NLU-TEXT-LONG>Coke 20oz</NLU-TEXT-LONG><PRICE>229</PRICE><BARC action="Update"><NLU-NO>1032331</NLU-NO><BARCODE>049000000443</BARCODE><PRICE>999</PRICE></BARC><BARC><BARCODE>049000000444</BARCODE></BARC></DRY>
<DRY action="Update"><NLU-NO>2000</NLU-NO><NLU-TEXT-LONG>Chips</NLU-TEXT-LONG><PRICE>319</PRICE><BARC><BARCODE>012000001291</BARCODE></BARC></DRY>
</OCT2000-IMPORT>`;

describe('parsePricebook', () => {
  it('parses DRY articles with plu, description, cents price and barcodes', () => {
    const entries = parsePricebook(XML);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      plu: '1032331',
      description: 'Coke 20oz',
      priceCents: 229, // article PRICE, NOT the nested BARC PRICE (999)
      barcodes: ['049000000443', '049000000444'],
    });
    expect(entries[1].description).toBe('Chips');
    expect(entries[1].priceCents).toBe(319);
  });

  it('returns no entries for content without DRY articles', () => {
    expect(parsePricebook('<OCT2000-IMPORT><CMPGN><CAMPAIGN-ID>1</CAMPAIGN-ID></CMPGN></OCT2000-IMPORT>')).toEqual([]);
  });
});

describe('buildPricebookIndex / loadPricebookIndex', () => {
  it('indexes by every barcode and by PLU', () => {
    const index = loadPricebookIndex(XML);
    expect(index.get('049000000443')).toMatchObject({ description: 'Coke 20oz', priceCents: 229, plu: '1032331' });
    expect(index.get('049000000444')?.description).toBe('Coke 20oz');
    expect(index.get('1032331')?.code).toBe('1032331');
    expect(index.get('012000001291')?.description).toBe('Chips');
    expect(index.get('nope')).toBeUndefined();
  });

  it('buildPricebookIndex stamps the looked-up code onto each entry', () => {
    const index = buildPricebookIndex(parsePricebook(XML));
    expect(index.get('049000000443')?.code).toBe('049000000443');
  });
});

describe('resolvePricebookFilename', () => {
  const files = ['31989-1706723713125.xml', '31989-1700000000000.xml', '40000-1.xml', 'notes.txt'];

  it('matches the player/site code and prefers the most recent', () => {
    expect(resolvePricebookFilename(files, '31989')).toBe('31989-1706723713125.xml');
  });

  it('matches a different code', () => {
    expect(resolvePricebookFilename(files, '40000')).toBe('40000-1.xml');
  });

  it('falls back to exact <code>.xml', () => {
    expect(resolvePricebookFilename(['31989.xml'], '31989')).toBe('31989.xml');
  });

  it('returns null for no match or empty code', () => {
    expect(resolvePricebookFilename(files, '99999')).toBeNull();
    expect(resolvePricebookFilename(files, '')).toBeNull();
  });

  it('still prefers a code match over the first-xml fallback', () => {
    expect(resolvePricebookFilename(files, '40000', { fallbackToFirst: true })).toBe('40000-1.xml');
  });

  it('falls back to the first .xml when no code matches and fallbackToFirst is set', () => {
    expect(resolvePricebookFilename(['sample.xml', 'zzz.xml', 'notes.txt'], '99999', { fallbackToFirst: true })).toBe(
      'sample.xml',
    );
  });

  it('falls back to the first .xml with an empty code when fallbackToFirst is set', () => {
    expect(resolvePricebookFilename(['sample.xml'], '', { fallbackToFirst: true })).toBe('sample.xml');
  });

  it('returns null with fallbackToFirst when there are no .xml files', () => {
    expect(resolvePricebookFilename(['notes.txt'], '', { fallbackToFirst: true })).toBeNull();
  });
});

describe('resolvePricebookDir', () => {
  const fallback = '/bundled/pricebook';

  it('uses the requested dir when it is non-empty', () => {
    expect(resolvePricebookDir('/my/dir', fallback)).toBe('/my/dir');
  });

  it('falls back to the bundled dir when requested is empty, whitespace, or undefined', () => {
    expect(resolvePricebookDir('', fallback)).toBe(fallback);
    expect(resolvePricebookDir('   ', fallback)).toBe(fallback);
    expect(resolvePricebookDir(undefined, fallback)).toBe(fallback);
  });

  it('trims a requested dir', () => {
    expect(resolvePricebookDir('  /my/dir  ', fallback)).toBe('/my/dir');
  });
});

describe('resolveScan', () => {
  const hit = { description: 'Coke 20oz', priceCents: 229 };

  it('explicit description and price win over the pricebook hit', () => {
    expect(resolveScan(hit, '105', 'PREPAY CA #02', 100)).toEqual({
      code: '105',
      description: 'PREPAY CA #02',
      priceCents: 100,
    });
  });

  it('the pricebook hit fills in whatever the caller left out', () => {
    expect(resolveScan(hit, '049000000443')).toEqual({
      code: '049000000443',
      description: 'Coke 20oz',
      priceCents: 229,
    });
    expect(resolveScan(hit, '049000000443', undefined, 150)).toEqual({
      code: '049000000443',
      description: 'Coke 20oz',
      priceCents: 150,
    });
  });

  it('blank explicit description falls through to the hit, then to UPC <code>', () => {
    expect(resolveScan(hit, '1', '  ').description).toBe('Coke 20oz');
    expect(resolveScan(undefined, '42', '  ')).toEqual({ code: '42', description: 'UPC 42', priceCents: 100 });
  });

  it('unknown item with no explicit values defaults to UPC <code> at $1.00', () => {
    expect(resolveScan(undefined, '999')).toEqual({ code: '999', description: 'UPC 999', priceCents: 100 });
  });
});

describe('pickQuickKeys', () => {
  it('selects items with barcode + description + price, up to the limit', () => {
    const entries = parsePricebook(XML);
    const keys = pickQuickKeys(entries);
    expect(keys).toEqual([
      { code: '049000000443', description: 'Coke 20oz', priceCents: 229 },
      { code: '012000001291', description: 'Chips', priceCents: 319 },
    ]);
  });

  it('respects the limit', () => {
    expect(pickQuickKeys(parsePricebook(XML), 1)).toHaveLength(1);
  });
});

describe('parsePdiPricebook', () => {
  it('extracts POS code, description and dollar price (→ cents) per ITTDetail', () => {
    expect(parsePdiPricebook(PDI_XML)).toEqual([
      { plu: '028200009654', description: 'Marlboro 72 GLD BX KG', priceCents: 599, barcodes: ['028200009654'] },
      { plu: '049000000443', description: 'Coke 20oz', priceCents: 229, barcodes: ['049000000443'] },
    ]);
  });

  it('reads RegularSellPrice whether or not it carries attributes', () => {
    const [withAttr, withoutAttr] = parsePdiPricebook(PDI_XML);
    expect(withAttr.priceCents).toBe(599); // <RegularSellPrice value="1">5.99</…>
    expect(withoutAttr.priceCents).toBe(229); // <RegularSellPrice>2.29</…>
  });

  it('falls back to the POS code when an item has no description', () => {
    const xml = '<ITTDetail><ItemCode><POSCode>111</POSCode></ItemCode><ITTData><RegularSellPrice>1.00</RegularSellPrice></ITTData></ITTDetail>';
    expect(parsePdiPricebook(xml)).toEqual([{ plu: '111', description: '111', priceCents: 100, barcodes: ['111'] }]);
  });

  it('skips ITTDetail entries with no POS code', () => {
    const xml = '<ITTDetail><ITTData><Description>Orphan</Description></ITTData></ITTDetail>';
    expect(parsePdiPricebook(xml)).toEqual([]);
  });
});

describe('parsePricebookXml (dialect dispatch)', () => {
  it('routes NAXML/PDI to the PDI parser', () => {
    expect(parsePricebookXml(PDI_XML)).toHaveLength(2);
    expect(parsePricebookXml(PDI_XML)[0].description).toBe('Marlboro 72 GLD BX KG');
  });

  it('routes OCT2000 (<DRY>) to the legacy parser', () => {
    const oct = parsePricebookXml(XML);
    expect(oct).toEqual(parsePricebook(XML));
    expect(oct.length).toBeGreaterThan(0);
  });
});
