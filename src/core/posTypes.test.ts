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

  it('maps Bulloch to VJ 5438 / pole 5440 (canonical legacy port)', () => {
    expect(portsForRegisterType('bulloch')).toEqual({ vjPort: 5438, polePort: 5440 });
  });

  it('lists exactly the seven register types with labels', () => {
    expect(REGISTER_TYPES.map((r) => r.value)).toEqual([
      'radiant6-canada',
      'radiant6-us',
      'bulloch',
      'verifone-topaz',
      'verifone-topaz-lol',
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

  it('isLoaRegisterType is true for both LOA players, false for the TCP registers', () => {
    expect(isLoaRegisterType('loa-player')).toBe(true);
    expect(isLoaRegisterType('ckp2-loa')).toBe(true);
    expect(isLoaRegisterType('radiant6-canada')).toBe(false);
    expect(isLoaRegisterType('verifone-topaz')).toBe(false);
    expect(isLoaRegisterType('bulloch')).toBe(false);
  });

  it('maps Radiant6 US to VJ 5438 / pole 5439 (shared Radiant6 ports)', () => {
    expect(portsForRegisterType('radiant6-us')).toEqual({ vjPort: 5438, polePort: 5439 });
  });

  it('registers Radiant6 US with its label and ports', () => {
    expect(REGISTER_TYPES.find((r) => r.value === 'radiant6-us')).toEqual({
      value: 'radiant6-us',
      label: 'Radiant6 US',
      vjPort: 5438,
      polePort: 5439,
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
    expect(loaEntryUrlForTarget('ckp2-loa', 'local')).toBe('http://localhost:5173/');
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
    expect(loaEntryUrlForTarget('ckp2-loa', 'e2e')).toBe('http://localhost:5173/');
  });

  it('loaEntryUrl appends the player key in the hash, or leaves the base bare when absent', () => {
    const local = loaEntryUrlForTarget('ckp2-loa', 'local');
    expect(loaEntryUrl('9f419cb6-dev', local)).toBe(`${local}#playerKey=9f419cb6-dev`);
    expect(loaEntryUrl('  9f419cb6-dev  ', local)).toBe(`${local}#playerKey=9f419cb6-dev`);
    expect(loaEntryUrl('', local)).toBe(local);
  });

  it('loaEntryUrl keeps a base URL that already pins a playerKey when none is configured', () => {
    const e2e = loaEntryUrlForTarget('loa-player', 'e2e');
    expect(loaEntryUrl('', e2e)).toBe(e2e);
  });

  it('loaEntryUrl replaces a pinned playerKey with the configured one (never both)', () => {
    const url = loaEntryUrl('mine', loaEntryUrlForTarget('loa-player', 'e2e'));
    expect(url).toBe(
      'https://loa-player.e2e.circlekliftdev.com/20260605155159.d8638c8/index.html#playerKey=mine',
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
