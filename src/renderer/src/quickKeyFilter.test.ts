import { describe, it, expect } from 'vitest';
import { matchesQuery, filterQuickKeys, sortPinned, togglePin } from './quickKeyFilter';
import type { QuickKeyEntry } from '../../core/quickkeys';

const key = (upc: string, description: string): QuickKeyEntry => ({
  upc,
  sendScan: false,
  description,
  quantity: 1,
  priceCents: 100,
  io: [],
});

const COKE = key('049000000443', 'Coke 20oz');
const CHIPS = key('012000001291', 'Lays Chips');
const WATER = key('628700001111', 'Eau 500ml');

describe('matchesQuery', () => {
  it('matches every entry for an empty or whitespace query', () => {
    expect(matchesQuery(COKE, '')).toBe(true);
    expect(matchesQuery(COKE, '   ')).toBe(true);
  });

  it('matches by description, case-insensitively', () => {
    expect(matchesQuery(COKE, 'coke')).toBe(true);
    expect(matchesQuery(COKE, 'CHIPS')).toBe(false);
  });

  it('matches by UPC substring', () => {
    expect(matchesQuery(COKE, '049000')).toBe(true);
    expect(matchesQuery(COKE, '999')).toBe(false);
  });
});

describe('filterQuickKeys', () => {
  it('keeps only matching entries in original order', () => {
    expect(filterQuickKeys([COKE, CHIPS, WATER], 'a')).toEqual([CHIPS, WATER]);
  });

  it('returns all entries for an empty query', () => {
    expect(filterQuickKeys([COKE, CHIPS], '')).toEqual([COKE, CHIPS]);
  });
});

describe('sortPinned', () => {
  it('floats pinned entries to the top, preserving order within groups', () => {
    expect(sortPinned([COKE, CHIPS, WATER], new Set([WATER.upc]))).toEqual([WATER, COKE, CHIPS]);
    expect(sortPinned([COKE, CHIPS, WATER], new Set([COKE.upc, WATER.upc]))).toEqual([COKE, WATER, CHIPS]);
  });

  it('is a no-op when nothing is pinned', () => {
    expect(sortPinned([COKE, CHIPS], new Set())).toEqual([COKE, CHIPS]);
  });
});

describe('togglePin', () => {
  it('adds an absent upc', () => {
    expect(togglePin(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes a present upc', () => {
    expect(togglePin(['a', 'b'], 'a')).toEqual(['b']);
  });
});
