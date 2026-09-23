import { describe, it, expect } from 'vitest';
import {
  normalizePlayerConfig,
  DEFAULT_POS_CONFIG,
  DEFAULT_PLAYER_CONFIG,
  REGISTER_TYPES,
  portsForRegisterType,
  hostForRegisterType,
  baseRegisterType,
  isLoaRegisterType,
  isOctaneRegisterType,
  registerTypeOptionLabel,
  loaEntryUrl,
  loaEntryUrlForTarget,
  loaEnvsForRegisterType,
  defaultLoaEnvForRegisterType,
  LOA_TARGETS,
  LOA_ENV_LABELS,
  LOL_VM_HOST,
} from './posTypes';
import { stageForUrl } from './globalInit';

describe('normalizePlayerConfig', () => {
  it('returns defaults for null/empty input', () => {
    expect(normalizePlayerConfig(null)).toEqual(DEFAULT_PLAYER_CONFIG);
    expect(normalizePlayerConfig({})).toEqual(DEFAULT_PLAYER_CONFIG);
  });

  it('trims provided values', () => {
    expect(normalizePlayerConfig({ playerCode: '  31989  ', playerKey: ' abc ' })).toMatchObject({
      playerCode: '31989',
      playerKey: 'abc',
    });
  });

  it('defaults the cashier to the Java emulator operator (12399/TimC)', () => {
    expect(DEFAULT_PLAYER_CONFIG.operatorId).toBe('12399');
    expect(DEFAULT_PLAYER_CONFIG.operatorName).toBe('TimC');
  });

  it('trims the operator', () => {
    expect(normalizePlayerConfig({ operatorId: '  40123  ', operatorName: '  Dana  ' })).toMatchObject({
      operatorId: '40123',
      operatorName: 'Dana',
    });
  });

  it('falls back rather than yielding an empty operator', () => {
    // A blank OperatorName makes CK Player 2.0's parser omit the field, and its
    // Register guard then keeps the PREVIOUS cashier — which reads as the
    // emulator being ignored. Never put an empty operator on the wire.
    const cfg = normalizePlayerConfig({ operatorId: '   ', operatorName: '' });
    expect(cfg.operatorId).toBe(DEFAULT_PLAYER_CONFIG.operatorId);
    expect(cfg.operatorName).toBe(DEFAULT_PLAYER_CONFIG.operatorName);
  });

  it('falls back to the default backend URL when blank', () => {
    expect(normalizePlayerConfig({ backendBaseUrl: '   ' }).backendBaseUrl).toBe(DEFAULT_PLAYER_CONFIG.backendBaseUrl);
  });

  it('keeps a custom backend URL', () => {
    expect(normalizePlayerConfig({ backendBaseUrl: 'https://x.test/api/' }).backendBaseUrl).toBe('https://x.test/api/');
  });

  it('exposes sane defaults for the POS connection (Radiant6 Canada)', () => {
    expect(DEFAULT_POS_CONFIG).toEqual({
      host: '127.0.0.1',
      vjPort: 5438,
      polePort: 5439,
      registerType: 'radiant6-canada',
      loaEnv: 'local',
    });
  });
});

