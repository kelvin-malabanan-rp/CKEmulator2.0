import { useEffect, useRef, useState } from 'react';
import { formatCurrency, type PosLocale } from '../../../core/currency';
import { REGISTER_TYPES } from '../../../core/posTypes';
import type { useEmulator } from '../useEmulator';

/**
 * The hero panel: running basket + totals + tender. Empty state is a large
 * centered prompt; once items are rung it becomes a scrollable line-item table
 * with monospace numbers. Void is a small, right-aligned danger button gated
 * behind a confirm modal (item count + total + "can't be undone") — never a
 * bare tap-to-void.
 */
export function TransactionPanel({
  e,
  locale,
}: {
  e: ReturnType<typeof useEmulator>;
  locale: PosLocale;
}): JSX.Element {
  const { snapshot } = e;
  const hasItems = snapshot.lines.some((l) => !l.voided);
  const visibleLines = snapshot.lines.filter((li) => !li.voided);
  const [confirmingVoid, setConfirmingVoid] = useState(false);

  // Keep the newest scan in view: new lines append to the bottom, so scroll the
  // basket to the bottom whenever a line is added — the cashier never has to
  // scroll to the latest item. Keyed on the last line number + count so it fires
  // on each add (and after a void that shifts the tail), not on every render.
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastLineNumber = visibleLines.length ? visibleLines[visibleLines.length - 1].lineNumber : 0;
  useEffect(() => {
    const el = bodyRef.current;
    // Only when there are items — scrolling the empty state to the bottom would
    // push the centered "No items" prompt out of view on load.
    if (el && visibleLines.length > 0) el.scrollTop = el.scrollHeight;
  }, [lastLineNumber, visibleLines.length]);

  // Terminal/VJ context for the header (muted mono, right-aligned).
  const regLabel = REGISTER_TYPES.find((r) => r.value === e.config.registerType)?.label ?? e.config.registerType;
  const context = `${regLabel} · VJ ${e.config.host}:${e.config.vjPort}`;

  const doVoid = (): void => {
    e.voidTicket();
    setConfirmingVoid(false);
  };

  return (
    <section className="txpanel">
      <div className="txhead">
        <h2 className="txtitle">Transaction #{snapshot.tx}</h2>
        <span className="txcontext" title={context}>{context}</span>
      </div>

      <div className="txbody" ref={bodyRef}>
        {visibleLines.length === 0 ? (
          <div className="txempty">
            <span className="txemptybig">No items</span>
            <span className="txemptysub">Tap or search a quick key to start ringing</span>
          </div>
        ) : (
          <table className="basket">
            <thead>
              <tr>
                <th className="col-item">Item</th>
                <th className="col-qty">Qty</th>
                <th className="col-price">Price</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleLines.map((li) => (
                <tr key={li.lineNumber}>
                  <td>{li.description}</td>
                  <td className="num">{li.quantity}</td>
                  <td className="num">{formatCurrency(li.extendedCents, locale)}</td>
                  <td className="lineactions">
                    <button
                      title="Add another of this item (new line)"
                      onClick={() => e.addCustom({ code: li.code, description: li.description, priceCents: li.unitPriceCents, quantity: 1 })}
                    >
                      +1
                    </button>
                    <button className="linevoid" title="Void this line" onClick={() => e.voidLine(li.lineNumber)}>
                      void
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="totals">
        <div><span>Subtotal</span><b className="num">{formatCurrency(snapshot.subtotalCents, locale)}</b></div>
        <div><span>Tax</span><b className="num">{formatCurrency(snapshot.taxCents, locale)}</b></div>
        <div className="grand"><span>Total</span><b className="num">{formatCurrency(snapshot.totalCents, locale)}</b></div>
      </div>

      <div className="tender">
        <button className="primary" disabled={!hasItems} onClick={() => e.tender('cash-exact')}>Cash (exact)</button>
        <button className="secondary" disabled={!hasItems} onClick={() => e.tender('next-dollar')}>Next $</button>
        <button className="primary" disabled={!hasItems} onClick={() => e.tender('amount', snapshot.totalCents + 500)}>Cash +$5</button>
        <button className="voidticket" disabled={!hasItems} onClick={() => setConfirmingVoid(true)}>Void ticket</button>
      </div>

      {confirmingVoid && (
        <div className="modal" onClick={() => setConfirmingVoid(false)}>
          <div className="modalbox voidmodalbox" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="modaltitle">Void ticket?</h3>
            <div className="voidmodalmsg">
              <div>
                {visibleLines.length} item{visibleLines.length === 1 ? '' : 's'} ·{' '}
                <span className="num">{formatCurrency(snapshot.totalCents, locale)}</span>
              </div>
              <span className="voidwarn">This can't be undone.</span>
            </div>
            <div className="voidconfirmbtns">
              <button className="voidcancel" onClick={() => setConfirmingVoid(false)}>Cancel</button>
              <button className="voidconfirmbtn" onClick={doVoid}>Void ticket</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
