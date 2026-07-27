import { describe, it, expect } from 'vitest';
import {
  normalizePlayerConfig,
  DEFAULT_POS_CONFIG,
  DEFAULT_PLAYER_CONFIG,
  REGISTER_TYPES,
  portsForRegisterType,
  hostForRegisterType,
  baseRegisterType,
  LOL_VM_HOST,
} from './posTypes';

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

  it('lists exactly the five register types with labels', () => {
    expect(REGISTER_TYPES.map((r) => r.value)).toEqual([
      'radiant6-canada',
      'radiant6-us',
      'bulloch',
      'verifone-topaz',
      'verifone-topaz-lol',
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

  it('maps every other register type to itself', () => {
    for (const t of ['radiant6-canada', 'radiant6-us', 'bulloch', 'verifone-topaz'] as const) {
      expect(baseRegisterType(t)).toBe(t);
    }
  });
});
