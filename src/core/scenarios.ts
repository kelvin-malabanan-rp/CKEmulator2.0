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
  | { kind: 'scan'; code: string; description?: string; priceCents?: number }
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
  /** Pump number stamped in the demo prepay item's description (fallback only). */
  prepayPumpNumber: number;
  /** Prepay amount for the demo's fuel scene, in cents. */
  prepayAmountCents: number;
  /**
   * The real fuel prepay item from the loaded ads list (see `findPrepayItem`).
   * When present the demo rings this item; when absent it falls back to a
   * synthetic `PREPAY CA #NN` line built from `prepayPumpNumber`.
   */
  prepayItem?: { code: string; description: string };
  /**
   * A completer from the loaded ads — the prepay ad's when it has one, else
   * any ad's. When present the demo's Scene 3 rings it directly (auto-inject)
   * instead of waiting for a shopper-screen tap — the ads don't render on the
   * shopper screen, so a tap can never come.
   */
  demoCompleter?: { code: string; description?: string };
}

/** How long a scenario waits for the player to silently inject a completer. */
const INJECT_TIMEOUT_MS = 15_000;
/** How long a scenario waits for the cashier to manually tap the offer. */
const MANUAL_INJECT_TIMEOUT_MS = 60_000;

/**
 * Camera pacing for the demo-recording scenario. Each scene dwells long
 * enough to read on a screen recording — these are deliberate, not the
 * user-tunable stepGapMs.
 */
const DEMO_ATTRACT_MS = 4_000; // walkup/attract screen establishes before the sale
const DEMO_SCAN_GAP_MS = 2_500; // natural cadence between back-to-back scans
const DEMO_SCENE_MS = 4_000; // dwell after each basket change so the shopper screen update reads
const DEMO_GOODBYE_MS = 8_000; // receipt/goodbye linger before the recording cut

/** The canned regression scenarios, parameterised by `p`. */
export function builtinScenarios(p: ScenarioParams): Scenario[] {
  const gap: ScenarioStep = { kind: 'wait', ms: p.stepGapMs };
  // Demo Scene 3: with a known completer from the ads list, ring it directly
  // (the ads don't render on the shopper screen, so a manual tap can never
  // arrive). Without loaded ads there is no completer to ring — skip the
  // offer beat entirely rather than stall a recording on a wait that can
  // never be satisfied.
  const demoOfferSteps: ScenarioStep[] = p.demoCompleter
    ? [
        {
          kind: 'scan',
          code: p.demoCompleter.code,
          ...(p.demoCompleter.description !== undefined ? { description: p.demoCompleter.description } : {}),
        },
        { kind: 'wait', ms: DEMO_SCENE_MS },
      ]
    : [];
  const demoScene3 = p.demoCompleter
    ? 'Scene 3: the register rings a completer from the ads list itself (auto-inject — the ads have no shopper-screen tap), then payment closes the sale.'
    : 'Scene 3: payment closes the sale (load ads first to add the auto-injected completer beat).';
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
      registerTypes: ['radiant6-canada', 'radiant6-us', 'verifone-topaz'],
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
      registerTypes: ['radiant6-canada', 'radiant6-us', 'bulloch', 'verifone-topaz'],
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
      id: 'demo-recording',
      name: 'Demo recording script (Topaz)',
      description: `One-shot run of the Verifone Topaz demo script. Scene 1: the transaction comes alive (three scans). Scene 2: cashier corrections — price override, another unit rung inline, void, fuel prepay. ${demoScene3}`,
      registerTypes: ['verifone-topaz'],
      steps: [
        // ── Scene 1: The Transaction Comes Alive ──
        // Attract dwell — the walkup ad establishes on camera before the sale.
        { kind: 'wait', ms: DEMO_ATTRACT_MS },
        { kind: 'scan', code: p.itemCode },
        { kind: 'wait', ms: DEMO_SCENE_MS },
        { kind: 'scan', code: p.itemCode2 },
        { kind: 'wait', ms: DEMO_SCAN_GAP_MS },
        { kind: 'scan', code: p.itemCode },
        { kind: 'wait', ms: DEMO_SCENE_MS },
        // ── Scene 2: The Cashier Makes Changes — The Player Stays Accurate ──
        // Void the duplicate FIRST: Topaz voids match by description newest-first,
        // so with two item-1 lines active a later void would eat the price
        // override's re-rung line instead of the duplicate.
        { kind: 'voidLine', lineNumber: 3 },
        { kind: 'wait', ms: DEMO_SCENE_MS },
        // Price override on the remaining item-1 line (void + re-ring at $1.49).
        { kind: 'setPrice', lineNumber: 1, priceCents: 149 },
        { kind: 'wait', ms: DEMO_SCENE_MS },
        // Another unit of item 2 — rings as its own line (shopper adds are
        // inline, never qty bumps).
        { kind: 'scan', code: p.itemCode2 },
        { kind: 'wait', ms: DEMO_SCENE_MS },
        // …then ring a fuel prepay: the real prepay item from the ads list when
        // one is loaded (its `#` description routes it to the player's fuel
        // branch), else a synthetic line built from the pump param. The amount
        // always comes from the scenario params.
        {
          kind: 'scan',
          code: p.prepayItem?.code ?? '',
          description:
            p.prepayItem?.description ??
            `PREPAY CA #${String(Math.max(1, Math.trunc(p.prepayPumpNumber))).padStart(2, '0')}`,
          priceCents: p.prepayAmountCents,
        },
        { kind: 'wait', ms: DEMO_SCENE_MS },
        // ── Scene 3: The Offer Fires — and Closes the Sale ──
        // A direct scan of a completer from the ads list (auto-inject), or
        // nothing when no ads are loaded — never a wait that can't be met.
        ...demoOfferSteps,
        { kind: 'tender', tenderKind: 'cash-exact' },
        // Goodbye linger — screen resets, basket clears, ready for the next customer.
        { kind: 'wait', ms: DEMO_GOODBYE_MS },
      ],
    },
    {
      id: 'suspend-resume',
      name: 'Suspend / resume ticket',
      description:
        'Scan an item, suspend the ticket, resume it, then tender — watch the player clear the basket on suspend and restore it on resume.',
      registerTypes: ['radiant6-canada', 'radiant6-us', 'verifone-topaz'],
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
      return `scan ${step.code || step.description || '?'}`;
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
