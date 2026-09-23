import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RegisterSession, type WireMessage, type SessionSnapshot, type TenderKind } from '../../core/RegisterSession';
import {
  DEFAULT_POS_CONFIG,
  DEFAULT_PLAYER_CONFIG,
  normalizePlayerConfig,
  isLoaRegisterType,
  isOctaneRegisterType,
  type PosConfig,
  type PlayerConfig,
  type RegisterType,
  type Status,
} from '../../core/posTypes';
import type { InjectCommand } from '../../core/injectProtocol';
import { loaTransport } from './loaTransport';
import type { PosLocale } from '../../core/currency';
import {
  buildPricebookIndex,
  pickQuickKeys,
  resolveScan,
  type PricebookEntry,
  type QuickKeyItem,
  type PricebookLoadResult,
  type ResolvedItem,
} from '../../core/pricebook';
import { resolvePricebookUrl, resolveTenantUrl, type GlobalInitConfig } from '../../core/globalInit';
import { quickKeyColor, type QuickKeyColor, type QuickKeyEntry, type QuickKeyFile } from '../../core/quickkeys';
import {
  extractTriggersCompleters,
  isLegitimateAd,
  orderManifest,
  type AdTriggersCompleters,
  type AdManifestEntry,
} from '../../core/adTriggers';
import { categorizeLog, type LogCategory } from './wireLog';
import {
  OCTANE_DEFAULT_SCAN_PORT,
  OCTANE_SCAN_PATH,
  octaneJournalUrl,
} from '../../core/octaneEndpoints';
import {
  octaneLocaleForTenant,
  OCTANE_LOCALE_LABELS,
  DEFAULT_OCTANE_LOCALE,
} from '../../core/OctaneEncoder';
import {
  formatTenantCurrency,
  currencyForTenant,
  tenantFromPlayerCode,
  DEFAULT_TENANT,
} from '../../core/tenantCurrency';

export interface LogEntry {
  id: number;
  channel: WireMessage['channel'] | 'sys';
  text: string;
  /** Absolute wall-clock time the line was logged (for tooltips). */
  at: string;
  /** Epoch ms the line was logged (for relative "2s ago" timestamps). */
  atMs: number;
  /** Filter/colour category derived from the channel + text. */
  category: LogCategory;
}

export type PricebookItem = QuickKeyItem;

/** Fallback CAD quick keys used until a real pricebook is loaded. */
export const PRICEBOOK: PricebookItem[] = [
  { code: '049000000443', description: 'Coke 20oz', priceCents: 229 },
  { code: '012000001291', description: 'Lays Chips', priceCents: 319 },
  { code: '060410000016', description: 'Cafe Moyen', priceCents: 194 },
  { code: '067000001234', description: 'Beignet', priceCents: 159 },
  { code: '628700001111', description: 'Eau 500ml', priceCents: 199 },
  { code: '063500001019', description: 'Barre Choc', priceCents: 249 },
];

const idleStatus: Status = { vj: 'disconnected', pole: 'disconnected', scanner: 'disconnected' };
const PLAYER_CFG_KEY = 'r6ca.playerConfig';
const PRICEBOOK_DIR_KEY = 'r6ca.pricebookDir';
// Empty = use the sample pricebook bundled with this repo (resolved in the main
// process). Paste a folder to override (e.g. a local liftck_player checkout with
// real `<playerCode>-<timestamp>.xml` exports).
const DEFAULT_PRICEBOOK_DIR = '';

