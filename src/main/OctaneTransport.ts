/**
 * OctaneTransport — Electron main-process HTTP transport for the Octane (EU)
 * register. Octane is the one family that does NOT use sockets:
 *
 *   emulator ──POST http://<player>:8023/add_salesline──▶ player   (journal)
 *   emulator ◀──POST http://<emulator>:8020/function───── player   (injects)
 *
 * So the emulator is an HTTP *client* for the virtual journal and an HTTP
 * *server* for the player's completer injects — the mirror image of every
 * other register type, where both directions ride one socket.
 *
 * Ported from the legacy emulator's `OctaneRegisterEmulator` (HTTPDevice
 * journal writes) + `ScanServer` (port 8020, `/function`), and cross-checked
 * against the consumers: CK Player 2.0's `plugins/octane/OctaneVirtualJournal`
 * (express server on 8023) and `plugins/octane/OctaneScanner` (axios client).
 *
 * Node-only (uses `http`). Holds NO business logic — it ships bytes.
 */
import http from 'http';
import type { Channel, ConnState, Status } from '../core/posTypes';
import type { InjectCommand } from '../core/injectProtocol';
import type { RegisterTransport } from './RegisterTransport';
import {
  OCTANE_JOURNAL_PATH,
  OCTANE_SCAN_PATH,
  OCTANE_DEFAULT_VJ_PORT,
  OCTANE_DEFAULT_SCAN_PORT,
  octaneJournalUrl,
} from '../core/octaneEndpoints';

export interface OctaneTransportConfig {
  /** Host running CK Player 2.0's Octane virtual-journal servlet. */
  host: string;
  /** The player's `virtualjournal.octaneServletPort` (default 8023). */
  vjPort: number;
  /** The port THIS process listens on for injects (default 8020). */
  scannerPort?: number;
  /** Delay before re-probing a journal that isn't answering. Default 2000ms. */
  reconnectDelayMs?: number;
}

/** Max journal messages held while the player isn't answering. */
const MAX_PENDING = 100;
/** Per-request timeout for a journal POST and for the reachability probe. */
const REQUEST_TIMEOUT_MS = 5000;
/** Reject an inject body larger than this (a scan payload is a few hundred bytes). */
const MAX_SCAN_BODY_BYTES = 64 * 1024;

/**
 * The inject payload the player sends. Only `function.sale` is load-bearing;
 * the surrounding `version`/`validate*`/`timeout` fields are Octane API
 * ceremony that both the legacy ScanServer and this one ignore.
 */
interface ScanRequestBody {
  function?: { sale?: { articleNo?: string | number; quantity?: number } };
}

/** Extract an inject from a parsed scan body, or null when it isn't one. */
export function parseScanRequest(body: unknown): InjectCommand | null {
  const sale = (body as ScanRequestBody | null)?.function?.sale;
  if (!sale) return null;
  const barcode = sale.articleNo === undefined ? '' : String(sale.articleNo).trim();
  if (!barcode) return null;
  const qty = Number(sale.quantity);
  // Legacy ScanServer: `qty != null ? qty : 1`, then one scan per unit.
  const quantity = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
  return { barcode, quantity };
}

export class OctaneTransport implements RegisterTransport {
  private readonly host: string;
  private readonly vjPort: number;
  private readonly scanPort: number;
  private readonly reconnectDelayMs: number;

  private vjState: ConnState = 'disconnected';
  private scanState: ConnState = 'disconnected';
  private closed = false;
  private probeTimer: ReturnType<typeof setTimeout> | null = null;
  private scanServer: http.Server | null = null;
  private pending: string[] = [];
  private statusListeners: Array<(s: Status) => void> = [];
  private injectListeners: Array<(cmd: InjectCommand) => void> = [];

  constructor(config: OctaneTransportConfig) {
    this.host = config.host;
    this.vjPort = config.vjPort || OCTANE_DEFAULT_VJ_PORT;
    this.scanPort = config.scannerPort ?? OCTANE_DEFAULT_SCAN_PORT;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 2000;
  }

  /**
   * Start listening for injects and probe the player's journal servlet.
   * Resolves once both attempts are initiated — the journal probe completes
   * asynchronously and reports through `onStatus`, matching PosTransport.
   */
  async connect(): Promise<void> {
    this.closed = false;
    this.startScanServer();
    this.setVjState('connecting');
    void this.probeJournal();
  }

