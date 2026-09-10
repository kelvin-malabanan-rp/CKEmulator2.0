/**
 * LOA-mode transport (renderer side).
 *
 * In LOA mode the target player is embedded as a cross-origin iframe and driven
 * over `window.postMessage` — there is no TCP socket, so this lives in the
 * renderer (unlike PosTransport, which is main-process `net`). It:
 *   - wraps each NGRP document (a `loa`-channel WireMessage payload) in the
 *     Mashgin envelope `{name:'rp-ngrp-doc', ts, details}` and posts it to the
 *     iframe at its own origin;
 *   - listens for the player's reverse messages and translates a
 *     `rp-inject-item` completer push into the same `InjectCommand`s the TCP
 *     reverse channel produces, so useEmulator's existing ring-up path is reused
 *     verbatim.
 *
 * The pure translation (`injectCommandsFromMessage`) is exported for unit tests;
 * the singleton holds the iframe wiring the renderer can't unit-test directly.
 */
import type { InjectCommand } from '../../core/injectProtocol';
import type { RegisterType } from '../../core/posTypes';
import { LoaSendQueue, RATE_LIMIT_GAP_MS } from './loaSendQueue';

/** Inbound player→emulator message shape (loa-player src/model/event/*). */
interface InboundMessage {
  name?: unknown;
  details?: {
    completers?: Array<{ itemCode?: unknown; upsellId?: unknown }>;
  };
}

/**
 * Translate one inbound player message into the InjectCommands to ring up.
 * Only `rp-inject-item` yields injects — each completer's `itemCode` becomes a
 * barcode (quantity 1), matching how the emulator rings a physically-scanned
 * completer. Anything else (ads-shown, session-mode, non-completer injects)
 * yields nothing. Pure — no DOM, safe to unit-test.
 */
export function injectCommandsFromMessage(msg: InboundMessage | null | undefined): InjectCommand[] {
  if (!msg || msg.name !== 'rp-inject-item') return [];
  const completers = msg.details?.completers ?? [];
  const out: InjectCommand[] = [];
  for (const c of completers) {
    const code = c?.itemCode;
    if (typeof code === 'string' && code !== '') out.push({ barcode: code, quantity: 1 });
    else if (typeof code === 'number') out.push({ barcode: String(code), quantity: 1 });
  }
  return out;
}

type InjectListener = (cmd: InjectCommand) => void;
type LogListener = (direction: 'out' | 'in', name: string, detailJson: string) => void;

let frame: HTMLIFrameElement | null = null;
let targetOrigin = '*';
let listenerInstalled = false;
const injectListeners: InjectListener[] = [];
const logListeners: LogListener[] = [];

function emitLog(direction: 'out' | 'in', name: string, detail: unknown): void {
  const json = detail === undefined ? '' : JSON.stringify(detail);
  for (const l of logListeners) l(direction, name, json);
}

function installWindowListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('message', (e: MessageEvent) => {
    // Only trust the embedded player's own frame.
    if (!frame || e.source !== frame.contentWindow) return;
    const d = e.data as InboundMessage;
    if (!d || typeof d.name !== 'string') return;
    emitLog('in', d.name, (d as { details?: unknown }).details);
    for (const cmd of injectCommandsFromMessage(d)) {
      for (const l of injectListeners) l(cmd);
    }
  });
}

/**
 * Actually post one document. Runs at the queue's pace, not the caller's, so it
 * re-checks the frame: Disconnect between enqueue and drain must not post into a
 * torn-down player.
 */
function postDoc(docJson: string): void {
  if (!frame?.contentWindow) return;
  let details: unknown;
  try {
    details = JSON.parse(docJson);
  } catch {
    return;
  }
  frame.contentWindow.postMessage({ name: 'rp-ngrp-doc', ts: Date.now(), details }, targetOrigin);
  emitLog('out', 'rp-ngrp-doc', details);
}

// Both players silently drop documents that arrive inside their rate-limit window,
// so outbound docs are paced rather than posted the instant the basket changes.
// See loaSendQueue for the thresholds and the coalescing rules.
const sendQueue = new LoaSendQueue(postDoc, RATE_LIMIT_GAP_MS['ckp2-loa']);

/** The renderer-side LOA transport singleton (mirrors window.emulator's surface). */
export const loaTransport = {
  /**
   * Register the embedded player iframe, lock the outbound origin to its own, and
   * pace outbound docs for whichever player this is. Mounting a frame is a fresh
   * player, so any queued document from the previous one is dropped.
   */
  setFrame(iframe: HTMLIFrameElement | null, entryUrl: string, registerType?: RegisterType): void {
    frame = iframe;
    try {
      targetOrigin = new URL(entryUrl).origin;
    } catch {
      targetOrigin = '*';
    }
    // The two LOA players rate-limit at different thresholds, and baseRegisterType
    // deliberately aliases them together — so key off the register type itself.
    if (registerType !== undefined) {
      sendQueue.setMinGap(RATE_LIMIT_GAP_MS[registerType === 'ckp2-loa' ? 'ckp2-loa' : 'loa-player']);
    }
    sendQueue.reset();
    installWindowListener();
  },

  /**
   * Queue an NGRP document (JSON string) for delivery as an `rp-ngrp-doc`. Returns
   * whether a player is attached to deliver to — not whether it has been posted
   * yet, which the pacing window decides.
   */
  send(docJson: string): boolean {
    if (!frame?.contentWindow) return false;
    sendQueue.enqueue(docJson);
    return true;
  },

  /** Subscribe to completer injects pushed by the player. Returns an unsubscribe fn. */
  onInject(cb: InjectListener): () => void {
    injectListeners.push(cb);
    return () => {
      const i = injectListeners.indexOf(cb);
      if (i >= 0) injectListeners.splice(i, 1);
    };
  },

  /** Subscribe to a compact log of every message in/out (for the Wire Log). */
  onLog(cb: LogListener): () => void {
    logListeners.push(cb);
    return () => {
      const i = logListeners.indexOf(cb);
      if (i >= 0) logListeners.splice(i, 1);
    };
  },
};
