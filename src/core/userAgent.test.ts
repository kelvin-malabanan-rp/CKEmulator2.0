import { describe, expect, it } from 'vitest';
import { browserUserAgent, looksLikeElectron } from './userAgent';

/** A realistic Electron 31 user agent, as Electron stamps it onto every frame. */
const ELECTRON_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'ckemulator2.0/0.1.0 Chrome/126.0.6478.36 Electron/31.0.0 Safari/537.36';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.6478.36 Safari/537.36';

describe('looksLikeElectron', () => {
  it('detects the Electron token the way is-electron does', () => {
    expect(looksLikeElectron(ELECTRON_UA)).toBe(true);
  });

  it('is false for an ordinary Chrome user agent', () => {
    expect(looksLikeElectron(CHROME_UA)).toBe(false);
  });

  it('does not match the lowercase app name', () => {
    // is-electron uses a case-sensitive indexOf, and our app id is lowercase — so the
    // app token alone must never trip detection.
    expect(looksLikeElectron('ckemulator2.0/0.1.0')).toBe(false);
  });
});

describe('browserUserAgent', () => {
  it('removes the Electron token so the embedded player takes its browser path', () => {
    const result = browserUserAgent(ELECTRON_UA);

    expect(looksLikeElectron(result)).toBe(false);
    expect(result).not.toContain('Electron/31.0.0');
  });

  it('keeps the rest of the user agent intact', () => {
    const result = browserUserAgent(ELECTRON_UA);

    expect(result).toContain('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(result).toContain('Chrome/126.0.6478.36');
    expect(result).toContain('Safari/537.36');
    expect(result).toContain('ckemulator2.0/0.1.0');
  });

  it('leaves no double spaces where the token was', () => {
    expect(browserUserAgent(ELECTRON_UA)).not.toMatch(/\s{2,}/);
  });

  it('leaves a user agent without the token unchanged', () => {
    expect(browserUserAgent(CHROME_UA)).toBe(CHROME_UA);
  });

  it('is idempotent', () => {
    const once = browserUserAgent(ELECTRON_UA);

    expect(browserUserAgent(once)).toBe(once);
  });

  it('strips a token at the end of the string', () => {
    expect(browserUserAgent('Chrome/126.0.0.0 Electron/31.0.0')).toBe('Chrome/126.0.0.0');
  });

  it('handles an empty user agent', () => {
    expect(browserUserAgent('')).toBe('');
  });
});
