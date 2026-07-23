import { useEffect, useMemo, useState } from 'react';
import { PRICEBOOK, useEmulator } from './useEmulator';
import { useScenarioRunner } from './useScenarioRunner';
import { findAnyCompleter, findPrepayItem } from '../../core/adTriggers';
import { type ScenarioParams } from '../../core/scenarios';
import { REGISTER_TYPES, portsForRegisterType, type RegisterType } from '../../core/posTypes';
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
import { Dot } from './components/Dot';
import { QuickKeys } from './components/QuickKeys';
import { LoyaltyInput } from './components/LoyaltyInput';
import { TriggersCompleters } from './components/TriggersCompleters';
import { Scenarios } from './components/Scenarios';
import { TransactionPanel } from './components/TransactionPanel';
import './App.css';

function App(): JSX.Element {
  const e = useEmulator();
  // One runner shared by the Scenarios panel and the per-ad Silent ▶ buttons,
  // so "one run at a time" holds across both entry points.
  const r = useScenarioRunner(e);
  const { snapshot } = e;
  const locale = snapshot.locale;

  // Right column shows either the Wire Log or the Scenarios panel. Starting a
  // run (incl. per-ad Silent ▶ from the left column) switches to Scenarios so
  // the step ticker is visible.
  const [rightTab, setRightTab] = useState<'log' | 'scenarios'>('log');
  const running = r.running;
  useEffect(() => {
    if (running !== null) setRightTab('scenarios');
  }, [running]);

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

  return (
    <div className="app">
      <header className="bar">
        <strong>CKEmulator 2.0</strong>
        <span className="conn">
          <Dot state={e.status.vj} /> VJ {e.config.host}:{e.config.vjPort}
          <Dot state={e.status.pole} /> Pole {e.config.host}:{e.config.polePort}
          {e.config.scannerPort !== undefined && (
            <>
              <Dot state={e.status.scanner} /> Scanner {e.config.host}:{e.config.scannerPort}
            </>
          )}
        </span>
        <input
          className="host"
          value={e.config.host}
          onChange={(ev) => e.setConfig({ ...e.config, host: ev.target.value })}
        />
        <select
          className="regtype"
          value={e.config.registerType}
          title="Register type — sets the VJ/pole ports automatically"
          onChange={(ev) => {
            const registerType = ev.target.value as RegisterType;
            // scannerPort: undefined first so a stale Topaz port doesn't
            // survive a switch to a scanner-less register type.
            e.setConfig({ ...e.config, registerType, scannerPort: undefined, ...portsForRegisterType(registerType) });
          }}
        >
          {REGISTER_TYPES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} (VJ {r.vjPort} / Pole {r.polePort}
              {r.scannerPort !== undefined ? ` / Scanner ${r.scannerPort}` : ''})
            </option>
          ))}
        </select>
        <button onClick={() => void e.connect()}>Connect</button>
        <button onClick={() => void e.disconnect()}>Disconnect</button>
        <span className="spacer" />
        {/* US lanes (Radiant6 US, Verifone Topaz) are en-US only — hide the
            toggle there. Switching to US while fr is active is already
            coherent: the session rebuild carries locale through
            RegisterSession.setLocale, which ignores 'fr' in US mode, so the
            fresh snapshot reads 'en'. */}
        {e.config.registerType !== 'radiant6-us' && e.config.registerType !== 'verifone-topaz' && (
          <div className="locale">
            <button className={locale === 'en' ? 'on' : ''} onClick={() => e.setLocale('en')}>EN-CA</button>
            <button className={locale === 'fr' ? 'on' : ''} onClick={() => e.setLocale('fr')}>FR-CA</button>
          </div>
        )}
      </header>

      <header className="bar creds">
        <span className="lbl">Player Key</span>
        <input
          className="pkey"
          type="text"
          value={e.playerConfig.playerKey}
          placeholder="player.key"
          onChange={(ev) => e.setPlayerConfig({ ...e.playerConfig, playerKey: ev.target.value })}
        />
        <button onClick={() => void e.registerPlayer()}>Register</button>
        <small className="hint">
          Register resolves the datacenter, player code &amp; backend automatically (like CKP2 + legacy).
        </small>
      </header>

      {(e.globalInit || e.globalInitError) && (
        <div className="initcfg">
          {e.globalInit ? (
            <>
              <div className="initmeta">
                <span>player.code=<b>{e.globalInit.playerCode}</b></span>
                <span>tenant=<b>{e.globalInit.tenant}</b></span>
                <span>{e.globalInit.datacenter}</span>
              </div>
              <pre>{e.globalInit.raw}</pre>
            </>
          ) : (
            <div className="initerr">Register failed: {e.globalInitError}</div>
          )}
        </div>
      )}

      <div className="body">
        <section className="left">
          <div className="qkhead">
            <h3>Quick Keys</h3>
            <button className="qkreload" onClick={() => void e.reloadQuickKeys()} title="Reload quick keys from the .qk files">
              ↻ Reload
            </button>
          </div>
          <QuickKeys e={e} locale={locale} />

          <LoyaltyInput e={e} />

          <h3>Triggers &amp; Completers</h3>
          <TriggersCompleters e={e} r={r} params={params} />
        </section>

        <TransactionPanel e={e} locale={locale} />

        <section className="right">
          <div className="loghead">
            <div className="tabs">
              <button className={rightTab === 'scenarios' ? 'on' : ''} onClick={() => setRightTab('scenarios')}>
                Scenarios
              </button>
              <button className={rightTab === 'log' ? 'on' : ''} onClick={() => setRightTab('log')}>
                Wire Log
              </button>
            </div>
            {rightTab === 'log' && <button onClick={e.clearLog}>clear</button>}
          </div>
          {rightTab === 'scenarios' ? (
            <Scenarios
              e={e}
              r={r}
              params={params}
              loyaltyCard={loyaltyCard}
              setLoyaltyCard={setLoyaltyCard}
              stepGapMs={stepGapMs}
              setStepGapMs={setStepGapMs}
              upcCoupon12={upcCoupon12}
              setUpcCoupon12={setUpcCoupon12}
              prepayAmountCents={prepayAmountCents}
              setPrepayAmountCents={setPrepayAmountCents}
              prepayPumpNumber={prepayPumpNumber}
              setPrepayPumpNumber={setPrepayPumpNumber}
            />
          ) : (
            <div className="log">
              {e.log.map((l) => (
                <div key={l.id} className={`logline ${l.channel}`}>
                  <span className="tag">{l.channel.toUpperCase()}</span>
                  <code>{l.text}</code>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