describe('register types & ports', () => {
  it('maps Radiant6 Canada to VJ 5438 / pole 5439', () => {
    expect(portsForRegisterType('radiant6-canada')).toEqual({ vjPort: 5438, polePort: 5439 });
  });

  it('maps Radiant6 US to VJ 5438 with NO pole display', () => {
    // CK Player 2.0's US plugin (electron/plugins/radiant6) ships no
    // pole-display module — Radiant6Register.ts: "NO pole display in prod US
    // Radiant6 (realTimeInputs=virtualjournal only)" — and the legacy Java
    // emulator overrides updatePole to skip the device ("no pole display on
    // R6"). Opening 5439 there is an endless ECONNREFUSED retry loop.
    expect(portsForRegisterType('radiant6-us')).toEqual({ vjPort: 5438, polePort: 0 });
  });

  it('leaves the pole out of the picker label when the type has none', () => {
    const us = REGISTER_TYPES.find((r) => r.value === 'radiant6-us')!;
    expect(registerTypeOptionLabel(us)).toBe('Radiant6 US (VJ 5438)');
  });

  it('maps Bulloch to VJ 5438 / pole 5440 (canonical legacy port)', () => {
    expect(portsForRegisterType('bulloch')).toEqual({ vjPort: 5438, polePort: 5440 });
  });

  it('lists exactly the eight register types with labels', () => {
    expect(REGISTER_TYPES.map((r) => r.value)).toEqual([
      'radiant6-canada',
      'radiant6-us',
      'bulloch',
      'verifone-topaz',
      'verifone-topaz-lol',
      'octane',
      'loa-player',
      'ckp2-loa',
    ]);
    expect(REGISTER_TYPES.find((r) => r.value === 'bulloch')?.label).toBe('Bulloch');
  });

  it('maps Verifone Topaz to VJ 10002 / pole 10001 / scanner 10000 (legacy dev TCP convention)', () => {
    expect(portsForRegisterType('verifone-topaz')).toEqual({
      vjPort: 10002,
      polePort: 10001,
      scannerPort: 10000,
    });
  });

  it('registers Verifone Topaz with its label and ports', () => {
    expect(REGISTER_TYPES.find((r) => r.value === 'verifone-topaz')).toEqual({
      value: 'verifone-topaz',
      label: 'Verifone Topaz',
      vjPort: 10002,
      polePort: 10001,
      scannerPort: 10000,
    });
  });

  it('omits scannerPort for register types without a scanner feed', () => {
    expect(portsForRegisterType('radiant6-canada')).not.toHaveProperty('scannerPort');
    expect(portsForRegisterType('bulloch')).not.toHaveProperty('scannerPort');
  });

  it('registers the two LOA players with no TCP ports — the build comes from LOA_TARGETS', () => {
    expect(REGISTER_TYPES.filter((r) => r.vjPort === 0)).toEqual([
      { value: 'loa-player', label: 'LOA Legacy', vjPort: 0, polePort: 0 },
      { value: 'ckp2-loa', label: 'CKP2.0 LOA Mode', vjPort: 0, polePort: 0 },
    ]);
    expect(portsForRegisterType('loa-player')).toEqual({ vjPort: 0, polePort: 0 });
    expect(portsForRegisterType('ckp2-loa')).toEqual({ vjPort: 0, polePort: 0 });
  });

  it('maps Octane to the HTTP journal port 8023 and the inbound scan port 8020', () => {
    expect(portsForRegisterType('octane')).toEqual({ vjPort: 8023, polePort: 0, scannerPort: 8020 });
  });

  it('registers Octane with no pole display', () => {
    expect(REGISTER_TYPES.find((r) => r.value === 'octane')).toEqual({
      value: 'octane',
      label: 'Octane',
      vjPort: 8023,
      polePort: 0,
      scannerPort: 8020,
    });
  });

  it('isOctaneRegisterType singles out Octane', () => {
    expect(isOctaneRegisterType('octane')).toBe(true);
    expect(isOctaneRegisterType('radiant6-canada')).toBe(false);
    expect(isOctaneRegisterType('verifone-topaz')).toBe(false);
    expect(isOctaneRegisterType('loa-player')).toBe(false);
  });

  it('Octane is not mistaken for a LOA register', () => {
    expect(isLoaRegisterType('octane')).toBe(false);
  });

  it('registerTypeOptionLabel names only the endpoints a type actually uses', () => {
    const label = (value: string): string =>
      registerTypeOptionLabel(REGISTER_TYPES.find((r) => r.value === value)!);
    expect(label('radiant6-canada')).toBe('Radiant6 Canada (VJ 5438 / Pole 5439)');
    expect(label('verifone-topaz')).toBe('Verifone Topaz (VJ 10002 / Pole 10001 / Scanner 10000)');
    // Octane has no pole, and its scanner port is inbound — say so rather than
    // advertising a "Pole 0" that nothing ever opens.
    expect(label('octane')).toBe('Octane (HTTP VJ 8023 / Scan-in 8020)');
    expect(label('loa-player')).toBe('LOA Legacy (postMessage)');
  });

  it('isLoaRegisterType is true for both LOA players, false for the TCP registers', () => {
    expect(isLoaRegisterType('loa-player')).toBe(true);
    expect(isLoaRegisterType('ckp2-loa')).toBe(true);
    expect(isLoaRegisterType('radiant6-canada')).toBe(false);
    expect(isLoaRegisterType('verifone-topaz')).toBe(false);
    expect(isLoaRegisterType('bulloch')).toBe(false);
  });

  it('registers Radiant6 US with its label and ports', () => {
    expect(REGISTER_TYPES.find((r) => r.value === 'radiant6-us')).toEqual({
      value: 'radiant6-us',
      label: 'Radiant6 US',
      vjPort: 5438,
      polePort: 0,
    });
  });

  it('maps Verifone Topaz (LoL) to the same Topaz ports, pre-pointed at the LoL VM', () => {
    expect(portsForRegisterType('verifone-topaz-lol')).toEqual({
      vjPort: 10002,
      polePort: 10001,
      scannerPort: 10000,
    });
    expect(REGISTER_TYPES.find((r) => r.value === 'verifone-topaz-lol')).toEqual({
      value: 'verifone-topaz-lol',
      label: 'Verifone Topaz (LoL)',
      vjPort: 10002,
      polePort: 10001,
      scannerPort: 10000,
      defaultHost: LOL_VM_HOST,
    });
  });
});

