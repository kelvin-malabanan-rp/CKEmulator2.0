import { useEffect, useRef, useState } from 'react';
import { dotState, type DotState } from '../connState';
import { summarizeConnections, type ConnChannel } from '../connSummary';
import { isLoaRegisterType, LOA_PLAYER_ENTRY_URL } from '../../../core/posTypes';
import type { useEmulator } from '../useEmulator';

/** Per-channel detail line shown in the popover. */
interface Endpoint extends ConnChannel {
  target: string;
}

const DETAIL: Record<DotState, string> = {
  idle: 'not connected yet',
  connecting: 'connecting…',
  connected: 'connected',
  error: 'disconnected — handshake failed or dropped',
};

/**
 * Collapsed connection status for the top bar: one dot + a summary label that
 * rolls up VJ/Pole/Scanner (never says "online" while anything is degraded).
 * Clicking opens a popover listing every endpoint with its own dot and
 * IP:port; a detail line appears below a divider only while something is not
 * fully connected. Closes on outside click (click-triggered, matching the
 * per-dot popover elsewhere).
 */
export function ConnectionStatus({ e }: { e: ReturnType<typeof useEmulator> }): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // LOA drives the player over cross-origin postMessage to an embedded iframe —
  // there are no VJ/Pole/Scanner sockets, so show a single postMessage endpoint
  // instead of the (always-red) hardware channels. The bridge is "connected"
  // once the mode is active (the iframe is mounted and we can post to it).
  const isLoa = isLoaRegisterType(e.config.registerType);
  const endpoints: Endpoint[] = isLoa
    ? [{ label: 'postMessage', state: 'connected', target: new URL(LOA_PLAYER_ENTRY_URL).host }]
    : [
        { label: 'VJ', state: dotState(e.status.vj, e.attempted), target: `${e.config.host}:${e.config.vjPort}` },
        { label: 'Pole', state: dotState(e.status.pole, e.attempted), target: `${e.config.host}:${e.config.polePort}` },
        ...(e.config.scannerPort !== undefined
          ? [{ label: 'Scanner', state: dotState(e.status.scanner, e.attempted), target: `${e.config.host}:${e.config.scannerPort}` }]
          : []),
      ];
  const summary = summarizeConnections(endpoints);
  const degraded = endpoints.filter((ep) => ep.state !== 'connected' && ep.state !== 'idle');

  return (
    <div className="connstatus" ref={wrapRef}>
      <button
        className="connsummary"
        title="Connection status — click for detail"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`dot ${summary.overall}`} />
        <span className="connlabel">{summary.label}</span>
      </button>
      {open && (
        <div className="connpop" role="dialog" aria-label="Connection detail">
          {endpoints.map((ep) => (
            <div key={ep.label} className="connrow">
              <span className={`dot ${ep.state}`} />
              <span className="conname">{ep.label}</span>
              <span className="connaddr">{ep.target}</span>
            </div>
          ))}
          {degraded.length > 0 && (
            <div className="conndetail">
              {degraded.map((ep) => (
                <div key={ep.label}>
                  {ep.label} {DETAIL[ep.state]}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
