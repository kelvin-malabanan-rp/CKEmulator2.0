import type { Parse } from './usePersistedState';

/**
 * Persisted UI-preference keys, defaults, and validating parsers for
 * `usePersistedState`. Kept module-level (like scenarioSettings) so the parsers
 * are unit-testable and their references stay stable across renders.
 */

export const INIT_CFG_EXPANDED_KEY = 'r6ca.ui.initCfgExpanded';
export const QK_PINS_KEY = 'r6ca.ui.qkPins';
export const THEME_KEY = 'r6ca.ui.theme';
export const PANEL_TAB_KEY = 'r6ca.ui.panelTab';

export type Theme = 'dark' | 'dimmed' | 'light';
export type PanelTab = 'log' | 'scenarios' | 'loyalty' | 'config';

/** Ordered for the 3-way toggle and for cycling with `nextTheme`. */
export const THEMES: readonly Theme[] = ['dark', 'dimmed', 'light'];
/** Bottom-right quadrant tabs, in display order. */
export const PANEL_TABS: readonly PanelTab[] = ['log', 'scenarios', 'loyalty', 'config'];

export const DEFAULT_INIT_CFG_EXPANDED = false;
export const DEFAULT_QK_PINS: string[] = [];
export const DEFAULT_THEME: Theme = 'dark';
export const DEFAULT_PANEL_TAB: PanelTab = 'log';

/** `'true'`/`'false'` → boolean; anything else falls back to the default. */
export const parseBoolean: Parse<boolean> = (raw) => (raw === 'true' ? true : raw === 'false' ? false : null);

/** Only the known panel-tab keys are accepted. */
export const parsePanelTab: Parse<PanelTab> = (raw) =>
  (PANEL_TABS as readonly string[]).includes(raw) ? (raw as PanelTab) : null;

/** Only the three known theme values are accepted. */
export const parseTheme: Parse<Theme> = (raw) =>
  raw === 'dark' || raw === 'dimmed' || raw === 'light' ? raw : null;

/**
 * First-load theme when nothing is persisted: honour the OS `prefers-color-scheme`
 * (light when the user prefers light, else the dark default). Pure over the
 * media-query result so it is unit-testable without a DOM.
 */
export const systemDefaultTheme = (prefersLight: boolean): Theme => (prefersLight ? 'light' : DEFAULT_THEME);

/** JSON array of UPC strings; rejects malformed JSON or non-string arrays. */
export const parsePins: Parse<string[]> = (raw) => {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : null;
  } catch {
    return null;
  }
};

/** Serialize the pinned-UPC list for storage. */
export const serializePins = (pins: string[]): string => JSON.stringify(pins);