  /**
   * HTTP has no persistent connection to watch, so "connected" means the
   * journal servlet ANSWERED. Any HTTP status counts, including 404: CK Player
   * 2.0's HTTPDevice serves `GET /health`, but the legacy Java player's
   * HttpServer registers only the servlet path and 404s everything else — in
   * both cases a response proves a server is listening. Only a transport-level
   * failure (ECONNREFUSED, timeout, DNS) means "down".
   */
  private async probeJournal(): Promise<void> {
    if (this.closed) return;
    const reachable = await this.request('GET', '/health');
    if (this.closed) return;
    if (reachable.ok) {
      this.setVjState('connected');
      this.flushPending();
    } else {
      console.warn(`[OctaneTransport] vj: ${this.journalUrl()} unreachable — ${reachable.error}`);
      this.setVjState('disconnected');
      this.scheduleProbe();
    }
  }

  private scheduleProbe(): void {
    if (this.closed || this.probeTimer) return;
    this.probeTimer = setTimeout(() => {
      this.probeTimer = null;
      void this.probeJournal();
    }, this.reconnectDelayMs);
  }

  private journalUrl(): string {
    return octaneJournalUrl(this.host, this.vjPort);
  }

  /**
   * One HTTP request to the player. Resolves `{ ok: true }` for ANY response
   * (see probeJournal on why a 404 still counts as reachable) and
   * `{ ok: false, error }` only when the request never got a reply.
   */
  private request(
    method: 'GET' | 'POST',
    path: string,
    body?: string,
  ): Promise<{ ok: true; statusCode: number } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      const req = http.request(
        {
          host: this.host,
          port: this.vjPort,
          path,
          method,
          headers:
            body === undefined
              ? {}
              : {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(body),
                },
          timeout: REQUEST_TIMEOUT_MS,
        },
        (res) => {
          // Drain so the socket can be reused/closed cleanly.
          res.resume();
          res.on('end', () => resolve({ ok: true, statusCode: res.statusCode ?? 0 }));
        },
      );
      req.on('timeout', () => req.destroy(new Error(`timeout after ${REQUEST_TIMEOUT_MS}ms`)));
      req.on('error', (err: Error) => resolve({ ok: false, error: err.message }));
      if (body !== undefined) req.write(body);
      req.end();
    });
  }

  /**
   * POST one journal message. Octane sends ONE JSON document per request — CK
   * Player 2.0 runs `JSON.parse` over the whole body, so batching lines into a
   * single POST would fail to parse.
   *
   * Only the `vj` channel exists: Octane has no pole display and its scanner
   * port is inbound, so anything else is dropped loudly rather than silently
   * mis-routed.
   */
  send(channel: Channel, data: string): boolean {
    if (channel !== 'vj') {
      console.warn(`[OctaneTransport] ✗ ${channel} has no Octane endpoint — dropped: ${JSON.stringify(data)}`);
      return false;
    }
    if (this.vjState !== 'connected') {
      if (this.closed) {
        console.warn(`[OctaneTransport] ✗ vj closed — dropped: ${JSON.stringify(data)}`);
        return false;
      }
      if (this.pending.length >= MAX_PENDING) {
        const dropped = this.pending.shift();
        console.warn(`[OctaneTransport] ✗ vj queue full — dropped oldest: ${JSON.stringify(dropped ?? '')}`);
      }
      this.pending.push(data);
      console.warn(`[OctaneTransport] ⏸ vj not reachable — queued (${this.pending.length} pending)`);
      return false;
    }
    void this.post(data);
    return true;
  }

  /** Fire one journal POST and fold the outcome back into the vj state. */
  private async post(data: string): Promise<void> {
    const res = await this.request('POST', OCTANE_JOURNAL_PATH, data);
    if (res.ok) {
      console.log(`[OctaneTransport] → vj (HTTP ${res.statusCode}): ${JSON.stringify(data.replace(/\r\n$/, ''))}`);
      return;
    }
    console.warn(`[OctaneTransport] ✗ vj POST failed — ${res.error}`);
    // The player went away mid-sale: stop claiming connected and start
    // re-probing so the next message queues instead of vanishing.
    this.setVjState('disconnected');
    this.scheduleProbe();
  }

  /** Re-send everything held while the journal was unreachable, in order. */
  private flushPending(): void {
    if (this.pending.length === 0) return;
    console.log(`[OctaneTransport] vj: flushing ${this.pending.length} queued message(s)`);
    for (const data of this.pending.splice(0)) void this.post(data);
  }

  /**
   * Listen for the player's completer injects. This is the emulator standing
   * in for the Octane POS's own HTTP API: `POST /function` with
   * `{"function":{"sale":{"articleNo":"…","quantity":N}}}`, answered 200 so
   * the player's OctaneScanner records the inject as successful.
   */
  private startScanServer(): void {
    if (this.scanServer) return;
    this.scanState = 'connecting';
    const server = http.createServer((req, res) => this.handleScanRequest(req, res));
    server.on('error', (err: Error) => {
      console.error(`[OctaneTransport] scan server error on :${this.scanPort} — ${err.message}`);
      this.scanServer = null;
      this.setScanState('disconnected');
      if (!this.closed) {
        // Usually EADDRINUSE (a legacy emulator or a stale run still bound).
        // Retry on the same cadence as the journal probe.
        setTimeout(() => {
          if (!this.closed) this.startScanServer();
        }, this.reconnectDelayMs);
      }
    });
    server.listen(this.scanPort, () => {
      console.log(`[OctaneTransport] scan server listening on :${this.scanPort}${OCTANE_SCAN_PATH}`);
      this.setScanState('connected');
    });
    this.scanServer = server;
  }

  private handleScanRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const reply = (code: number, payload: Record<string, unknown>): void => {
      const body = JSON.stringify(payload);
      res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };

    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== OCTANE_SCAN_PATH) {
      reply(404, { status: 'ERROR', message: `expected POST ${OCTANE_SCAN_PATH}` });
      return;
    }

    let raw = '';
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      raw += chunk.toString('utf-8');
      if (raw.length > MAX_SCAN_BODY_BYTES) {
        tooLarge = true;
        reply(413, { status: 'ERROR', message: 'scan body too large' });
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      let cmd: InjectCommand | null = null;
      try {
        cmd = parseScanRequest(JSON.parse(raw));
      } catch (err) {
        console.warn(`[OctaneTransport] ← scan: unparseable body — ${err instanceof Error ? err.message : String(err)}`);
        reply(400, { status: 'ERROR', message: 'body is not valid JSON' });
        return;
      }
      if (!cmd) {
        // The legacy ScanServer 400s a body without function.sale.articleNo;
        // so do we. (Unlike legacy we do NOT also 400 on a missing
        // application/json content-type — that only made curl-based testing
        // fail, and no real client omits it.)
        console.warn(`[OctaneTransport] ← scan: no function.sale.articleNo in ${raw.slice(0, 200)}`);
        reply(400, { status: 'ERROR', message: 'missing function.sale.articleNo' });
        return;
      }
      console.log(`[OctaneTransport] ← scan inject: ${cmd.barcode} ×${cmd.quantity}`);
      for (const l of this.injectListeners) l(cmd);
      reply(200, { status: 'OK' });
    });
  }

  status(): Status {
    // Octane has no pole display — it is permanently absent, not "down".
    // The UI lists only the VJ and scan endpoints for this register type.
    return { vj: this.vjState, pole: 'disconnected', scanner: this.scanState };
  }

  onStatus(listener: (s: Status) => void): void {
    this.statusListeners.push(listener);
  }

  onInject(listener: (cmd: InjectCommand) => void): void {
    this.injectListeners.push(listener);
  }

  private setVjState(state: ConnState): void {
    if (this.vjState === state) return;
    this.vjState = state;
    console.log(`[OctaneTransport] vj: ${state} (${this.journalUrl()})`);
    this.emitStatus();
  }

  private setScanState(state: ConnState): void {
    if (this.scanState === state) return;
    this.scanState = state;
    console.log(`[OctaneTransport] scan: ${state} (:${this.scanPort}${OCTANE_SCAN_PATH})`);
    this.emitStatus();
  }

  private emitStatus(): void {
    const snapshot = this.status();
    for (const l of this.statusListeners) l(snapshot);
  }

  close(): void {
    this.closed = true;
    if (this.probeTimer) {
      clearTimeout(this.probeTimer);
      this.probeTimer = null;
    }
    this.pending = [];
    this.scanServer?.close();
    this.scanServer = null;
    this.vjState = 'disconnected';
    this.scanState = 'disconnected';
  }
}
