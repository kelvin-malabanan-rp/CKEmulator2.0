import { useEffect, useRef } from 'react';
import { LOA_PLAYER_ENTRY_URL, loaEntryUrl } from '../../../core/posTypes';
import { loaTransport } from '../loaTransport';

/**
 * Embeds the real loa-player as a cross-origin iframe (LOA mode) and registers
 * it with `loaTransport`, which drives it over postMessage. The player must be
 * running on its own dev server (`npm run serve:player`, :9000); until then the
 * frame shows the browser's connection error, which is the honest state.
 *
 * The `playerKey` is passed in the URL hash (`#playerKey=…`) — the player reads
 * it from `window.location.hash` to boot as that registered player (resolving
 * its tenant, settings and Mashgin station). Without it the player falls back to
 * a default config and never consumes the order documents we send.
 *
 * The iframe is mounted only while `connected` (Connect) so Disconnect→Connect
 * fully tears it down and re-creates it — a clean re-boot that retries the
 * player's own network fetch, recovering from a "Can't fetch from network" state
 * without reloading the whole app.
 */
export function LoaFrame({
  playerKey,
  connected,
  baseUrl = LOA_PLAYER_ENTRY_URL,
}: {
  playerKey?: string;
  connected: boolean;
  baseUrl?: string;
}): JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null);
  const key = (playerKey ?? '').trim();
  const entryUrl = loaEntryUrl(key, baseUrl);

  useEffect(() => {
    if (!connected) {
      loaTransport.setFrame(null, entryUrl);
      return;
    }
    loaTransport.setFrame(ref.current, entryUrl);
    return () => loaTransport.setFrame(null, entryUrl);
  }, [entryUrl, connected]);

  if (!key) {
    return (
      <div className="loaframe">
        <div className="loaframehead">
          <span className="loaframetitle">loa-player</span>
        </div>
        <div className="loaframeempty">Enter a player key in Config to boot the embedded player.</div>
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="loaframe">
        <div className="loaframehead">
          <span className="loaframetitle">loa-player</span>
        </div>
        <div className="loaframeempty">Not connected — click Connect to load the player.</div>
      </div>
    );
  }

  return (
    <div className="loaframe">
      <div className="loaframehead">
        <span className="loaframetitle">loa-player</span>
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
        title="loa-player"
        src={entryUrl}
        referrerPolicy="origin"
      />
    </div>
  );
}
