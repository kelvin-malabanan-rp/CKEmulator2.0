import { useEffect, useState } from 'react';
import { isInteractiveTemplate, type AdItem } from '../../../core/adTriggers';
import { scenarioForAd, type ScenarioParams } from '../../../core/scenarios';
import type { useEmulator } from '../useEmulator';
import type { useScenarioRunner } from '../useScenarioRunner';

/**
 * Triggers & Completers — lists the live ads (from the backend manifest), each
 * with Triggers (UPCs that fire it) and Completers (items that complete its
 * offer). Click an item in the modal to scan it straight into the basket.
 * Silent-capable ads (injectItem/addDiscount figs) also get a Silent ▶ button
 * that runs the scan→sign-in→wait-for-inject scenario for that ad.
 */
export function TriggersCompleters({
  e,
  r,
  params,
}: {
  e: ReturnType<typeof useEmulator>;
  r: ReturnType<typeof useScenarioRunner>;
  params: ScenarioParams;
}): JSX.Element {
  const [page, setPage] = useState(0);
  const [modalPage, setModalPage] = useState(0);
  const [modal, setModal] = useState<{
    ad: { id: string; name: string };
    kind: 'triggers' | 'completers';
    items: AdItem[];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "<id>:triggers" | "<id>:completers"
  const ads = e.adManifest;
  const perPage = 9; // 3 columns × 3 rows
  const pageCount = Math.max(1, Math.ceil(ads.length / perPage));
  const safePage = Math.min(page, pageCount - 1);
  const current = ads.slice(safePage * perPage, safePage * perPage + perPage);

  // Modal item grid pagination (reset to page 0 whenever the modal changes).
  const MODAL_PER_PAGE = 12; // 2 columns × 6 rows
  const modalPageCount = modal ? Math.max(1, Math.ceil(modal.items.length / MODAL_PER_PAGE)) : 1;
  const modalSafePage = Math.min(modalPage, modalPageCount - 1);
  const modalItems = modal ? modal.items.slice(modalSafePage * MODAL_PER_PAGE, modalSafePage * MODAL_PER_PAGE + MODAL_PER_PAGE) : [];
  useEffect(() => setModalPage(0), [modal]);

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
            <small className="hint">{ads.length} ad(s)</small>
          )
        ) : (
          <small className="hint">Register the player, then Load ads</small>
        )}
      </div>

      {/* Persistent legend so the row indicators aren't a guessing game. */}
      {ads.length > 0 && (
        <div className="tclegend">
          <span className="tclegenditem" title="This ad has completer items configured">
            <span className="tcdot has" /> has completers
          </span>
          <span className="tclegenditem" title="This ad has no completers (its Completers button is disabled)">
            <span className="tcdot none" /> none
          </span>
          <span className="tclegenditem" title="Interactive microsite ad (has figs) — the left accent bar marks these">
            <span className="tcaccentbar" /> interactive
          </span>
        </div>
      )}

      {ads.length > 0 && (
        <div className="tcgrid">
          {current.map((ad) => {
              const cs = completerState(ad.id);
              const detail = adDetails[ad.id];
              const template = detail?.template ?? '';
              const interactive = isInteractiveTemplate(template);
              const silent = detail?.silentCapable && detail.triggers.length > 0 && e.config.registerType !== 'bulloch';
              return (
                <div
                  key={ad.id || ad.name}
                  className={`tccard${interactive ? ' interactive' : ''}`}
                  title={interactive ? 'Interactive ad — the left accent bar marks interactive microsite ads' : undefined}
                >
                  <div className="tccardhead">
                    <span
                      className={`tcdot ${cs}`}
                      title={cs === 'has' ? 'Has completers' : cs === 'none' ? 'No completers' : 'Checking…'}
                    />
                    <span className="tccardname" title={ad.name}>{ad.name}</span>
                    {silent && (
                      <button
                        className="tcsilent"
                        disabled={r.running !== null}
                        title="Run the silent-injection scenario for this ad: scan its trigger, sign in, wait for the player to inject the completer, tender."
                        onClick={() => void r.runScenario(scenarioForAd(detail!, params)!)}
                      >
                        ▶
                      </button>
                    )}
                  </div>
                  <span className="tccardtype" title={interactive ? 'Interactive microsite ad (has figs)' : 'Plain image/video ad'}>
                    {template || 'Ad'}
                  </span>
                  <div className="tccardbtns">
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
                  </div>
                </div>
              );
            })}
        </div>
      )}
      {ads.length > 0 && pageCount > 1 && (
        <div className="qkpager">
          <button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
            ‹
          </button>
          <span>
            {safePage + 1}/{pageCount}
          </span>
          <button disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
            ›
          </button>
        </div>
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
              <>
                <div className="tcitems">
                  {modalItems.map((it) => (
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
                {modalPageCount > 1 && (
                  <div className="qkpager">
                    <button disabled={modalSafePage === 0} onClick={() => setModalPage(modalSafePage - 1)}>
                      ‹
                    </button>
                    <span>
                      {modalSafePage + 1}/{modalPageCount}
                    </span>
                    <button disabled={modalSafePage >= modalPageCount - 1} onClick={() => setModalPage(modalSafePage + 1)}>
                      ›
                    </button>
                  </div>
                )}
              </>
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
