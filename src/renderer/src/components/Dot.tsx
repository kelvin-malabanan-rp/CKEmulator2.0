import type { ConnState } from '../../../core/posTypes';

/** Connection-state indicator dot: green connected / amber connecting / red down. */
export function Dot({ state }: { state: ConnState }): JSX.Element {
  const color = state === 'connected' ? '#3ec46d' : state === 'connecting' ? '#e6b450' : '#d9534f';
  return <span className="dot" style={{ background: color }} title={state} />;
}
