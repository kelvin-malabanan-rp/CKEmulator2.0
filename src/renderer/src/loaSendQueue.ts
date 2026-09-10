/**
 * Outbound pacing for LOA-mode order documents.
 *
 * Both LOA players rate-limit incoming NGRP documents and drop — silently, with
 * only a log line — anything arriving inside the window:
 *   - CK Player 2.0: `NgrpBasketReceiver.ts` `DEFAULT_RATE_LIMIT_MS = 200`, applied
 *     to *every* doc including TENDERED/CANCELED.
 *   - loa-player: `MashginBasketAdapter` reads `basket.rateLimitingThresholdMs`,
 *     default 1000 (`Config.ts`).
 *
 * The emulator re-sends the whole document on every basket mutation, so a burst is
 * easy to produce: a multi-completer `rp-inject-item` rings up one item per
 * completer back-to-back, and the scenario runner's step gap is operator-settable
 * below either threshold. Un-paced, everything after the first doc in a window was
 * thrown away and the player's basket silently diverged from the emulator's.
 *
 * Because each document is full state rather than a delta, two consecutive docs for
 * the same open basket can be collapsed to the later one — that is the whole point
 * of the declarative sync. Two things are never collapsed: a terminal doc
 * (TENDERED/CANCELED), which is the signal the player closes the basket on, and a
 * doc for a different order uuid, which is a basket boundary. Both are queued and
 * drained one per window instead.
 */

/** Per-player minimum gap, chosen to sit outside each player's own window. */
export const RATE_LIMIT_GAP_MS: Record<'loa-player' | 'ckp2-loa', number> = {
  // CK Player 2.0 drops at <200ms; 250 clears it without being felt in the UI.
  'ckp2-loa': 250,
  // loa-player drops at <1000ms.
  'loa-player': 1100,
};

/** Terminal statuses — a basket end, never coalesced away. */
const TERMINAL = new Set(['TENDERED', 'CANCELED']);

interface QueuedDoc {
  json: string;
  /** Order uuid, or null when the doc could not be parsed. */
  uuid: string | null;
  terminal: boolean;
}

function describe(json: string): QueuedDoc {
  try {
    const order = (JSON.parse(json) as { order?: { uuid?: unknown; status?: unknown } }).order;
    const uuid = typeof order?.uuid === 'string' ? order.uuid : null;
    const status = typeof order?.status === 'string' ? order.status : '';
    return { json, uuid, terminal: TERMINAL.has(status) };
  } catch {
    // Unparseable: treat as its own opaque doc so it is never merged or dropped.
    return { json, uuid: null, terminal: true };
  }
}

export class LoaSendQueue {
  private readonly post: (json: string) => void;
  private minGapMs: number;
  private queue: QueuedDoc[] = [];
  private lastPostAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(post: (json: string) => void, minGapMs: number) {
    this.post = post;
    this.minGapMs = minGapMs;
  }

  /** Widen or narrow the window when the target player changes. */
  setMinGap(ms: number): void {
    this.minGapMs = ms;
  }

  /**
   * Accept a document. Posts immediately when the window is clear, otherwise
   * queues it — superseding the pending doc when both describe the same still-open
   * basket.
   */
  enqueue(json: string): void {
    const next = describe(json);
    const last = this.queue[this.queue.length - 1];
    const supersedes =
      last !== undefined && !last.terminal && last.uuid !== null && last.uuid === next.uuid;

    if (supersedes) this.queue[this.queue.length - 1] = next;
    else this.queue.push(next);

    this.pump();
  }

  /** Drop queued work and re-arm immediate delivery (Disconnect / target swap). */
  reset(): void {
    this.queue = [];
    this.lastPostAt = Number.NEGATIVE_INFINITY;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private pump(): void {
    if (this.timer !== null || this.queue.length === 0) return;

    const waitMs = this.lastPostAt + this.minGapMs - Date.now();
    if (waitMs > 0) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, waitMs);
      return;
    }

    const doc = this.queue.shift();
    if (doc === undefined) return;
    this.lastPostAt = Date.now();
    this.post(doc.json);

    this.pump();
  }
}
