import { describe, expect, it } from 'vitest';
import { shouldShowTabBadge } from './tabBadge';

describe('shouldShowTabBadge', () => {
  it('hides the badge when the count is undefined (e.g. the Wire Log tab)', () => {
    expect(shouldShowTabBadge(undefined)).toBe(false);
  });

  it('hides the badge when the count is zero', () => {
    expect(shouldShowTabBadge(0)).toBe(false);
  });

  it('shows the badge for a positive count', () => {
    expect(shouldShowTabBadge(1)).toBe(true);
    expect(shouldShowTabBadge(12)).toBe(true);
  });

  it('does not show a badge for a negative count', () => {
    expect(shouldShowTabBadge(-1)).toBe(false);
  });
});
