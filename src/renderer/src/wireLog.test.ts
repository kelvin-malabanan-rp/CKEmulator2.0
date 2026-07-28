import { describe, it, expect } from 'vitest';
import { categorizeLog, formatRelativeTime } from './wireLog';

describe('categorizeLog', () => {
  it('treats every protocol channel as wire traffic', () => {
    expect(categorizeLog('vj', '1011 ...')).toBe('wire');
    expect(categorizeLog('pole', 'DISPLAY ...')).toBe('wire');
    expect(categorizeLog('scanner', '049000000443')).toBe('wire');
  });

  it('classifies sys connection events', () => {
    expect(categorizeLog('sys', 'Connecting to 127.0.0.1 (VJ 5438…)')).toBe('connection');
    expect(categorizeLog('sys', 'Disconnecting…')).toBe('connection');
    expect(categorizeLog('sys', 'Registered: ca-123 (tenant ca)')).toBe('connection');
  });

  it('classifies sys data/config loads', () => {
    expect(categorizeLog('sys', 'Pricebook loaded: 5 items')).toBe('data');
    expect(categorizeLog('sys', 'Quick keys loaded from /x: 2 file(s)')).toBe('data');
    expect(categorizeLog('sys', 'Completer inject: 049000000443 ×1')).toBe('data');
  });

  it('lets error precedence win over connection/data keywords', () => {
    expect(categorizeLog('sys', 'Register failed: bad key')).toBe('error');
    expect(categorizeLog('sys', 'Ads error: 404')).toBe('error');
    expect(categorizeLog('sys', 'Pricebook error: not found')).toBe('error');
  });
});

describe('formatRelativeTime', () => {
  it('shows "now" within the first few seconds and clamps clock skew', () => {
    expect(formatRelativeTime(1000, 1000)).toBe('now');
    expect(formatRelativeTime(1000, 4999)).toBe('now');
    expect(formatRelativeTime(5000, 1000)).toBe('now');
  });

  it('shows seconds, then minutes+seconds, then hours+minutes', () => {
    expect(formatRelativeTime(0, 12_000)).toBe('12s ago');
    expect(formatRelativeTime(0, 90_000)).toBe('1m30s ago');
    expect(formatRelativeTime(0, 602_000)).toBe('10m02s ago');
    expect(formatRelativeTime(0, 2 * 60 * 60_000)).toBe('2h00m ago');
    expect(formatRelativeTime(0, (2 * 3600 + 5 * 60) * 1000)).toBe('2h05m ago');
  });
});
