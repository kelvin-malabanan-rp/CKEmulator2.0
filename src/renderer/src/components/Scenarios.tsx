import { useMemo } from 'react';
import { builtinScenarios, describeStep, type ScenarioParams } from '../../../core/scenarios';
import type { RunResult, StepResult, StepStatus } from '../../../core/scenarioRunner';
import { baseRegisterType, type RegisterType } from '../../../core/posTypes';
import { DEFAULT_STEP_GAP_MS, DEFAULT_PREPAY_CENTS, DEFAULT_PREPAY_PUMP } from '../scenarioSettings';
import type { useEmulator } from '../useEmulator';
import type { useScenarioRunner } from '../useScenarioRunner';

const STEP_GLYPH: Record<StepStatus, string> = {
  pending: '·',
  running: '…',
  ok: '✓',
  fail: '✗',
  skipped: '⏭',
};

/** Short lane tags shown on each scenario row; the active lane's tag is accented. */
const REGISTER_TAG: Record<RegisterType, string> = {
  'radiant6-canada': 'CA',
  'radiant6-us': 'US',
  bulloch: 'BUL',
  'verifone-topaz': 'TPZ',
  'verifone-topaz-lol': 'LoL',
  'loa-player': 'LOA',
  'ckp2-loa': 'CKP2',
};

const REGISTER_TAG_TITLE: Record<RegisterType, string> = {
  'radiant6-canada': 'Radiant6 Canada',
  'radiant6-us': 'Radiant6 US',
  bulloch: 'Bulloch (Canada, pole-only)',
  'verifone-topaz': 'Verifone Topaz (US, plaintext VJ + scanner)',
  'verifone-topaz-lol': 'Verifone Topaz — LoL VM (US, plaintext VJ + scanner)',
  'loa-player': 'LOA Legacy (loa-player iframe over postMessage)',
  'ckp2-loa': 'CKP2.0 LOA Mode (CK Player 2.0 iframe over postMessage)',
};

