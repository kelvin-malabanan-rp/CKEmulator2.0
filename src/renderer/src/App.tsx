import { useCallback, useEffect, useMemo, useState } from 'react';
import { PRICEBOOK, useEmulator } from './useEmulator';
import { useScenarioRunner } from './useScenarioRunner';
import { formatCurrency, type PosLocale } from '../../core/currency';
import { paginate } from '../../core/quickkeys';
import { isInteractiveTemplate, type AdItem } from '../../core/adTriggers';
import { builtinScenarios, scenarioForAd, type ScenarioParams } from '../../core/scenarios';
import type { RunResult, StepResult, StepStatus } from '../../core/scenarioRunner';
import { REGISTER_TYPES, portsForRegisterType, type ConnState, type RegisterType } from '../../core/posTypes';
import './App.css';

const QK_PER_PAGE = 9; // 3 columns × 3 rows
const SCENARIO_CARD_KEY = 'r6ca.scenario.loyaltyCard';
const SCENARIO_GAP_KEY = 'r6ca.scenario.stepGapMs';
const DEFAULT_SCENARIO_CARD = '70846414251491703';
const DEFAULT_STEP_GAP_MS = 750;

function Dot({ state }: { state: ConnState }): JSX.Element {
  const color = state === 'connected' ? '#3ec46d' : state === 'connecting' ? '#e6b450' : '#d9534f';
  return <span className="dot" style={{ background: color }} title={state} />;
}

