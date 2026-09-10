/**
 * Octane HTTP endpoints, shared by the main-process transport and the renderer
 * (status panel, log lines) so the two can never disagree about where the
 * journal goes or which port the emulator listens on.
 *
 * Pure / browser-safe (no Node or Electron imports).
 */

/** The player's `virtualjournal.octaneServletPath` — where the journal is POSTed. */
export const OCTANE_JOURNAL_PATH = '/add_salesline';

/** The player's `virtualjournal.octaneServletPort` default. */
export const OCTANE_DEFAULT_VJ_PORT = 8023;

/**
 * Path the player's OctaneScanner POSTs completer injects to. The EMULATOR
 * serves this, standing in for the Octane POS's own HTTP API.
 */
export const OCTANE_SCAN_PATH = '/function';

/** Port the emulator listens on for injects (the POS side of `scanner.octanePosUrl`). */
export const OCTANE_DEFAULT_SCAN_PORT = 8020;

/** Full journal URL for a host/port pair — the target of every journal POST. */
export function octaneJournalUrl(host: string, port: number): string {
  return `http://${host}:${port}${OCTANE_JOURNAL_PATH}`;
}
