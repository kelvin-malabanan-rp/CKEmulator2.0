/**
 * Scenario model + builders.
 *
 * A Scenario is a named, ordered list of steps (scan, loyalty sign-in, waits,
 * line edits, tender, …) that the scenario engine replays against a
 * RegisterSession to exercise CK Player 2.0 end-to-end. `builtinScenarios`
 * returns the canned regression scenarios (silent injection, arrondir
 * rounding, fr-CA, Bulloch, …); `scenarioForAd` derives a scan→sign-in→inject
 * scenario from one ad's triggers/completers.
 *
 * Pure / browser-safe (no Node or Electron imports).
 */
import type { TenderKind } from './RegisterSession';
import type { RegisterType } from './posTypes';
import type { AdTriggersCompleters } from './adTriggers';

export type ScenarioStep =
  | { kind: 'scan'; code: string; description?: string }
  | { kind: 'loyalty'; cardNumber: string }
  | { kind: 'wait'; ms: number }
  | { kind: 'waitForInject'; timeoutMs: number; expectCodes?: string[] }
  | { kind: 'tender'; tenderKind: TenderKind; amountCents?: number }
  | { kind: 'voidLine'; lineNumber: number }
  | { kind: 'setQuantity'; lineNumber: number; quantity: number }
  | { kind: 'setPrice'; lineNumber: number; priceCents: number }
  | { kind: 'voidTicket' }
  | { kind: 'suspend' }
  | { kind: 'resume' }
  | { kind: 'setLocale'; locale: 'en' | 'fr' }
  | { kind: 'expect'; check: 'lineCount' | 'totalCents'; value: number };

export interface Scenario {
  id: string;
  name: string;
  description: string;
  registerTypes: RegisterType[];
  steps: readonly ScenarioStep[];
}

/** Knobs the UI feeds into the builders (item codes, cards, pacing). */
export interface ScenarioParams {
  itemCode: string;
  itemCode2: string;
  loyaltyCard: string;
  upcCoupon12: string;
  stepGapMs: number;
}

/** How long a scenario waits for the player to silently inject a completer. */
const INJECT_TIMEOUT_MS = 15_000;
/** How long a scenario waits for the cashier to manually tap the offer. */
const MANUAL_INJECT_TIMEOUT_MS = 60_000;

/** The canned regression scenarios, parameterised by `p`. */
export function builtinScenarios(p: ScenarioParams): Scenario[] {
  const gap: ScenarioStep = { kind: 'wait', ms: p.stepGapMs };
  return [
    {
      id: 'silent-loyalty-injection',
      name: 'Silent loyalty injection',
      description:
        'Scan a trigger item then sign in with loyalty — watch the player auto-inject the completer with no cashier tap before the sale tenders.',
      registerTypes: ['radiant6-canada', 'radiant6-us'],
      steps: [
        { kind: 'scan', code: p.itemCode },
        gap,
        { kind: 'loyalty', cardNumber: p.loyaltyCard },
        { kind: 'waitForInject', timeoutMs: INJECT_TIMEOUT_MS },
        gap,
        { kind: 'tender', tenderKind: 'cash-exact' },
      ],
    },
    {
      id: 'loyalty-signin',
      name: 'Loyalty sign-in',
      description:
        'Scan an item, then swipe the loyalty card mid-transaction — watch the player switch to the signed-in member experience.',
      registerTypes: ['radiant6-canada', 'radiant6-us'],
      steps: [{ kind: 'scan', code: p.itemCode }, gap, { kind: 'loyalty', cardNumber: p.loyaltyCard }],
    },
    {
      id: 'upc-as-coupon',
      name: 'UPC sent as loyalty card',
      description:
        'Send a 12-digit DiscountCardNumber — watch the player treat it as a coupon UPC ($0 item), not a loyalty sign-in (LIFTBAU-565).',
      registerTypes: ['radiant6-canada', 'radiant6-us'],
      steps: [{ kind: 'loyalty', cardNumber: p.upcCoupon12 }],
    },
    {
      id: 'arrondir-rounding',
      name: 'Arrondir cash rounding',
      description:
        'Scan an item, reprice it to $2.02, then tender exact cash — watch the player show Canadian penny rounding (arrondir) on the total.',
      registerTypes: ['radiant6-canada'],
      steps: [
        { kind: 'scan', code: p.itemCode },
        { kind: 'setPrice', lineNumber: 1, priceCents: 202 },
        gap,
        { kind: 'tender', tenderKind: 'cash-exact' },
      ],
    },
    {
      id: 'manual-completer',
      name: 'Manual completer tap',
      description:
        'Scan a trigger item then wait — the cashier must tap the offer in the player to inject the completer within a minute.',
      registerTypes: ['radiant6-canada', 'radiant6-us'],
      steps: [
        { kind: 'scan', code: p.itemCode },
        { kind: 'waitForInject', timeoutMs: MANUAL_INJECT_TIMEOUT_MS },
      ],
    },
    {
      id: 'edit-heavy-sale',
      name: 'Edit-heavy sale',
      description:
        'Scan two items, change quantity and price, void a line, then tender to the next dollar — watch the player basket track every edit and the change due.',
      registerTypes: ['radiant6-canada', 'radiant6-us', 'bulloch'],
      steps: [
        { kind: 'scan', code: p.itemCode },
        { kind: 'scan', code: p.itemCode2 },
        { kind: 'setQuantity', lineNumber: 1, quantity: 3 },
        { kind: 'setPrice', lineNumber: 2, priceCents: 149 },
        { kind: 'voidLine', lineNumber: 1 },
        gap,
        { kind: 'tender', tenderKind: 'next-dollar' },
      ],
    },
    {
      id: 'fr-ca-sale',
      name: 'French (fr-CA) sale',
      description:
        'Switch the lane to French, run a quick sale, then switch back — watch the player render pole/basket text in fr-CA for the whole sale.',
      registerTypes: ['radiant6-canada', 'bulloch'],
      steps: [
        { kind: 'setLocale', locale: 'fr' },
        { kind: 'scan', code: p.itemCode },
        gap,
        { kind: 'tender', tenderKind: 'cash-exact' },
        { kind: 'setLocale', locale: 'en' },
      ],
    },
    {
      id: 'bulloch-full-sale',
      name: 'Bulloch full sale',
      description:
        'Scan two items and void one on a Bulloch lane — watch the player follow the pole-primary Bulloch protocol through to tender.',
      registerTypes: ['bulloch'],
      steps: [
        { kind: 'scan', code: p.itemCode },
        { kind: 'scan', code: p.itemCode2 },
        { kind: 'voidLine', lineNumber: 1 },
        gap,
        { kind: 'tender', tenderKind: 'cash-exact' },
      ],
    },
    {
      id: 'suspend-resume',
      name: 'Suspend / resume ticket',
      description:
        'Scan an item, suspend the ticket, resume it, then tender — watch the player clear the basket on suspend and restore it on resume.',
      registerTypes: ['radiant6-canada', 'radiant6-us'],
      steps: [
        { kind: 'scan', code: p.itemCode },
        { kind: 'suspend' },
        gap,
        { kind: 'resume' },
        gap,
        { kind: 'tender', tenderKind: 'cash-exact' },
      ],
    },
  ];
}

