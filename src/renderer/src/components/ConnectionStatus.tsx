import { useEffect, useRef, useState } from 'react';
import { dotState, type DotState } from '../connState';
import { summarizeConnections, type ConnChannel } from '../connSummary';
import { isLoaRegisterType, isOctaneRegisterType, loaEntryUrlForTarget } from '../../../core/posTypes';
import { OCTANE_DEFAULT_SCAN_PORT, OCTANE_JOURNAL_PATH, OCTANE_SCAN_PATH } from '../../../core/octaneEndpoints';
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
  // instead of the hardware channels. It's green when the player is mounted
  // (Connect) and red when not (Disconnect / before connecting), so the Connect
  // button is the way to (re-)boot the embedded player.
  const isLoa = isLoaRegisterType(e.config.registerType);
  // Octane speaks HTTP in both directions and has no pole: the VJ is a servlet
  // we POST to on the player, and "Scan-in" is the server WE run for the
  // player's completer injects. Listing Pole here would report a permanently
  // red endpoint that this register type simply doesn't have.
  const isOctane = isOctaneRegisterType(e.config.registerType);
  const endpoints: Endpoint[] = isLoa
    ? [
        {
          label: 'postMessage',
          state: e.loaConnected ? 'connected' : 'error',
          target: new URL(loaEntryUrlForTarget(e.config.registerType, e.config.loaEnv)).host,
        },
      ]
    : isOctane
    ? [
        {
          label: 'VJ',
          state: dotState(e.status.vj, e.attempted),
          target: `${e.config.host}:${e.config.vjPort}${OCTANE_JOURNAL_PATH}`,
        },
        {
          label: 'Scan-in',
          state: dotState(e.status.scanner, e.attempted),
          target: `:${e.config.scannerPort ?? OCTANE_DEFAULT_SCAN_PORT}${OCTANE_SCAN_PATH}`,
        },
      ]
    : [
        // Bulloch is pole-only (the transport never opens a VJ socket) and
        // Radiant6 US has no pole display, so each lane lists only the
        // channels it actually opens — never a permanently red endpoint.
        ...(e.config.registerType !== 'bulloch'
          ? [{ label: 'VJ', state: dotState(e.status.vj, e.attempted), target: `${e.config.host}:${e.config.vjPort}` }]
          : []),
        ...(e.config.polePort > 0
          ? [{ label: 'Pole', state: dotState(e.status.pole, e.attempted), target: `${e.config.host}:${e.config.polePort}` }]
          : []),
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
