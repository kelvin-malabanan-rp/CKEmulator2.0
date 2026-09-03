/**
 * Portal setting-groups fetch — the step that carries the real `pricebook.url`
 * (and other `loa-*` settings) for a store. Mirrors loa-player's
 * `LiftProxy.fetchSettingGroups`: the player.key registration (GlobalInit) does
 * NOT return `pricebook.url`, so the authoritative value comes from the portal
 * settinggroups collection, queried against `contentCron.baseUrl`.
 *
 * Without this the emulator can only *guess* the pricebook URL
 * (`resolvePricebookUrl` deriving `${origin}/api/lift/${tenant}/pricebook`),
 * which fails for any store whose portal-configured URL differs from the guess.
 *
 * Pure / browser-safe (no Node or Electron imports). The HTTP GET lives in the
 * main process; this module is the URL builder + response parser it calls.
 */

/** One raw setting as returned by the settinggroups collection. */
export interface RawSetting {
  name: string;
  value: string;
}

/** One raw setting group (only the fields we consume). */
export interface RawSettingGroup {
  settings?: RawSetting[] | null;
}

/** The settinggroups `_doc` response envelope (`{ data: [...] }`). */
export interface SettingGroupsResponse {
  data?: RawSettingGroup[] | null;
}

/** Result of a settings fetch (returned from main → renderer over IPC). */
export interface SettingsFetchResult {
  ok: boolean;
  /** `loa-`-prefixed settings, prefix stripped (e.g. `pricebook.url`). */
  settings: Record<string, string>;
  /** Convenience: the resolved `pricebook.url`, or '' when the portal has none. */
  pricebookUrl?: string;
  error?: string;
}

/** Portal setting names are `loa-`-prefixed; the prefix is stripped on read. */
const LOA_PREFIX = 'loa-';

/**
 * Query date stamp `YYYYMMDD` (loa-player `Utils.getDateString`). Used in the
 * settinggroups start/end-date window filter.
 */
export function settingsDateStamp(d: Date): string {
  const p = (n: number): string => (n >= 10 ? `${n}` : `0${n}`);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/**
 * Build the settinggroups query URL (loa-player `LiftProxy.fetchSettingGroups`).
 * `contentCronBaseUrl` must already be tenant-resolved and end with a slash
 * (the init endpoint is `…/api/lift/{tenantCode}/elastic/`).
 */
export function buildSettingGroupsUrl(args: {
  contentCronBaseUrl: string;
  locationCode: string;
  playerCode: string;
  playerKey: string;
  today: string;
}): string {
  const { contentCronBaseUrl, locationCode, playerCode, playerKey, today } = args;
  return (
    `${contentCronBaseUrl}settinggroups/_doc` +
    `?in(related.locationcode,${locationCode})` +
    `&sort=-modifiedat&source=json` +
    `&and(or(ge(related.enddate,${today}),n(related.enddate)),or(le(related.startdate,${today}),n(related.startdate)))` +
    `&playercode=${playerCode}&playerkey=${playerKey}`
  );
}

/**
 * Flatten `loa-`-prefixed settings from the response into a name→value map
 * (prefix stripped). The query returns groups newest-first (`sort=-modifiedat`),
 * so the FIRST value seen for a name wins — the newest setting takes precedence.
 * (loa-player stores every group and resolves by priority/schedule; taking the
 * newest value is sufficient for the single-lane emulator.)
 */
export function extractLoaSettings(json: SettingGroupsResponse | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const group of json?.data ?? []) {
    for (const s of group?.settings ?? []) {
      if (!s?.name || !s.name.startsWith(LOA_PREFIX)) continue;
      const name = s.name.slice(LOA_PREFIX.length);
      if (!(name in out)) out[name] = s.value ?? '';
    }
  }
  return out;
}
