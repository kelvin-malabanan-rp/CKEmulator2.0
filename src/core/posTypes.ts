/** Shared, browser-safe transport types used by main, preload and renderer. */
import type { PricebookLoadResult } from './pricebook';
import type { GlobalInitResult } from './globalInit';
import type { QuickKeyLoadResult } from './quickkeys';
import type { AdsManifestResult, AdDetailResult } from './adTriggers';
import type { InjectCommand } from './injectProtocol';

export type Channel = 'vj' | 'pole' | 'scanner';
export type ConnState = 'connected' | 'connecting' | 'disconnected';
export type Status = Record<Channel, ConnState>;

/**
 * POS register types — each listens on its own VJ/pole ports; radiant6-us
 * shares the Radiant6 ports but flips VJ-totals/rounding behavior
 * (see RegisterSession). verifone-topaz adds a third feed (scanner) —
 * in prod all three are serial COM ports, so the emulator uses its own
 * TCP port convention (see below).
 *
 * verifone-topaz-lol is NOT a different protocol — it is plain Verifone Topaz
 * pre-pointed at the LoL Linux player VM (see LOL_VM_HOST). It normalizes to
 * 'verifone-topaz' at every behavior boundary via baseRegisterType(), so it
 * shares the encoder, scenarios, ports and en-US-only locale — only the
 * default connection host differs.
 */
export type RegisterType =
  | 'radiant6-canada'
  | 'radiant6-us'
  | 'bulloch'
  | 'verifone-topaz'
  | 'verifone-topaz-lol';

/** NetBird address of the LoL legacy-LIFT-on-Linux player (display :10, lane player2_lane1). */
export const LOL_VM_HOST = '100.6.7.113';

/**
 * Collapse a register type to the base type whose protocol/scenario behavior
 * it uses. Only verifone-topaz-lol aliases (→ verifone-topaz); every other
 * type maps to itself. Callers that branch on protocol (RegisterSession,
 * PosTransport, scenario filtering) normalize through this so the LoL preset
 * never needs its own copy of that logic.
 */
export function baseRegisterType(type: RegisterType): RegisterType {
  return type === 'verifone-topaz-lol' ? 'verifone-topaz' : type;
}

/**
 * Per-register-type defaults (the ports the player listens on). Radiant6
 * Canada and US use VJ 5438 / pole 5439; Bulloch is pole-primary on 5440
 * (legacy `debug1.properties`: "Bulloch typically listens on TCP 5440").
 *
 * Verifone Topaz has NO prod TCP ports — the player binds serial COM ports
 * (scanner COM1, pole COM2, VJ COM3 per LIFT-2669). For local dev the ports
 * follow the LEGACY emulator convention (liftck_player release/8.2.8.0
 * `system.properties`: "io devices are redirected to TCP for local
 * connection to emulator"): `scanner.ioParams=TCP:10000`,
 * `poledisplay.ioParams=TCP:10001`, `virtualjournal.ioParams=TCP:10002`
 * — already mirrored in CKP2.0's `system.properties` Topaz block. Note the
 * ordering: scanner is the LOWEST port and the VJ the HIGHEST.
 */
export const REGISTER_TYPES: ReadonlyArray<{
  value: RegisterType;
  label: string;
  vjPort: number;
  polePort: number;
  scannerPort?: number;
  /** Connection host applied when this type is picked; omitted → 127.0.0.1 (local emulator dev). */
  defaultHost?: string;
}> = [
  { value: 'radiant6-canada', label: 'Radiant6 Canada', vjPort: 5438, polePort: 5439 },
  { value: 'radiant6-us', label: 'Radiant6 US', vjPort: 5438, polePort: 5439 },
  { value: 'bulloch', label: 'Bulloch', vjPort: 5438, polePort: 5440 },
  { value: 'verifone-topaz', label: 'Verifone Topaz', vjPort: 10002, polePort: 10001, scannerPort: 10000 },
  {
    value: 'verifone-topaz-lol',
    label: 'Verifone Topaz (LoL)',
    vjPort: 10002,
    polePort: 10001,
    scannerPort: 10000,
    defaultHost: LOL_VM_HOST,
  },
];

