/** Shared, browser-safe transport types used by main, preload and renderer. */
import type { PricebookLoadResult } from './pricebook';
import type { SettingsFetchResult } from './settingGroups';
import type { GlobalInitResult } from './globalInit';
import type { QuickKeyLoadResult } from './quickkeys';
import type { AdsManifestResult, AdDetailResult } from './adTriggers';
import type { InjectCommand } from './injectProtocol';

export type Channel = 'vj' | 'pole' | 'scanner';
export type ConnState = 'connected' | 'connecting' | 'disconnected';
export type Status = Record<Channel, ConnState>;

/**
 * Channels a WireMessage can target. The TCP transport (PosTransport) only knows
 * the hardware `Channel`s; `loa` is a renderer-only pseudo-channel whose payload
 * is an NGRP order-document JSON string delivered to the embedded loa-player over
 * cross-origin postMessage (LOA mode), never over a socket.
 */
export type WireChannel = Channel | 'loa';

/**
 * Environments a LOA player build can be deployed to. Same vocabulary as a
 * datacenter's `stage` (see globalInit) so a target's declared environment can be
 * checked against the URL it actually points at.
 */
export type LoaEnv = 'local' | 'dev' | 'e2e' | 'prod';

/** Display label for an environment (the Config badge). */
export const LOA_ENV_LABELS: Record<LoaEnv, string> = {
  local: 'Local',
  dev: 'Dev',
  e2e: 'E2E',
  prod: 'Prod',
};

/**
 * Every embeddable LOA player build, as (player, environment) → URL. The two LOA
 * register types are different PLAYERS — 'loa-player' is the legacy loa-player,
 * 'ckp2-loa' is CK Player 2.0's own LOA mode — and each is deployed to its own
 * set of environments, so this is a matrix rather than one list per axis. Only
 * the combinations that actually exist are listed; the Config env picker offers
 * exactly the rows matching the selected register type.
 */
export const LOA_TARGETS: ReadonlyArray<{
  registerType: RegisterType;
  env: LoaEnv;
  entryUrl: string;
}> = [
  {
    registerType: 'loa-player',
    env: 'e2e',
    entryUrl:
      'https://loa-player.e2e.circlekliftdev.com/20260605155159.d8638c8/index.html#playerKey=69acb823-3a55-4d10-b007-ebbc66b267ca',
  },
  // Three parts of this URL are load-bearing, all verified against CK Player 2.0:
  //   - `shopper.html` — the shopper display entry, the surface Mashgin embeds.
  //     (`index.html` boots the same bundle but names the wrong surface.)
  //   - `?host=standalone` — standalone boot is opt-in (LIFT-2826).
  //     maybeInstallElectronShim() (installElectronShim.ts:66) installs the
  //     standalone branch only for host=standalone in the query, the hash, or
  //     VITE_HOST_MODE. Without it you get a generic player: no StandaloneShim,
  //     empty hwPlatform, so isMashginPlatform() is false and AppInitService
  //     (:435, :1047) starts neither NgrpBasketReceiver nor PostMessageBridge.
  //     Nothing listens, and the player looks like it loaded fine.
  //   - `hw` in the HASH, added by loaEntryUrl — main.tsx:18-20 reads it from
  //     window.location.hash only.
  // Start the target with `npm run dev:web` (plain vite, port pinned to 5173);
  // Mashgin mode never needs CK Player 2.0's own Electron shell.
  { registerType: 'ckp2-loa', env: 'local', entryUrl: 'http://localhost:5173/shopper.html?host=standalone' },
];

/**
 * Default Mashgin hardware token. Matches CK Player 2.0's own standalone default
 * (standaloneInit.ts:279) and the loa-player Player.ts fallback (Hardware.MASHGIN_11),
 * so both LOA players boot the same way when nothing overrides it.
 */
export const LOA_DEFAULT_HW = 'mashgin_11';

/** The environments the given LOA player is deployed to, in table order. */
export function loaEnvsForRegisterType(type: RegisterType): LoaEnv[] {
  return LOA_TARGETS.filter((t) => t.registerType === type).map((t) => t.env);
}

