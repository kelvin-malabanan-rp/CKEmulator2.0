/**
 * PosTransport — Electron main-process TCP client to CK Player 2.0's CA
 * adapters. The player listens as a TCP server on the virtual-journal and
 * pole-display ports (default 5438 / 5439); this connects as a client and
 * writes the encoder's bytes. Auto-reconnects when the player restarts.
 *
 * Node-only (uses `net`). Holds NO business logic — it ships bytes.
 */
import net from 'net';
import { baseRegisterType } from '../core/posTypes';
import type { Channel, ConnState, Status, PosConfig, RegisterType } from '../core/posTypes';
import { parseInjectCommand, type InjectCommand } from '../core/injectProtocol';
import type { RegisterTransport } from './RegisterTransport';

export type { Channel, ConnState, Status } from '../core/posTypes';

export interface PosTransportConfig extends PosConfig {
  /** Delay before retrying a dropped/failed connection. Default 2000ms. */
  reconnectDelayMs?: number;
}

interface Connection {
  socket: net.Socket | null;
  state: ConnState;
  port: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Channel was opened by connect() — sends may queue while it is down. */
  enabled: boolean;
  /** Outbound messages held while the channel is down, flushed FIFO on connect. */
  pending: string[];
}

/** Max messages held per channel while disconnected; beyond this the oldest is dropped. */
const MAX_PENDING = 100;

export class PosTransport implements RegisterTransport {
  private readonly host: string;
  private readonly reconnectDelayMs: number;
  private readonly registerType: RegisterType;
  private readonly conns: Record<Channel, Connection>;
  private closed = false;
  private statusListeners: Array<(s: Status) => void> = [];
  private injectListeners: Array<(cmd: InjectCommand) => void> = [];
  /** Line buffer for inbound VJ bytes (player→register completer injects). */
  private vjBuffer = '';
  /** Line buffer for inbound scanner bytes (US Topaz completer injects). */
  private scannerBuffer = '';

  constructor(config: PosTransportConfig) {
    this.host = config.host;
    this.reconnectDelayMs = config.reconnectDelayMs ?? 2000;
    // verifone-topaz-lol is Topaz on the LoL VM; normalize so the scanner-feed
    // decision (and any future protocol branch) matches plain Topaz.
    this.registerType = baseRegisterType(config.registerType);
    this.conns = {
      vj: { socket: null, state: 'disconnected', port: config.vjPort, reconnectTimer: null, enabled: false, pending: [] },
      pole: { socket: null, state: 'disconnected', port: config.polePort, reconnectTimer: null, enabled: false, pending: [] },
      scanner: { socket: null, state: 'disconnected', port: config.scannerPort ?? 0, reconnectTimer: null, enabled: false, pending: [] },
    };
  }

  /**
   * Begin connecting the channels this register uses. Resolves once the
   * attempts are initiated. Bulloch is pole-only (no virtual journal), so the
   * VJ socket is never opened — avoids endless ECONNREFUSED retries against a
   * port the Bulloch player doesn't listen on. Only Verifone Topaz has a
   * separate barcode-scanner feed, so the scanner socket is opened for that
   * type alone (and only when a scannerPort is configured).
   */
  async connect(): Promise<void> {
    this.closed = false;
    if (this.registerType !== 'bulloch') this.openChannel('vj');
    this.openChannel('pole');
    if (this.registerType === 'verifone-topaz' && this.conns.scanner.port > 0) {
      this.openChannel('scanner');
    }
  }

  private openChannel(channel: Channel): void {
    if (this.closed) return;
    const conn = this.conns[channel];
    conn.enabled = true;
    if (conn.reconnectTimer) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }

    this.setState(channel, 'connecting');
    console.log(`[PosTransport] ${channel}: connecting to ${this.host}:${conn.port}…`);
    const socket = net.connect({ host: this.host, port: conn.port });
    conn.socket = socket;

