# One-Button Scenario Runner (+ radiant6-us groundwork) — Design

**Date:** 2026-07-08
**Status:** Approved (Option A: declarative scenario runner; US target: radiant6-us)

## Problem

Testing player flows today is manual: tap a quick key, type a loyalty card,
wait, watch the wire log. Multi-step flows — especially **silent discount
injection on loyalty customers** (scan trigger item → loyalty 1024 → player
confirms sign-in → player injects EventId 2001) — need many precise steps and
a human watching timing. We want one button per flow, with pass/fail.

## Grounding (from the legacy + CK Player 2.0 audits, 2026-07-08)

- CK Player 2.0's silent injection path is confirmed:
  `1011` trigger item → `itemsInBasket`/`onPromo`; `1024` non-12-digit card →
  `SCANNER_LOYALTY_RECEIVED` → `LoyaltyManager.loginV2` (async HTTP) →
  `LOYALTY_SIGNED_IN` → `ifLoyaltySignedIn`; ad with `injectItem`/`addDiscount`
  completer and no display media (or `canAutocompleteDiscount`) →
  `BasketAdQueue.injectItemSilently()` → `virtualjournal.injectScan` →
  **`EventId=2001,Barcode=…,Quantity=…`** back down the VJ socket.
- The emulator already has every primitive: `scan`, `loyalty`, `tender`,
  `voidLine`, `setQuantity`, `setPrice`, `voidTicket`, and the inbound inject
  listener (`onInject` → rings up the item, bumps `injectSeq`).
- A 12-digit `DiscountCardNumber` exercises the LIFTBAU-565 discriminator
  (UPC-as-coupon: `SCAN_RECEIVED` + $0 `ITEM_ADDED`, pricebook-gated).
- Legacy's `RegisterEmulator` interface + `dev/playbackFiles/*.xml` confirm the
  action vocabulary; legacy paced journal lines at ~750 ms (`JOURNAL_LAG`).

## Design

### Core: `src/core/scenarios.ts` (pure, unit-tested)

```ts
type ScenarioStep =
  | { kind: 'scan'; code: string; description?: string }
  | { kind: 'loyalty'; cardNumber: string }
  | { kind: 'wait'; ms: number }                       // pacing (default step gap 750ms)
  | { kind: 'waitForInject'; timeoutMs: number; expectCodes?: string[] }
  | { kind: 'tender'; tenderKind: TenderKind; amountCents?: number }
  | { kind: 'voidLine'; lineNumber: number }
  | { kind: 'setQuantity'; lineNumber: number; quantity: number }
  | { kind: 'setPrice'; lineNumber: number; priceCents: number }
  | { kind: 'voidTicket' }
  | { kind: 'expect'; check: 'lineCount' | 'totalCents'; value: number };

interface Scenario {
  id: string;
  name: string;
  description: string;
  registerTypes: RegisterType[];   // which modes it applies to
  steps: ScenarioStep[];
}
```

- `builtinScenarios(params)` returns the canned list; `params` carries the
  configurable loyalty card number and default trigger/completer UPCs.
- `scenarioForAd(ad, cardNumber)` builds the per-ad silent-injection scenario:
  scan `ad.triggers[0]` → loyalty → `waitForInject` with
  `expectCodes = ad.completers.map(c => c.code)` → tender.
- Pure module: no timers, no React — the *runner* owns time.

### Runner: `useScenarioRunner` (renderer hook)

- Executes steps sequentially against the existing `useEmulator` actions.
- Per-step state: `pending | running | ok | fail(reason)`; scenario verdict =
  all-ok. Cancellable (Stop button); a register-type switch aborts the run.
- `waitForInject` resolves when `injectSeq` bumps (and, when `expectCodes` is
  set, the injected barcode matches); rejects on timeout. Default 15 s —
  loyalty login is a real HTTP round-trip.
- Every step logs to the existing Wire Log with a `sys` line
  (`[Scenario] step 3/6 waitForInject … ok in 2.4s`).

### UI

- New **Scenarios panel** (left column, under Triggers & Completers): one
  button per applicable built-in scenario, live step ticker while running,
  green/red verdict when done.
- Per-ad **"Test silently"** button in the Triggers & Completers rows for ads
  whose completers include an `injectItem`/`addDiscount` condition — requires
  extending `adTriggers.ts` extraction to also capture **completer condition
  types**, which yields a "silent-capable" badge per ad.
- A small settings row: loyalty card number (persisted in localStorage),
  step gap ms.

### Built-in scenarios (first ship)

1. **Silent loyalty discount injection** — scan trigger UPC → loyalty →
   waitForInject(15 s) → tender cash-exact. *The headline button.*
2. **Loyalty sign-in only** — 1024 with non-12-digit card.
3. **1024 UPC-as-coupon** (LIFTBAU-565) — 12-digit card number; expect a $0
   item echo, no sign-in.
4. **Arrondir rounding sale** — price ending in 1–4/6–9 ¢ → cash tender →
   1022 Arrondir emitted.
5. **Manual completer** — scan trigger → waitForInject(60 s) (cashier taps in
   the player).
6. **Edit-heavy sale** — scan ×2 → setQuantity → setPrice → voidLine → tender.
7. **fr-CA sale** — locale fr → scan → tender (Solde dû / Monnaie due windows).
8. **Bulloch full sale** — [C000] → [C110]×2 → [C120] → [C200].
9. **Suspend/resume** — requires adding **1003/1004** to
   `Radiant6CanadaEncoder` (currently missing; small addition, in scope).

### Error handling

- Timeout on `waitForInject` → step fail with elapsed time; run stops (later
  steps marked skipped). Disconnected sockets → immediate fail with a hint.
- Runner never mutates `RegisterSession` directly — only via the same
  dispatch used by manual buttons, so the Wire Log stays the single truth.

### Testing

- `scenarios.test.ts` — scenario builders (incl. per-ad builder, completer
  condition-type extraction).
- Runner tested via a fake clock + scripted `injectSeq` bumps (vitest).
- Round-trip tests already prove the encoder output parses in CKP2; scenario
  steps reuse those encoders unchanged.

## Phase 2: `radiant6-us` register type

Smallest useful US mode; same 10xx wire protocol. Deltas vs Canada, all
confirmed against legacy `Radiant6VirtualJournal`/`Radiant6RegisterEmulator`
(release/8.2.8.0):

- **Emit `1005` (basket subtotal) and `1020` (tax) on the VJ** — in Canada
  these are pole-only; in the US the VJ is authoritative for them.
- **No Arrondir** — US cash does not nickel-round (skip the 1022 rounding
  event; keep exact totals).
- **Locale/currency**: en-US, `$` prefix formatting (pole windows use the EN
  regex family: `Balance Due…` / `Change Due…`).
- **Loyalty**: 1024 flow identical; legacy recognizes card prefixes
  `D7826` / `D8018` / `8018` — the emulator just sends whatever card the user
  configured, so this is documentation + default placeholder, not logic.
- Implementation: `registerType: 'radiant6-us'` routing in `RegisterSession`
  (reuses `Radiant6CanadaEncoder` with an options flag `{ vjTotals: true,
  cashRounding: false }` rather than a copied encoder).
- All scenario buttons work unchanged in this mode (Arrondir scenario hidden
  via `registerTypes`).

Out of scope (later phases): octane HTTP mode, Verifone Topaz, repo rename to
`pos-emulator`.
