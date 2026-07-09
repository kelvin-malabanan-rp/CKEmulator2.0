/**
 * ScenarioRunner — replays a Scenario's steps against a ScenarioActions facade
 * (scan, loyalty, tender, …) one at a time, awaiting `wait` pauses and
 * `waitForInject` steps that resolve when `notifyInject` delivers a matching
 * player→register completer inject (EventId 2001). Produces a RunResult with a
 * per-step status trail and an overall pass/fail/cancelled verdict.
 *
 * Pure / browser-safe (no Node, Electron or React imports); the clock and
 * sleep are injectable for tests.
 */
import type { Scenario, ScenarioStep } from './scenarios';
import type { SessionSnapshot, TenderKind } from './RegisterSession';
import type { InjectCommand } from './injectProtocol';
import type { PosLocale } from './currency';

/** Everything a scenario can do to the register; the UI wires these to useEmulator. */
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

export interface StepResult {
  step: ScenarioStep;
  status: StepStatus;
  detail?: string;
  elapsedMs: number;
}

export interface RunResult {
  verdict: 'pass' | 'fail' | 'cancelled';
  steps: StepResult[];
}

interface InjectWaiter {
  expectCodes?: readonly string[];
  ignored: string[];
  settle(outcome: 'inject'): void;
}

const OK: { status: 'ok' | 'fail'; detail?: string } = { status: 'ok' };

/**
 * Runs one Scenario. Single-use: create a fresh runner per run — after
 * `cancel()` (or a finished run) a second `run()` on the same instance is not
 * supported.
 *
 * Guarantees:
 * - `run()` never rejects; every path resolves a RunResult.
 * - Steps run sequentially; the first 'fail' skips all remaining steps and
 *   yields verdict 'fail'. `cancel()` skips the in-flight and remaining steps
 *   and yields verdict 'cancelled'.
 * - `onProgress(index, result)` fires twice per executed step — once with
 *   status 'running' when it starts, once with its final status when it
 *   settles — and exactly once (final status only) for skipped steps.
 *   Exceptions thrown by onProgress are swallowed.
 * - `notifyInject` with no pending waitForInject step is a no-op;
 *   non-matching injects are ignored but recorded in the step's detail.
 */
export class ScenarioRunner {
  private readonly actions: ScenarioActions;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly onProgress: ((index: number, result: StepResult) => void) | undefined;
  private cancelled = false;
  private signalCancel: () => void = () => {};
  private readonly cancelSignal: Promise<void>;
  private waiter: InjectWaiter | null = null;

  constructor(
    actions: ScenarioActions,
    opts?: {
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
      onProgress?: (index: number, result: StepResult) => void;
    },
  ) {
    this.actions = actions;
    this.sleep = opts?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts?.now ?? Date.now;
    this.onProgress = opts?.onProgress;
    this.cancelSignal = new Promise((resolve) => {
      this.signalCancel = resolve;
    });
  }

  async run(scenario: Scenario): Promise<RunResult> {
    const results: StepResult[] = [];
    let failed = false;
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      if (failed || this.cancelled) {
        const result: StepResult = { step, status: 'skipped', elapsedMs: 0 };
        results.push(result);
        this.progress(i, result);
        continue;
      }
      const startedAt = this.now();
      this.progress(i, { step, status: 'running', elapsedMs: 0 });
      let status: StepStatus;
      let detail: string | undefined;
      try {
        const outcome = await this.execute(step);
        status = outcome.status;
        detail = outcome.detail;
      } catch (err) {
        status = 'fail';
        detail = err instanceof Error ? err.message : String(err);
      }
      if (this.cancelled) status = 'skipped';
      if (status === 'fail') failed = true;
      const result: StepResult = {
        step,
        status,
        ...(detail !== undefined ? { detail } : {}),
        elapsedMs: this.now() - startedAt,
      };
      results.push(result);
      this.progress(i, result);
    }
    const verdict = this.cancelled ? 'cancelled' : failed ? 'fail' : 'pass';
    return { verdict, steps: results };
  }

  /** Deliver a player→register inject; resolves a pending waitForInject when it matches. */
  notifyInject(cmd: InjectCommand): void {
    const w = this.waiter;
    if (!w) return;
    if (!w.expectCodes?.length || w.expectCodes.includes(cmd.barcode)) {
      w.settle('inject');
    } else {
      w.ignored.push(cmd.barcode);
    }
  }

  /** Stop the run: the in-flight and remaining steps become 'skipped', verdict 'cancelled'. Safe to call any time, more than once. */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.signalCancel();
  }

  private progress(index: number, result: StepResult): void {
    if (!this.onProgress) return;
    try {
      this.onProgress(index, result);
    } catch {
      // A buggy progress listener must never fail the run.
    }
  }

  private async execute(step: ScenarioStep): Promise<{ status: 'ok' | 'fail'; detail?: string }> {
    switch (step.kind) {
      case 'scan':
        this.actions.scan(step.code, step.description);
        return OK;
      case 'loyalty':
        this.actions.loyalty(step.cardNumber);
        return OK;
      case 'tender':
        this.actions.tender(step.tenderKind, step.amountCents);
        return OK;
      case 'voidLine':
        this.actions.voidLine(step.lineNumber);
        return OK;
      case 'setQuantity':
        this.actions.setQuantity(step.lineNumber, step.quantity);
        return OK;
      case 'setPrice':
        this.actions.setPrice(step.lineNumber, step.priceCents);
        return OK;
      case 'voidTicket':
        this.actions.voidTicket();
        return OK;
      case 'suspend':
        this.actions.suspend();
        return OK;
      case 'resume':
        this.actions.resume();
        return OK;
      case 'setLocale':
        this.actions.setLocale(step.locale);
        return OK;
      case 'wait':
        await Promise.race([this.sleep(step.ms), this.cancelSignal]);
        return OK;
      case 'waitForInject':
        return this.waitForInject(step);
      case 'expect':
        return this.checkExpect(step);
    }
  }

  private async waitForInject(
    step: Extract<ScenarioStep, { kind: 'waitForInject' }>,
  ): Promise<{ status: 'ok' | 'fail'; detail?: string }> {
    const ignored: string[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await new Promise<'inject' | 'timeout' | 'cancelled'>((resolve) => {
        let settled = false;
        const settle = (o: 'inject' | 'timeout' | 'cancelled'): void => {
          if (settled) return;
          settled = true;
          resolve(o);
        };
        this.waiter = { expectCodes: step.expectCodes, ignored, settle };
        timer = setTimeout(() => settle('timeout'), step.timeoutMs);
        void this.cancelSignal.then(() => settle('cancelled'));
      });
      const ignoredNote = ignored.length > 0 ? `; ignored inject(s): ${ignored.join(', ')}` : '';
      if (outcome === 'timeout') {
        return { status: 'fail', detail: `timeout after ${step.timeoutMs}ms${ignoredNote}` };
      }
      // 'cancelled' is rewritten to 'skipped' by the run loop; report ok here.
      return ignoredNote ? { status: 'ok', detail: ignoredNote.slice(2) } : OK;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.waiter = null;
    }
  }

  private checkExpect(
    step: Extract<ScenarioStep, { kind: 'expect' }>,
  ): { status: 'ok' | 'fail'; detail?: string } {
    const snap = this.actions.snapshot();
    const got =
      step.check === 'lineCount' ? snap.lines.filter((l) => !l.voided).length : snap.totalCents;
    if (got === step.value) return OK;
    return { status: 'fail', detail: `expected ${step.value}, got ${got}` };
  }
}