    socket.on('connect', () => {
      console.log(`[PosTransport] ${channel}: connected to ${this.host}:${conn.port}`);
      if (channel === 'vj') this.vjBuffer = '';
      if (channel === 'scanner') this.scannerBuffer = '';
      this.flushPending(channel, socket);
      this.setState(channel, 'connected');
    });
    // The player writes completer injects back down the VJ socket (CA/radiant6)
    // or the scanner socket (US Topaz — writeToHost, as if physically scanned).
    if (channel === 'vj') {
      socket.on('data', (data: Buffer) => this.handleVjData(data.toString('utf-8')));
    }
    if (channel === 'scanner') {
      socket.on('data', (data: Buffer) => this.handleScannerData(data.toString('utf-8')));
    }
    socket.on('error', (err: Error) => {
      console.warn(`[PosTransport] ${channel}: socket error — ${err.message}`);
    });
    socket.on('close', () => {
      conn.socket = null;
      this.setState(channel, 'disconnected');
      this.scheduleReconnect(channel);
    });
  }

  private scheduleReconnect(channel: Channel): void {
    if (this.closed) return;
    const conn = this.conns[channel];
    if (conn.reconnectTimer) return;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      this.openChannel(channel);
    }, this.reconnectDelayMs);
  }

  /**
   * Write bytes to a channel. While an enabled channel is down (player
   * restarting, socket reconnecting) the bytes are queued and flushed FIFO on
   * (re)connect — a scanner echo must not be lost while its VJ line survives,
   * or the player rings a UPC-less line. Channels never opened for this
   * register type still drop. Returns true only when written immediately.
   */
  send(channel: Channel, data: string): boolean {
    const conn = this.conns[channel];
    if (conn.socket && conn.state === 'connected') {
      conn.socket.write(data);
      console.log(`[PosTransport] → ${channel}: ${JSON.stringify(data.replace(/\r\n$/, ''))}`);
      return true;
    }
    if (conn.enabled && !this.closed) {
      if (conn.pending.length >= MAX_PENDING) {
        const dropped = conn.pending.shift();
        console.warn(`[PosTransport] ✗ ${channel} queue full — dropped oldest: ${JSON.stringify((dropped ?? '').replace(/\r\n$/, ''))}`);
      }
      conn.pending.push(data);
      console.warn(`[PosTransport] ⏸ ${channel} not connected — queued (${conn.pending.length} pending): ${JSON.stringify(data.replace(/\r\n$/, ''))}`);
      return false;
    }
    console.warn(`[PosTransport] ✗ ${channel} not connected — dropped: ${JSON.stringify(data.replace(/\r\n$/, ''))}`);
    return false;
  }

  /** Write any messages queued while the channel was down, in send order. */
  private flushPending(channel: Channel, socket: net.Socket): void {
    const conn = this.conns[channel];
    if (conn.pending.length === 0) return;
    console.log(`[PosTransport] ${channel}: flushing ${conn.pending.length} queued message(s)`);
    for (const data of conn.pending.splice(0)) {
      socket.write(data);
      console.log(`[PosTransport] → ${channel} (queued): ${JSON.stringify(data.replace(/\r\n$/, ''))}`);
    }
  }

  /** Buffer inbound VJ bytes, split into lines, and emit any inject commands. */
  private handleVjData(chunk: string): void {
    this.vjBuffer += chunk;
    let idx: number;
    while ((idx = this.vjBuffer.indexOf('\n')) >= 0) {
      const line = this.vjBuffer.slice(0, idx).replace(/\r$/, '');
      this.vjBuffer = this.vjBuffer.slice(idx + 1);
      const cmd = parseInjectCommand(line);
      if (cmd) {
        console.log(`[PosTransport] ← vj inject: ${JSON.stringify(cmd)}`);
        for (const l of this.injectListeners) l(cmd);
      }
    }
  }

  /**
   * Buffer inbound scanner bytes and emit an inject per completed line. The
   * player's US completer flow writes the item code to the register's scanner
   * input (BarcodeScanner.writeToHost), one write per unit, POS-formatted and
   * terminated with the device's line separator — so each line is one scan.
   * Parse leniently: take the longest digit run (POS format templates may add
   * prefixes/suffixes; serial framing may add control bytes).
   */
  private handleScannerData(chunk: string): void {
    this.scannerBuffer += chunk;
    let idx: number;
    while ((idx = this.scannerBuffer.search(/[\r\n]/)) >= 0) {
      const line = this.scannerBuffer.slice(0, idx);
      this.scannerBuffer = this.scannerBuffer.slice(idx + 1);
      const digitRuns = line.match(/\d+/g);
      if (!digitRuns) continue;
      const barcode = digitRuns.reduce((a, b) => (b.length > a.length ? b : a), '');
      if (barcode.length < 4) continue;
      console.log(`[PosTransport] ← scanner inject: ${barcode}`);
      for (const l of this.injectListeners) l({ barcode, quantity: 1 });
    }
  }

  status(): Status {
    return { vj: this.conns.vj.state, pole: this.conns.pole.state, scanner: this.conns.scanner.state };
  }

  onStatus(listener: (s: Status) => void): void {
    this.statusListeners.push(listener);
  }

  /** Subscribe to completer injects from the player (VJ EventId 2001 or a US scanner-channel write). */
  onInject(listener: (cmd: InjectCommand) => void): void {
    this.injectListeners.push(listener);
  }

  private setState(channel: Channel, state: ConnState): void {
    if (this.conns[channel].state === state) return;
    this.conns[channel].state = state;
    console.log(`[PosTransport] ${channel}: ${state}`);
    const snapshot = this.status();
    for (const l of this.statusListeners) l(snapshot);
  }

  close(): void {
    this.closed = true;
    for (const channel of ['vj', 'pole', 'scanner'] as Channel[]) {
      const conn = this.conns[channel];
      if (conn.reconnectTimer) {
        clearTimeout(conn.reconnectTimer);
        conn.reconnectTimer = null;
      }
      conn.socket?.destroy();
      conn.socket = null;
      conn.state = 'disconnected';
      conn.enabled = false;
      conn.pending = [];
    }
  }
}
