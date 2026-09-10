import { useEffect, useRef } from 'react';
import {
  loaEntryUrl,
  loaEntryUrlForTarget,
  LOA_ENV_LABELS,
  REGISTER_TYPES,
  type LoaEnv,
  type RegisterType,
} from '../../../core/posTypes';
import { loaTransport } from '../loaTransport';

/**
 * Embeds the selected LOA player build as a cross-origin iframe (LOA mode) and
 * registers it with `loaTransport`, which drives it over postMessage. Which build
 * is embedded comes from the register type (which LOA player) plus `env` (which
 * deployment of it) — see LOA_TARGETS. Until it is reachable the frame shows the
 * browser's connection error, which is the honest state.
 *
 * The `playerKey` is passed in the URL hash (`#playerKey=…`) — the player reads
 * it from `window.location.hash` to boot as that registered player (resolving
 * its tenant, settings and Mashgin station). Without it the player falls back to
 * whatever the target URL pins (hosted builds) or to a default config, in which
 * case it never consumes the order documents we send.
 *
 * The iframe is mounted only while `connected` (Connect) so Disconnect→Connect
 * fully tears it down and re-creates it — a clean re-boot that retries the
 * player's own network fetch, recovering from a "Can't fetch from network" state
 * without reloading the whole app.
 */
export function LoaFrame({
  playerKey,
  connected,
  registerType,
  env,
}: {
  playerKey?: string;
  connected: boolean;
  registerType: RegisterType;
  env: LoaEnv;
}): JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null);
  const key = (playerKey ?? '').trim();
  const entryUrl = loaEntryUrl(key, loaEntryUrlForTarget(registerType, env));
  const playerLabel = REGISTER_TYPES.find((r) => r.value === registerType)?.label ?? registerType;
  const title = `${playerLabel} — ${LOA_ENV_LABELS[env]}`;

  useEffect(() => {
    if (!connected) {
      loaTransport.setFrame(null, entryUrl, registerType);
      return;
    }
    loaTransport.setFrame(ref.current, entryUrl, registerType);
    return () => loaTransport.setFrame(null, entryUrl, registerType);
  }, [entryUrl, connected, registerType]);

  // A target whose URL pins its own `#playerKey=` boots without one configured,
  // so only prompt for a key when the resolved URL carries none at all.
  if (!entryUrl.includes('#playerKey=')) {
    return (
      <div className="loaframe">
        <div className="loaframehead">
          <span className="loaframetitle">{title}</span>
        </div>
        <div className="loaframeempty">Enter a player key in Config to boot the embedded player.</div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="loaframe">
        <div className="loaframehead">
          <span className="loaframetitle">{title}</span>
        </div>
        <div className="loaframeempty">Not connected — click Connect to load the player.</div>
      </div>
    );
  }

  return (
    <div className="loaframe">
      <div className="loaframehead">
        <span className="loaframetitle">{title}</span>
        <span className="loaframeurl mono">{entryUrl}</span>
      </div>
      {/*
        The player derives our origin from document.referrer and will only accept
        postMessages from it, so the referrer has to survive the cross-origin load.
        `origin` sends exactly the origin (no path) regardless of the default policy.
      */}
      <iframe
        ref={ref}
        className="loaframeframe"
        title={title}
        src={entryUrl}
        referrerPolicy="origin"
      />
    </div>
  );
}
