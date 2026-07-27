import type { DotState } from './connState';

/** One connection endpoint's label + its derived visual state. */
export interface ConnChannel {
  label: string;
  state: DotState;
}

/** Rolled-up status for the collapsed top-bar indicator (one dot + one label). */
export interface ConnSummary {
  /** Worst-of the channels, driving the single dot's colour. */
  overall: DotState;
  /** One-line summary — never reads "online" while any channel is degraded. */
  label: string;
}

/**
 * Roll up per-channel connection states into a single dot + summary label for
 * the collapsed top-bar status. Precedence is error > connecting > connected >
 * idle, so the summary can never say "online" while anything is degraded: a
 * degraded channel is named specifically (e.g. "Scanner connecting"). Pure (no
 * clock / DOM) so it is unit-testable.
 */
export function summarizeConnections(channels: ConnChannel[]): ConnSummary {
  if (channels.length === 0) return { overall: 'idle', label: 'Not connected' };

  const labelsIn = (s: DotState): string[] =>
    channels.filter((c) => c.state === s).map((c) => c.label);
  const errored = labelsIn('error');
  const connecting = labelsIn('connecting');
  const connected = labelsIn('connected');
  const idle = labelsIn('idle');

  // Error wins — one down endpoint must never be summarised as "online".
  if (errored.length > 0) {
    return { overall: 'error', label: `${errored.join(', ')} disconnected` };
  }
  // Then in-flight handshakes — amber, name the affected endpoint(s).
  if (connecting.length > 0) {
    return { overall: 'connecting', label: `${connecting.join(', ')} connecting` };
  }
  // Everything up.
  if (connected.length === channels.length) {
    return { overall: 'connected', label: `${connected.join(' · ')} online` };
  }
  // Nothing attempted yet.
  if (idle.length === channels.length) {
    return { overall: 'idle', label: 'Not connected' };
  }
  // Defensive: a partial mix with no error/connecting (unreachable with a single
  // global "attempted" flag) — name what isn't up rather than claim online.
  const notUp = channels.filter((c) => c.state !== 'connected').map((c) => c.label);
  return { overall: 'idle', label: `${notUp.join(', ')} not connected` };
}
