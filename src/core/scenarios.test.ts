import { describe, it, expect } from 'vitest';
import { builtinScenarios, scenarioForAd, type ScenarioParams } from './scenarios';

const params: ScenarioParams = {
  itemCode: '049000000443',
  itemCode2: '012000001291',
  loyaltyCard: '70846414251491703',
  upcCoupon12: '012345678905',
  stepGapMs: 750,
};

describe('builtinScenarios', () => {
  it('includes the silent loyalty injection scenario for radiant6 types', () => {
    const s = builtinScenarios(params).find((x) => x.id === 'silent-loyalty-injection');
    expect(s).toBeDefined();
    expect(s!.registerTypes).toContain('radiant6-canada');
    expect(s!.registerTypes).toContain('radiant6-us');
    expect(s!.steps.map((st) => st.kind)).toEqual([
      'scan',
      'wait',
      'loyalty',
      'waitForInject',
      'wait',
      'tender',
    ]);
  });

  it('arrondir scenario is canada-only', () => {
    const s = builtinScenarios(params).find((x) => x.id === 'arrondir-rounding')!;
    expect(s.registerTypes).toEqual(['radiant6-canada']);
  });

  it('upc-as-coupon uses a 12-digit card number', () => {
    const s = builtinScenarios(params).find((x) => x.id === 'upc-as-coupon')!;
    const loy = s.steps.find((st) => st.kind === 'loyalty');
    expect(loy && 'cardNumber' in loy && /^\d{12}$/.test(loy.cardNumber)).toBe(true);
  });

  it('every scenario has a unique id and at least one step', () => {
    const all = builtinScenarios(params);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) expect(s.steps.length).toBeGreaterThan(0);
  });

  it('returns 9 scenarios, each with a name, description and non-empty registerTypes', () => {
    const all = builtinScenarios(params);
    expect(all.length).toBe(9);
    for (const s of all) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.registerTypes.length).toBeGreaterThan(0);
    }
  });

  it('wait steps use the configured step gap', () => {
    const all = builtinScenarios(params);
    for (const s of all) {
      for (const st of s.steps) {
        if (st.kind === 'wait') expect(st.ms).toBe(params.stepGapMs);
      }
    }
  });

  it('fr-ca-sale restores locale en as its last step', () => {
    const s = builtinScenarios(params).find((x) => x.id === 'fr-ca-sale')!;
    const last = s.steps[s.steps.length - 1];
    expect(last).toEqual({ kind: 'setLocale', locale: 'en' });
    expect(s.steps[0]).toEqual({ kind: 'setLocale', locale: 'fr' });
  });

  it('bulloch-full-sale targets only bulloch', () => {
    const s = builtinScenarios(params).find((x) => x.id === 'bulloch-full-sale')!;
    expect(s.registerTypes).toEqual(['bulloch']);
  });

  it('edit-heavy-sale runs on all register types and ends with next-dollar tender', () => {
    const s = builtinScenarios(params).find((x) => x.id === 'edit-heavy-sale')!;
    expect(s.registerTypes).toEqual(['radiant6-canada', 'radiant6-us', 'bulloch']);
    const last = s.steps[s.steps.length - 1];
    expect(last).toMatchObject({ kind: 'tender', tenderKind: 'next-dollar' });
  });

  it('manual-completer waits longer for a cashier tap than the silent scenario', () => {
    const all = builtinScenarios(params);
    const manual = all.find((s) => s.id === 'manual-completer')!;
    const silent = all.find((s) => s.id === 'silent-loyalty-injection')!;
    const manualWait = manual.steps.find((st) => st.kind === 'waitForInject')!;
    const silentWait = silent.steps.find((st) => st.kind === 'waitForInject')!;
    expect(manualWait.kind === 'waitForInject' && silentWait.kind === 'waitForInject').toBe(true);
    if (manualWait.kind === 'waitForInject' && silentWait.kind === 'waitForInject') {
      expect(manualWait.timeoutMs).toBeGreaterThan(silentWait.timeoutMs);
    }
  });

  it('suspend-resume suspends before resuming', () => {
    const s = builtinScenarios(params).find((x) => x.id === 'suspend-resume')!;
    const kinds = s.steps.map((st) => st.kind);
    expect(kinds.indexOf('suspend')).toBeGreaterThan(-1);
    expect(kinds.indexOf('suspend')).toBeLessThan(kinds.indexOf('resume'));
  });
});

describe('scenarioForAd', () => {
  const ad = {
    id: '42',
    name: 'Deal',
    template: 'Basket Offer',
    triggers: [{ code: '111', description: 'Trigger Item' }],
    completers: [{ code: '999' }],
    completerConditionTypes: ['injectItem'],
    silentCapable: true,
  };

  it('builds scan → loyalty → waitForInject(completer codes) → tender', () => {
    const s = scenarioForAd(ad, params)!;
    expect(s.steps[0]).toMatchObject({ kind: 'scan', code: '111' });
    const w = s.steps.find((st) => st.kind === 'waitForInject');
    expect(w).toMatchObject({ expectCodes: ['999'] });
  });

  it('returns null when the ad has no triggers', () => {
    expect(scenarioForAd({ ...ad, triggers: [] }, params)).toBeNull();
  });

  it('derives id and name from the ad', () => {
    const s = scenarioForAd(ad, params)!;
    expect(s.id).toBe('ad-42');
    expect(s.name).toBe('Ad: Deal');
    expect(s.registerTypes).toEqual(['radiant6-canada', 'radiant6-us']);
  });

  it('carries the trigger description onto the scan step', () => {
    const s = scenarioForAd(ad, params)!;
    expect(s.steps[0]).toMatchObject({ kind: 'scan', description: 'Trigger Item' });
  });

  it('omits description from the scan step and falls back to the code when the trigger has none', () => {
    const s = scenarioForAd({ ...ad, triggers: [{ code: '111' }] }, params)!;
    expect(s.steps[0].kind).toBe('scan');
    expect('description' in s.steps[0]).toBe(false);
    expect(s.description).toContain('"111"');
  });

  it('omits expectCodes entirely when the ad has no completers', () => {
    const s = scenarioForAd({ ...ad, completers: [] }, params)!;
    const w = s.steps.find((st) => st.kind === 'waitForInject')!;
    expect(w.kind).toBe('waitForInject');
    expect('expectCodes' in w).toBe(false);
  });

  it('ends with a cash-exact tender after a gap', () => {
    const s = scenarioForAd(ad, params)!;
    const kinds = s.steps.map((st) => st.kind);
    expect(kinds).toEqual(['scan', 'wait', 'loyalty', 'waitForInject', 'wait', 'tender']);
    const last = s.steps[s.steps.length - 1];
    expect(last).toMatchObject({ kind: 'tender', tenderKind: 'cash-exact' });
  });
});