/** Quick keys driven by .qk files: 3-wide grid that fills the column, paginated, colored. */
function QuickKeys({ e, locale }: { e: ReturnType<typeof useEmulator>; locale: PosLocale }): JSX.Element {
  const [tab, setTab] = useState(0);
  const [page, setPage] = useState(0);
  const perPage = QK_PER_PAGE; // fixed 3×3 grid
  const files = e.quickKeyFiles;
  const active = files[Math.min(tab, Math.max(0, files.length - 1))];
  const pages = useMemo(() => paginate(active?.entries ?? [], perPage), [active, perPage]);
  const safePage = Math.min(page, pages.length - 1);
  const current = pages[safePage] ?? [];

  useEffect(() => setPage(0), [tab]);

  return (
    <div className="qk">
      {files.length > 1 && (
        <div className="qktabs">
          {files.map((f, i) => (
            <button key={f.file} className={i === tab ? 'on' : ''} onClick={() => setTab(i)}>
              {f.file.replace(/\.qk$/i, '')}
            </button>
          ))}
        </div>
      )}
      <div className="grid qk3">
        {current.map((entry, i) => (
          <button
            key={`${entry.upc}-${i}`}
            className={`key ${e.quickKeyColorFor(entry.upc)}`}
            title={entry.upc}
            onClick={() => e.fireQuickKey(entry)}
          >
            <span>{entry.description}</span>
            <small>{formatCurrency(entry.priceCents, locale)}</small>
          </button>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="qkpager">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ‹
          </button>
          <span>
            {safePage + 1}/{pages.length}
          </span>
          <button disabled={safePage >= pages.length - 1} onClick={() => setPage(safePage + 1)}>
            ›
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Triggers & Completers — lists the live ads (from the backend manifest), each
 * with Triggers (UPCs that fire it) and Completers (items that complete its
 * offer). Click an item in the modal to scan it straight into the basket.
 * Silent-capable ads (injectItem/addDiscount figs) also get a Silent ▶ button
 * that runs the scan→sign-in→wait-for-inject scenario for that ad.
 */
function TriggersCompleters({
  e,
  r,
  params,
}: {
  e: ReturnType<typeof useEmulator>;
  r: ReturnType<typeof useScenarioRunner>;
  params: ScenarioParams;
}): JSX.Element {
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<{
    ad: { id: string; name: string };
    kind: 'triggers' | 'completers';
    items: AdItem[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "<id>:triggers" | "<id>:completers"
  const perPage = 3;
  const ads = e.adManifest;
  const pageCount = Math.max(1, Math.ceil(ads.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const current = ads.slice(safePage * perPage, safePage * perPage + perPage);

  // Details are background-prefetched by loadAds; read them here for indicators.
  const adDetails = e.adDetails;
  const loadedCount = Object.keys(adDetails).length;

  // Close the modal once CKP2 acts on the offer: a completer inject from the
  // player, or the transaction ending/resetting (tx advances on tender/void).
  const { tx } = e.snapshot;
  const injectSeq = e.injectSeq;
  useEffect(() => {
    setModal(null);
  }, [tx, injectSeq]);

  // Completer indicator per ad: 'has' (green) / 'none' (grey) / 'unknown' (faint, still loading).
  const completerState = (id: string): 'has' | 'none' | 'unknown' => {
    const d = adDetails[id];
    if (!d) return 'unknown';
    return d.completers.length > 0 ? 'has' : 'none';
  };

  const open = async (ad: { id: string; name: string }, kind: 'triggers' | 'completers'): Promise<void> => {
    setBusy(`${ad.id}:${kind}`);
    const detail = e.adDetails[ad.id] ?? (await e.loadAdDetail(ad.id));
    setBusy(null);
    const items = !detail ? [] : kind === 'triggers' ? detail.triggers : detail.completers;
    // No completer modal for an ad with no completers.
    if (kind === 'completers' && items.length === 0) return;
    setModal({ ad, kind, items });
  };

  // Scanning a trigger fires the ad → close the triggers modal and surface that
  // ad's completers (mirrors the real basket flow). Scanning a completer just
  // rings it up and leaves the modal open.
  const onItemClick = (it: AdItem): void => {
    if (!modal) return;
    e.scan(it.code, it.description);
    if (modal.kind === 'triggers') {
      // Trigger fired → open the ad's completers, or just close if it has none.
      const completers = e.adDetails[modal.ad.id]?.completers ?? [];
      if (completers.length === 0) {
        setModal(null);
        return;
      }
      setModal({ ad: modal.ad, kind: 'completers', items: completers });
    } else {
      // Completer selected → close the modal.
      setModal(null);
    }
  };

  return (
    <div className="tc">
      <div className="tcctl">
        <button onClick={() => void e.loadAds()} disabled={e.adsStatus.loading}>
          {e.adsStatus.loading ? 'Loading…' : 'Load ads'}
        </button>
        {e.adsStatus.error ? (
          <small className="tcerr" title={e.adsStatus.error}>{e.adsStatus.error}</small>
        ) : ads.length > 0 ? (
          loadedCount < ads.length ? (
            <small className="hint">loading details… {loadedCount}/{ads.length}</small>
          ) : (
            <small className="hint tclegend">
              {ads.length} ad(s) · <span className="tcdot has" /> completers ·{' '}
              <span className="tcaccentbar" /> interactive
            </small>
          )
        ) : (
          <small className="hint">Register the player, then Load ads</small>
        )}
      </div>

      {ads.length > 0 && (
        <>
          <div className="tclist">
            {current.map((ad) => {
              const cs = completerState(ad.id);
              const detail = adDetails[ad.id];
              const template = detail?.template ?? '';
              const interactive = isInteractiveTemplate(template);
              return (
                <div key={ad.id || ad.name} className={`tcrow${interactive ? ' interactive' : ''}`}>
                  <span
                    className={`tcdot ${cs}`}
                    title={cs === 'has' ? 'Has completers' : cs === 'none' ? 'No completers' : 'Checking…'}
                  />
                  <div className="tcnamewrap">
                    <span className="tcname" title={ad.name}>{ad.name}</span>
                    {template && (
                      <span className="tctmpl" title={interactive ? 'Interactive microsite ad (has figs)' : 'Plain image/video ad'}>
                        {template}
                      </span>
                    )}
                  </div>
                  <button className="tcbtn" disabled={busy !== null} onClick={() => void open(ad, 'triggers')}>
                    {busy === `${ad.id}:triggers` ? '…' : 'Triggers'}
                  </button>
                  <button
                    className="tcbtn"
                    disabled={busy !== null || cs === 'none'}
                    title={cs === 'none' ? 'No completers' : undefined}
                    onClick={() => void open(ad, 'completers')}
                  >
                    {busy === `${ad.id}:completers` ? '…' : 'Completers'}
                  </button>
                  {detail?.silentCapable && detail.triggers.length > 0 && e.config.registerType !== 'bulloch' && (
                    <button
                      className="tcbtn"
                      disabled={r.running !== null}
                      title="Run the silent-injection scenario for this ad: scan its trigger, sign in, wait for the player to inject the completer, tender."
                      onClick={() => void r.runScenario(scenarioForAd(detail, params)!)}
                    >
                      Silent ▶
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {pageCount > 1 && (
            <div className="qkpager">
              <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹</button>
              <span>{safePage + 1}/{pageCount}</span>
              <button disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>›</button>
            </div>
          )}
        </>
      )}

      {modal && (
        <div className="tcmodal" onClick={() => setModal(null)}>
          <div className="tcmodalbox" onClick={(ev) => ev.stopPropagation()}>
            <div className="tcmodalhead">
              <b>{modal.kind === 'triggers' ? 'Triggers' : 'Completers'} — {modal.ad.name}</b>
              <button onClick={() => setModal(null)}>×</button>
            </div>
            {modal.items.length === 0 ? (
              <small className="hint">{modal.kind === 'triggers' ? 'No triggers.' : 'No completers.'}</small>
            ) : (
              <div className="tcitems">
                {modal.items.map((it) => (
                  <button
                    key={it.code}
                    className="tcitem"
                    title={modal.kind === 'triggers' ? 'Scan to fire this ad, then pick a completer' : 'Scan this completer into the basket'}
                    onClick={() => onItemClick(it)}
                  >
                    <span>{it.description || it.code}</span>
                    <small>{it.code}</small>
                  </button>
                ))}
              </div>
            )}
            <small className="hint">
              {modal.kind === 'triggers'
                ? 'Click a trigger to scan it — then its completers appear.'
                : 'Click a completer to scan it into the basket.'}
            </small>
          </div>
        </div>
      )}
    </div>
  );
}

function LoyaltyInput({ e }: { e: ReturnType<typeof useEmulator> }): JSX.Element {
  const [card, setCard] = useState('8018782603900002665855');

  const submit = (): void => {
    const trimmed = card.trim();
    if (!trimmed) return;
    e.loyalty(trimmed);
  };

  return (
    <div className="loyalty">
      <h3>Loyalty / EasyPay</h3>
      <small className="hint">Scan or type loyalty card #</small>
      <div className="loyaltyrow">
        <input
          type="text"
          className="loyaltyinput"
          value={card}
          onChange={(ev) => setCard(ev.target.value)}
          onKeyDown={(ev) => { if (ev.key === 'Enter') submit(); }}
        />
        <button className="loyaltybtn" onClick={submit} disabled={!card.trim()}>
          Scan
        </button>
      </div>
    </div>
  );
}

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
};

const REGISTER_TAG_TITLE: Record<RegisterType, string> = {
  'radiant6-canada': 'Radiant6 Canada',
  'radiant6-us': 'Radiant6 US',
  bulloch: 'Bulloch (Canada, pole-only)',
};

/** Compact per-step trail: `n/m kind glyph [detail]` — used live and for the last result. */
function StepRows({ steps }: { steps: StepResult[] }): JSX.Element {
  return (
    <div className="steplist">
      {steps.map((s, i) => (
        <div key={i} className="steprow">
          <span className="stepnum">{i + 1}/{steps.length}</span>
          <span className="stepkind">{s.step.kind}</span>
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
function Scenarios({
  e,
  r,
  params,
  loyaltyCard,
  setLoyaltyCard,
  stepGapMs,
  setStepGapMs,
}: {
  e: ReturnType<typeof useEmulator>;
  r: ReturnType<typeof useScenarioRunner>;
  params: ScenarioParams;
  loyaltyCard: string;
  setLoyaltyCard: (card: string) => void;
  stepGapMs: number;
  setStepGapMs: (ms: number) => void;
}): JSX.Element {
  const registerType = e.config.registerType;
  const list = useMemo(
    () => builtinScenarios(params).filter((s) => s.registerTypes.includes(registerType)),
    [params, registerType],
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
      </div>
      <div className="sclist">
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
                    <span key={t} className={`sctag${t === registerType ? ' on' : ''}`} title={REGISTER_TAG_TITLE[t]}>
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

function App(): JSX.Element {
  const e = useEmulator();
  // One runner shared by the Scenarios panel and the per-ad Silent ▶ buttons,
  // so "one run at a time" holds across both entry points.
  const r = useScenarioRunner(e);
  const { snapshot } = e;
  const locale = snapshot.locale;
  // Tender/void only make sense with a live basket; disabled when empty so they
  // can't spawn stray transactions or be spammed.
  const hasItems = snapshot.lines.some((l) => !l.voided);

  // Right column shows either the Wire Log or the Scenarios panel. Starting a
  // run (incl. per-ad Silent ▶ from the left column) switches to Scenarios so
  // the step ticker is visible.
  const [rightTab, setRightTab] = useState<'log' | 'scenarios'>('log');
  const running = r.running;
  useEffect(() => {
    if (running !== null) setRightTab('scenarios');
  }, [running]);

  // Scenario knobs, persisted like the other r6ca.* localStorage settings.
  const [loyaltyCard, setLoyaltyCardState] = useState<string>(() => {
    try {
      return localStorage.getItem(SCENARIO_CARD_KEY) ?? DEFAULT_SCENARIO_CARD;
    } catch {
      return DEFAULT_SCENARIO_CARD;
    }
  });
  const [stepGapMs, setStepGapMsState] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(SCENARIO_GAP_KEY);
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STEP_GAP_MS;
    } catch {
      return DEFAULT_STEP_GAP_MS;
    }
  });
  const setLoyaltyCard = useCallback((card: string) => {
    setLoyaltyCardState(card);
    try {
      localStorage.setItem(SCENARIO_CARD_KEY, card);
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, []);
  const setStepGapMs = useCallback((ms: number) => {
    setStepGapMsState(ms);
    try {
      localStorage.setItem(SCENARIO_GAP_KEY, String(ms));
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, []);

  // Item codes for the canned scenarios: first two quick keys, falling back to
  // the derived quick-key picks, then the bundled PRICEBOOK constants.
  const params = useMemo<ScenarioParams>(() => {
    const qkEntries = e.quickKeyFiles[0]?.entries ?? [];
    return {
      itemCode: qkEntries[0]?.upc ?? e.quickKeys[0]?.code ?? PRICEBOOK[0].code,
      itemCode2: qkEntries[1]?.upc ?? e.quickKeys[1]?.code ?? PRICEBOOK[1].code,
      loyaltyCard,
      upcCoupon12: '012345678905',
      stepGapMs,
    };
  }, [e.quickKeyFiles, e.quickKeys, loyaltyCard, stepGapMs]);

  return (
    <div className="app">
      <header className="bar">
        <strong>Canada Emulator</strong>
        <span className="conn">
          <Dot state={e.status.vj} /> VJ {e.config.host}:{e.config.vjPort}
          <Dot state={e.status.pole} /> Pole {e.config.host}:{e.config.polePort}
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
            e.setConfig({ ...e.config, registerType, ...portsForRegisterType(registerType) });
          }}
        >
          {REGISTER_TYPES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label} (VJ {r.vjPort} / Pole {r.polePort})
            </option>
          ))}
        </select>
        <button onClick={() => void e.connect()}>Connect</button>
        <button onClick={() => void e.disconnect()}>Disconnect</button>
        <span className="spacer" />
        {/* US lanes are en-US only — hide the toggle there. Switching to US
            while fr is active is already coherent: the session rebuild carries
            locale through RegisterSession.setLocale, which ignores 'fr' in US
            mode, so the fresh snapshot reads 'en'. */}
        {e.config.registerType !== 'radiant6-us' && (
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

        <section className="center">
          <h3>Transaction #{snapshot.tx}</h3>
          <table className="basket">
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Ext</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snapshot.lines.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">No items — tap a quick key</td>
                </tr>
              )}
              {snapshot.lines.map((li) => (
                <tr key={li.lineNumber} className={li.voided ? 'voided' : ''}>
                  <td>{li.lineNumber}</td>
                  <td>{li.description}</td>
                  <td>{li.quantity}</td>
                  <td>{formatCurrency(li.unitPriceCents, locale)}</td>
                  <td>{formatCurrency(li.extendedCents, locale)}</td>
                  <td className="lineactions">
                    {!li.voided && (
                      <>
                        <button onClick={() => e.setQuantity(li.lineNumber, li.quantity + 1)}>+1</button>
                        <button onClick={() => e.setPrice(li.lineNumber, Math.max(0, li.unitPriceCents - 10))}>-10¢</button>
                        <button onClick={() => e.voidLine(li.lineNumber)}>void</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="totals">
            <div><span>Subtotal</span><b>{formatCurrency(snapshot.subtotalCents, locale)}</b></div>
            <div><span>Tax</span><b>{formatCurrency(snapshot.taxCents, locale)}</b></div>
            <div className="grand"><span>Total</span><b>{formatCurrency(snapshot.totalCents, locale)}</b></div>
          </div>

          <div className="tender">
            <button disabled={!hasItems} onClick={() => e.tender('cash-exact')}>Cash (exact)</button>
            <button disabled={!hasItems} onClick={() => e.tender('next-dollar')}>Next $</button>
            <button disabled={!hasItems} onClick={() => e.tender('amount', snapshot.totalCents + 500)}>Cash +$5</button>
            <button className="voidticket" disabled={!hasItems} onClick={() => e.voidTicket()}>Void Ticket</button>
          </div>
        </section>

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
