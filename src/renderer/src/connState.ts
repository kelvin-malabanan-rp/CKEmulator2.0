import type { ConnState } from '../../core/posTypes';

/**
 * Visual state for a connection dot. Wider than the transport's ConnState so
 * the UI can tell "not attempted yet" (idle, gray) apart from "attempted and
 * down" (error, red) — the transport only knows connected/connecting/
 * disconnected, so the distinction is derived here from whether Connect has
 * been pressed this session.
 */
export type DotState = 'idle' | 'connecting' | 'connected' | 'error';

/**
 * Derive a dot's visual state from the transport's ConnState and whether a
 * connect has been attempted. A `disconnected` channel is idle (gray) until the
 * user presses Connect, after which the same `disconnected` means a failed /
 * dropped handshake (error, red).
 */
export function dotState(conn: ConnState, attempted: boolean): DotState {
  if (conn === 'connected') return 'connected';
  if (conn === 'connecting') return 'connecting';
  return attempted ? 'error' : 'idle';
}