/**
 * The environment to select when switching to a LOA player: the currently chosen
 * one if that player has it, else its first. Keeps a register-type switch from
 * leaving the config on a combination that doesn't exist.
 */
export function defaultLoaEnvForRegisterType(type: RegisterType, current?: LoaEnv): LoaEnv {
  const envs = loaEnvsForRegisterType(type);
  if (current && envs.includes(current)) return current;
  return envs[0] ?? 'local';
}

/**
 * The player build for a (register type, environment) pair. Falls back to that
 * player's first build when the pair isn't in the table, and to the first LOA
 * target overall for a non-LOA register type — callers gate on isLoaRegisterType().
 */
export function loaEntryUrlForTarget(type: RegisterType, env: LoaEnv): string {
  const forType = LOA_TARGETS.filter((t) => t.registerType === type);
  const exact = forType.find((t) => t.env === env);
  return (exact ?? forType[0] ?? LOA_TARGETS[0]).entryUrl;
}

/**
 * Build the embedded player URL, passing the player key in the hash
 * (`#playerKey=...`) so it boots as that registered player (resolving its tenant,
 * settings and Mashgin station). An empty key yields the base URL unchanged — for
 * a local dev server that is the bare URL (the player boots with a default config
 * and won't consume our order documents); for a deployed build that already pins a
 * `#playerKey=` it keeps that key, so the target works out of the box.
 *
 * A configured key always wins: any hash the base URL carries is dropped first, so
 * a pinned key can never survive alongside the one we asked for.
 *
 * `hw` is appended alongside the key and sets the player's hardware platform —
 * `mashgin_11` by default, which is what makes CK Player 2.0's
 * `isMashginPlatform(hwPlatform)` gate pass. Only the hash is rewritten: any query
 * string the base URL carries (notably CK Player 2.0's `?host=standalone`) survives
 * untouched.
 */
export function loaEntryUrl(playerKey: string, baseUrl: string, hw: string = LOA_DEFAULT_HW): string {
  const key = playerKey.trim();
  if (!key) return baseUrl;
  const hashAt = baseUrl.indexOf('#');
  const base = hashAt >= 0 ? baseUrl.slice(0, hashAt) : baseUrl;
  // hw rides in the hash beside the key, never in the query: CK Player 2.0's
  // main.tsx reads it from window.location.hash only, and loa-player's
  // Player.ts does the same. A query-string hw is silently ignored by both.
  return `${base}#playerKey=${key}&hw=${encodeURIComponent(hw)}`;
}

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
 *
 * octane is the EU POS (Ireland, Norway, Sweden, Denmark, Latvia). It is the
 * only family whose journal is HTTP rather than a socket: the emulator POSTs
 * one JSON document per event to the player's `/add_salesline` servlet on
 * `vjPort`, and RUNS its own HTTP server on `scannerPort` for the player's
 * completer injects (`POST /function`). There is no pole display — CK Player
 * 2.0's octane plugin has no pole module, so `polePort` is 0 and no pole
 * channel is ever opened. See OctaneTransport / OctaneEncoder.
 *
 * loa-player and ckp2-loa are the two LOA players — the legacy loa-player and
 * CK Player 2.0's own LOA mode. They speak the identical postMessage/NGRP
 * protocol (ckp2-loa normalizes to 'loa-player' via baseRegisterType, exactly as
 * the LoL preset does for Topaz); they differ only in which build is embedded,
 * which LOA_TARGETS resolves from the register type plus the chosen LoaEnv.
 */
