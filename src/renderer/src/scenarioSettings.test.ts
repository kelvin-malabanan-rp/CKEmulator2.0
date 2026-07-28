import { describe, it, expect } from 'vitest';
import { parseString, parseStepGapMs, parsePrepayCents, parsePrepayPump } from './scenarioSettings';

describe('parseString', () => {
  it('accepts any string, including empty', () => {
    expect(parseString('8018abc')).toBe('8018abc');
    expect(parseString('')).toBe('');
  });
});

describe('parseStepGapMs', () => {
  it('accepts finite, non-negative numbers', () => {
    expect(parseStepGapMs('750')).toBe(750);
    expect(parseStepGapMs('0')).toBe(0);
  });

  it('rejects negatives and non-numbers', () => {
    expect(parseStepGapMs('-1')).toBeNull();
    expect(parseStepGapMs('abc')).toBeNull();
  });
});

describe('parsePrepayCents', () => {
  it('accepts finite, positive numbers', () => {
    expect(parsePrepayCents('3000')).toBe(3000);
  });

  it('rejects zero, negatives, and non-numbers', () => {
    expect(parsePrepayCents('0')).toBeNull();
    expect(parsePrepayCents('-5')).toBeNull();
    expect(parsePrepayCents('nope')).toBeNull();
  });
});

describe('parsePrepayPump', () => {
  it('accepts and truncates integers ≥ 1', () => {
    expect(parsePrepayPump('5')).toBe(5);
    expect(parsePrepayPump('5.9')).toBe(5);
  });

  it('rejects values below 1 and non-numbers', () => {
    expect(parsePrepayPump('0')).toBeNull();
    expect(parsePrepayPump('0.4')).toBeNull();
    expect(parsePrepayPump('abc')).toBeNull();
  });
});
