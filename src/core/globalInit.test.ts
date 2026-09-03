import { describe, it, expect } from 'vitest';
import {
  parseProperties,
  extractLocationCode,
  deriveTenant,
  extractEndpoints,
  toGlobalInitConfig,
  resolveTenantUrl,
  resolvePricebookUrl,
  findDatacenterName,
  configFromPlayerKeyFile,
  stageForUrl,
  DATACENTERS,
  PLAYER_KEY_FILENAME,
} from './globalInit';

// Real generated config (the "# Generated on …" block), with Java-escaped colons.
const RAW = `# Generated on 2026-06-03T07:31:38.143Z
player.code=ca-radmarketing-1
player.key=d8362376-b40a-4f75-8757-4c5a2582b06e-e2e
init.url=https\\://player.e2e.circlekliftdev.com/api/lift/system/services/init
heartbeat.url=https\\://player.e2e.circlekliftdev.com/api/lift/{tenantCode}/services/heartbeats/
pricebook.url=
manifest.url=https\\://player.e2e.circlekliftdev.com/api/lift/{tenantCode}/manifests
masterItemData.url=https\\://player.e2e.circlekliftdev.com/api/lift/{tenantCode}/s3/files/item_master/tenant_{tenantCode}_master_data_file.zip
pricebook.pricebookTypeUrl=`;

describe('parseProperties', () => {
  it('parses keys and unescapes Java backslash escapes in URLs', () => {
    const p = parseProperties(RAW);
    expect(p.get('player.code')).toBe('ca-radmarketing-1');
    expect(p.get('init.url')).toBe('https://player.e2e.circlekliftdev.com/api/lift/system/services/init');
    expect(p.get('pricebook.url')).toBe('');
  });

  it('skips comments and blank lines', () => {
    expect(parseProperties('# c\n\nplayer.code=x').get('player.code')).toBe('x');
  });
});

describe('extractLocationCode / deriveTenant', () => {
  it('strips the trailing lane segment after the last dash (loa getLocationCode parity)', () => {
    expect(extractLocationCode('ca-radmarketing-1')).toBe('ca-radmarketing');
    expect(extractLocationCode('ie-12345-2')).toBe('ie-12345');
    // Unconditional last-dash strip — not just numeric suffixes.
    expect(extractLocationCode('us-2741604-laneA')).toBe('us-2741604');
    // No dash → returned unchanged.
    expect(extractLocationCode('31989')).toBe('31989');
  });

  it('derives tenant from the player code leading segment when no tenant property', () => {
    expect(deriveTenant(parseProperties(RAW), 'ca-radmarketing-1')).toBe('ca');
    expect(deriveTenant(new Map([['tenant', 'ie']]), 'x-1')).toBe('ie');
  });
});

describe('extractEndpoints / toGlobalInitConfig', () => {
  it('extracts all endpoint keys (empty string when absent)', () => {
    const e = extractEndpoints(parseProperties(RAW));
    expect(e['masterItemData.url']).toContain('item_master');
    expect(e['pricebook.url']).toBe('');
    expect(e['scoreboard.url']).toBe('');
  });

  it('builds a config with player code, tenant, location and endpoints', () => {
    const cfg = toGlobalInitConfig(RAW, 'End to End Test Lab')!;
    expect(cfg.playerCode).toBe('ca-radmarketing-1');
    expect(cfg.tenant).toBe('ca');
    expect(cfg.locationCode).toBe('ca-radmarketing');
    expect(cfg.datacenter).toBe('End to End Test Lab');
    expect(cfg.endpoints['init.url']).toContain('https://');
  });

  it('returns null when there is no player.code (unrecognised key)', () => {
    expect(toGlobalInitConfig('# nope\nfoo=bar')).toBeNull();
  });
});

describe('findDatacenterName', () => {
  it('recovers the datacenter name from an endpoint host', () => {
    const endpoints = extractEndpoints(parseProperties(RAW));
    expect(findDatacenterName(endpoints)).toBe('End to End Test Lab');
  });

  it('returns undefined for an unknown host', () => {
    expect(findDatacenterName({ 'init.url': 'https://unknown.example.com/api' })).toBeUndefined();
  });

  it('returns undefined when there are no usable endpoints', () => {
    expect(findDatacenterName({})).toBeUndefined();
    expect(findDatacenterName({ 'init.url': '' })).toBeUndefined();
  });
});

