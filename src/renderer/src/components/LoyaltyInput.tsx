import { useEffect, useRef, useState } from 'react';
import type { useEmulator } from '../useEmulator';

type LoyaltyStatus = 'idle' | 'sending' | 'sent';

/**
 * Loyalty / EasyPay card entry — types or scans a card number into the 1024
 * flow. The inline indicator is deliberately honest: the wire returns no
 * loyalty result, so it only reflects what we know locally (idle → sending →
 * sent). It never claims success/failure the player hasn't reported.
 */
export function LoyaltyInput({ e }: { e: ReturnType<typeof useEmulator> }): JSX.Element {
  const [card, setCard] = useState('8018782603900002665855');
  const [status, setStatus] = useState<LoyaltyStatus>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const submit = (): void => {
    const trimmed = card.trim();
    if (!trimmed) return;
    timers.current.forEach(clearTimeout);
    e.loyalty(trimmed);
    setStatus('sending');
    // No inbound loyalty-result frame exists, so settle to a neutral "sent"
    // after the send and fade back to idle — never a fake green check / red x.
    timers.current = [
      setTimeout(() => setStatus('sent'), 500),
      setTimeout(() => setStatus('idle'), 3000),
    ];
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
        <span className={`loyaltystatus ${status}`} title={`Loyalty send: ${status}`} aria-live="polite">
          {status === 'sending' ? <span className="spinner" /> : status === 'sent' ? '✓ sent' : ''}
        </span>
      </div>
    </div>
  );
}