/**
 * Build a scan → sign-in → wait-for-inject → tender scenario from one ad's
 * triggers/completers, or null when the ad has nothing to scan.
 */
export function scenarioForAd(ad: AdTriggersCompleters, p: ScenarioParams): Scenario | null {
  if (ad.triggers.length === 0) return null;
  const gap: ScenarioStep = { kind: 'wait', ms: p.stepGapMs };
  const trigger = ad.triggers[0];
  const expectCodes = ad.completers.map((c) => c.code);
  return {
    id: `ad-${ad.id}`,
    name: `Ad: ${ad.name}`,
    description: `Scan "${trigger.description ?? trigger.code}" and sign in — watch the player fire "${ad.name}" and inject its completer before the sale tenders.`,
    registerTypes: ['radiant6-canada', 'radiant6-us'],
    steps: [
      {
        kind: 'scan',
        code: trigger.code,
        ...(trigger.description !== undefined ? { description: trigger.description } : {}),
      },
      gap,
      { kind: 'loyalty', cardNumber: p.loyaltyCard },
      {
        kind: 'waitForInject',
        timeoutMs: INJECT_TIMEOUT_MS,
        ...(expectCodes.length > 0 ? { expectCodes } : {}),
      },
      gap,
      { kind: 'tender', tenderKind: 'cash-exact' },
    ],
  };
}

/**
 * One-line human summary of a step's action AND payload, for the UI ticker —
 * so two scenarios that differ only in payload (e.g. loyalty card vs 12-digit
 * UPC on the same 1024 event) read differently.
 */
export function describeStep(step: ScenarioStep): string {
  switch (step.kind) {
    case 'scan':
      return `scan ${step.code}`;
    case 'loyalty':
      return `loyalty ${step.cardNumber}`;
    case 'wait':
      return `wait ${step.ms}ms`;
    case 'waitForInject':
      return step.expectCodes && step.expectCodes.length > 0
        ? `waitForInject ≤${step.timeoutMs / 1000}s (${step.expectCodes.join(', ')})`
        : `waitForInject ≤${step.timeoutMs / 1000}s`;
    case 'tender':
      return step.amountCents !== undefined
        ? `tender ${step.tenderKind} ${(step.amountCents / 100).toFixed(2)}`
        : `tender ${step.tenderKind}`;
    case 'voidLine':
      return `voidLine #${step.lineNumber}`;
    case 'setQuantity':
      return `setQuantity #${step.lineNumber} ×${step.quantity}`;
    case 'setPrice':
      return `setPrice #${step.lineNumber} → ${(step.priceCents / 100).toFixed(2)}`;
    case 'setLocale':
      return `setLocale ${step.locale}`;
    case 'expect':
      return `expect ${step.check} = ${step.value}`;
    default:
      return step.kind;
  }
}
