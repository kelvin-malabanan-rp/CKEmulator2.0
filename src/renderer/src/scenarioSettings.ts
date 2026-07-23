import type { Parse } from './usePersistedState';

/**
 * Persisted scenario-knob settings: localStorage keys, defaults, and the
 * validating parsers used by `usePersistedState`. Centralised here (rather than
 * inline in App) so the parsers are unit-testable and the App/Scenarios panels
 * share one source of truth for the defaults.
 */

export const SCENARIO_CARD_KEY = 'r6ca.scenario.loyaltyCard';
export const SCENARIO_GAP_KEY = 'r6ca.scenario.stepGapMs';
export const SCENARIO_COUPON_KEY = 'r6ca.scenario.upcCoupon12';
export const SCENARIO_PREPAY_KEY = 'r6ca.scenario.prepayAmountCents';
export const SCENARIO_PUMP_KEY = 'r6ca.scenario.prepayPumpNumber';

// Valid CK loyalty format: 22 digits starting 8018 — the player's
// getCKLoyaltyNumber rejects anything else before it ever calls login.
export const DEFAULT_SCENARIO_CARD = '8018782603900930000100';
export const DEFAULT_UPC_COUPON = '012345678905';
export const DEFAULT_STEP_GAP_MS = 750;
export const DEFAULT_PREPAY_CENTS = 3000;
export const DEFAULT_PREPAY_PUMP = 5;

/** Any string is a valid card/UPC value (empty included — kept as typed). */
export const parseString: Parse<string> = (raw) => raw;

/** Step gap: a finite, non-negative number of milliseconds. */
export const parseStepGapMs: Parse<number> = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Prepay amount: a finite, positive number of cents. */
export const parsePrepayCents: Parse<number> = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Pump number: a finite integer ≥ 1 (truncated). */
export const parsePrepayPump: Parse<number> = (raw) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
};
