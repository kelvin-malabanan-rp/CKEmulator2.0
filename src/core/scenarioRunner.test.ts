import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScenarioRunner, type ScenarioActions, type StepResult } from './scenarioRunner';
import type { Scenario } from './scenarios';
import type { SessionSnapshot } from './RegisterSession';

function fakeActions(): ScenarioActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    scan: (c, _d, _p, minAge) => calls.push(`scan:${c}${minAge !== undefined ? `:${minAge}+` : ''}`),
    loyalty: (n) => calls.push(`loyalty:${n}`),
    tender: (k) => calls.push(`tender:${k}`),
    voidLine: (n) => calls.push(`voidLine:${n}`),
    setQuantity: (n, q) => calls.push(`qty:${n}:${q}`),
    setPrice: (n, p) => calls.push(`price:${n}:${p}`),
    voidTicket: () => calls.push('voidTicket'),
    suspend: () => calls.push('suspend'),
    resume: () => calls.push('resume'),
    setLocale: (l) => calls.push(`locale:${l}`),
    snapshot: () => ({ lines: [], totalCents: 0 }) as never,
  };
}

function scenario(steps: Scenario['steps']): Scenario {
  return {
    id: 'test',
    name: 'Test',
    description: 'Test scenario',
    registerTypes: ['radiant6-canada'],
    steps,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ScenarioRunner', () => {
  it('runs action steps in order and reports ok', async () => {
    const actions = fakeActions();
    const r = new ScenarioRunner(actions);
    const result = await r.run(
      scenario([
        { kind: 'scan', code: '049000000443' },
        { kind: 'loyalty', cardNumber: '70846414251491703' },
      ]),
    );
    expect(actions.calls).toEqual(['scan:049000000443', 'loyalty:70846414251491703']);
    expect(result.verdict).toBe('pass');
    expect(result.steps.map((s) => s.status)).toEqual(['ok', 'ok']);
  });

  it('passes a scan step price through to the scan action (uncoded prepay items)', async () => {
    const calls: Array<[string, string | undefined, number | undefined]> = [];
    const actions = { ...fakeActions(), scan: (c: string, d?: string, p?: number) => calls.push([c, d, p]) };
    const r = new ScenarioRunner(actions);
    const result = await r.run(
      scenario([{ kind: 'scan', code: '', description: 'PREPAY CA #05', priceCents: 3000 }]),
    );
    expect(calls).toEqual([['', 'PREPAY CA #05', 3000]]);
    expect(result.verdict).toBe('pass');
  });

  it('passes a scan step minAge through to the scan action (age-restricted items)', async () => {
    const actions = fakeActions();
    const r = new ScenarioRunner(actions);
    const result = await r.run(
      scenario([
        { kind: 'scan', code: 'BEER', minAge: 21 },
        { kind: 'scan', code: 'COKE' },
      ]),
    );
    expect(actions.calls).toEqual(['scan:BEER:21+', 'scan:COKE']);
    expect(result.verdict).toBe('pass');
  });

  it('waitForInject resolves when a matching inject arrives', async () => {
    const actions = fakeActions();
    const r = new ScenarioRunner(actions);
    const promise = r.run(
      scenario([{ kind: 'waitForInject', timeoutMs: 15_000, expectCodes: ['999'] }]),
    );
    await Promise.resolve();
    r.notifyInject({ barcode: '999', quantity: 1 });
    const result = await promise;
    expect(result.verdict).toBe('pass');
    expect(result.steps[0].status).toBe('ok');
  });

  it('waitForInject ignores non-matching codes and fails on timeout', async () => {
    vi.useFakeTimers();
    const actions = fakeActions();
    const r = new ScenarioRunner(actions);
    const promise = r.run(
      scenario([
        { kind: 'waitForInject', timeoutMs: 50, expectCodes: ['999'] },
        { kind: 'scan', code: '049000000443' },
      ]),
    );
    await vi.advanceTimersByTimeAsync(0);
    r.notifyInject({ barcode: '111', quantity: 1 });
    await vi.advanceTimersByTimeAsync(60);
    const result = await promise;
    expect(result.verdict).toBe('fail');
    expect(result.steps[0].status).toBe('fail');
    expect(result.steps[0].detail).toContain('timeout after 50ms');
    expect(result.steps[0].detail).toContain('111');
    expect(result.steps[1].status).toBe('skipped');
    expect(actions.calls).toEqual([]);
  });

  it('waitForInject with no expectCodes accepts any inject', async () => {
    const actions = fakeActions();
    const r = new ScenarioRunner(actions);
    const promise = r.run(scenario([{ kind: 'waitForInject', timeoutMs: 15_000 }]));
    await Promise.resolve();
    r.notifyInject({ barcode: 'anything-at-all', quantity: 2 });
    const result = await promise;
    expect(result.verdict).toBe('pass');
    expect(result.steps[0].status).toBe('ok');
  });

  it('cancel() stops the run with remaining steps skipped', async () => {
    vi.useFakeTimers();
    const actions = fakeActions();
    const r = new ScenarioRunner(actions);
    const promise = r.run(
      scenario([
        { kind: 'wait', ms: 1000 },
        { kind: 'scan', code: '049000000443' },
      ]),
    );
    await vi.advanceTimersByTimeAsync(0);
    r.cancel();
    const result = await promise;
    expect(result.verdict).toBe('cancelled');
    expect(result.steps.map((s) => s.status)).toEqual(['skipped', 'skipped']);
    expect(actions.calls).toEqual([]);
  });

  it('cancel() during a pending waitForInject skips it, and notifyInject after the run is a no-op', async () => {
    vi.useFakeTimers();
    const actions = fakeActions();
    const r = new ScenarioRunner(actions);
    const promise = r.run(
      scenario([
        { kind: 'waitForInject', timeoutMs: 15_000, expectCodes: ['999'] },
        { kind: 'scan', code: '049000000443' },
      ]),
    );
    await vi.advanceTimersByTimeAsync(0);
    r.cancel();
    const result = await promise;
    expect(result.verdict).toBe('cancelled');
    expect(result.steps.map((s) => s.status)).toEqual(['skipped', 'skipped']);
    expect(actions.calls).toEqual([]);
    expect(() => r.notifyInject({ barcode: '999', quantity: 1 })).not.toThrow();
  });

  it('an inject arriving just before the timeout wins without double-settling the step', async () => {
    vi.useFakeTimers();
    const actions = fakeActions();
    const events: Array<{ index: number; status: StepResult['status'] }> = [];
    const r = new ScenarioRunner(actions, {
      onProgress: (index, result) => events.push({ index, status: result.status }),
    });
    const promise = r.run(scenario([{ kind: 'waitForInject', timeoutMs: 50, expectCodes: ['999'] }]));
    await vi.advanceTimersByTimeAsync(49);
    r.notifyInject({ barcode: '999', quantity: 1 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result.verdict).toBe('pass');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('ok');
    expect(events).toEqual([
      { index: 0, status: 'running' },
      { index: 0, status: 'ok' },
    ]);
  });

  it('cancel() before any run is a safe no-op', () => {
    const r = new ScenarioRunner(fakeActions());
    expect(() => {
      r.cancel();
      r.cancel();
    }).not.toThrow();
  });

  it('notifyInject with no pending waiter is a no-op', () => {
    const r = new ScenarioRunner(fakeActions());
    expect(() => r.notifyInject({ barcode: '999', quantity: 1 })).not.toThrow();
  });

  it('expect step checks the snapshot', async () => {
    const actions = fakeActions();
    actions.snapshot = () =>
      ({ lines: [{ voided: false }], totalCents: 250 }) as unknown as SessionSnapshot;
    const r = new ScenarioRunner(actions);
    const result = await r.run(
      scenario([
        { kind: 'expect', check: 'lineCount', value: 1 },
        { kind: 'expect', check: 'totalCents', value: 999 },
      ]),
    );
    expect(result.verdict).toBe('fail');
    expect(result.steps[0].status).toBe('ok');
    expect(result.steps[1].status).toBe('fail');
    expect(result.steps[1].detail).toBe('expected 999, got 250');
  });

  it('expect lineCount ignores voided lines', async () => {
    const actions = fakeActions();
    actions.snapshot = () =>
      ({
        lines: [{ voided: false }, { voided: true }, { voided: false }],
        totalCents: 0,
      }) as unknown as SessionSnapshot;
    const r = new ScenarioRunner(actions);
    const result = await r.run(scenario([{ kind: 'expect', check: 'lineCount', value: 2 }]));
    expect(result.verdict).toBe('pass');
    expect(result.steps[0].status).toBe('ok');
  });

  it('a throwing action fails the step with the error message and skips the rest', async () => {
    const actions = fakeActions();
    actions.scan = () => {
      throw new Error('register offline');
    };
    const r = new ScenarioRunner(actions);
    const result = await r.run(
      scenario([
        { kind: 'scan', code: '049000000443' },
        { kind: 'tender', tenderKind: 'cash-exact' },
      ]),
    );
    expect(result.verdict).toBe('fail');
    expect(result.steps[0].status).toBe('fail');
    expect(result.steps[0].detail).toContain('register offline');
    expect(result.steps[1].status).toBe('skipped');
    expect(actions.calls).toEqual([]);
  });

  it('onProgress fires running then the final status for each step', async () => {
    const actions = fakeActions();
    const events: Array<{ index: number; status: StepResult['status'] }> = [];
    const r = new ScenarioRunner(actions, {
      onProgress: (index, result) => events.push({ index, status: result.status }),
    });
    const result = await r.run(
      scenario([
        { kind: 'scan', code: '049000000443' },
        { kind: 'suspend' },
      ]),
    );
    expect(result.verdict).toBe('pass');
    expect(events).toEqual([
      { index: 0, status: 'running' },
      { index: 0, status: 'ok' },
      { index: 1, status: 'running' },
      { index: 1, status: 'ok' },
    ]);
  });

  it('onProgress reports skipped steps once (no running phase) and survives its own exceptions', async () => {
    const actions = fakeActions();
    actions.scan = () => {
      throw new Error('boom');
    };
    const events: Array<{ index: number; status: StepResult['status'] }> = [];
    const r = new ScenarioRunner(actions, {
      onProgress: (index, result) => {
        events.push({ index, status: result.status });
        throw new Error('listener bug');
      },
    });
    const result = await r.run(
      scenario([
        { kind: 'scan', code: '049000000443' },
        { kind: 'resume' },
      ]),
    );
    expect(result.verdict).toBe('fail');
    expect(events).toEqual([
      { index: 0, status: 'running' },
      { index: 0, status: 'fail' },
      { index: 1, status: 'skipped' },
    ]);
  });

  it('runs every action step kind against the actions facade', async () => {
    const actions = fakeActions();
    const r = new ScenarioRunner(actions);
    const result = await r.run(
      scenario([
        { kind: 'setLocale', locale: 'fr' },
        { kind: 'scan', code: '1' },
        { kind: 'setQuantity', lineNumber: 1, quantity: 3 },
        { kind: 'setPrice', lineNumber: 1, priceCents: 202 },
        { kind: 'voidLine', lineNumber: 1 },
        { kind: 'suspend' },
        { kind: 'resume' },
        { kind: 'voidTicket' },
        { kind: 'tender', tenderKind: 'next-dollar' },
      ]),
    );
    expect(result.verdict).toBe('pass');
    expect(actions.calls).toEqual([
      'locale:fr',
      'scan:1',
      'qty:1:3',
      'price:1:202',
      'voidLine:1',
      'suspend',
      'resume',
      'voidTicket',
      'tender:next-dollar',
    ]);
  });

  it('measures elapsedMs with the injected clock', async () => {
    let t = 0;
    const actions = fakeActions();
    const r = new ScenarioRunner(actions, { now: () => (t += 5) });
    const result = await r.run(scenario([{ kind: 'scan', code: '1' }]));
    expect(result.steps[0].elapsedMs).toBe(5);
  });
});
