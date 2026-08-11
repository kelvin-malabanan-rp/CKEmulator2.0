/**
 * User-agent normalisation for LOA mode.
 *
 * The embedded loa-player decides how to talk to its parent window by calling
 * `is-electron`, which sniffs `navigator.userAgent` for the token `Electron/<version>`.
 * Electron stamps that token onto *every* frame, so the player — even though it is a
 * cross-origin page served from its own dev server — concludes it is running as the
 * Electron shell and locks its parent origin to `file://`. Our renderer is an http
 * origin, so both directions of the postMessage bridge then fail silently: outbound
 * messages target an origin the parent does not have, and inbound messages are rejected
 * as unauthorised.
 *
 * Dropping the token makes the player take its normal browser path, where it derives the
 * parent origin from `document.referrer` (our renderer's origin) and the bridge works.
 * Nothing in this emulator branches on the Electron token — the preload bridge is exposed
 * as `window.emulator` regardless — so removing it is safe.
 */

/** Matches the ` Electron/31.0.0` token Electron appends to the Chrome user agent. */
const ELECTRON_TOKEN = /\s*\bElectron\/\S+/g;

/**
 * Strip the `Electron/<version>` token from a user-agent string, leaving an ordinary
 * Chrome user agent. Collapses the whitespace the removal leaves behind. Safe to call on
 * a string that has no token (returns it unchanged apart from trimming), and idempotent.
 */
export function browserUserAgent(userAgent: string): string {
  return userAgent.replace(ELECTRON_TOKEN, '').replace(/\s{2,}/g, ' ').trim();
}

/** True when `is-electron` would detect this user agent as the Electron shell. */
export function looksLikeElectron(userAgent: string): boolean {
  return userAgent.indexOf('Electron') >= 0;
}
