import { describe, it, expect } from 'vitest';
import {
  settingsDateStamp,
  buildSettingGroupsUrl,
  extractLoaSettings,
  type SettingGroupsResponse,
} from './settingGroups';

describe('settingsDateStamp', () => {
  it('formats YYYYMMDD with zero-padded month/day', () => {
    expect(settingsDateStamp(new Date('2026-08-05T12:00:00'))).toBe('20260805');
    expect(settingsDateStamp(new Date('2026-12-25T00:00:00'))).toBe('20261225');
  });
});

describe('buildSettingGroupsUrl', () => {
  it('assembles the loa-player settinggroups query (locationcode, dates, player creds)', () => {
    const url = buildSettingGroupsUrl({
      contentCronBaseUrl: 'https://player.e2e.circlekliftdev.com/api/lift/ca/elastic/',
      locationCode: 'ca-radmarketing',
      playerCode: 'ca-radmarketing-1',
      playerKey: 'KEY123',
      today: '20260825',
    });
    expect(url).toContain('/api/lift/ca/elastic/settinggroups/_doc');
    expect(url).toContain('in(related.locationcode,ca-radmarketing)');
    expect(url).toContain('sort=-modifiedat&source=json');
    expect(url).toContain('ge(related.enddate,20260825)');
    expect(url).toContain('le(related.startdate,20260825)');
    expect(url).toContain('playercode=ca-radmarketing-1&playerkey=KEY123');
  });
});

describe('extractLoaSettings', () => {
  it('keeps only loa- settings, strips the prefix, and exposes pricebook.url', () => {
    const json: SettingGroupsResponse = {
      data: [
        {
          settings: [
            { name: 'loa-pricebook.url', value: 'https://host/api/lift/ca/pricebook' },
            { name: 'loa-images.url', value: 'https://host/img' },
            { name: 'other.setting', value: 'ignored' }, // no loa- prefix → dropped
          ],
        },
      ],
    };
    const settings = extractLoaSettings(json);
    expect(settings['pricebook.url']).toBe('https://host/api/lift/ca/pricebook');
    expect(settings['images.url']).toBe('https://host/img');
    expect(settings['other.setting']).toBeUndefined();
  });

  it('newest group wins for a duplicated setting (response is sorted -modifiedat)', () => {
    const json: SettingGroupsResponse = {
      data: [
        { settings: [{ name: 'loa-pricebook.url', value: 'NEW' }] },
        { settings: [{ name: 'loa-pricebook.url', value: 'OLD' }] },
      ],
    };
    expect(extractLoaSettings(json)['pricebook.url']).toBe('NEW');
  });

  it('tolerates missing/empty data and settings', () => {
    expect(extractLoaSettings(null)).toEqual({});
    expect(extractLoaSettings({})).toEqual({});
    expect(extractLoaSettings({ data: [{ settings: null }, {}] })).toEqual({});
  });
});
