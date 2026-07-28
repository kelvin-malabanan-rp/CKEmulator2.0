import { describe, it, expect } from 'vitest';
import { dotState } from './connState';

describe('dotState', () => {
  it('is connected whenever the channel is connected, regardless of attempt', () => {
    expect(dotState('connected', false)).toBe('connected');
    expect(dotState('connected', true)).toBe('connected');
  });

  it('is connecting whenever the channel is connecting', () => {
    expect(dotState('connecting', false)).toBe('connecting');
    expect(dotState('connecting', true)).toBe('connecting');
  });

  it('is idle when disconnected before any connect attempt', () => {
    expect(dotState('disconnected', false)).toBe('idle');
  });

  it('is error when disconnected after a connect attempt', () => {
    expect(dotState('disconnected', true)).toBe('error');
  });
});
