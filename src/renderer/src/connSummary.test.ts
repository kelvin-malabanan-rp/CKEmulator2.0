import { describe, it, expect } from 'vitest';
import { summarizeConnections } from './connSummary';

describe('summarizeConnections', () => {
  it('reports "Not connected" (idle) when no channels are given', () => {
    expect(summarizeConnections([])).toEqual({ overall: 'idle', label: 'Not connected' });
  });

  it('reports "Not connected" (idle) when nothing has been attempted', () => {
    const r = summarizeConnections([
      { label: 'VJ', state: 'idle' },
      { label: 'Pole', state: 'idle' },
    ]);
    expect(r).toEqual({ overall: 'idle', label: 'Not connected' });
  });

  it('joins all connected channels with "· … online" and a green (connected) dot', () => {
    const r = summarizeConnections([
      { label: 'VJ', state: 'connected' },
      { label: 'Pole', state: 'connected' },
      { label: 'Scanner', state: 'connected' },
    ]);
    expect(r).toEqual({ overall: 'connected', label: 'VJ · Pole · Scanner online' });
  });

  it('omits an absent endpoint from the online summary', () => {
    const r = summarizeConnections([
      { label: 'VJ', state: 'connected' },
      { label: 'Pole', state: 'connected' },
    ]);
    expect(r).toEqual({ overall: 'connected', label: 'VJ · Pole online' });
  });

  it('never says online while a channel is connecting — names it, amber dot', () => {
    const r = summarizeConnections([
      { label: 'VJ', state: 'connected' },
      { label: 'Pole', state: 'connected' },
      { label: 'Scanner', state: 'connecting' },
    ]);
    expect(r).toEqual({ overall: 'connecting', label: 'Scanner connecting' });
  });

  it('names a disconnected/errored channel with a red dot', () => {
    const r = summarizeConnections([
      { label: 'VJ', state: 'connected' },
      { label: 'Pole', state: 'connected' },
      { label: 'Scanner', state: 'error' },
    ]);
    expect(r).toEqual({ overall: 'error', label: 'Scanner disconnected' });
  });

  it('gives error precedence over connecting', () => {
    const r = summarizeConnections([
      { label: 'VJ', state: 'error' },
      { label: 'Pole', state: 'connecting' },
    ]);
    expect(r).toEqual({ overall: 'error', label: 'VJ disconnected' });
  });

  it('lists multiple affected channels', () => {
    const r = summarizeConnections([
      { label: 'VJ', state: 'error' },
      { label: 'Pole', state: 'error' },
      { label: 'Scanner', state: 'connected' },
    ]);
    expect(r).toEqual({ overall: 'error', label: 'VJ, Pole disconnected' });
  });
});
