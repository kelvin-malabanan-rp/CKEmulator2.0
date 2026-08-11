/**
 * GlobalInit — mirrors the player.key → backend registration flow shared by
 * CK Player 2.0 (`GlobalInitClient`) and the legacy Java player. The player.key
 * is sent to each datacenter's `…/system/services/init`; the matching one
 * returns a Java `.properties` block (player.code + tenant endpoint URLs) — the
 * "# Generated on …" config. This module holds the pure parsing/derivation
 * (browser-safe, unit-tested); the actual HTTP GET lives in the main process.
 */

export interface Datacenter {
  name: string;
  stage: string;
  register: string;
  host: string;
}

/** Datacenters probed in priority order (same set as CKPlayer2.0). */
export const DATACENTERS: Datacenter[] = [
  { name: 'End to End Test Lab', stage: 'e2e', register: 'https://player.e2e.circlekliftdev.com/api/lift/system/services/init', host: 'https://player.e2e.circlekliftdev.com' },
  { name: 'Europe End to End Test Lab', stage: 'e2e', register: 'https://player.eu-e2e.circlekliftdev.com/api/lift/system/services/init', host: 'https://player.eu-e2e.circlekliftdev.com' },
  { name: 'North America Dev', stage: 'devdog', register: 'https://player.circlekliftdev.com/api/lift/system/services/init', host: 'https://player.circlekliftdev.com' },
  { name: 'Europe Dev', stage: 'dev', register: 'https://player.eu.circlekliftdev.com/api/lift/system/services/init', host: 'https://player.eu.circlekliftdev.com' },
  { name: 'North America Prod', stage: 'prod', register: 'https://player.circleklift.com/api/lift/system/services/init', host: 'https://player.circleklift.com' },
  { name: 'Europe Prod', stage: 'prod', register: 'https://player.eu.circleklift.com/api/lift/system/services/init', host: 'https://player.eu.circleklift.com' },
  { name: 'LOCAL Dev', stage: 'local', register: 'http://localhost:8080/api/lift/system/services/init', host: 'http://localhost:8080' },
];

export const ENDPOINT_KEYS = [
  'init.url',
  'heartbeat.url',
  'pricebook.url',
  'manifest.url',
  'scoreboard.url',
  'playerevents.url',
  'cashierscore.url',
  'contentCron.baseUrl',
  'masterItemData.url',
  'masterItemDataV2.url',
  'pricebook.pricebookTypeUrl',
] as const;

export interface GlobalInitConfig {
  playerCode: string;
  playerKey: string;
  tenant: string;
  locationCode: string;
  endpoints: Record<string, string>;
  datacenter?: string;
  raw: string;
}

export interface GlobalInitResult {
  ok: boolean;
  config?: GlobalInitConfig;
  error?: string;
}

/**
 * Parse a Java `.properties` payload into a map. Improves on the naive
 * CKPlayer2.0 parser by unescaping the backslash escapes Java writes
 * (`\:` → `:`, `\=` → `=`, `\\` → `\`) so URLs like `https\://…` come back
 * usable.
 */
export function parseProperties(text: string): Map<string, string> {
  const props = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/\\([:=\\])/g, '$1');
    props.set(key, value);
  }
  return props;
}

/** Player code `ca-radmarketing-1` → location `ca-radmarketing` (strip trailing `-<n>`). */
export function extractLocationCode(playerCode: string): string {
  const lastDash = playerCode.lastIndexOf('-');
  if (lastDash > 0 && /^\d+$/.test(playerCode.slice(lastDash + 1))) {
    return playerCode.slice(0, lastDash);
  }
  return playerCode;
}

/** Tenant from an explicit `tenant=` property, else the player code's leading segment (`ca-…` → `ca`). */
export function deriveTenant(props: Map<string, string>, playerCode: string): string {
  const explicit = props.get('tenant');
  if (explicit && explicit.trim()) return explicit.trim();
  const head = playerCode.split('-')[0];
  return head || 'unknown';
}

export function extractEndpoints(props: Map<string, string>): Record<string, string> {
  const endpoints: Record<string, string> = {};
  for (const key of ENDPOINT_KEYS) endpoints[key] = props.get(key) ?? '';
  return endpoints;
}

/**
 * Build a GlobalInitConfig from a parsed properties payload. Returns null when
 * there's no `player.code` (datacenter didn't recognise the key).
 */
export function toGlobalInitConfig(raw: string, datacenter?: string): GlobalInitConfig | null {
  const props = parseProperties(raw);
  const playerCode = props.get('player.code');
  if (!playerCode) return null;
  return {
    playerCode,
    playerKey: props.get('player.key') ?? '',
    tenant: deriveTenant(props, playerCode),
    locationCode: extractLocationCode(playerCode),
    endpoints: extractEndpoints(props),
    datacenter,
    raw,
  };
}

/** Resolve `{tenantCode}` tokens in an endpoint URL (Java Utils.replaceTokens parity). */
export function resolveTenantUrl(url: string, tenant: string): string {
  return url.replace(/\{tenantCode\}/g, tenant).replace(/%7BtenantCode%7D/gi, tenant);
}

/**
 * Resolve the pricebook download URL for the current player. The init response
 * commonly omits `pricebook.url`, so fall back to deriving it from the init
 * endpoint's origin + tenant — mirrors the reference emulator's
 * `resolvePricebookUrl` (portal-client.js). Returns '' when neither is available.
 */
export function resolvePricebookUrl(endpoints: Record<string, string>, tenant: string): string {
  const configured = endpoints['pricebook.url'];
  if (configured) return resolveTenantUrl(configured, tenant);
  const initUrl = endpoints['init.url'];
  if (!initUrl) return '';
  try {
    return `${new URL(initUrl).origin}/api/lift/${tenant}/pricebook`;
  } catch {
    return '';
  }
}

/**
 * Filename for the persisted generated config, matching the legacy player's
 * `player.key` file (`EmulatorUI.PLAYER_KEY_FILENAME`). The `# Generated on …`
 * properties block is written here so endpoints survive an app restart.
 */
export const PLAYER_KEY_FILENAME = 'player.key';

/**
 * Recover a datacenter display name from a set of endpoint URLs by matching
 * their origin against the known {@link DATACENTERS}. The persisted file holds
 * only properties (no datacenter name), so this restores it on reload.
 */
export function findDatacenterName(endpoints: Record<string, string>): string | undefined {
  for (const url of Object.values(endpoints)) {
    if (!url) continue;
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      continue;
    }
    const dc = DATACENTERS.find((d) => d.host === origin);
    if (dc) return dc.name;
  }
  return undefined;
}

/**
 * Parse a persisted `player.key` file back into a GlobalInitConfig, recovering
 * the datacenter name from the endpoint hosts. Returns null when the file holds
 * no `player.code`.
 */
export function configFromPlayerKeyFile(text: string): GlobalInitConfig | null {
  const config = toGlobalInitConfig(text);
  if (!config) return null;
  return { ...config, datacenter: findDatacenterName(config.endpoints) };
}
