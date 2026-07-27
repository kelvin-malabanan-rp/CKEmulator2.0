import { useEffect, useMemo, useState } from 'react';
import { PRICEBOOK, useEmulator } from './useEmulator';
import { useScenarioRunner } from './useScenarioRunner';
import { findAnyCompleter, findPrepayItem } from '../../core/adTriggers';
import { builtinScenarios, type ScenarioParams } from '../../core/scenarios';
import { baseRegisterType } from '../../core/posTypes';
import { usePersistedState } from './usePersistedState';
import {
  SCENARIO_CARD_KEY,
  SCENARIO_GAP_KEY,
  SCENARIO_COUPON_KEY,
  SCENARIO_PREPAY_KEY,
  SCENARIO_PUMP_KEY,
  DEFAULT_SCENARIO_CARD,
  DEFAULT_UPC_COUPON,
  DEFAULT_STEP_GAP_MS,
  DEFAULT_PREPAY_CENTS,
  DEFAULT_PREPAY_PUMP,
  parseString,
  parseStepGapMs,
  parsePrepayCents,
  parsePrepayPump,
} from './scenarioSettings';
import {
  THEME_KEY,
  parseTheme,
  systemDefaultTheme,
  PANEL_TAB_KEY,
  DEFAULT_PANEL_TAB,
  parsePanelTab,
} from './uiSettings';
import { TopBar } from './components/TopBar';
import { QuickKeys } from './components/QuickKeys';
import { TriggersCompleters } from './components/TriggersCompleters';
import { TransactionPanel } from './components/TransactionPanel';
import { InfoPanel } from './components/InfoPanel';
import './App.css';

/** OS preference read once for the first-load theme default (no persisted choice). */
const prefersLight =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)').matches
    : false;

function App(): JSX.Element {
  const e = useEmulator();
  // One runner shared by the Scenarios panel and the per-ad Silent ▶ buttons,
  // so "one run at a time" holds across both entry points.
  const r = useScenarioRunner(e);
  const { snapshot } = e;
  const locale = snapshot.locale;

  // Colour theme (dark / dimmed / light), persisted. First load with no saved
  // choice follows the OS prefers-color-scheme. Applied as data-theme on <html>
  // so the token overrides cascade to the whole document.
  const [theme, setTheme] = usePersistedState(THEME_KEY, systemDefaultTheme(prefersLight), parseTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Active tab of the bottom-right quadrant, persisted. Starting a scenario run
  // (incl. per-ad Silent ▶) switches to the Scenarios tab so the ticker shows.
  const [panelTab, setPanelTab] = usePersistedState(PANEL_TAB_KEY, DEFAULT_PANEL_TAB, parsePanelTab);
  const running = r.running;
  useEffect(() => {
    if (running !== null) setPanelTab('scenarios');
  }, [running, setPanelTab]);

  // Scenario knobs, persisted to localStorage (r6ca.* keys).
  const [loyaltyCard, setLoyaltyCard] = usePersistedState(SCENARIO_CARD_KEY, DEFAULT_SCENARIO_CARD, parseString);
  const [stepGapMs, setStepGapMs] = usePersistedState(SCENARIO_GAP_KEY, DEFAULT_STEP_GAP_MS, parseStepGapMs);
  const [upcCoupon12, setUpcCoupon12] = usePersistedState(SCENARIO_COUPON_KEY, DEFAULT_UPC_COUPON, parseString);
  const [prepayAmountCents, setPrepayAmountCents] = usePersistedState(SCENARIO_PREPAY_KEY, DEFAULT_PREPAY_CENTS, parsePrepayCents);
  const [prepayPumpNumber, setPrepayPumpNumber] = usePersistedState(SCENARIO_PUMP_KEY, DEFAULT_PREPAY_PUMP, parsePrepayPump);

  // Item codes for the canned scenarios: first two quick keys, falling back to
  // the derived quick-key picks, then the bundled PRICEBOOK constants.
  const params = useMemo<ScenarioParams>(() => {
    const qkEntries = e.quickKeyFiles[0]?.entries ?? [];
    // The demo's fuel scene rings the real prepay item from the loaded ads
    // (the pump param only shapes the synthetic fallback line), and Scene 3
    // auto-injects a completer — the prepay ad's when it has one, else any
    // loaded ad's — because the ads don't render on the shopper screen.
    const ads = Object.values(e.adDetails);
    const prepay = findPrepayItem(ads);
    const completer = prepay?.completer ?? findAnyCompleter(ads, prepay?.code);
    return {
      itemCode: qkEntries[0]?.upc ?? e.quickKeys[0]?.code ?? PRICEBOOK[0].code,
      itemCode2: qkEntries[1]?.upc ?? e.quickKeys[1]?.code ?? PRICEBOOK[1].code,
      loyaltyCard,
      upcCoupon12,
      stepGapMs,
      prepayPumpNumber,
      prepayAmountCents,
      ...(prepay ? { prepayItem: { code: prepay.code, description: prepay.description } } : {}),
      ...(completer ? { demoCompleter: completer } : {}),
    };
  }, [e.quickKeyFiles, e.quickKeys, e.adDetails, loyaltyCard, upcCoupon12, stepGapMs, prepayPumpNumber, prepayAmountCents]);

  // Scenarios applicable to the active lane — count is shown as a tab badge and
  // the last run's scenario is looked up for the one-click re-run button.
  const activeBase = baseRegisterType(e.config.registerType);
  const scenarioCount = useMemo(
    () => builtinScenarios(params).filter((s) => s.registerTypes.includes(activeBase)).length,
    [params, activeBase],
  );
  const lastRun = r.lastResult;
  const rerunScenario = useMemo(
    () => (lastRun ? builtinScenarios(params).find((s) => s.id === lastRun.id) ?? null : null),
    [lastRun, params],
  );

  return (
    <div className="app">
      <TopBar e={e} theme={theme} setTheme={setTheme} />

      {/* Fixed 2×2 grid: Quick Keys / Transaction on top, Ads / Info below.
          Each quadrant is a fixed box that scrolls its own overflow. */}
      <div className="grid2x2">
        <section className="quad quad-qk">
          <QuickKeys e={e} locale={locale} />
        </section>

        <section className="quad quad-tx">
          <TransactionPanel e={e} locale={locale} />
        </section>

        <section className="quad quad-ads">
          <div className="adshead">
            <span className="adstitle">Ads</span>
            <span className="adscount">{e.adManifest.length}</span>
          </div>
          <TriggersCompleters e={e} r={r} params={params} />
        </section>

        <section className="quad quad-info">
          <InfoPanel
            e={e}
            r={r}
            params={params}
            tab={panelTab}
            setTab={setPanelTab}
            scenarioCount={scenarioCount}
            lastRun={lastRun}
            rerunScenario={rerunScenario}
            scenario={{
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
            }}
          />
        </section>
      </div>
    </div>
  );
}

export default App;
