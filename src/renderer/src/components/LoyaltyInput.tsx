import { useState } from 'react';
import type { useEmulator } from '../useEmulator';

/** Loyalty / EasyPay card entry — types or scans a card number into the 1024 flow. */
export function LoyaltyInput({ e }: { e: ReturnType<typeof useEmulator> }): JSX.Element {
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
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') submit();
          }}
        />
        <button className="loyaltybtn" onClick={submit} disabled={!card.trim()}>
          Scan
        </button>
      </div>
    </div>
  );
}
