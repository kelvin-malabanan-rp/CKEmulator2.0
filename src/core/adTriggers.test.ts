import { describe, it, expect } from 'vitest';
import {
  extractTriggersCompleters,
  findAnyCompleter,
  findPrepayItem,
  isLegitimateAd,
  orderAds,
  isInteractiveTemplate,
  type AdItem,
  type AdTriggersCompleters,
} from './adTriggers';

describe('extractTriggersCompleters', () => {
  it('pulls trigger UPCs from adtriggerconditions[].items (string UPCs)', () => {
    const r = extractTriggersCompleters({
      id: 42,
      name: '7up points club test',
      adtriggers: [{ adtriggerconditions: [{ items: ['028200009654', '012000001291'] }] }],
    });
    expect(r.name).toBe('7up points club test');
    expect(r.triggers.map((t) => t.code)).toEqual(['028200009654', '012000001291']);
  });

  it('pulls completer items (objects with code + description)', () => {
    const r = extractTriggersCompleters({
      id: 1,
      name: 'Combo',
      adcompleters: [
        { completercode: 'Completer 1', items: [{ code: '049000050110', description: 'Diet Coke 2lt' }] },
      ],
    });
    expect(r.completers).toEqual([{ code: '049000050110', description: 'Diet Coke 2lt' }]);
  });

  it('reads item codes from condition upc / itemcode / couponupc with descriptions', () => {
    const r = extractTriggersCompleters({
      name: 'CouponAd',
      adcompleters: [
        {
          adcompleterconditions: [
            { upc: '111', itemdescription: 'Thing' },
            { itemcode: '222', description: 'Other' },
            { couponupc: '95365' },
          ],
        },
      ],
    });
    expect(r.completers).toEqual([
      { code: '111', description: 'Thing' },
      { code: '222', description: 'Other' },
      { code: '95365' },
    ]);
  });

  it('dedupes by code and backfills a missing description', () => {
    const r = extractTriggersCompleters({
      name: 'Dup',
      adtriggers: [
        { items: ['123'], adtriggerconditions: [{ upc: '123', itemdescription: 'Coke' }] },
      ],
    });
    expect(r.triggers).toEqual([{ code: '123', description: 'Coke' }]);
  });

  it('falls back to id then a placeholder when name is missing', () => {
    expect(extractTriggersCompleters({ id: 7 }).name).toBe('7');
    expect(extractTriggersCompleters({}).name).toBe('(unnamed ad)');
  });

  it('returns empty arrays for an ad with no triggers/completers', () => {
    const r = extractTriggersCompleters({ id: 1, name: 'Plain' });
    expect(r.triggers).toEqual([]);
    expect(r.completers).toEqual([]);
  });

  it('surfaces the template name', () => {
    expect(extractTriggersCompleters({ id: 1, name: 'X', templatename: 'Basket Offer' }).template).toBe('Basket Offer');
    expect(extractTriggersCompleters({ id: 2, name: 'Y' }).template).toBe('');
  });
});

describe('isInteractiveTemplate', () => {
  it('is false for Static Image Or Video and empty/unknown', () => {
    expect(isInteractiveTemplate('Static Image Or Video')).toBe(false);
    expect(isInteractiveTemplate('static image or video')).toBe(false);
    expect(isInteractiveTemplate('')).toBe(false);
    expect(isInteractiveTemplate(undefined)).toBe(false);
  });

  it('is true for microsite templates', () => {
    expect(isInteractiveTemplate('Basket Offer')).toBe(true);
    expect(isInteractiveTemplate('2 Or 3 For')).toBe(true);
    expect(isInteractiveTemplate('Combo')).toBe(true);
  });
});

describe('completer condition types', () => {
  it('collects conditiontype values from completer conditions', () => {
    const out = extractTriggersCompleters({
      id: 1,
      name: 'Silent Deal',
      adcompleters: [
        { adcompleterconditions: [{ conditiontype: 'injectItem', itemcode: '111' }] },
        { adcompleterconditions: [{ conditiontype: 'xFor', items: ['222'] }] },
      ],
    });
    expect(out.completerConditionTypes).toEqual(['injectItem', 'xFor']);
    expect(out.silentCapable).toBe(true);
  });

  it('silentCapable is true for addDiscount, false otherwise', () => {
    const mk = (t: string): boolean =>
      extractTriggersCompleters({
        id: 2,
        adcompleters: [{ adcompleterconditions: [{ conditiontype: t, itemcode: '1' }] }],
      }).silentCapable;
    expect(mk('addDiscount')).toBe(true);
    expect(mk('addItem')).toBe(false);
    expect(mk('completePromo')).toBe(false);
  });

  it('handles ads with no completers', () => {
    const out = extractTriggersCompleters({ id: 3, name: 'x' });
    expect(out.completerConditionTypes).toEqual([]);
    expect(out.silentCapable).toBe(false);
  });
});

