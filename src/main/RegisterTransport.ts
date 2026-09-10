/**
 * The transport surface the main process drives, regardless of how a register
 * family actually talks. `PosTransport` implements it over TCP sockets
 * (Radiant6, Bulloch, Verifone Topaz); `OctaneTransport` implements it over
 * HTTP (an outbound JSON journal plus an inbound scan server).
 *
 * Keeping this explicit means `emulator:connect` can hold either one without
 * the IPC layer knowing which wire is underneath.
 */
import type { Channel, Status } from '../core/posTypes';
import type { InjectCommand } from '../core/injectProtocol';

export interface RegisterTransport {
  /** Begin connecting the channels this register uses. */
  connect(): Promise<void>;
  /** Write one message to a channel. True only when it went out immediately. */
  send(channel: Channel, data: string): boolean;
  /** Current per-channel connection state. */
  status(): Status;
  /** Subscribe to status changes. */
  onStatus(listener: (s: Status) => void): void;
  /** Subscribe to completer injects pushed by the player. */
  onInject(listener: (cmd: InjectCommand) => void): void;
  /** Tear everything down; no further reconnects. */
  close(): void;
}
