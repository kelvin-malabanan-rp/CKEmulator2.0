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
 * a default config and never consumes the order documents we send. The iframe
 * stays mounted for the whole LOA session so the player boots once (~30s: auth +
 * content/pricebook sync) rather than on every re-render.
 */
export function LoaFrame({
  playerKey,
  baseUrl = LOA_PLAYER_ENTRY_URL,
}: {
  playerKey?: string;
  baseUrl?: string;
}): JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null);
  const key = (playerKey ?? '').trim();
  const entryUrl = loaEntryUrl(key, baseUrl);

  useEffect(() => {
    loaTransport.setFrame(ref.current, entryUrl);
    return () => loaTransport.setFrame(null, entryUrl);
  }, [entryUrl]);

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
