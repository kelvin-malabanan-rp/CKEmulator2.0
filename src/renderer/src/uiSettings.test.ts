import { describe, it, expect } from 'vitest';
import {
  parseBoolean,
  parsePanelTab,
  parsePins,
  serializePins,
  parseTheme,
  systemDefaultTheme,
  THEMES,
  PANEL_TABS,
} from './uiSettings';

describe('parseBoolean', () => {
  it('parses the two boolean strings', () => {
    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('false')).toBe(false);
  });

  it('rejects anything else', () => {
    expect(parseBoolean('1')).toBeNull();
    expect(parseBoolean('')).toBeNull();
    expect(parseBoolean('TRUE')).toBeNull();
  });
});

describe('parsePanelTab', () => {
  it('accepts every known panel tab', () => {
    for (const tab of PANEL_TABS) {
      expect(parsePanelTab(tab)).toBe(tab);
    }
  });

  it('lists the tabs in display order', () => {
    expect(PANEL_TABS).toEqual(['log', 'scenarios', 'loyalty', 'config']);
  });

  it('rejects unknown values (including the retired ads tab)', () => {
    expect(parsePanelTab('ads')).toBeNull();
    expect(parsePanelTab('triggers')).toBeNull();
    expect(parsePanelTab('')).toBeNull();
    expect(parsePanelTab('LOG')).toBeNull();
  });
});

describe('parseTheme', () => {
  it('accepts the three known themes', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('dimmed')).toBe('dimmed');
    expect(parseTheme('light')).toBe('light');
  });

  it('rejects unknown values', () => {
    expect(parseTheme('midnight')).toBeNull();
    expect(parseTheme('')).toBeNull();
    expect(parseTheme('DARK')).toBeNull();
  });

  it('lists the themes in toggle order', () => {
    expect(THEMES).toEqual(['dark', 'dimmed', 'light']);
  });
});

describe('systemDefaultTheme', () => {
  it('uses light when the OS prefers light', () => {
    expect(systemDefaultTheme(true)).toBe('light');
  });

  it('falls back to the dark default otherwise', () => {
    expect(systemDefaultTheme(false)).toBe('dark');
  });
});

describe('parsePins', () => {
  it('parses a JSON array of strings', () => {
    expect(parsePins('["a","b"]')).toEqual(['a', 'b']);
    expect(parsePins('[]')).toEqual([]);
  });

  it('rejects malformed JSON and non-string arrays', () => {
    expect(parsePins('not json')).toBeNull();
    expect(parsePins('{"a":1}')).toBeNull();
    expect(parsePins('[1,2]')).toBeNull();
  });

  it('round-trips through serializePins', () => {
    expect(parsePins(serializePins(['x', 'y']))).toEqual(['x', 'y']);
  });
});
