import { describe, it, expect } from 'vitest';
import { builtinScenarios, describeStep, scenarioForAd, type ScenarioParams } from './scenarios';

const params: ScenarioParams = {
  itemCode: '049000000443',
  itemCode2: '012000001291',
  loyaltyCard: '70846414251491703',
  upcCoupon12: '012345678905',
  stepGapMs: 750,
  prepayPumpNumber: 7,
  prepayAmountCents: 2500,
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

  it('age-restricted scenario scans a 21+ item then a normal item (radiant6 only)', () => {
    const s = builtinScenarios(params).find((x) => x.id === 'age-restricted-item')!;
    expect(s.registerTypes).toEqual(['radiant6-canada', 'radiant6-us']);
    const scans = s.steps.filter((st) => st.kind === 'scan');
    expect(scans[0]).toMatchObject({ code: params.itemCode, minAge: 21 });
    expect('minAge' in scans[1]).toBe(false); // the follow-up item is unrestricted
  });

  it('returns 13 scenarios, each with a name, description and non-empty registerTypes', () => {
    const all = builtinScenarios(params);
    expect(all.length).toBe(13);
    for (const s of all) {
      expect(s.name.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.registerTypes.length).toBeGreaterThan(0);
    }
  });

  it('wait steps use the configured step gap (demo-recording paces itself)', () => {
    const all = builtinScenarios(params);
    for (const s of all) {
      if (s.id === 'demo-recording') continue;
      for (const st of s.steps) {
        if (st.kind === 'wait') expect(st.ms).toBe(params.stepGapMs);
      }
    }
  });

  it('demo-recording follows the Verifone Topaz demo script scene order', () => {
    const s = builtinScenarios(params).find((x) => x.id === 'demo-recording')!;
    expect(s.registerTypes).toEqual(['verifone-topaz']);
    expect(s.steps.map((st) => st.kind)).toEqual([
      // Scene 1 — the transaction comes alive (attract dwell + three scans)
      'wait',
      'scan',
      'wait',
      'scan',
      'wait',
      'scan',
      'wait',
      // Scene 2 — cashier corrections: void duplicate, override, inline re-add, fuel prepay
      'voidLine', // duplicate first — desc-matched Topaz voids must not eat the override
      'wait',
      'setPrice',
      'wait',
      'scan', // another unit of item 2 — rings as its own line (inline, no qty bump)
      'wait',
      'scan', // fuel prepay — an ITEM whose # description routes to the fuel branch
      'wait',
      // Scene 3 — no ads loaded means no completer to auto-inject: the demo
      // must never stall on a wait that can't be satisfied, so payment follows.
      'tender',
      'wait', // goodbye linger
    ]);
    // Corrections: void the duplicate line 3 BEFORE overriding line 1 (Topaz
    // desc-matched voids would otherwise eat the override's re-rung line), and
    // the "more of the same item" beat re-scans item 2 so it rings inline.
    expect(s.steps.find((st) => st.kind === 'setPrice')).toMatchObject({ lineNumber: 1 });
    expect(s.steps.find((st) => st.kind === 'voidLine')).toMatchObject({ lineNumber: 3 });
    const kinds = s.steps.map((st) => st.kind);
    expect(kinds.indexOf('voidLine')).toBeLessThan(kinds.indexOf('setPrice'));
    const scans = s.steps.filter((st) => st.kind === 'scan');
    expect(scans[3]).toEqual(scans[1]); // same item as scan #2, new line
    // Without a real prepay item loaded from the ads, the prepay rings as an
    // uncoded ITEM whose synthetic description carries the pump # from params.
    expect(scans[4]).toEqual({ kind: 'scan', code: '', description: 'PREPAY CA #07', priceCents: 2500 });
    // Fixed camera pacing, independent of the user-tunable stepGapMs.
    for (const st of s.steps) {
      if (st.kind === 'wait') expect(st.ms).toBeGreaterThanOrEqual(2500);
    }
    // Ends on a lingering wait so the goodbye screen survives the recording cut.
    expect(s.steps[s.steps.length - 1].kind).toBe('wait');
  });

  it('demo-recording auto-injects the ads-list completer when one is provided', () => {
    const withCompleter: ScenarioParams = {
      ...params,
      prepayItem: { code: '000000000105', description: 'PREPAY CA #02' },
      demoCompleter: { code: '049000000443', description: 'Coke 20oz' },
    };
    const s = builtinScenarios(withCompleter).find((x) => x.id === 'demo-recording')!;
    // Scene 3's manual shopper-screen tap is replaced by a direct scan of the
    // completer — the ad never renders on the shopper screen, so no tap can come.
    expect(s.steps.some((st) => st.kind === 'waitForInject')).toBe(false);
    const scans = s.steps.filter((st) => st.kind === 'scan');
    expect(scans[scans.length - 1]).toEqual({ kind: 'scan', code: '049000000443', description: 'Coke 20oz' });
    // The completer scan slots where the inject wait was: after the prepay, before tender.
    const kinds = s.steps.map((st) => st.kind);
    expect(kinds.indexOf('tender')).toBeGreaterThan(kinds.lastIndexOf('scan'));
    expect(s.description).toContain('auto-inject');
  });

  it('demo-recording auto-injects even without a prepay item (any ad completer)', () => {
    const s = builtinScenarios({ ...params, demoCompleter: { code: '111' } }).find(
      (x) => x.id === 'demo-recording',
    )!;
    expect(s.steps.some((st) => st.kind === 'waitForInject')).toBe(false);
    const scans = s.steps.filter((st) => st.kind === 'scan');
    expect(scans[scans.length - 1]).toEqual({ kind: 'scan', code: '111' });
  });

  it('demo-recording rings the real prepay item from the ads list when provided', () => {
    const withItem: ScenarioParams = {
      ...params,
      prepayItem: { code: '000000000105', description: 'PREPAY CA #02' },
    };
    const s = builtinScenarios(withItem).find((x) => x.id === 'demo-recording')!;
    const scans = s.steps.filter((st) => st.kind === 'scan');
    // Real code + description from the ad item; the amount still comes from params.
    expect(scans[4]).toEqual({
      kind: 'scan',
      code: '000000000105',
      description: 'PREPAY CA #02',
      priceCents: 2500,
    });
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
    expect(s.registerTypes).toEqual(['radiant6-canada', 'radiant6-us', 'bulloch', 'verifone-topaz', 'octane']);
    const last = s.steps[s.steps.length - 1];
    expect(last).toMatchObject({ kind: 'tender', tenderKind: 'next-dollar' });
  });

  it('journal-driven scenarios run on verifone-topaz', () => {
    const all = builtinScenarios(params);
    for (const id of ['loyalty-signin', 'edit-heavy-sale', 'suspend-resume']) {
      const s = all.find((x) => x.id === id)!;
      expect(s.registerTypes, id).toContain('verifone-topaz');
    }
  });

  it('EventId-dependent and lane-specific scenarios stay off verifone-topaz', () => {
    // Topaz is plaintext-only: no EventId 1024 loyalty (upc-as-coupon) and no
    // EventId 2001 inject reverse-channel (silent/manual completer), no fr-CA,
    // no arrondir, no Bulloch protocol.
    const all = builtinScenarios(params);
    for (const id of [
      'silent-loyalty-injection',
      'manual-completer',
      'upc-as-coupon',
      'arrondir-rounding',
      'fr-ca-sale',
      'bulloch-full-sale',
    ]) {
      const s = all.find((x) => x.id === id)!;
      expect(s.registerTypes, id).not.toContain('verifone-topaz');
    }
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

describe('describeStep', () => {
  it('includes the payload so equal-looking steps are distinguishable', () => {
    expect(describeStep({ kind: 'loyalty', cardNumber: '70846414251491703' })).toBe('loyalty 70846414251491703');
    expect(describeStep({ kind: 'loyalty', cardNumber: '012345678905' })).toBe('loyalty 012345678905');
    expect(describeStep({ kind: 'scan', code: '028200009654' })).toBe('scan 028200009654');
    expect(describeStep({ kind: 'scan', code: 'BEER', minAge: 21 })).toBe('scan BEER (21+)');
    expect(describeStep({ kind: 'wait', ms: 750 })).toBe('wait 750ms');
    expect(describeStep({ kind: 'tender', tenderKind: 'cash-exact' })).toBe('tender cash-exact');
    expect(describeStep({ kind: 'tender', tenderKind: 'amount', amountCents: 500 })).toBe('tender amount 5.00');
  });

  it('summarizes waitForInject with and without expected codes', () => {
    expect(describeStep({ kind: 'waitForInject', timeoutMs: 15000 })).toBe('waitForInject ≤15s');
    expect(describeStep({ kind: 'waitForInject', timeoutMs: 60000, expectCodes: ['999', '111'] })).toBe(
      'waitForInject ≤60s (999, 111)',
    );
  });

  it('covers line edits and bare kinds', () => {
    expect(describeStep({ kind: 'voidLine', lineNumber: 2 })).toBe('voidLine #2');
    expect(describeStep({ kind: 'setQuantity', lineNumber: 1, quantity: 3 })).toBe('setQuantity #1 ×3');
    expect(describeStep({ kind: 'setPrice', lineNumber: 2, priceCents: 149 })).toBe('setPrice #2 → 1.49');
    expect(describeStep({ kind: 'scan', code: '', description: 'PREPAY CA #05' })).toBe('scan PREPAY CA #05');
    expect(describeStep({ kind: 'setLocale', locale: 'fr' })).toBe('setLocale fr');
    expect(describeStep({ kind: 'suspend' })).toBe('suspend');
    expect(describeStep({ kind: 'resume' })).toBe('resume');
    expect(describeStep({ kind: 'voidTicket' })).toBe('voidTicket');
    expect(describeStep({ kind: 'expect', check: 'lineCount', value: 1 })).toBe('expect lineCount = 1');
  });
});