export type RegisterType =
  | 'radiant6-canada'
  | 'radiant6-us'
  | 'bulloch'
  | 'verifone-topaz'
  | 'verifone-topaz-lol'
  | 'octane'
  | 'loa-player'
  | 'ckp2-loa';

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
  if (type === 'verifone-topaz-lol') return 'verifone-topaz';
  if (type === 'ckp2-loa') return 'loa-player';
  return type;
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
  // Octane: HTTP, not TCP. `vjPort` 8023 is the player's `/add_salesline`
  // servlet we POST to (CKP2.0 `virtualjournal.octaneServletPort`);
  // `scannerPort` 8020 is the port the EMULATOR listens on for the player's
  // injects (its `scanner.octanePosUrl` → `http://<pos>:8020/function`) — the
  // only register type where scannerPort is inbound. No pole display.
  { value: 'octane', label: 'Octane', vjPort: 8023, polePort: 0, scannerPort: 8020 },
  // LOA modes: no TCP ports. The player is embedded as a cross-origin iframe and
  // driven over postMessage (see LOA_TARGETS / loaTransport). Ports are 0 so
  // nothing tries to open a socket; isLoaRegisterType() gates that. Which build
  // each embeds comes from LOA_TARGETS, keyed by this value plus the LoaEnv.
  { value: 'loa-player', label: 'LOA Legacy', vjPort: 0, polePort: 0 },
  { value: 'ckp2-loa', label: 'CKP2.0 LOA Mode', vjPort: 0, polePort: 0 },
];

/** True for LOA mode — the postMessage/iframe transport, not a TCP register. */
export function isLoaRegisterType(type: RegisterType): boolean {
  return baseRegisterType(type) === 'loa-player';
}

/** True for Octane — the HTTP journal + inbound scan-server transport, not TCP. */
export function isOctaneRegisterType(type: RegisterType): boolean {
  return baseRegisterType(type) === 'octane';
}

/**
 * The register-type picker's option text: the label plus the endpoints that
 * type actually uses, so the dropdown never advertises a port nothing opens
 * (LOA has none; Octane has no pole and its scanner port is inbound).
 */
export function registerTypeOptionLabel(entry: (typeof REGISTER_TYPES)[number]): string {
  if (isLoaRegisterType(entry.value)) return `${entry.label} (postMessage)`;
  if (isOctaneRegisterType(entry.value)) {
    return `${entry.label} (HTTP VJ ${entry.vjPort} / Scan-in ${entry.scannerPort})`;
  }
  const scanner = entry.scannerPort !== undefined ? ` / Scanner ${entry.scannerPort}` : '';
  return `${entry.label} (VJ ${entry.vjPort} / Pole ${entry.polePort}${scanner})`;
}

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
  /**
   * Barcode-scanner feed port. OUTBOUND for verifone-topaz (a socket the
   * emulator dials); INBOUND for octane (the HTTP port the emulator listens
   * on for the player's injects). Unset for every other type.
   */
  scannerPort?: number;
  registerType: RegisterType;
  /**
   * Which environment's build LOA mode embeds — resolved together with
   * registerType through LOA_TARGETS. Ignored by every TCP register type.
   */
  loaEnv: LoaEnv;
}

// NOTE: the Octane price dialect is deliberately NOT part of PosConfig. It is
// derived from the registered tenant (octaneLocaleForTenant), never chosen by
// hand — a manual setting can only ever disagree with the player it points at.

export const DEFAULT_POS_CONFIG: PosConfig = {
  host: '127.0.0.1',
  vjPort: 5438,
  polePort: 5439,
  registerType: 'radiant6-canada',
  loaEnv: 'local',
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
  /** Download + parse the live pricebook for the registered player (PDI/NAXML or OCT2000). */
  downloadPricebook(req: {
    pricebookUrl: string;
    playerCode: string;
    playerKey: string;
    locationCode: string;
  }): Promise<PricebookLoadResult>;
  /** Register the player.key against the datacenters and return the generated config. */
  registerPlayer(req: { playerKey: string; product?: string }): Promise<GlobalInitResult>;
  /**
   * Fetch the portal setting groups for the registered player — returns the
   * `loa-*` settings (prefix stripped), chiefly the real `pricebook.url` that
   * GlobalInit registration omits. `contentCronBaseUrl` must be tenant-resolved.
   */
  fetchSettings(req: {
    contentCronBaseUrl: string;
    locationCode: string;
    playerCode: string;
    playerKey: string;
  }): Promise<SettingsFetchResult>;
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