/** Look up the VJ/pole (and, for Topaz, scanner) ports for a register type. */
export function portsForRegisterType(
  type: RegisterType,
): { vjPort: number; polePort: number; scannerPort?: number } {
  const entry = REGISTER_TYPES.find((r) => r.value === type) ?? REGISTER_TYPES[0];
  return {
    vjPort: entry.vjPort,
    polePort: entry.polePort,
    ...(entry.scannerPort !== undefined ? { scannerPort: entry.scannerPort } : {}),
  };
}

/** The default connection host for a register type — the LoL VM for the LoL preset, else localhost. */
export function hostForRegisterType(type: RegisterType): string {
  return REGISTER_TYPES.find((r) => r.value === type)?.defaultHost ?? DEFAULT_POS_CONFIG.host;
}

/** Connection target for the CK Player 2.0 CA adapters. */
export interface PosConfig {
  host: string;
  vjPort: number;
  polePort: number;
  /** Barcode-scanner feed port — only used by verifone-topaz. */
  scannerPort?: number;
  registerType: RegisterType;
}

export const DEFAULT_POS_CONFIG: PosConfig = {
  host: '127.0.0.1',
  vjPort: 5438,
  polePort: 5439,
  registerType: 'radiant6-canada',
};

/**
 * Player identity / backend credentials — mirrors CKPlayer2.0's
 * `player.code` / `player.key` settings. Editable at runtime in the emulator
 * (like CKPlayer2.0) and used to resolve items against the LIFT backend.
 */
export interface PlayerConfig {
  playerCode: string;
  playerKey: string;
  backendBaseUrl: string;
}

export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  playerCode: '',
  playerKey: '',
  backendBaseUrl: 'https://player.circlekliftdev.com/api/lift/',
};

/** Apply defaults + trim to a partial player config (e.g. from persisted storage). */
export function normalizePlayerConfig(partial: Partial<PlayerConfig> | null | undefined): PlayerConfig {
  const trimmed = (v: string | undefined, fallback: string): string => (v ?? fallback).trim();
  return {
    playerCode: trimmed(partial?.playerCode, DEFAULT_PLAYER_CONFIG.playerCode),
    playerKey: trimmed(partial?.playerKey, DEFAULT_PLAYER_CONFIG.playerKey),
    backendBaseUrl:
      trimmed(partial?.backendBaseUrl, DEFAULT_PLAYER_CONFIG.backendBaseUrl) || DEFAULT_PLAYER_CONFIG.backendBaseUrl,
  };
}

/** The emulator bridge exposed on `window.emulator` by the preload. */
export interface EmulatorBridge {
  connect(config: PosConfig): Promise<Status>;
  disconnect(): Promise<Status>;
  send(channel: Channel, data: string): Promise<boolean>;
  getStatus(): Promise<Status>;
  /** Subscribe to status changes; returns an unsubscribe function. */
  onStatus(cb: (status: Status) => void): () => void;
  /** Subscribe to completer injects from the player (VJ reverse channel). */
  onInject(cb: (cmd: InjectCommand) => void): () => void;
  /** Load the pricebook matching the player code from a local directory. Empty dir uses the bundled sample. */
  loadPricebook(req: { dir?: string; playerCode: string }): Promise<PricebookLoadResult>;
  /** Register the player.key against the datacenters and return the generated config. */
  registerPlayer(req: { playerKey: string; product?: string }): Promise<GlobalInitResult>;
  /** Load the persisted player.key file (generated config) saved by a prior registration. */
  loadPlayerKey(): Promise<GlobalInitResult>;
  /** Load all `.qk` quick-key files from a folder (usualsuspects first). Empty dir uses the bundled defaults. */
  loadQuickKeys(req: { dir?: string }): Promise<QuickKeyLoadResult>;
  /** Fetch the live ads manifest (ad list) for the player. */
  loadAds(req: { backendBaseUrl: string; playerCode: string; playerKey: string }): Promise<AdsManifestResult>;
  /** Fetch one ad's full doc (triggers & completers), on demand. */
  loadAdDetail(req: {
    backendBaseUrl: string;
    playerCode: string;
    playerKey: string;
    id: string;
  }): Promise<AdDetailResult>;
}
