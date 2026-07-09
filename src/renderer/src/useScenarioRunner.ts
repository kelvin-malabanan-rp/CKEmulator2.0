/**
 * useScenarioRunner — thin React shell over the tested ScenarioRunner engine.
 *
 * Wires a run's ScenarioActions to the useEmulator lane actions, feeds
 * player→register completer injects (window.emulator.onInject) into the active
 * runner for the duration of a run, and mirrors engine progress into React
 * state for the Scenarios panel. All sequencing/verdict logic lives in
 * src/core/scenarioRunner.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ScenarioRunner,
  type RunResult,
  type ScenarioActions,
  type StepResult,
} from '../../core/scenarioRunner';
import type { Scenario } from '../../core/scenarios';
import type { SessionSnapshot } from '../../core/RegisterSession';
import type { useEmulator } from './useEmulator';

export function useScenarioRunner(e: ReturnType<typeof useEmulator>): {
  running: string | null;
  /** Display name of the active scenario (for rows keyed off `running`). */
  runningName: string | null;
  progress: StepResult[];
  lastResult: { id: string; name: string; result: RunResult } | null;
  runScenario: (s: Scenario) => Promise<void>;
  cancel: () => void;
} {
  const [running, setRunning] = useState<string | null>(null);
  const [runningName, setRunningName] = useState<string | null>(null);
  const [progress, setProgress] = useState<StepResult[]>([]);
  const [lastResult, setLastResult] = useState<{ id: string; name: string; result: RunResult } | null>(null);

  // One single-use ScenarioRunner per run (see its class JSDoc); null when idle.
  const runnerRef = useRef<ScenarioRunner | null>(null);
  // Monotonic run id — state updates from a stale run must not clobber a newer one.
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  // e.snapshot is React state captured at render time; expect steps need the
  // state as of the previous step, so read through a ref kept fresh on render.
  // Because the ref refreshes in a passive effect (i.e. only after React
  // re-renders), an expect step must follow a `wait` gap — an action step
  // immediately followed by expect would read the pre-action snapshot.
  const snapshotRef = useRef<SessionSnapshot>(e.snapshot);
  useEffect(() => {
    snapshotRef.current = e.snapshot;
  }, [e.snapshot]);

  // Latest emulator facade — actions must not close over a stale render's e
  // (the run outlives the render that started it).
  const emulatorRef = useRef(e);
  useEffect(() => {
    emulatorRef.current = e;
  }, [e]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runnerRef.current?.cancel();
    };
  }, []);

  // Switching register type rebuilds the lane session — abort any active run.
  const registerType = e.config.registerType;
  useEffect(() => {
    runnerRef.current?.cancel();
  }, [registerType]);

  const runScenario = useCallback(async (s: Scenario): Promise<void> => {
    if (runnerRef.current) {
      console.log(`[Scenario] ignoring "${s.id}" — another scenario is still running`);
      return;
    }
    const emu = emulatorRef.current;
    const connected =
      emu.config.registerType === 'bulloch'
        ? emu.status.pole === 'connected'
        : emu.status.vj === 'connected';
    if (!connected) {
      console.log(`[Scenario] ✘ ${s.id} fail: lane not connected (${emu.config.registerType})`);
      setProgress([]);
      setLastResult({
        id: s.id,
        name: s.name,
        result: {
          verdict: 'fail',
          steps: [{ step: s.steps[0], status: 'fail', detail: 'not connected', elapsedMs: 0 }],
        },
      });
      return;
    }

    const runId = ++runIdRef.current;
    const total = s.steps.length;
    const live = (): boolean => mountedRef.current && runIdRef.current === runId;

    const actions: ScenarioActions = {
      scan: (code, description) => emulatorRef.current.scan(code, description),
      loyalty: (cardNumber) => emulatorRef.current.loyalty(cardNumber),
      tender: (kind, amountCents) => emulatorRef.current.tender(kind, amountCents),
      voidLine: (lineNumber) => emulatorRef.current.voidLine(lineNumber),
      setQuantity: (lineNumber, quantity) => emulatorRef.current.setQuantity(lineNumber, quantity),
      setPrice: (lineNumber, priceCents) => emulatorRef.current.setPrice(lineNumber, priceCents),
      voidTicket: () => emulatorRef.current.voidTicket(),
      suspend: () => emulatorRef.current.suspend(),
      resume: () => emulatorRef.current.resume(),
      setLocale: (locale) => emulatorRef.current.setLocale(locale),
      snapshot: () => snapshotRef.current,
    };

    const runner = new ScenarioRunner(actions, {
      onProgress: (index, result) => {
        if (!live()) return;
        setProgress((prev) => {
          const next = prev.slice();
          next[index] = result;
          return next;
        });
        if (result.status !== 'running') {
          console.log(
            `[Scenario] ${index + 1}/${total} ${result.step.kind} ${result.status} (${(result.elapsedMs / 1000).toFixed(1)}s)`,
          );
        }
      },
    });
    runnerRef.current = runner;
    setRunning(s.id);
    setRunningName(s.name);
    setProgress(s.steps.map((step) => ({ step, status: 'pending' as const, elapsedMs: 0 })));
    console.log(`[Scenario] ▶ ${s.id}`);

    // Feed player injects to the runner for this run only. The useEmulator
    // onInject listener (which rings the completer up) stays subscribed too.
    const unsubscribe = window.emulator.onInject((cmd) => runner.notifyInject(cmd));
    try {
      const result = await runner.run(s);
      if (result.verdict === 'pass') {
        console.log(`[Scenario] ✔ ${s.id} pass`);
      } else if (result.verdict === 'cancelled') {
        console.log(`[Scenario] ⏹ ${s.id} cancelled`);
      } else {
        const failIndex = result.steps.findIndex((r) => r.status === 'fail');
        const failed = result.steps[failIndex];
        console.log(
          `[Scenario] ✘ ${s.id} fail at step ${failIndex + 1}: ${failed?.detail ?? failed?.step.kind ?? 'unknown'}`,
        );
      }
      if (live()) setLastResult({ id: s.id, name: s.name, result });
    } finally {
      unsubscribe();
      if (runnerRef.current === runner) runnerRef.current = null;
      if (live()) {
        setRunning(null);
        setRunningName(null);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    runnerRef.current?.cancel();
  }, []);

  return { running, runningName, progress, lastResult, runScenario, cancel };
}
