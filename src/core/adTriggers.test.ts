import { describe, it, expect } from 'vitest';
import {
  extractTriggersCompleters,
  orderAds,
  isInteractiveTemplate,
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
