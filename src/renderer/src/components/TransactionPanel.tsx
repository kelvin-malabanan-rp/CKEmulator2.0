import { formatCurrency, type PosLocale } from '../../../core/currency';
import type { useEmulator } from '../useEmulator';

/** Running basket + totals + tender controls for the current transaction. */
export function TransactionPanel({
  e,
  locale,
}: {
  e: ReturnType<typeof useEmulator>;
  locale: PosLocale;
}): JSX.Element {
  const { snapshot } = e;
  // Tender/void only make sense with a live basket; disabled when empty so they
  // can't spawn stray transactions or be spammed.
  const hasItems = snapshot.lines.some((l) => !l.voided);
  const visibleLines = snapshot.lines.filter((li) => !li.voided);

  return (
    <section className="center">
      <h3>Transaction #{snapshot.tx}</h3>
      <table className="basket">
        <thead>
          <tr>
            <th className="col-item">Item</th>
            <th className="col-qty">Qty</th>
            <th className="col-price">Price</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleLines.length === 0 && (
            <tr>
              <td colSpan={4} className="empty">No items — tap a quick key</td>
            </tr>
          )}
          {visibleLines.map((li) => (
            <tr key={li.lineNumber}>
              <td>{li.description}</td>
              <td>{li.quantity}</td>
              <td>{formatCurrency(li.extendedCents, locale)}</td>
              <td className="lineactions">
                <button title="Add another of this item (new line)" onClick={() => e.addCustom({ code: li.code, description: li.description, priceCents: li.unitPriceCents, quantity: 1 })}>+1</button>
                <button title="Void this line" onClick={() => e.voidLine(li.lineNumber)}>void</button>
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
  );
}
