import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoaSendQueue, RATE_LIMIT_GAP_MS } from './loaSendQueue';

/** Minimal NGRP-shaped doc — the queue only reads order.uuid and order.status. */
function doc(uuid: string, status: string, marker: string): string {
  return JSON.stringify({ order: { uuid, status, marker } });
}
const uuidOf = (json: string) => JSON.parse(json).order.uuid as string;
const markerOf = (json: string) => JSON.parse(json).order.marker as string;

describe('LoaSendQueue', () => {
  let posted: string[];
  let q: LoaSendQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    posted = [];
    q = new LoaSendQueue((json) => posted.push(json), 250);
  });
  afterEach(() => vi.useRealTimers());

  it('posts the first doc immediately — nothing to wait behind', () => {
    q.enqueue(doc('o1', 'OPEN', 'a'));
    expect(posted.map(markerOf)).toEqual(['a']);
  });

  // The defect this exists for: a multi-completer rp-inject-item rings up one item
  // per completer, each re-sending the full doc with no gap. CK Player 2.0 drops
  // every non-terminal doc inside its window, so only the first ever landed.
  it('paces a burst instead of firing every doc into the rate-limit window', () => {
    q.enqueue(doc('o1', 'OPEN', 'a'));
    q.enqueue(doc('o1', 'OPEN', 'b'));
    q.enqueue(doc('o1', 'OPEN', 'c'));

    expect(posted.map(markerOf)).toEqual(['a']);
    vi.advanceTimersByTime(250);
    // b and c are the same basket, still open: c supersedes b (full-state docs).
    expect(posted.map(markerOf)).toEqual(['a', 'c']);
  });

  it('sends a doc that arrives after the window with no added delay', () => {
    q.enqueue(doc('o1', 'OPEN', 'a'));
    vi.advanceTimersByTime(250);
    q.enqueue(doc('o1', 'OPEN', 'b'));
    expect(posted.map(markerOf)).toEqual(['a', 'b']);
  });

  // Coalescing must never eat a basket end: TENDERED/CANCELED is the signal the
  // player closes the basket on, and CK Player 2.0 rate-limits terminal docs too.
  it('never coalesces away a terminal doc', () => {
    q.enqueue(doc('o1', 'OPEN', 'a'));
    q.enqueue(doc('o1', 'TENDERED', 'end'));
    q.enqueue(doc('o2', 'OPEN', 'next'));

    vi.advanceTimersByTime(250);
    expect(posted.map(markerOf)).toEqual(['a', 'end']);
    vi.advanceTimersByTime(250);
    expect(posted.map(markerOf)).toEqual(['a', 'end', 'next']);
    expect(posted.map(uuidOf)).toEqual(['o1', 'o1', 'o2']);
  });

  it('never coalesces across a basket boundary', () => {
    q.enqueue(doc('o1', 'OPEN', 'a'));
    q.enqueue(doc('o1', 'OPEN', 'b'));
    q.enqueue(doc('o2', 'OPEN', 'c'));

    vi.advanceTimersByTime(250);
    expect(posted.map(markerOf)).toEqual(['a', 'b']);
    vi.advanceTimersByTime(250);
    expect(posted.map(markerOf)).toEqual(['a', 'b', 'c']);
  });

  it('drains a long burst in order, one per window', () => {
    for (const m of ['a', 'b', 'c']) q.enqueue(doc(`o-${m}`, 'OPEN', m));
    expect(posted.map(markerOf)).toEqual(['a']);
    vi.advanceTimersByTime(250);
    expect(posted.map(markerOf)).toEqual(['a', 'b']);
    vi.advanceTimersByTime(250);
    expect(posted.map(markerOf)).toEqual(['a', 'b', 'c']);
    vi.advanceTimersByTime(1000);
    expect(posted.map(markerOf)).toEqual(['a', 'b', 'c']);
  });

  it('honours a widened gap — loa-player rate-limits at 1000ms, not 200ms', () => {
    q.setMinGap(1100);
    q.enqueue(doc('o1', 'OPEN', 'a'));
    q.enqueue(doc('o1', 'OPEN', 'b'));
    vi.advanceTimersByTime(250);
    expect(posted.map(markerOf)).toEqual(['a']);
    vi.advanceTimersByTime(850);
    expect(posted.map(markerOf)).toEqual(['a', 'b']);
  });

  it('passes a doc it cannot parse straight through rather than swallowing it', () => {
    q.enqueue('not json');
    expect(posted).toEqual(['not json']);
  });

  it('reset() drops queued work and re-arms immediate send (Disconnect)', () => {
    q.enqueue(doc('o1', 'OPEN', 'a'));
    q.enqueue(doc('o1', 'OPEN', 'b'));
    q.reset();
    vi.advanceTimersByTime(1000);
    expect(posted.map(markerOf)).toEqual(['a']);

    q.enqueue(doc('o2', 'OPEN', 'fresh'));
    expect(posted.map(markerOf)).toEqual(['a', 'fresh']);
  });

  it('publishes gaps that clear each player\'s own rate limiter', () => {
    // CK Player 2.0 NgrpBasketReceiver.ts DEFAULT_RATE_LIMIT_MS = 200.
    expect(RATE_LIMIT_GAP_MS['ckp2-loa']).toBeGreaterThan(200);
    // loa-player Config.ts basket.rateLimitingThresholdMs defaultValue = 1000.
    expect(RATE_LIMIT_GAP_MS['loa-player']).toBeGreaterThan(1000);
  });
});
