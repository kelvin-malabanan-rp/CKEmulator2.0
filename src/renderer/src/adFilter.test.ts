import { describe, it, expect } from 'vitest';
import { filterAds, matchesAd } from './adFilter';
import type { AdTriggersCompleters } from '../../core/adTriggers';

const TEST_AD_1 = { id: '2023788', name: 'Test Ad 1' };
const COFFEE = { id: '1001', name: 'Coffee Deal' };

const detail = (id: string, trigger: string, completer: string): AdTriggersCompleters => ({
  id,
  name: '',
  template: 'Basket Offer',
  triggers: [{ code: trigger }],
  completers: [{ code: completer }],
  completerConditionTypes: [],
  silentCapable: false,
});

describe('matchesAd', () => {
  it('matches everything on an empty or blank query', () => {
    expect(matchesAd(TEST_AD_1, undefined, '')).toBe(true);
    expect(matchesAd(TEST_AD_1, undefined, '   ')).toBe(true);
  });

  it('matches name case-insensitively and by id', () => {
    expect(matchesAd(TEST_AD_1, undefined, 'test ad')).toBe(true);
    expect(matchesAd(TEST_AD_1, undefined, '2023788')).toBe(true);
    expect(matchesAd(COFFEE, undefined, 'test')).toBe(false);
  });

  it('matches trigger and completer UPCs only once details have loaded', () => {
    const d = detail('2023788', '8710622513117', '5000112637922');
    expect(matchesAd(TEST_AD_1, undefined, '8710622513117')).toBe(false);
    expect(matchesAd(TEST_AD_1, d, '8710622513117')).toBe(true);
    expect(matchesAd(TEST_AD_1, d, '500011263')).toBe(true);
  });
});

describe('filterAds', () => {
  it('keeps manifest order', () => {
    const ads = [COFFEE, TEST_AD_1, { id: '3', name: 'Coffee Two' }];
    expect(filterAds(ads, {}, 'coffee').map((a) => a.id)).toEqual(['1001', '3']);
  });
});