describe('LOA targets (player x environment)', () => {
  it('ships LOA Legacy to e2e and CKP2.0 LOA Mode to the local dev server', () => {
    expect(loaEnvsForRegisterType('loa-player')).toEqual(['e2e']);
    expect(loaEnvsForRegisterType('ckp2-loa')).toEqual(['local']);
    expect(loaEntryUrlForTarget('ckp2-loa', 'local')).toBe(
      'http://localhost:5173/shopper.html?host=standalone',
    );
    expect(loaEntryUrlForTarget('loa-player', 'e2e')).toBe(
      'https://loa-player.e2e.circlekliftdev.com/20260605155159.d8638c8/index.html#playerKey=69acb823-3a55-4d10-b007-ebbc66b267ca',
    );
  });

  it('lists no environments for a non-LOA register type', () => {
    expect(loaEnvsForRegisterType('radiant6-canada')).toEqual([]);
  });

  // The badge is drawn from the declared env, so a URL filed under the wrong key
  // would mislabel the environment — e.g. a prod build shown as E2E.
  it("every target's URL actually points at the environment it claims", () => {
    for (const t of LOA_TARGETS) {
      expect(stageForUrl(t.entryUrl), `${t.registerType}/${t.env}`).toBe(t.env);
    }
  });

  it('every target is a usable absolute URL on a LOA register type with a label', () => {
    for (const t of LOA_TARGETS) {
      expect(t.entryUrl, t.registerType).toMatch(/^https?:\/\//);
      expect(() => new URL(t.entryUrl)).not.toThrow();
      expect(isLoaRegisterType(t.registerType), t.registerType).toBe(true);
      expect(LOA_ENV_LABELS[t.env], t.env).toBeTruthy();
    }
  });

  it('every LOA register type has at least one build to embed', () => {
    for (const r of REGISTER_TYPES.filter((r) => isLoaRegisterType(r.value))) {
      expect(loaEnvsForRegisterType(r.value).length, r.label).toBeGreaterThan(0);
    }
  });

  it('defaultLoaEnvForRegisterType keeps the current env when the player has it', () => {
    expect(defaultLoaEnvForRegisterType('loa-player', 'e2e')).toBe('e2e');
    expect(defaultLoaEnvForRegisterType('ckp2-loa', 'local')).toBe('local');
  });

  it("defaultLoaEnvForRegisterType falls back when the player doesn't ship that env", () => {
    // Switching Legacy(e2e) -> CKP2.0 must not leave the config on 'e2e'.
    expect(defaultLoaEnvForRegisterType('ckp2-loa', 'e2e')).toBe('local');
    expect(defaultLoaEnvForRegisterType('loa-player', 'local')).toBe('e2e');
    expect(defaultLoaEnvForRegisterType('ckp2-loa')).toBe('local');
  });

  it('loaEntryUrlForTarget falls back to the player\'s own build for an env it lacks', () => {
    expect(loaEntryUrlForTarget('ckp2-loa', 'e2e')).toBe(
      'http://localhost:5173/shopper.html?host=standalone',
    );
  });

  it('loaEntryUrl appends the player key in the hash, or leaves the base bare when absent', () => {
    const local = loaEntryUrlForTarget('ckp2-loa', 'local');
    expect(loaEntryUrl('9f419cb6-dev', local)).toBe(`${local}#playerKey=9f419cb6-dev&hw=mashgin_11`);
    expect(loaEntryUrl('  9f419cb6-dev  ', local)).toBe(`${local}#playerKey=9f419cb6-dev&hw=mashgin_11`);
    expect(loaEntryUrl('', local)).toBe(local);
  });

  it('loaEntryUrl keeps a base URL that already pins a playerKey when none is configured', () => {
    const e2e = loaEntryUrlForTarget('loa-player', 'e2e');
    expect(loaEntryUrl('', e2e)).toBe(e2e);
  });

  it('loaEntryUrl replaces a pinned playerKey with the configured one (never both)', () => {
    const url = loaEntryUrl('mine', loaEntryUrlForTarget('loa-player', 'e2e'));
    expect(url).toBe(
      'https://loa-player.e2e.circlekliftdev.com/20260605155159.d8638c8/index.html#playerKey=mine&hw=mashgin_11',
    );
    expect(url.match(/#/g)).toHaveLength(1);
  });
});

describe('hostForRegisterType', () => {
  it('returns the LoL VM host for the LoL preset', () => {
    expect(hostForRegisterType('verifone-topaz-lol')).toBe(LOL_VM_HOST);
    expect(LOL_VM_HOST).toBe('100.6.7.113');
  });

  it('falls back to localhost for types without a default host', () => {
    for (const t of ['radiant6-canada', 'radiant6-us', 'bulloch', 'verifone-topaz'] as const) {
      expect(hostForRegisterType(t)).toBe('127.0.0.1');
    }
  });
});

describe('baseRegisterType', () => {
  it('aliases verifone-topaz-lol to verifone-topaz', () => {
    expect(baseRegisterType('verifone-topaz-lol')).toBe('verifone-topaz');
  });

  it('aliases ckp2-loa to loa-player, so both LOA players share the protocol', () => {
    expect(baseRegisterType('ckp2-loa')).toBe('loa-player');
  });

  it('maps every other register type to itself', () => {
    for (const t of ['radiant6-canada', 'radiant6-us', 'bulloch', 'verifone-topaz', 'loa-player'] as const) {
      expect(baseRegisterType(t)).toBe(t);
    }
  });
});

/**
 * CK Player 2.0's Mashgin mode is opt-in and URL-driven. These assert the three
 * load-bearing parts of the entry URL — miss any one and the player boots looking
 * perfectly healthy while the whole integration is inert, which is exactly the
 * failure this suite exists to catch. Mirrors liftck_mashgin_emulator's
 * scripts/smoke.js, which asserts the same contract for the reference tool.
 */
describe('CKP2.0 Mashgin mode — the standalone boot contract', () => {
  it('embeds the shopper entry, not index.html — that is the surface Mashgin embeds', () => {
    expect(loaEntryUrlForTarget('ckp2-loa', 'local')).toContain('/shopper.html');
  });

  // installElectronShim.ts:66 reads `host` from the query OR the hash; without it
  // there is no StandaloneShim, hwPlatform is empty, isMashginPlatform() is false
  // and AppInitService never starts PostMessageBridge or NgrpBasketReceiver.
  it('opts into standalone boot with host=standalone', () => {
    const url = new URL(loaEntryUrlForTarget('ckp2-loa', 'local'));
    expect(url.searchParams.get('host')).toBe('standalone');
  });

  // CKP2.0's main.tsx:18-20 reads hw from window.location.hash only, so a hw in
  // the query string is silently ignored and hwPlatform falls back to its default.
  it('carries playerKey and hw in the hash, keeping the standalone flag in the query', () => {
    const entry = loaEntryUrl('9f419cb6-dev', loaEntryUrlForTarget('ckp2-loa', 'local'));
    const url = new URL(entry);
    expect(url.searchParams.get('host')).toBe('standalone');
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
    expect(hash.get('playerKey')).toBe('9f419cb6-dev');
    expect(hash.get('hw')).toBe('mashgin_11');
    expect(url.searchParams.get('hw')).toBeNull();
    expect(entry.match(/#/g)).toHaveLength(1);
  });

  it('honours an explicit hw over the mashgin_11 default', () => {
    const entry = loaEntryUrl('k', loaEntryUrlForTarget('ckp2-loa', 'local'), 'mashgin_15');
    expect(new URLSearchParams(new URL(entry).hash.slice(1)).get('hw')).toBe('mashgin_15');
  });

  // host=standalone is a CKP2.0 concept. loa-player has no such flag and must not
  // be handed one — it would ride along into its own URL parsing as junk.
  it('never applies host=standalone to a loa-player target', () => {
    for (const t of LOA_TARGETS.filter((t) => t.registerType !== 'ckp2-loa')) {
      expect(t.entryUrl, t.registerType).not.toContain('host=standalone');
    }
  });
});
