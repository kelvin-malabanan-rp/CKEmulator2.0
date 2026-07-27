import { PANEL_TABS, type PanelTab } from '../uiSettings';
import type { ScenarioParams, Scenario } from '../../../core/scenarios';
import type { useEmulator } from '../useEmulator';
import type { useScenarioRunner } from '../useScenarioRunner';
import { shouldShowTabBadge } from '../tabBadge';
import { WireLog } from './WireLog';
import { Scenarios } from './Scenarios';
import { LoyaltyInput } from './LoyaltyInput';
import { ConfigTab } from './ConfigTab';

/** The scenario runner's last-run record (name + timestamp for the indicator). */
type LastRun = ReturnType<typeof useScenarioRunner>['lastResult'];

const TAB_LABEL: Record<PanelTab, string> = {
  log: 'Wire Log',
  scenarios: 'Scenarios',
  loyalty: 'Loyalty',
  config: 'Config',
};

/** Props for the Scenarios tab, forwarded straight through. */
export interface ScenarioControls {
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
}

/**
 * Bottom-right quadrant: a fixed-size box with a tab strip (Wire Log /
 * Scenarios / Loyalty / Config) and the active tab's content scrolling within
 * it. The quadrant never resizes based on which tab is active or how much
 * content it holds — each tab body owns its own `overflow-y: auto`.
 */
export function InfoPanel({
  e,
  r,
  params,
  tab,
  setTab,
  scenarioCount,
  lastRun,
  rerunScenario,
  scenario,
}: {
  e: ReturnType<typeof useEmulator>;
  r: ReturnType<typeof useScenarioRunner>;
  params: ScenarioParams;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  scenarioCount: number;
  lastRun: LastRun;
  rerunScenario: Scenario | null;
  scenario: ScenarioControls;
}): JSX.Element {
  const badgeFor = (t: PanelTab): number | undefined => (t === 'scenarios' ? scenarioCount : undefined);

  return (
    <div className="infopanel">
      <div className="paneltabs">
        {PANEL_TABS.map((t) => (
          <button
            key={t}
            className={`paneltab${tab === t ? ' on' : ''}`}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
            {shouldShowTabBadge(badgeFor(t)) && <span className="tabbadge">{badgeFor(t)}</span>}
          </button>
        ))}
      </div>

      <div className="panelbody">
        {tab === 'log' && <WireLog log={e.log} onClear={e.clearLog} />}
        {tab === 'scenarios' && (
          <div className="scenariotab">
            {lastRun && (
              <div className="lastrun">
                <button
                  className="rerun"
                  title={rerunScenario ? `Re-run ${lastRun.name}` : 'Last scenario not available for this lane'}
                  disabled={r.running !== null || !rerunScenario}
                  onClick={() => rerunScenario && void r.runScenario(rerunScenario)}
                >
                  ↻ Re-run
                </button>
                <span className="lastrunlabel" title={`Last run at ${new Date(lastRun.ranAt).toLocaleTimeString()}`}>
                  {lastRun.name} · {new Date(lastRun.ranAt).toLocaleTimeString()}
                </span>
              </div>
            )}
            <Scenarios e={e} r={r} params={params} {...scenario} />
          </div>
        )}
        {tab === 'loyalty' && <LoyaltyInput e={e} />}
        {tab === 'config' && <ConfigTab e={e} />}
      </div>
    </div>
  );
}