describe('configFromPlayerKeyFile', () => {
  it('parses a persisted player.key file and recovers the datacenter', () => {
    const cfg = configFromPlayerKeyFile(RAW)!;
    expect(cfg.playerCode).toBe('ca-radmarketing-1');
    expect(cfg.playerKey).toBe('d8362376-b40a-4f75-8757-4c5a2582b06e-e2e');
    expect(cfg.tenant).toBe('ca');
    expect(cfg.datacenter).toBe('End to End Test Lab');
  });

  it('returns null when the file has no player.code', () => {
    expect(configFromPlayerKeyFile('# empty file')).toBeNull();
  });
});

describe('PLAYER_KEY_FILENAME', () => {
  it('matches the legacy player.key filename', () => {
    expect(PLAYER_KEY_FILENAME).toBe('player.key');
  });
});

describe('resolveTenantUrl', () => {
  it('replaces {tenantCode} tokens', () => {
    expect(resolveTenantUrl('https://x/api/lift/{tenantCode}/manifests', 'ca')).toBe('https://x/api/lift/ca/manifests');
    expect(resolveTenantUrl('.../tenant_{tenantCode}_master.zip', 'ca')).toBe('.../tenant_ca_master.zip');
  });
});

describe('resolvePricebookUrl', () => {
  it('uses a configured pricebook.url (tenant-substituted)', () => {
    const endpoints = { 'pricebook.url': 'https://player.e2e.circlekliftdev.com/api/lift/{tenantCode}/pricebook', 'init.url': 'https://player.e2e.circlekliftdev.com/api/lift/system/services/init' };
    expect(resolvePricebookUrl(endpoints, 'us')).toBe('https://player.e2e.circlekliftdev.com/api/lift/us/pricebook');
  });

  it('derives from the init origin + tenant when pricebook.url is absent', () => {
    const endpoints = { 'pricebook.url': '', 'init.url': 'https://player.e2e.circlekliftdev.com/api/lift/system/services/init' };
    expect(resolvePricebookUrl(endpoints, 'us')).toBe('https://player.e2e.circlekliftdev.com/api/lift/us/pricebook');
  });

  it('returns empty when neither pricebook.url nor init.url is available', () => {
    expect(resolvePricebookUrl({}, 'us')).toBe('');
  });
});

describe('stageForUrl', () => {
  it('classifies the local dev servers, including the LOA player port', () => {
    expect(stageForUrl('http://localhost:5173/')).toBe('local');
    expect(stageForUrl('http://127.0.0.1:8080/api/lift/')).toBe('local');
  });

  it('classifies the hosted LOA E2E build as e2e, not dev, despite the dev domain', () => {
    expect(
      stageForUrl('https://loa-player.e2e.circlekliftdev.com/20260605155159.d8638c8/index.html#playerKey=abc'),
    ).toBe('e2e');
  });

  it('agrees with the stage every datacenter declares (devdog and dev both collapse to dev)', () => {
    for (const dc of DATACENTERS) {
      const expected = dc.stage === 'devdog' ? 'dev' : dc.stage;
      expect(stageForUrl(dc.host), dc.name).toBe(expected);
      expect(stageForUrl(dc.register), dc.name).toBe(expected);
    }
  });

  it('separates the prod domain from the dev domain', () => {
    expect(stageForUrl('https://player.circleklift.com/api/lift/')).toBe('prod');
    expect(stageForUrl('https://player.circlekliftdev.com/api/lift/')).toBe('dev');
  });

  it('does not let a lookalike host masquerade as Circle K', () => {
    expect(stageForUrl('https://evil-circleklift.com/')).toBe('unknown');
    expect(stageForUrl('https://circlekliftdev.com.attacker.test/')).toBe('unknown');
  });

  it('returns unknown for an unparseable or foreign URL', () => {
    expect(stageForUrl('')).toBe('unknown');
    expect(stageForUrl('not a url')).toBe('unknown');
    expect(stageForUrl('https://unknown.example.com/')).toBe('unknown');
  });
});
