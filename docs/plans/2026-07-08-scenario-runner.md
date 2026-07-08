# One-Button Scenario Runner + radiant6-us Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** One button per player flow (headline: silent loyalty discount injection) with live pass/fail, plus a `radiant6-us` register mode.

**Architecture:** A pure scenario engine in `src/core/` (declarative steps, injected actions/clock, awaitable inject signal) driven by a thin renderer hook and a Scenarios panel; the US mode is the existing Radiant6 encoder + session with two behavior flags (VJ totals on, cash rounding off).

**Tech Stack:** TypeScript, Electron + React, vitest. No new dependencies.

**Design doc:** `docs/plans/2026-07-08-scenario-runner-design.md`

**Conventions:** repo uses single quotes; every new function gets unit tests; commit messages have NO AI attribution. Run tests with `npx vitest run <file>`, typecheck with `npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`.

---

## Part 1 — Scenario runner

### Task 1: Completer condition types + silent-capable flag (`adTriggers.ts`)

The backend ad JSON carries `conditiontype` on each completer condition
(CKP2 `src/core/models/CompleterConditionType.ts`: `completePromo`,
`couponDiscount`, `duplicateScannedItem`, `xFor`, `addItem`, `injectItem`,
`addDiscount`). Silent injection requires `injectItem` or `addDiscount`.

**Files:**
- Modify: `src/core/adTriggers.ts`
- Test: `src/core/adTriggers.test.ts`

**Step 1: Write the failing tests** (append to `adTriggers.test.ts`)

```ts
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
```

**Step 2: Run to verify failure**

Run: `npx vitest run src/core/adTriggers.test.ts`
Expected: FAIL — `completerConditionTypes` undefined.

**Step 3: Implement**

In `adTriggers.ts`:
- Add `conditiontype?: string;` to `RawCondition`.
- Add to `AdTriggersCompleters`:
  ```ts
  /** Distinct completer conditiontype values (e.g. 'injectItem', 'xFor'). */
  completerConditionTypes: string[];
  /** True when a completer can auto-inject with no cashier tap. */
  silentCapable: boolean;
  ```
- In `extractTriggersCompleters`, while walking `ad.adcompleters`, collect
  `str(cond.conditiontype)` into a `Set<string>` (skip empties); then:
  ```ts
  const completerConditionTypes = [...types];
  const silentCapable = types.has('injectItem') || types.has('addDiscount');
  ```

**Step 4: Run tests** — `npx vitest run src/core/adTriggers.test.ts` → PASS (all, including existing).

**Step 5: Commit** — `git add -A && git commit -m "feat: extract completer condition types + silent-capable flag"`

---

### Task 2: Encoder 1003/1004 (suspend/resume)

**Files:**
- Modify: `src/core/Radiant6CanadaEncoder.ts`
- Test: `src/core/Radiant6CanadaEncoder.test.ts`, `src/core/__roundtrip__/parser-roundtrip.test.ts`

**Step 1:** Read `../CKPlayer2.0/electron/plugins/radiant6-canada/Radiant6CanadaMessageParser.ts` lines ~340–360 to confirm which fields the 1003/1004 handlers read (expected: `TransactionNumber` only).

**Step 2: Failing tests** (append to `Radiant6CanadaEncoder.test.ts`, using the existing fixed-clock pattern from that file)

```ts
it('encodes 1003 basket suspend', () => {
  expect(enc.basketSuspend({ tx: 7 })).toBe(
    'EventId=1003,TerminalNumber=1,EventTime=2026-01-02T03:04:05.006,TransactionNumber=7\r\n',
  );
});

it('encodes 1004 basket resume', () => {
  expect(enc.basketResume({ tx: 7 })).toBe(
    'EventId=1004,TerminalNumber=1,EventTime=2026-01-02T03:04:05.006,TransactionNumber=7\r\n',
  );
});
```

(Adjust the literal EventTime to whatever fixed clock the existing tests use.)

**Step 3:** Run → FAIL. **Step 4: Implement**