export function useEmulator(): {
  snapshot: SessionSnapshot;
  injectSeq: number;
  status: Status;
  /** True once Connect has been pressed this session — lets dots show idle (never tried) vs error (tried, down). */
  attempted: boolean;
  /** LOA mode: whether the embedded player is mounted (Connect) or not (Disconnect). */
  loaConnected: boolean;
  /** Text of the most recent error-category log line, for the status-dot tooltip. */
  lastError: string | null;
  config: PosConfig;
  setConfig: (c: PosConfig) => void;
  playerConfig: PlayerConfig;
  setPlayerConfig: (c: PlayerConfig) => void;
  registerPlayer: () => Promise<void>;
  globalInit: GlobalInitConfig | null;
  globalInitError: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  log: LogEntry[];
  clearLog: () => void;
  setLocale: (l: PosLocale) => void;
  quickKeys: PricebookItem[];
  quickKeyFiles: QuickKeyFile[];
  quickKeyColorFor: (upc: string) => QuickKeyColor;
  fireQuickKey: (entry: QuickKeyEntry) => void;
  reloadQuickKeys: () => Promise<void>;
  adManifest: AdManifestEntry[];
  adDetails: Record<string, AdTriggersCompleters>;
  adsStatus: { loading: boolean; error: string | null };
  loadAds: () => Promise<void>;
  loadAdDetail: (id: string) => Promise<AdTriggersCompleters | null>;
  pricebookDir: string;
  setPricebookDir: (dir: string) => void;
  pricebookStatus: PricebookLoadResult | null;
  /** True while a pricebook download is in flight (register auto-download or manual). */
  pricebookBusy: boolean;
  loadPricebook: () => Promise<void>;
  /** Download the live pricebook for the registered player into the item grid. */
  downloadPricebook: () => Promise<void>;
  /** Player code whose downloaded pricebook is loaded (null = none / only the sample). */
  pricebookDownloadedCode: string | null;
  addItem: (item: PricebookItem) => void;
  addCustom: (input: { code: string; description: string; priceCents: number; quantity: number; minAge?: number }) => void;
  scan: (code: string, description?: string, priceCents?: number, minAge?: number) => void;
  voidLine: (lineNumber: number) => void;
  setQuantity: (lineNumber: number, qty: number) => void;
  setPrice: (lineNumber: number, priceCents: number) => void;
  loyalty: (cardNumber: string) => void;
  tender: (kind: TenderKind, amountCents?: number) => void;
  voidTicket: () => void;
  suspend: () => void;
  resume: () => void;
  /** UPC/PLU → resolved pricebook item, for name lookups (e.g. ad trigger/completer items). */
  pricebookIndex: Map<string, ResolvedItem>;
  /** Registered tenant code (`pl`), or the CA default before registration. */
  tenant: string;
  /**
   * Format integer cents for DISPLAY in the tenant's currency — the single
   * money formatter the UI uses, so nothing can render a stale `$` on a
   * Polish lane. Wire formatting lives in the encoders, not here.
   */
  money: (cents: number) => string;
} {
  const [config, setConfig] = useState<PosConfig>(DEFAULT_POS_CONFIG);
  // Declared before the session so the registered tenant can seed it. The
  // tenant is the leading segment of the player code (`pl-79989-1` → `pl`) and
  // is the ONLY source for the Octane price dialect and the UI's currency —
  // both are derived, never picked by hand.
  const [globalInit, setGlobalInit] = useState<GlobalInitConfig | null>(null);
  const [globalInitError, setGlobalInitError] = useState<string | null>(null);
  // The tenant IS the player code's prefix. GlobalInit normally reports it
  // directly; deriving it from the code is the fallback for a config that
  // omits the `tenant=` property.
  const tenant =
    globalInit?.tenant?.trim().toLowerCase() ||
    tenantFromPlayerCode(globalInit?.playerCode) ||
    DEFAULT_TENANT;
  const octaneLocale = octaneLocaleForTenant(tenant) ?? DEFAULT_OCTANE_LOCALE;

  // Declared before the session so a persisted operator seeds the first
  // sign-on instead of arriving one transaction late.
  const [playerConfig, setPlayerConfigState] = useState<PlayerConfig>(() => {
    try {
      return normalizePlayerConfig(JSON.parse(localStorage.getItem(PLAYER_CFG_KEY) ?? 'null'));
    } catch {
      return DEFAULT_PLAYER_CONFIG;
    }
  });

  // One session per lane. Rebuilt when the register type changes so the wire
  // protocol matches (Radiant6 Canada = VJ + pole, Bulloch = pole-only). The
  // cashier/shopper locale carries across the switch.
  const sessionRef = useRef<RegisterSession | null>(null);
  const sessionTypeRef = useRef<RegisterType | undefined>(undefined);
  if (sessionRef.current === null || sessionTypeRef.current !== config.registerType) {
    const previous = sessionRef.current;
    const next = new RegisterSession({
      registerType: config.registerType,
      octaneLocale,
      operatorId: playerConfig.operatorId,
      operatorName: playerConfig.operatorName,
      ...(globalInit ? { playerCode: globalInit.playerCode } : {}),
    });
    if (previous) next.setLocale(previous.locale);
    sessionRef.current = next;
    sessionTypeRef.current = config.registerType;
  }
  const session = sessionRef.current;

  // Keep the live session on the tenant's dialect. Registering a different
  // player re-derives it without discarding an in-flight basket.
  session.setOctaneLocale(octaneLocale);
  // Same for the cashier: the session is only rebuilt on a register-type
  // change, so an edited operator reaches the lane here. It lands on the next
  // registerOpen (the next transaction), not on save.
  session.setOperator({ id: playerConfig.operatorId, name: playerConfig.operatorName });

  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => session.snapshot());
  const [status, setStatus] = useState<Status>(idleStatus);
  // Whether Connect has been pressed this session. Lets the status dots show a
  // neutral idle (never attempted) instead of red (attempted, handshake failed).
  const [attempted, setAttempted] = useState(false);
  // LOA mode: whether the embedded player is "connected" (iframe mounted). Connect
  // mounts it (fresh boot — retries the player's own network fetch); Disconnect
  // unmounts it. Lets the user re-boot a stuck player without a full app reload.
  const [loaConnected, setLoaConnected] = useState(false);
  // Increments on each completer inject from the player (CKP2 completing/adding).
  const [injectSeq, setInjectSeq] = useState(0);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logId = useRef(0);

  // When the register type switches the session is rebuilt (new wire protocol);
  // reset the basket view to match the fresh, empty lane.
  useEffect(() => {
    setSnapshot(session.snapshot());
  }, [session]);

  const logSys = useCallback((text: string) => {
    console.log(`[Emulator] ${text}`);
    const now = new Date();
    setLog((prev) =>
      [
        {
          id: logId.current++,
          channel: 'sys' as const,
          text,
          at: now.toLocaleTimeString(),
          atMs: now.getTime(),
          category: categorizeLog('sys', text),
        },
        ...prev,
      ].slice(0, 300),
    );
  }, []);

  const [pricebookDir, setPricebookDirState] = useState<string>(
    () => localStorage.getItem(PRICEBOOK_DIR_KEY) ?? DEFAULT_PRICEBOOK_DIR,
  );
  const [pricebookEntries, setPricebookEntries] = useState<PricebookEntry[]>([]);
  const [pricebookStatus, setPricebookStatus] = useState<PricebookLoadResult | null>(null);
  // Player code whose *downloaded* pricebook is currently in the grid. Guards
  // against re-downloading / re-parsing / re-building the grid for a pricebook we
  // already have — reset on (re-)registration so a new key downloads fresh.
  const [pricebookDownloadedCode, setPricebookDownloadedCode] = useState<string | null>(null);

  const setPricebookDir = useCallback((dir: string) => {
    setPricebookDirState(dir);
    try {
      localStorage.setItem(PRICEBOOK_DIR_KEY, dir);
    } catch {
      // ignore storage failures
    }
  }, []);

  const pricebookIndex = useMemo(() => buildPricebookIndex(pricebookEntries), [pricebookEntries]);
  const quickKeys = useMemo<PricebookItem[]>(
    () => (pricebookEntries.length > 0 ? pickQuickKeys(pricebookEntries) : PRICEBOOK),
    [pricebookEntries],
  );

  // Quick keys loaded from the bundled .qk files (legacy usualsuspects format) —
  // now only a fallback used before a pricebook is available.
  const [qkFiles, setQkFiles] = useState<QuickKeyFile[]>([]);

  // The item grid IS the pricebook when one is loaded (bundled sample, or a real
  // <playerCode>-<timestamp>.xml when pricebookDir points at one): every sellable
  // entry becomes a tappable key, searched/paged by the same grid. Falls back to
  // the .qk files so the grid is never empty before the pricebook resolves.
  const pricebookFile = useMemo<QuickKeyFile | null>(() => {
    if (pricebookEntries.length === 0) return null;
    const entries: QuickKeyEntry[] = [];
    for (const pe of pricebookEntries) {
      const upc = pe.barcodes[0] || pe.plu;
      if (upc && pe.description && pe.priceCents > 0) {
        entries.push({ upc, sendScan: true, description: pe.description, quantity: 1, priceCents: pe.priceCents, io: [] });
      }
    }
    return entries.length > 0 ? { file: 'Pricebook', entries } : null;
  }, [pricebookEntries]);

  const quickKeyFiles = useMemo<QuickKeyFile[]>(
    () => (pricebookFile ? [pricebookFile] : qkFiles),
    [pricebookFile, qkFiles],
  );

  // Ads. The manifest (id + name) loads fast; each ad's triggers/completers are
  // fetched lazily on demand and cached in adDetails (keyed by ad id).
  const [adManifest, setAdManifest] = useState<AdManifestEntry[]>([]);
  const [adDetails, setAdDetails] = useState<Record<string, AdTriggersCompleters>>({});
  const [adsStatus, setAdsStatus] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });

  // Quick keys turn green when their UPC is a trigger for an inspected ad —
  // sourced from the ad details fetched so far.
  const adCodes = useMemo(
    () => new Set(Object.values(adDetails).flatMap((g) => g.triggers.map((t) => t.code))),
    [adDetails],
  );

  const pricebookCodes = useMemo(() => new Set(pricebookIndex.keys()), [pricebookIndex]);
  // UPCs the pricebook marks age-restricted (minAge > 0) — colors their quick
  // keys orange (legacy EmulatorUI ACCENT_ORANGE), or dark-green when the code
  // is also an ad trigger.
  const ageCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const [code, item] of pricebookIndex) {
      if ((item.minAge ?? 0) > 0) codes.add(code);
    }
    return codes;
  }, [pricebookIndex]);
  const quickKeyColorFor = useCallback(
    (upc: string): QuickKeyColor =>
      quickKeyColor(upc, { pricebookLoaded: pricebookEntries.length > 0, pricebookCodes, adCodes, ageCodes }),
    [pricebookCodes, pricebookEntries.length, adCodes, ageCodes],
  );

  const loadQuickKeys = useCallback(async () => {
    logSys('Loading quick keys from bundled defaults…');
    const res = await window.emulator.loadQuickKeys({});
    if (res.ok) {
      setQkFiles(res.files);
      const total = res.files.reduce((n, f) => n + f.entries.length, 0);
      logSys(`Quick keys loaded from ${res.dir}: ${res.files.length} file(s), ${total} keys`);
    } else {
      setQkFiles([]);
      logSys(`Quick keys error: ${res.error}`);
    }
  }, [logSys]);

  // GlobalInit registration result — the datacenter the player.key resolved to
  // (e2e / dev / prod), with that datacenter's endpoint URLs.
  // Real pricebook.url resolved from the portal setting groups (GlobalInit omits
  // it). Preferred over the derived guess when present. Cleared on re-register.
  const [settingsPricebookUrl, setSettingsPricebookUrl] = useState<string | null>(null);
  // True while a pricebook download is in flight (drives the ConfigTab "downloading…" state).
  const [pricebookBusy, setPricebookBusy] = useState(false);

  // The backend to talk to is auto-detected from the registered datacenter's
  // endpoints (so an e2e player.key hits e2e even if the Backend field says dev).
  // Falls back to the manually entered Backend URL before registration.
  const resolvedBackendUrl = useMemo(() => {
    const ep = globalInit?.endpoints ?? {};
    return ep['manifest.url'] || ep['contentCron.baseUrl'] || ep['init.url'] || ep['heartbeat.url'] || playerConfig.backendBaseUrl;
  }, [globalInit, playerConfig.backendBaseUrl]);

  const adsRunRef = useRef(0);
  const loadAds = useCallback(async () => {
    const run = ++adsRunRef.current; // invalidates any in-flight prefetch
    setAdsStatus({ loading: true, error: null });
    logSys(`Loading ads for "${playerConfig.playerCode}" from ${resolvedBackendUrl}…`);
    const req = {
      backendBaseUrl: resolvedBackendUrl,
      playerCode: playerConfig.playerCode,
      playerKey: playerConfig.playerKey,
    };
    try {
      const res = await window.emulator.loadAds(req);
      if (!res.ok) {
        setAdManifest([]);
        setAdsStatus({ loading: false, error: res.error ?? 'unknown error' });
        logSys(`Ads error: ${res.error}`);
        return;
      }
      const manifest = orderManifest(res.ads);
      setAdManifest(manifest);
      setAdDetails({});
      setAdsStatus({ loading: false, error: null });
      logSys(`Ads loaded: ${manifest.length} ad(s) — fetching details…`);

      // Background-prefetch every ad's triggers/completers (throttled), so the
      // completer dots + template labels fill in without per-page waits.
      // Config entries (no templatename) are evicted from the manifest — only
      // legitimate ads with a real template are kept.
      const ids = manifest.map((m) => m.id);
      const configIds = new Set<string>();
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < ids.length && adsRunRef.current === run) {
          const id = ids[next++];
          try {
            const r = await window.emulator.loadAdDetail({ ...req, id });
            if (adsRunRef.current !== run) return;
            if (r.ok && r.ad) {
              if (!isLegitimateAd(r.ad)) {
                configIds.add(id);
                continue;
              }
              const detail = extractTriggersCompleters(r.ad);
              setAdDetails((prev) => (prev[id] ? prev : { ...prev, [id]: detail }));
            }
          } catch {
            // ignore individual ad failures — others still load
          }
        }
      };
      await Promise.all(Array.from({ length: 5 }, () => worker()));
      if (adsRunRef.current === run) {
        if (configIds.size > 0) {
          setAdManifest((prev) => prev.filter((m) => !configIds.has(m.id)));
          logSys(`Ad details loaded — removed ${configIds.size} config entry(s), ${manifest.length - configIds.size} legit ad(s) kept`);
        } else {
          logSys(`Ad details loaded (${manifest.length})`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAdsStatus({ loading: false, error: msg });
      logSys(`Ads error: ${msg} (restart the app if you just updated it)`);
    }
  }, [resolvedBackendUrl, playerConfig.playerCode, playerConfig.playerKey, logSys]);

  // Fetch one ad's triggers/completers on demand (cached by id).
  const loadAdDetail = useCallback(
    async (id: string): Promise<AdTriggersCompleters | null> => {
      const cached = adDetails[id];
      if (cached) return cached;
      try {
        const res = await window.emulator.loadAdDetail({
          backendBaseUrl: resolvedBackendUrl,
          playerCode: playerConfig.playerCode,
          playerKey: playerConfig.playerKey,
          id,
        });
        if (!res.ok || !res.ad) {
          logSys(`Ad detail error (${id}): ${res.error}`);
          return null;
        }
        if (!isLegitimateAd(res.ad)) {
          setAdManifest((prev) => prev.filter((m) => m.id !== id));
          logSys(`Removed config entry "${id}" from ads list (not a real ad)`);
          return null;
        }
        const detail = extractTriggersCompleters(res.ad);
        setAdDetails((prev) => ({ ...prev, [id]: detail }));
        return detail;
      } catch (err) {
        logSys(`Ad detail error (${id}): ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    [adDetails, resolvedBackendUrl, playerConfig.playerCode, playerConfig.playerKey, logSys],
  );

  // Auto-load quick keys once on mount.
  const quickKeysLoadedRef = useRef(false);
  useEffect(() => {
    if (quickKeysLoadedRef.current) return;
    quickKeysLoadedRef.current = true;
    void loadQuickKeys();
  }, [loadQuickKeys]);

  const setPlayerConfig = useCallback((c: PlayerConfig) => {
    const normalized = normalizePlayerConfig(c);
    setPlayerConfigState(normalized);
    try {
      localStorage.setItem(PLAYER_CFG_KEY, JSON.stringify(normalized));
    } catch {
      // ignore storage failures (private mode etc.)
    }
  }, []);

  useEffect(() => {
    const unsub = window.emulator.onStatus(setStatus);
    void window.emulator.getStatus().then(setStatus);
    return unsub;
  }, []);

  const dispatch = useCallback(
    (messages: WireMessage[]) => {
      const entries: LogEntry[] = [];
      for (const m of messages) {
        // LOA docs go to the embedded player over postMessage (renderer);
        // hardware channels go to the TCP transport in the main process.
        if (m.channel === 'loa') loaTransport.send(m.data);
        else void window.emulator.send(m.channel, m.data);
        const now = new Date();
        const text = m.data.replace(/\r\n$/, '');
        entries.push({
          id: logId.current++,
          channel: m.channel,
          text,
          at: now.toLocaleTimeString(),
          atMs: now.getTime(),
          category: categorizeLog(m.channel, text),
        });
      }
      setLog((prev) => [...entries.reverse(), ...prev].slice(0, 300));
      setSnapshot(session.snapshot());
    },
    [session],
  );

  // Ring up completer injects pushed by the player: resolve the UPC (pricebook →
  // quick keys → fallback) and add it to the basket, which re-emits to the player
  // (1011 + pole on TCP, or a fresh NGRP doc in LOA mode) so its basket reflects
  // it. Each inject bumps injectSeq — the player acting on a completer is the
  // signal to close the emulator's now-stale completer modal. Shared by both the
  // TCP reverse channel (EventId 2001) and LOA's rp-inject-item.
  const ringUpInject = useCallback(
    (cmd: InjectCommand) => {
      const hit = pricebookIndex.get(cmd.barcode) ?? quickKeys.find((p) => p.code === cmd.barcode);
      const item = hit
        ? {
            code: hit.code,
            description: hit.description,
            priceCents: hit.priceCents,
            quantity: cmd.quantity,
            ...(hit.minAge !== undefined ? { minAge: hit.minAge } : {}),
          }
        : { code: cmd.barcode, description: `UPC ${cmd.barcode}`, priceCents: 100, quantity: cmd.quantity };
      logSys(`Completer inject: ${cmd.barcode} ×${cmd.quantity} → ${item.description}`);
      dispatch(session.addItem(item));
      setInjectSeq((n) => n + 1);
    },
    [pricebookIndex, quickKeys, session, dispatch, logSys],
  );

  useEffect(() => window.emulator.onInject(ringUpInject), [ringUpInject]);
  useEffect(() => loaTransport.onInject(ringUpInject), [ringUpInject]);

  // Surface the player's inbound LOA messages (rp-inject-item, rp-ad-shown,
  // rp-session-mode, …) in the Wire Log. Outbound docs are already logged by
  // dispatch as `loa` lines, so only mirror inbound here.
  useEffect(
    () =>
      loaTransport.onLog((direction, name, detailJson) => {
        if (direction !== 'in') return;
        logSys(`← loa ${name}${detailJson ? ` ${detailJson.slice(0, 160)}` : ''}`);
      }),
    [logSys],
  );

  const connect = useCallback(async () => {
    // LOA mode has no TCP socket — the embedded iframe is the "connection".
    // Skip the hardware connect so PosTransport never dials the (0) ports.
    if (isLoaRegisterType(config.registerType)) {
      setAttempted(true);
      setLoaConnected(true);
      logSys('LOA — loading the embedded player (postMessage). Reconnect re-boots it.');
      return;
    }
    if (isOctaneRegisterType(config.registerType)) {
      // Octane has no sockets: we POST the journal to the player and listen for
      // its injects ourselves, so name both endpoints rather than VJ/pole ports.
      logSys(
        `Connecting to Octane journal ${octaneJournalUrl(config.host, config.vjPort)} ` +
          `(listening for injects on :${config.scannerPort ?? OCTANE_DEFAULT_SCAN_PORT}${OCTANE_SCAN_PATH}, ` +
          `${octaneLocale} prices)…`,
      );
      setAttempted(true);
      setStatus(await window.emulator.connect(config));
      return;
    }
    const scannerNote = config.scannerPort !== undefined ? `, scanner ${config.scannerPort}` : '';
    // polePort 0 = no pole display on this register (Radiant6 US) — don't log
    // a port the transport deliberately never opens.
    const poleNote = config.polePort > 0 ? `, pole ${config.polePort}` : '';
    logSys(`Connecting to ${config.host} (VJ ${config.vjPort}${poleNote}${scannerNote})…`);
    setAttempted(true);
    const s = await window.emulator.connect(config);
    setStatus(s);
  }, [config, octaneLocale, logSys]);

  const disconnect = useCallback(async () => {
    // LOA: unmount the embedded player (no TCP transport to close).
    if (isLoaRegisterType(config.registerType)) {
      setLoaConnected(false);
      setAttempted(false);
      logSys('LOA — unloaded the embedded player.');
      return;
    }
    logSys('Disconnecting…');
    setAttempted(false);
    const s = await window.emulator.disconnect();
    setStatus(s);
  }, [config, logSys]);

  // Most recent error-category line, surfaced in the status-dot tooltip. Log is
  // newest-first, so the first error match is the latest one.
  const lastError = useMemo(() => log.find((l) => l.category === 'error')?.text ?? null, [log]);

  // The UI's single money formatter. Keyed on the registered tenant, so a
  // Polish player shows `2,10 zł` and a Canadian one `$2.10` with nothing to
  // configure. `snapshot.locale` only matters for Canada (en-CA vs fr-CA).
  const money = useCallback(
    (cents: number): string => formatTenantCurrency(cents, tenant, snapshot.locale),
    [tenant, snapshot.locale],
  );

  const setLocale = useCallback(
    (l: PosLocale) => {
      session.setLocale(l);
      setSnapshot(session.snapshot());
    },
    [session],
  );

  const loadPricebook = useCallback(async () => {
    logSys(`Loading pricebook for "${playerConfig.playerCode}" from ${pricebookDir || 'bundled sample'}…`);
    const result = await window.emulator.loadPricebook({ dir: pricebookDir, playerCode: playerConfig.playerCode });
    setPricebookStatus(result);
    setPricebookEntries(result.ok ? result.entries : []);
    // A cached download restored on startup counts as "downloaded" for this player
    // (keeps the once-guard + the Config button's loaded state in sync).
    if (result.ok && result.fromDownloadCache) {
      setPricebookDownloadedCode(playerConfig.playerCode);
    }
    logSys(
      result.ok
        ? `Pricebook loaded: ${result.count} items${result.fromDownloadCache ? ' (downloaded)' : ` (${result.path.split('/').pop()})`}`
        : `Pricebook error: ${result.error}`,
    );
  }, [pricebookDir, playerConfig.playerCode, logSys]);

  // Download the live pricebook for the registered player and feed it to the item
  // grid. Resolves pricebook.url from the GlobalInit config (deriving it from the
  // init origin when absent); the main process fetches + parses (PDI/NAXML or
  // OCT2000). Requires a registered player (globalInit).
  // An explicit click always (re-)downloads for the currently registered player.
  // Redundant *automatic* loads are avoided elsewhere: startup/registration read
  // the userData cache instead of the network (see loadPricebook), so this only
  // hits the network on a deliberate download.
  // Core download for a specific registered config. `urlOverride` (the portal
  // setting groups' pricebook.url, threaded through the register chain to dodge
  // the setState race) wins over the persisted settings URL and the derived
  // guess. Runs against the main process, which fetches + decompresses + parses.
  const downloadFor = useCallback(
    async (gi: GlobalInitConfig, urlOverride?: string): Promise<void> => {
      const pricebookUrl =
        (urlOverride && urlOverride.trim()) ||
        (settingsPricebookUrl && settingsPricebookUrl.trim()) ||
        resolvePricebookUrl(gi.endpoints, gi.tenant);
      if (!pricebookUrl) {
        logSys('No pricebook URL available for this player (missing pricebook.url / init.url).');
        return;
      }
      logSys(`Downloading pricebook for ${gi.playerCode} (tenant ${gi.tenant})…`);
      setPricebookBusy(true);
      let result: PricebookLoadResult;
      try {
        result = await window.emulator.downloadPricebook({
          pricebookUrl,
          playerCode: gi.playerCode,
          playerKey: gi.playerKey || playerConfig.playerKey,
          locationCode: gi.locationCode,
        });
      } catch (err) {
        // e.g. the main process predates this IPC handler — restart `npm run dev`.
        result = {
          ok: false,
          count: 0,
          entries: [],
          path: pricebookUrl,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        setPricebookBusy(false);
      }
      setPricebookStatus(result);
      if (result.ok) {
        setPricebookEntries(result.entries);
        setPricebookDownloadedCode(gi.playerCode);
        logSys(`Pricebook downloaded: ${result.count} items`);
      } else {
        logSys(`Pricebook download failed: ${result.error}`);
      }
    },
    [settingsPricebookUrl, playerConfig.playerKey, logSys],
  );

  // Manual (re-)download button — always (re-)downloads for the current player.
  const downloadPricebook = useCallback(async () => {
    if (!globalInit) {
      logSys('Register the player first, then download its pricebook.');
      return;
    }
    await downloadFor(globalInit);
  }, [globalInit, downloadFor, logSys]);

  // Post-registration chain: fetch the portal setting groups to learn the real
  // pricebook.url (GlobalInit omits it), then auto-download the pricebook. Both
  // stages are best-effort — a settings/pricebook failure never invalidates a
  // successful registration; the download falls back to the derived URL. Run
  // fire-and-forget from registerPlayer so it doesn't block the Register button.
  const hydrateSettingsAndDownload = useCallback(
    async (gi: GlobalInitConfig): Promise<void> => {
      const contentCronBaseUrl = resolveTenantUrl(gi.endpoints['contentCron.baseUrl'] ?? '', gi.tenant);
      let pricebookUrl = '';
      if (contentCronBaseUrl) {
        logSys('Fetching portal settings (pricebook.url)…');
        try {
          const s = await window.emulator.fetchSettings({
            contentCronBaseUrl,
            locationCode: gi.locationCode,
            playerCode: gi.playerCode,
            playerKey: gi.playerKey || playerConfig.playerKey,
          });
          if (s.ok && s.pricebookUrl) {
            pricebookUrl = s.pricebookUrl;
            setSettingsPricebookUrl(pricebookUrl);
            logSys('Settings: resolved pricebook.url from the portal.');
          } else if (s.ok) {
            logSys('Settings: portal has no pricebook.url — using the derived URL.');
          } else {
            logSys(`Settings fetch failed: ${s.error ?? 'unknown'} — using the derived URL.`);
          }
        } catch (err) {
          logSys(`Settings fetch failed: ${err instanceof Error ? err.message : String(err)} — using the derived URL.`);
        }
      } else {
        logSys('No contentCron.baseUrl in the config — using the derived pricebook URL.');
      }
      await downloadFor(gi, pricebookUrl);
    },
    [downloadFor, playerConfig.playerKey, logSys],
  );

  // Announce the derived dialect/currency once per tenant, so the wire format
  // in play is visible in the log rather than implied.
  const announcedTenant = useRef<string | null>(null);
  useEffect(() => {
    if (!globalInit?.tenant || announcedTenant.current === tenant) return;
    announcedTenant.current = tenant;
    const detected = octaneLocaleForTenant(tenant);
    logSys(
      `Tenant "${tenant}": UI currency ${currencyForTenant(tenant)} ` +
        `(${formatTenantCurrency(150, tenant)}); Octane price locale ` +
        `${detected ? OCTANE_LOCALE_LABELS[detected] : `not an Octane market — using ${DEFAULT_OCTANE_LOCALE}`}.`,
    );
  }, [globalInit?.tenant, tenant, logSys]);

  // Load the pricebook on mount and whenever the player code or pricebook dir
  // changes — so once hydration resolves the player code, a previously-downloaded
  // pricebook (userData cache) is restored instead of the bundled sample. Keyed
  // by code|dir so it doesn't reload for anything else (e.g. a fresh download,
  // which changes neither, is preserved).
  const pricebookLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${playerConfig.playerCode}|${pricebookDir}`;
    if (pricebookLoadKeyRef.current === key) return;
    pricebookLoadKeyRef.current = key;
    void loadPricebook();
  }, [playerConfig.playerCode, pricebookDir, loadPricebook]);

  // On startup, rehydrate from the persisted player.key file (if a prior
  // registration saved one) so the generated config + endpoints survive a
  // restart — parity with the legacy player reading its player.key file.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    void window.emulator.loadPlayerKey().then((res) => {
      if (res.ok && res.config) {
        setGlobalInit(res.config);
        setPlayerConfig({
          ...playerConfig,
          playerCode: res.config.playerCode,
          playerKey: res.config.playerKey || playerConfig.playerKey,
        });
        logSys(`Loaded persisted player.key: ${res.config.playerCode} (tenant ${res.config.tenant})`);
      }
    });
  }, [playerConfig, setPlayerConfig, logSys]);

  const registerPlayer = useCallback(async () => {
    setGlobalInitError(null);
    logSys(`Registering player.key ${playerConfig.playerKey.slice(0, 8)}… across datacenters`);
    const res = await window.emulator.registerPlayer({ playerKey: playerConfig.playerKey });
    if (res.ok && res.config) {
      setGlobalInit(res.config);
      // Re-registration allows a fresh pricebook download (clears the once-guard)
      // and a fresh settings resolution (drop any stale portal pricebook.url).
      setPricebookDownloadedCode(null);
      setSettingsPricebookUrl(null);
      // Adopt the discovered player code so the rest of the app (pricebook,
      // tenant) lines up with the registered player.
      setPlayerConfig({ ...playerConfig, playerCode: res.config.playerCode });
      logSys(`Registered: ${res.config.playerCode} (tenant ${res.config.tenant}) via ${res.config.datacenter}`);
      // One-button flow: resolve the portal pricebook.url and auto-download the
      // pricebook. Fire-and-forget — registration is already complete and must
      // not block on (or fail because of) the pricebook stage.
      void hydrateSettingsAndDownload(res.config);
    } else {
      setGlobalInit(null);
      setGlobalInitError(res.error ?? 'Registration failed');
      logSys(`Register failed: ${res.error ?? 'unknown error'}`);
    }
  }, [playerConfig, setPlayerConfig, hydrateSettingsAndDownload, logSys]);

  return useMemo(
    () => ({
      snapshot,
      injectSeq,
      status,
      attempted,
      loaConnected,
      lastError,
      config,
      setConfig,
      playerConfig,
      setPlayerConfig,
      registerPlayer,
      globalInit,
      globalInitError,
      connect,
      disconnect,
      log,
      clearLog: () => setLog([]),
      setLocale,
      quickKeys,
      quickKeyFiles,
      quickKeyColorFor,
      fireQuickKey: (entry: QuickKeyEntry) => {
        // A `.qk` row carries no age; source the item's minAge from the loaded
        // pricebook so age-restricted quick keys still emit AgeMinimum.
        const minAge = pricebookIndex.get(entry.upc)?.minAge;
        dispatch(
          session.addItem({
            code: entry.upc,
            description: entry.description,
            priceCents: entry.priceCents,
            quantity: entry.quantity,
            ...(minAge !== undefined ? { minAge } : {}),
          }),
        );
      },
      reloadQuickKeys: loadQuickKeys,
      adManifest,
      adDetails,
      adsStatus,
      loadAds,
      loadAdDetail,
      pricebookDir,
      setPricebookDir,
      pricebookStatus,
      pricebookBusy,
      loadPricebook,
      downloadPricebook,
      pricebookDownloadedCode,
      addItem: (item: PricebookItem) => dispatch(session.addItem(item)),
      addCustom: (input: { code: string; description: string; priceCents: number; quantity: number; minAge?: number }) =>
        dispatch(session.addItem(input)),
      scan: (code: string, description?: string, priceCents?: number, minAge?: number) => {
        const hit = pricebookIndex.get(code) ?? quickKeys.find((p) => p.code === code);
        dispatch(session.addItem(resolveScan(hit, code, description, priceCents, minAge)));
      },
      voidLine: (lineNumber: number) => dispatch(session.voidLine(lineNumber)),
      setQuantity: (lineNumber: number, qty: number) => dispatch(session.setQuantity(lineNumber, qty)),
      setPrice: (lineNumber: number, priceCents: number) => dispatch(session.setPrice(lineNumber, priceCents)),
      loyalty: (cardNumber: string) => dispatch(session.loyalty(cardNumber)),
      tender: (kind: TenderKind, amountCents?: number) => dispatch(session.tender(kind, amountCents)),
      voidTicket: () => {
        // Log the void distinctly (item count + total) so it's traceable in the
        // wire log after the basket has been cleared.
        const items = snapshot.lines.filter((l) => !l.voided).length;
        logSys(`VOID: ${items} item${items === 1 ? '' : 's'}, ${money(snapshot.totalCents)}`);
        dispatch(session.voidTicket());
      },
      suspend: () => dispatch(session.suspend()),
      resume: () => dispatch(session.resume()),
      pricebookIndex,
      tenant,
      money,
    }),
    [
      snapshot,
      injectSeq,
      status,
      attempted,
      loaConnected,
      lastError,
      config,
      playerConfig,
      setPlayerConfig,
      log,
      connect,
      disconnect,
      dispatch,
      setLocale,
      session,
      quickKeys,
      quickKeyFiles,
      quickKeyColorFor,
      loadQuickKeys,
      adManifest,
      adDetails,
      adsStatus,
      loadAds,
      loadAdDetail,
      pricebookDir,
      setPricebookDir,
      pricebookStatus,
      pricebookBusy,
      loadPricebook,
      downloadPricebook,
      pricebookDownloadedCode,
      pricebookIndex,
      registerPlayer,
      globalInit,
      globalInitError,
      tenant,
      money,
    ],
  );
}
