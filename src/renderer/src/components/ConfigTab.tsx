import { useState } from 'react';
import {
  REGISTER_TYPES,
  LOA_ENV_LABELS,
  portsForRegisterType,
  hostForRegisterType,
  isLoaRegisterType,
  loaEnvsForRegisterType,
  defaultLoaEnvForRegisterType,
  loaEntryUrlForTarget,
  registerTypeOptionLabel,
  type RegisterType,
  type LoaEnv,
} from '../../../core/posTypes';
import { usePersistedState } from '../usePersistedState';
import { INIT_CFG_EXPANDED_KEY, DEFAULT_INIT_CFG_EXPANDED, parseBoolean } from '../uiSettings';
import type { useEmulator } from '../useEmulator';

/**
 * Config tab: the interactive connection SETUP (register type, host,
 * player key + Register) that used to crowd the top bar, plus the read-only
 * session dump. The dump is collapsed to player.code + tenant by default and
 * expands to the full key-value block with a Copy-all button.
 */
export function ConfigTab({ e }: { e: ReturnType<typeof useEmulator> }): JSX.Element {
  const [expanded, setExpanded] = usePersistedState(
    INIT_CFG_EXPANDED_KEY,
    DEFAULT_INIT_CFG_EXPANDED,
    parseBoolean,
  );
  const [copied, setCopied] = useState(false);

  const copyAll = (): void => {
    if (!e.globalInit) return;
    void navigator.clipboard?.writeText(e.globalInit.raw).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };

  const isLoa = isLoaRegisterType(e.config.registerType);
  const registerLabel =
    REGISTER_TYPES.find((r) => r.value === e.config.registerType)?.label ?? e.config.registerType;
  const loaEnvs = loaEnvsForRegisterType(e.config.registerType);
  const loaUrl = loaEntryUrlForTarget(e.config.registerType, e.config.loaEnv);

  const gi = e.globalInit;
  // This player's downloaded pricebook is already in the grid — the download
  // button becomes a "loaded" no-op (re-register to refresh).
  const pricebookLoaded = !!gi && e.pricebookDownloadedCode === gi.playerCode;

  return (
    <div className="configtab">
      <div className="cfgsetup">
        <label className="cfgfield">
          <span className="cfglbl">Register type</span>
          <select
            className="regtype"
            value={e.config.registerType}
            title="Register type — sets the VJ/pole ports automatically"
            onChange={(ev) => {
              const registerType = ev.target.value as RegisterType;
              // scannerPort cleared first so a stale Topaz port can't survive a
              // switch to a scanner-less type; host follows the type's default.
              // loaEnv is re-resolved because the two LOA players ship to
              // different environments — keeping the old one could name a build
              // that doesn't exist for the newly selected player.
              e.setConfig({
                ...e.config,
                registerType,
                host: hostForRegisterType(registerType),
                scannerPort: undefined,
                loaEnv: defaultLoaEnvForRegisterType(registerType, e.config.loaEnv),
                ...portsForRegisterType(registerType),
              });
            }}
          >
            {REGISTER_TYPES.map((r) => (
              <option key={r.value} value={r.value}>
                {registerTypeOptionLabel(r)}
              </option>
            ))}
          </select>
        </label>

        {/* LOA has no TCP host to dial — the target is the embedded player's URL,
            so pick the environment instead of an editable (and meaningless)
            127.0.0.1. The full URL is the tooltip, keeping the control compact. */}
        {isLoa ? (
          <label className="cfgfield">
            <span className="cfglbl">Environment</span>
            <select
              className={`cfgenv env-${e.config.loaEnv}`}
              value={e.config.loaEnv}
              title={loaUrl}
              onChange={(ev) => e.setConfig({ ...e.config, loaEnv: ev.target.value as LoaEnv })}
            >
              {loaEnvs.map((env) => (
                <option key={env} value={env}>
                  {LOA_ENV_LABELS[env].toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="cfgfield">
            <span className="cfglbl">Host</span>
            {/* Read-only: every TCP register type pins exactly one host via
                hostForRegisterType (127.0.0.1, or the LoL VM), and switching type
                overwrites it anyway — so an editable box only ever advertised an
                edit that wouldn't survive. Types with more than one target get a
                picker instead, as LOA does above. */}
            <input
              className="host mono"
              value={e.config.host}
              readOnly
              title={`Fixed by the register type (${registerLabel}) — switch register type to change it`}
            />
          </div>
        )}

        <label className="cfgfield">
          <span className="cfglbl">Player key</span>
          <input
            className="pkey mono"
            type="text"
            value={e.playerConfig.playerKey}
            placeholder="player.key"
            onChange={(ev) => e.setPlayerConfig({ ...e.playerConfig, playerKey: ev.target.value })}
          />
        </label>

        {/* LOA fields are narrower than the TCP host row, so the buttons ride up
            beside them. Break the flex row first so Register drops down and sits
            alongside the pricebook button instead. */}
        {isLoa && <div className="cfgbreak" aria-hidden="true" />}

        <button
          className="cfgregister"
          disabled={e.pricebookBusy}
          onClick={() => void e.registerPlayer()}
          title="Resolve the datacenter, player code & backend from the player.key, then fetch settings and auto-download the pricebook"
        >
          Register
        </button>

        <button
          className="cfgregister"
          disabled={!e.globalInit || e.pricebookBusy}
          onClick={() => void e.downloadPricebook()}
          title={
            !e.globalInit
              ? 'Register the player first'
              : pricebookLoaded
                ? 'Re-download this player’s live pricebook (fetches a fresh copy)'
                : 'Download this player’s live pricebook and load it into the item grid'
          }
        >
          {e.pricebookBusy ? 'Downloading…' : pricebookLoaded ? 'Re-download pricebook' : 'Download pricebook'}
        </button>
      </div>

      {e.globalInitError && <div className="initerr">Register failed: {e.globalInitError}</div>}
      {e.pricebookBusy ? (
        <div className="pbstatus">Pricebook: downloading…</div>
      ) : (
        e.pricebookStatus && (
          <div className={e.pricebookStatus.ok ? 'pbstatus' : 'initerr'}>
            {e.pricebookStatus.ok
              ? `Pricebook: ${e.pricebookStatus.count} items loaded`
              : `Pricebook: ${e.pricebookStatus.error}`}
          </div>
        )
      )}

      {gi && (
        <div className="cfgdump">
          <button className="initrow" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
            <span className={`chevron${expanded ? ' open' : ''}`}>›</span>
            <span className="initsummary">
              player.code=<b>{gi.playerCode}</b>
              <span className="sep">·</span>tenant=<b>{gi.tenant}</b>
              {gi.datacenter && (
                <>
                  <span className="sep">·</span>
                  {gi.datacenter}
                </>
              )}
            </span>
          </button>
          {expanded && (
            <div className="initbody">
              <div className="initbodyhead">
                <button className="copyall" onClick={copyAll}>
                  {copied ? 'Copied ✓' : 'Copy all'}
                </button>
              </div>
              <pre>{gi.raw}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