```ts
basketSuspend(args: { tx: number }): string {
  return this.eventLine(1003, [['TransactionNumber', args.tx]]);
}

basketResume(args: { tx: number }): string {
  return this.eventLine(1004, [['TransactionNumber', args.tx]]);
}
```

**Step 5:** Add round-trip assertions in `parser-roundtrip.test.ts`: feed both lines through `Radiant6CanadaMessageParser` and assert actions `BASKET_SUSPEND` / `BASKET_RESUME` (match the file's existing helper style).

**Step 6:** `npx vitest run src/core/Radiant6CanadaEncoder.test.ts src/core/__roundtrip__/parser-roundtrip.test.ts` → PASS.

**Step 7: Commit** — `feat: encode 1003/1004 basket suspend/resume`

---

### Task 3: `RegisterSession.suspend()/resume()`

**Files:**
- Modify: `src/core/RegisterSession.ts`
- Test: `src/core/RegisterSession.test.ts`

**Step 1: Failing tests**

```ts
describe('suspend/resume', () => {
  it('emits 1003 then 1004 keeping the basket intact (radiant6)', () => {
    const s = new RegisterSession({ clock: fixedClock });
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    const sus = s.suspend();
    expect(sus).toHaveLength(1);
    expect(sus[0].data).toContain('EventId=1003');
    const res = s.resume();
    expect(res[0].data).toContain('EventId=1004');
    expect(s.snapshot().lines).toHaveLength(1); // basket kept
  });

  it('suspend before any activity emits nothing', () => {
    expect(new RegisterSession().suspend()).toEqual([]);
  });

  it('is a no-op for bulloch', () => {
    const s = new RegisterSession({ registerType: 'bulloch' });
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    expect(s.suspend()).toEqual([]);
    expect(s.resume()).toEqual([]);
  });
});
```

**Step 2:** Run → FAIL. **Step 3: Implement** — `suspend()` returns `[]` if Bulloch or `!this.started`; else `[{ channel: 'vj', data: this.encoder.basketSuspend({ tx: this.tx }) }]` and sets a private `suspended = true`. `resume()` mirrors (only when `suspended`), emits 1004 + the pole balance message, clears the flag. Basket and `tx` untouched.

**Step 4:** `npx vitest run src/core/RegisterSession.test.ts` → PASS. **Step 5: Commit** — `feat: RegisterSession suspend/resume (1003/1004)`

---

### Task 4: Scenario model + builders (`src/core/scenarios.ts`)

**Files:**
- Create: `src/core/scenarios.ts`, `src/core/scenarios.test.ts`

**Step 1: Failing tests**

```ts
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
    expect(s!.steps.map((st) => st.kind)).toEqual(['scan', 'wait', 'loyalty', 'waitForInject', 'wait', 'tender']);
  });

  it('arrondir scenario is canada-only and uses a non-nickel total', () => {
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
});

describe('scenarioForAd', () => {
  const ad = {
    id: '42', name: 'Deal', template: 'Basket Offer',
    triggers: [{ code: '111', description: 'Trigger Item' }],
    completers: [{ code: '999' }],
    completerConditionTypes: ['injectItem'], silentCapable: true,
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
});
```

**Step 2:** Run → FAIL (module missing). **Step 3: Implement** `src/core/scenarios.ts` (pure, browser-safe):

```ts
import type { TenderKind } from './RegisterSession';
import type { RegisterType } from './posTypes';
import type { AdTriggersCompleters } from './adTriggers';

export type ScenarioStep =
  | { kind: 'scan'; code: string; description?: string }
  | { kind: 'loyalty'; cardNumber: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'waitForInject'; timeoutMs: number; expectCodes?: string[] }
  | { kind: 'tender'; tenderKind: TenderKind; amountCents?: number }
  | { kind: 'voidLine'; lineNumber: number }
  | { kind: 'setQuantity'; lineNumber: number; quantity: number }
  | { kind: 'setPrice'; lineNumber: number; priceCents: number }
  | { kind: 'voidTicket' }
  | { kind: 'suspend' }
  | { kind: 'resume' }
  | { kind: 'setLocale'; locale: 'en' | 'fr' }
  | { kind: 'expect'; check: 'lineCount' | 'totalCents'; value: number };

export interface Scenario {
  id: string;
  name: string;
  description: string;
  registerTypes: RegisterType[];
  steps: ScenarioStep[];
}

export interface ScenarioParams {
  itemCode: string;
  itemCode2: string;
  loyaltyCard: string;
  upcCoupon12: string;
  stepGapMs: number;
}
```

`builtinScenarios(p)` returns (gap = `{ kind: 'wait', ms: p.stepGapMs }`):
1. `silent-loyalty-injection` — scan(itemCode), gap, loyalty(loyaltyCard), waitForInject(15000), gap, tender('cash-exact'). registerTypes: `['radiant6-canada', 'radiant6-us']`.
2. `loyalty-signin` — loyalty(loyaltyCard). Same types.
3. `upc-as-coupon` — loyalty(upcCoupon12), expect lineCount 1 *(the $0 echo comes from the player’s UPC discriminator — the emulator itself adds no line, so this expect documents player-side behavior; mark the step optional: see runner semantics below)*. Simplest correct version: steps = [loyalty(upcCoupon12)] only, description explains what to watch in the player. Use the simple version.
4. `arrondir-rounding` — scan a custom item priced 2.02 (`{ kind: 'scan', code: p.itemCode }` then `setPrice(1, 202)`), gap, tender('cash-exact'). registerTypes: `['radiant6-canada']`.
5. `manual-completer` — scan(itemCode), waitForInject(60000). Both radiant6 types.
6. `edit-heavy-sale` — scan ×2, setQuantity(1, 3), setPrice(2, 149), voidLine(1), gap, tender('next-dollar'). All types except steps unsupported on bulloch are fine (session handles bulloch void/qty via pole) → registerTypes: all three.
7. `fr-ca-sale` — setLocale('fr'), scan(itemCode), gap, tender('cash-exact'), setLocale('en'). `['radiant6-canada', 'bulloch']`.
8. `bulloch-full-sale` — scan, scan(itemCode2), voidLine(1), gap, tender('cash-exact'). `['bulloch']`.
9. `suspend-resume` — scan(itemCode), suspend, gap, resume, gap, tender('cash-exact'). `['radiant6-canada', 'radiant6-us']`.

*(Until Task 10 exists, `'radiant6-us'` is not a valid RegisterType — in this task type the arrays as `RegisterType[]` but only use `'radiant6-canada' | 'bulloch'`; add `'radiant6-us'` entries in Task 10. Keep a `// TODO(task 10)` marker.)*

`scenarioForAd(ad: AdTriggersCompleters, p)` → null when `ad.triggers.length === 0`; else scan(first trigger w/ description), gap, loyalty(p.loyaltyCard), waitForInject(15000, expectCodes = completer codes when non-empty), gap, tender('cash-exact'). Name: `Ad: ${ad.name}`.

**Step 4:** `npx vitest run src/core/scenarios.test.ts` → PASS. **Step 5: Commit** — `feat: scenario model + builtin/per-ad scenario builders`

---

### Task 5: Scenario engine (`src/core/scenarioRunner.ts`)

Pure async engine; React hook stays a shell. Time and inject arrival are injected.

**Files:**
- Create: `src/core/scenarioRunner.ts`, `src/core/scenarioRunner.test.ts`

**Step 1: Failing tests** (key cases)

```ts
import { describe, it, expect, vi } from 'vitest';
import { ScenarioRunner, type ScenarioActions } from './scenarioRunner';

function fakeActions(): ScenarioActions & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    scan: (c) => calls.push(`scan:${c}`),
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

it('runs action steps in order and reports ok', async () => {
  const a = fakeActions();
  const r = new ScenarioRunner(a, { sleep: async () => {} });
  const result = await r.run({
    id: 't', name: 't', description: '', registerTypes: ['radiant6-canada'],
    steps: [{ kind: 'scan', code: '1' }, { kind: 'loyalty', cardNumber: '2' }],
  });
  expect(a.calls).toEqual(['scan:1', 'loyalty:2']);
  expect(result.verdict).toBe('pass');
  expect(result.steps.map((s) => s.status)).toEqual(['ok', 'ok']);
});

it('waitForInject resolves when a matching inject arrives', async () => {
  const r = new ScenarioRunner(fakeActions(), { sleep: async () => {} });
  const p = r.run({ id: 't', name: 't', description: '', registerTypes: ['radiant6-canada'],
    steps: [{ kind: 'waitForInject', timeoutMs: 1000, expectCodes: ['999'] }] });
  r.notifyInject({ barcode: '999', quantity: 1 });
  const result = await p;
  expect(result.verdict).toBe('pass');
});

it('waitForInject ignores non-matching codes and fails on timeout', async () => {
  vi.useFakeTimers();
  const r = new ScenarioRunner(fakeActions(), {});
  const p = r.run({ id: 't', name: 't', description: '', registerTypes: ['radiant6-canada'],
    steps: [{ kind: 'waitForInject', timeoutMs: 50, expectCodes: ['999'] }, { kind: 'voidTicket' }] });
  r.notifyInject({ barcode: '111', quantity: 1 });
  await vi.advanceTimersByTimeAsync(60);
  const result = await p;
  expect(result.verdict).toBe('fail');
  expect(result.steps[0].status).toBe('fail');
  expect(result.steps[1].status).toBe('skipped');
  vi.useRealTimers();
});

it('cancel() stops the run with remaining steps skipped', async () => {
  vi.useFakeTimers();
  const r = new ScenarioRunner(fakeActions(), {});
  const p = r.run({ id: 't', name: 't', description: '', registerTypes: ['radiant6-canada'],
    steps: [{ kind: 'wait', ms: 1000 }, { kind: 'voidTicket' }] });
  r.cancel();
  await vi.advanceTimersByTimeAsync(1100);
  const result = await p;
  expect(result.verdict).toBe('cancelled');
  vi.useRealTimers();
});

it('expect step checks the snapshot', async () => {
  const a = fakeActions();
  a.snapshot = () => ({ lines: [{}], totalCents: 250 }) as never;
  const r = new ScenarioRunner(a, { sleep: async () => {} });
  const result = await r.run({ id: 't', name: 't', description: '', registerTypes: ['radiant6-canada'],
    steps: [{ kind: 'expect', check: 'lineCount', value: 1 }, { kind: 'expect', check: 'totalCents', value: 999 }] });
  expect(result.steps[0].status).toBe('ok');
  expect(result.steps[1].status).toBe('fail');
});
```

**Step 2:** Run → FAIL. **Step 3: Implement**

```ts
import type { Scenario, ScenarioStep } from './scenarios';
import type { SessionSnapshot, TenderKind } from './RegisterSession';
import type { InjectCommand } from './injectProtocol';
import type { PosLocale } from './currency';

export interface ScenarioActions {
  scan(code: string, description?: string): void;
  loyalty(cardNumber: string): void;
  tender(kind: TenderKind, amountCents?: number): void;
  voidLine(lineNumber: number): void;
  setQuantity(lineNumber: number, quantity: number): void;
  setPrice(lineNumber: number, priceCents: number): void;
  voidTicket(): void;
  suspend(): void;
  resume(): void;
  setLocale(locale: PosLocale): void;
  snapshot(): SessionSnapshot;
}

export type StepStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skipped';
export interface StepResult { step: ScenarioStep; status: StepStatus; detail?: string; elapsedMs: number }
export interface RunResult { verdict: 'pass' | 'fail' | 'cancelled'; steps: StepResult[] }

export class ScenarioRunner {
  constructor(
    private readonly actions: ScenarioActions,
    private readonly opts: {
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
      onProgress?: (index: number, result: StepResult) => void;
    } = {},
  ) {}
  // run(scenario): iterate steps; try/catch each; waitForInject registers a
  // pending {expectCodes, resolve} consumed by notifyInject(cmd) (with a
  // setTimeout race for the timeout); cancel() flips a flag and resolves any
  // pending wait as cancelled. First fail => remaining steps 'skipped',
  // verdict 'fail'. sleep defaults to setTimeout; now to Date.now.
  notifyInject(cmd: InjectCommand): void { /* match & resolve pending wait */ }
  cancel(): void { /* ... */ }
}
```

Implementation notes:
- `waitForInject` matches when `!expectCodes?.length || expectCodes.includes(cmd.barcode)`; non-matching injects are ignored (logged in detail).
- `wait` uses the injected `sleep`, checking the cancel flag after.
- `expect` reads `actions.snapshot()`: `lineCount` = non-voided `lines.length`, `totalCents` = `snapshot.totalCents`.
- Never throws out of `run()`; every path returns a `RunResult`.

**Step 4:** `npx vitest run src/core/scenarioRunner.test.ts` → PASS. **Step 5: Commit** — `feat: pure scenario engine with awaitable inject + cancel`

---

### Task 6: `useScenarioRunner` hook

**Files:**
- Create: `src/renderer/src/useScenarioRunner.ts`
- Modify: `src/renderer/src/useEmulator.ts` (expose `suspend`, `resume` actions — mirror the existing one-liners: `suspend: () => dispatch(session.suspend())`, same for resume; add to the return type)

Thin shell (per repo convention "UI stays a thin shell over tested logic" — no new tests beyond the core ones, but keep ALL logic in core):

```ts
export function useScenarioRunner(e: ReturnType<typeof useEmulator>): {
  running: string | null;                 // scenario id
  progress: StepResult[];
  lastResult: { id: string; result: RunResult } | null;
  runScenario: (s: Scenario) => Promise<void>;
  cancel: () => void;
}
```

- Builds a `ScenarioRunner` per run with actions delegating to `e.scan/e.loyalty/…/e.snapshot` (snapshot from `e.snapshot` state — pass a ref-backed getter so the runner sees fresh state).
- Subscribes `window.emulator.onInject(runner.notifyInject)` for the run's duration (this is IN ADDITION to the existing useEmulator onInject handler, which keeps ringing items up — both listeners coexist).
- `onProgress` updates `progress` state; on completion sets `lastResult` and logs one `sys` line per step via the pattern already used in `useEmulator` (`[Scenario] 3/6 waitForInject ok (2.4s)` — add a `logSys`-style callback param or reuse `e` if exposed; simplest: `console.log('[Scenario] …')` plus a `summary` returned for the panel to render).
- Guard: refuse to start when `e.status.vj !== 'connected'` (or pole for bulloch) — set `lastResult` to an immediate fail with detail `'not connected'`.
- Abort the run if the register type changes mid-run (`useEffect` on `e.config.registerType` → `cancel()`).

Verify: `npx tsc --noEmit -p tsconfig.web.json` → clean. Commit — `feat: useScenarioRunner hook wiring engine to emulator actions`

---

### Task 7: Scenarios panel + per-ad "Test silently" button + params UI

**Files:**
- Modify: `src/renderer/src/App.tsx` (new `Scenarios` component in the left column under `TriggersCompleters`; button in each ad row), `src/renderer/src/assets/*.css` (match existing panel styles)

Behavior:
- Panel lists `builtinScenarios(params).filter(s => s.registerTypes.includes(config.registerType))` — one button each; while running show the step ticker (`n/m kind … status`), then a green PASS / red FAIL badge with the failing step's detail; Stop button while running.
- Params row above the list: loyalty card input (default `70846414251491703`) and step gap (default 750 ms), persisted to localStorage keys `r6ca.scenario.loyaltyCard` / `r6ca.scenario.stepGapMs`. `itemCode`/`itemCode2` default to the first two quick keys (fallback `PRICEBOOK[0..1]`).
- In `TriggersCompleters` rows: for ads where `adDetails[id]?.silentCapable`, render a `Silent ▶` button → `runScenario(scenarioForAd(detail, params)!)`; disabled while a run is active. Tooltip when not silent-capable.
- Reuse the existing `injectSeq`-driven modal auto-close; no changes to that path.

Manual verification (this task has UI only — core is already tested): `npm run dev` alongside CK Player 2.0, run scenario ① against an ad with an `injectItem` completer, confirm PASS and the 2001→1011 echo in the Wire Log. Also verify FAIL path by running disconnected.

Typecheck + full `npm test` → PASS. Commit — `feat: scenarios panel + per-ad silent-injection test button`

---

## Part 2 — radiant6-us

### Task 8: Encoder — 1005/1020 + US basket-end totals

Legacy wire truth (`liftck_player` `Radiant6RegisterEmulator.java:149-150,296`): after every item mutation emit `1020 Amount=<tax>` then `1005 Amount=<subtotal>`; the completed/cancelled 1002 carries `SubtotalAmount=,TaxAmount=,TotalAmount=`.

**Files:**
- Modify: `src/core/Radiant6CanadaEncoder.ts`
- Test: `src/core/Radiant6CanadaEncoder.test.ts`

**Step 1: Failing tests**

```ts
it('encodes 1005 subtotal and 1020 tax (US mode)', () => {
  expect(enc.subtotal({ tx: 3, amountCents: 1716 })).toContain('EventId=1005');
  expect(enc.subtotal({ tx: 3, amountCents: 1716 })).toContain('Amount=17.16');
  expect(enc.tax({ tx: 3, amountCents: 43 })).toContain('EventId=1020');
  expect(enc.tax({ tx: 3, amountCents: 43 })).toContain('Amount=0.43');
});

it('basketEnd carries US totals when provided', () => {
  const line = enc.basketEnd({
    tx: 3, type: 'Sales', completion: 'Completed',
    totals: { subtotalCents: 1716, taxCents: 43, totalCents: 1759 },
  });
  expect(line).toContain('SubtotalAmount=17.16,TaxAmount=0.43,TotalAmount=17.59');
});

it('basketEnd omits totals when not provided (CA)', () => {
  expect(enc.basketEnd({ tx: 3, type: 'Sales', completion: 'Completed' })).not.toContain('SubtotalAmount');
});
```

**Step 2:** Run → FAIL. **Step 3: Implement** — `subtotal`/`tax` via `eventLine(1005|1020, [['TransactionNumber', tx], ['Amount', wireAmount(amountCents, 'en')]])`; extend `basketEnd` args with optional `totals`. Update the class doc comment: the no-1005/1020 rule is *Canada policy enforced by RegisterSession*, not by the encoder.

**Step 4:** All encoder + roundtrip tests PASS (roundtrip: also assert the CA parser IGNORES a 1005/1020 line gracefully — CKP2 has no handler for them, expect no event / no throw).

**Step 5: Commit** — `feat: encoder 1005/1020 + US basket-end totals`

---

### Task 9: `radiant6-us` register type (`posTypes.ts`)

**Files:**
- Modify: `src/core/posTypes.ts`
- Test: `src/core/posTypes.test.ts`

Tests: `portsForRegisterType('radiant6-us')` → `{ vjPort: 5438, polePort: 5439 }`; REGISTER_TYPES contains the new entry with label `'Radiant6 US'`. Implement: `export type RegisterType = 'radiant6-canada' | 'radiant6-us' | 'bulloch';`, add the entry, update the "Canadian POS register types" comment to cover US. Run posTypes + FULL suite (`npm test`) since RegisterType is widely imported → PASS. Commit — `feat: radiant6-us register type`

---

### Task 10: `RegisterSession` US behavior

**Files:**
- Modify: `src/core/RegisterSession.ts`, `src/core/scenarios.ts` (add `'radiant6-us'` to scenario registerTypes per Task 4's TODO)
- Test: `src/core/RegisterSession.test.ts`, `src/core/scenarios.test.ts`

**Step 1: Failing tests**

```ts
describe('radiant6-us', () => {
  const us = (): RegisterSession => new RegisterSession({ registerType: 'radiant6-us', clock: fixedClock });

  it('emits 1020 then 1005 after each item mutation', () => {
    const msgs = us().addItem({ code: '1', description: 'A', priceCents: 202 });
    const ids = msgs.filter((m) => m.channel === 'vj').map((m) => /EventId=(\d+)/.exec(m.data)![1]);
    expect(ids).toEqual(['1001', '1009', '1011', '1020', '1005']);
  });

  it('does not emit Arrondir and tenders the exact total', () => {
    const s = us();
    s.addItem({ code: '1', description: 'A', priceCents: 202 });
    const msgs = s.tender('cash-exact');
    expect(msgs.some((m) => m.data.includes('Description=Arrondir'))).toBe(false);
    expect(msgs.some((m) => m.data.includes('EventId=1007') && m.data.includes('Amount=2.12'))).toBe(true); // 2.02 + 5% tax
  });

  it('basket end carries totals in US mode', () => {
    const s = us();
    s.addItem({ code: '1', description: 'A', priceCents: 202 });
    const end = s.tender('cash-exact').find((m) => m.data.includes('EventId=1002'))!;
    expect(end.data).toContain('SubtotalAmount=2.02');
  });

  it('canada emits no 1005/1020 (regression)', () => {
    const msgs = new RegisterSession({ clock: fixedClock }).addItem({ code: '1', description: 'A', priceCents: 202 });
    expect(msgs.some((m) => /EventId=10(05|20)/.test(m.data))).toBe(false);
  });
});
```

(Adjust the exact-amount expectation to the session's real default tax math — `taxRateBps 500` on 202¢ = 10.1¢ → check `Basket`'s rounding and use the true value.)

**Step 2:** Run → FAIL. **Step 3: Implement** — private getters `vjTotals` (`registerType === 'radiant6-us'`) and `cashRounding` (`registerType === 'radiant6-canada'`); a `vjTotalsMessages()` helper returning `[tax(1020), subtotal(1005)]` appended in `addItem`/`voidLine`/`setQuantity`/`setPrice` when `vjTotals`; in `tender()` skip the rounding block and use `exactTotal` when `!cashRounding`, and pass `totals` to `basketEnd` when `vjTotals`. Force/keep locale `'en'` for `radiant6-us` in `setLocale` (ignore `'fr'`). Update scenarios.ts registerTypes arrays (silent-loyalty-injection, loyalty-signin, upc-as-coupon, manual-completer, edit-heavy-sale, suspend-resume gain `'radiant6-us'`).

**Step 4:** `npm test` → ALL PASS. **Step 5: Commit** — `feat: radiant6-us session behavior (VJ totals, no rounding, en-US)`

---

### Task 11: US UI polish + docs

**Files:**
- Modify: `src/renderer/src/App.tsx` (register dropdown gets the new type automatically from `REGISTER_TYPES` — verify; hide the FR locale toggle when `registerType === 'radiant6-us'`), `README.md` (document the new register type, the Scenarios panel, and per-ad Silent ▶ button; note default US loyalty card prefixes `D7826`/`D8018`/`8018` from legacy)

Verify: `npm run build` (typecheck + build) → clean; `npm test` → PASS. Manual: switch to Radiant6 US, run scenario ⑥, watch 1020/1005 lines in the Wire Log.

Commit — `feat: radiant6-us UI + docs for scenario runner`

---

## Final gate

- `npm test` and `npm run build` green.
- Manual end-to-end against CK Player 2.0 (scenario ① with a real silent-capable ad) before the PR.
- PR from `feat/scenario-runner` → `main`, GFM description with a fenced raw-summary block, no emoji, no AI attribution.