describe('isLegitimateAd', () => {
  it('returns true for ads with a real template', () => {
    expect(isLegitimateAd({ id: 1, name: 'Combo Deal', templatename: 'Basket Offer' })).toBe(true);
    expect(isLegitimateAd({ id: 2, name: 'Walkup', templatename: 'Static Image Or Video' })).toBe(true);
    expect(isLegitimateAd({ id: 3, name: '2 For $5', templatename: '2 Or 3 For' })).toBe(true);
  });

  it('returns false for config entries (templatename ends with "Config")', () => {
    expect(isLegitimateAd({ id: 10, name: 'Beat the Target', templatename: 'Beat The Target Config' })).toBe(false);
    expect(isLegitimateAd({ id: 11, name: 'Top 5 Promos', templatename: 'Top 5 Promos Config' })).toBe(false);
    expect(isLegitimateAd({ id: 12, name: 'Multi-Location', templatename: 'Beat The Target Config Multi-Location Config' })).toBe(false);
  });

  it('returns false for entries with no/empty templatename', () => {
    expect(isLegitimateAd({ id: 20, name: 'NoTemplate' })).toBe(false);
    expect(isLegitimateAd({ id: 21, name: 'Empty', templatename: '' })).toBe(false);
    expect(isLegitimateAd({ id: 22, name: 'Spaces', templatename: '   ' })).toBe(false);
  });
});

describe('findPrepayItem', () => {
  const ad = (id: string, triggers: AdItem[], completers: AdItem[] = []): AdTriggersCompleters => ({
    id,
    name: `ad ${id}`,
    template: 'Basket Offer',
    triggers,
    completers,
    completerConditionTypes: [],
    silentCapable: false,
  });

  it('finds the first item whose description mentions prepay (case-insensitive)', () => {
    const ads = [
      ad('1', [{ code: '028200009654', description: 'MARLBORO GOLD' }]),
      ad('2', [{ code: '000000000105', description: 'Prepay CA #02' }]),
    ];
    expect(findPrepayItem(ads)).toEqual({ code: '000000000105', description: 'Prepay CA #02' });
  });

  it('checks completers too, after that ad\'s triggers', () => {
    const ads = [ad('1', [{ code: '1', description: 'COKE 500ML' }], [{ code: '9', description: 'FUEL PREPAY' }])];
    expect(findPrepayItem(ads)).toEqual({ code: '9', description: 'FUEL PREPAY' });
  });

  it('surfaces the prepay ad\'s first completer (excluding the prepay item itself)', () => {
    const ads = [
      ad(
        '1',
        [{ code: '000000000105', description: 'PREPAY CA #02' }],
        [
          { code: '000000000105', description: 'PREPAY CA #02' },
          { code: '049000000443', description: 'Coke 20oz' },
        ],
      ),
    ];
    expect(findPrepayItem(ads)).toEqual({
      code: '000000000105',
      description: 'PREPAY CA #02',
      completer: { code: '049000000443', description: 'Coke 20oz' },
    });
  });

  it('omits the completer when the ad has none besides the prepay item', () => {
    const ads = [ad('1', [{ code: '105', description: 'FUEL PREPAY' }], [{ code: '105', description: 'FUEL PREPAY' }])];
    expect(findPrepayItem(ads)).toEqual({ code: '105', description: 'FUEL PREPAY' });
  });

  it('skips items with no description and returns null when nothing matches', () => {
    expect(findPrepayItem([ad('1', [{ code: '000000000105' }, { code: '2', description: 'PEPSI' }])])).toBeNull();
    expect(findPrepayItem([])).toBeNull();
  });
});

describe('findAnyCompleter', () => {
  const ad = (id: string, completers: AdItem[]): AdTriggersCompleters => ({
    id,
    name: `ad ${id}`,
    template: 'Basket Offer',
    triggers: [],
    completers,
    completerConditionTypes: [],
    silentCapable: false,
  });

  it('returns the first completer across the loaded ads', () => {
    const ads = [ad('1', []), ad('2', [{ code: '049000000443', description: 'Coke 20oz' }, { code: '2' }])];
    expect(findAnyCompleter(ads)).toEqual({ code: '049000000443', description: 'Coke 20oz' });
  });

  it('skips the excluded code (the prepay item itself)', () => {
    const ads = [ad('1', [{ code: '105', description: 'PREPAY CA #02' }, { code: '9', description: 'Water' }])];
    expect(findAnyCompleter(ads, '105')).toEqual({ code: '9', description: 'Water' });
  });

  it('returns null when no ad has a usable completer', () => {
    expect(findAnyCompleter([ad('1', [])])).toBeNull();
    expect(findAnyCompleter([ad('1', [{ code: '105' }])], '105')).toBeNull();
    expect(findAnyCompleter([])).toBeNull();
  });
});

describe('orderAds', () => {
  it('sorts by name case-insensitively without mutating input', () => {
    const input: AdTriggersCompleters[] = [
      { id: '2', name: 'ckmw Amp', triggers: [], completers: [] },
      { id: '1', name: '7up points', triggers: [], completers: [] },
      { id: '3', name: 'Cashew', triggers: [], completers: [] },
    ];
    expect(orderAds(input).map((a) => a.name)).toEqual(['7up points', 'Cashew', 'ckmw Amp']);
    expect(input[0].name).toBe('ckmw Amp'); // original order preserved
  });
});