/** Compact per-step trail: `n/m kind glyph [detail]` — used live and for the last result. */
function StepRows({ steps }: { steps: StepResult[] }): JSX.Element {
  return (
    <div className="steplist">
      {steps.map((s, i) => (
        <div key={i} className="steprow">
          <span className="stepnum">{i + 1}/{steps.length}</span>
          <span className="stepkind" title={describeStep(s.step)}>{describeStep(s.step)}</span>
          <span className={`stepglyph ${s.status}`}>{STEP_GLYPH[s.status]}</span>
          {s.detail && (
            <span className="stepdetail" title={s.detail}>{s.detail}</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Finished-run verdict badge + its compact step trail; persists until the next run. */
function RunOutcome({ result }: { result: RunResult }): JSX.Element {
  const failed = result.steps.find((s) => s.status === 'fail');
  return (
    <div className="scresult">
      {result.verdict === 'pass' ? (
        <span className="badge-pass">PASS</span>
      ) : result.verdict === 'cancelled' ? (
        <span className="badge-cancel">CANCELLED</span>
      ) : (
        <span className="badge-fail" title={failed?.detail}>
          FAIL{failed?.detail ? ` — ${failed.detail}` : ''}
        </span>
      )}
      <StepRows steps={result.steps} />
    </div>
  );
}

/**
 * Scenarios — one button per canned end-to-end flow (silent injection,
 * arrondir, fr-CA, …) for the current register type. Shows a live step ticker
 * while a run is active and the PASS/FAIL/CANCELLED outcome afterwards.
 * Per-ad Silent ▶ runs (from Triggers & Completers) surface their progress
 * and outcome here too.
 */
export function Scenarios({
  e,
  r,
  params,
  loyaltyCard,
  setLoyaltyCard,
  stepGapMs,
  setStepGapMs,
  upcCoupon12,
  setUpcCoupon12,
  prepayAmountCents,
  setPrepayAmountCents,
  prepayPumpNumber,
  setPrepayPumpNumber,
}: {
  e: ReturnType<typeof useEmulator>;
  r: ReturnType<typeof useScenarioRunner>;
  params: ScenarioParams;
  loyaltyCard: string;
  setLoyaltyCard: (card: string) => void;
  stepGapMs: number;
  setStepGapMs: (ms: number) => void;
  upcCoupon12: string;
  setUpcCoupon12: (upc: string) => void;
  prepayAmountCents: number;
  setPrepayAmountCents: (cents: number) => void;
  prepayPumpNumber: number;
  setPrepayPumpNumber: (pump: number) => void;
}): JSX.Element {
  const registerType = e.config.registerType;
  // LoL is Topaz on the VM — filter and accent scenarios by the base protocol
  // type so the LoL lane shows exactly the Topaz scenarios.
  const activeBase = baseRegisterType(registerType);
  const list = useMemo(
    () => builtinScenarios(params).filter((s) => s.registerTypes.includes(activeBase)),
    [params, activeBase],
  );
  // Runs started elsewhere (the per-ad Silent ▶ buttons) aren't in the list;
  // give them a row at the bottom so their ticker/outcome still shows.
  const listedIds = useMemo(() => new Set(list.map((s) => s.id)), [list]);
  const strayRunning = r.running !== null && !listedIds.has(r.running);
  const strayResult =
    r.running === null && r.lastResult !== null && !listedIds.has(r.lastResult.id)
      ? r.lastResult
      : null;

  return (
    <div className="scenarios">
      <div className="scparams">
        <label title="Loyalty card scenarios sign in with">
          Card
          <input
            type="text"
            className="sccard"
            value={loyaltyCard}
            onChange={(ev) => setLoyaltyCard(ev.target.value)}
          />
        </label>
        <label title="Pause between scenario steps (ms)">
          Gap ms
          <input
            type="number"
            className="scgap"
            min={0}
            step={50}
            value={stepGapMs}
            onChange={(ev) => {
              const v = Number(ev.target.value);
              setStepGapMs(Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULT_STEP_GAP_MS);
            }}
          />
        </label>
        <label title="12-digit UPC for the 'UPC sent as loyalty card' scenario — the player only rings the coupon when this UPC exists in ITS pricebook, so use one it knows">
          Coupon UPC
          <input
            type="text"
            className="sccoupon"
            value={upcCoupon12}
            onChange={(ev) => setUpcCoupon12(ev.target.value.trim())}
          />
        </label>
        <label title="Fuel prepay amount for the demo script's Scene 2, in dollars">
          Prepay $
          <input
            type="number"
            className="scgap"
            min={1}
            step={5}
            value={prepayAmountCents / 100}
            onChange={(ev) => {
              const v = Number(ev.target.value);
              setPrepayAmountCents(Number.isFinite(v) && v > 0 ? Math.round(v * 100) : DEFAULT_PREPAY_CENTS);
            }}
          />
        </label>
        <label title="Pump number for the demo's synthetic prepay line — only used when no real prepay item is found in the loaded ads">
          Pump
          <input
            type="number"
            className="scgap"
            min={1}
            max={99}
            step={1}
            value={prepayPumpNumber}
            onChange={(ev) => {
              const v = Number(ev.target.value);
              setPrepayPumpNumber(Number.isFinite(v) && v >= 1 ? Math.trunc(v) : DEFAULT_PREPAY_PUMP);
            }}
          />
        </label>
      </div>
      {!/^\d{12}$/.test(upcCoupon12) && (
        <div className="hint">Coupon UPC must be exactly 12 digits — anything else is treated by the player as a loyalty sign-in, not a coupon.</div>
      )}
      <div className="sclist">
        {list.length === 0 && !strayRunning && strayResult === null && (
          <div className="hint">
            No scenarios support the {REGISTER_TAG_TITLE[registerType]} lane yet — switch the register type to see its
            scenarios.
          </div>
        )}
        {list.map((s) => {
          const active = r.running === s.id;
          const finished = r.running === null && r.lastResult !== null && r.lastResult.id === s.id;
          return (
            <div key={s.id} className="scrow">
              <div className="scrowhead">
                <button
                  className="scbtn"
                  title={s.description}
                  disabled={r.running !== null}
                  onClick={() => void r.runScenario(s)}
                >
                  ▶ {s.name}
                </button>
                <span className="sctags">
                  {s.registerTypes.map((t) => (
                    <span key={t} className={`sctag${t === activeBase ? ' on' : ''}`} title={REGISTER_TAG_TITLE[t]}>
                      {REGISTER_TAG[t]}
                    </span>
                  ))}
                </span>
                {active && (
                  <button className="scstop" onClick={r.cancel}>
                    Stop
                  </button>
                )}
              </div>
              {active && <StepRows steps={r.progress} />}
              {finished && r.lastResult && <RunOutcome result={r.lastResult.result} />}
            </div>
          );
        })}
        {strayRunning && (
          <div className="scrow">
            <div className="scrowhead">
              <span className="scname">{r.runningName ?? r.running}</span>
              <button className="scstop" onClick={r.cancel}>
                Stop
              </button>
            </div>
            <StepRows steps={r.progress} />
          </div>
        )}
        {strayResult && (
          <div className="scrow">
            <div className="scrowhead">
              <span className="scname">{strayResult.name}</span>
            </div>
            <RunOutcome result={strayResult.result} />
          </div>
        )}
      </div>
    </div>
  );
}
