import { useState } from 'react';
import {
  REGISTER_TYPES,
  portsForRegisterType,
  hostForRegisterType,
  type RegisterType,
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

  const gi = e.globalInit;

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
              e.setConfig({
                ...e.config,
                registerType,
                host: hostForRegisterType(registerType),
                scannerPort: undefined,
                ...portsForRegisterType(registerType),
              });
            }}
          >
            {REGISTER_TYPES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.vjPort === 0
                  ? `${r.label} (postMessage)`
                  : `${r.label} (VJ ${r.vjPort} / Pole ${r.polePort}${
                      r.scannerPort !== undefined ? ` / Scanner ${r.scannerPort}` : ''
                    })`}
              </option>
            ))}
          </select>
        </label>

        <label className="cfgfield">
          <span className="cfglbl">Host</span>
          <input
            className="host"
            value={e.config.host}
            onChange={(ev) => e.setConfig({ ...e.config, host: ev.target.value })}
          />
        </label>

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

        <button className="cfgregister" onClick={() => void e.registerPlayer()} title="Resolve the datacenter, player code & backend from the player.key">
          Register
        </button>
      </div>

      {e.globalInitError && <div className="initerr">Register failed: {e.globalInitError}</div>}

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
