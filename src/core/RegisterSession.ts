/**
 * RegisterSession — orchestrates the Basket + Radiant6CanadaEncoder for one
 * register lane. Every action returns the ordered list of wire messages to
 * push to CK Player 2.0 (VJ lines + pole windows) and mutates the basket.
 *
 * Pure / browser-safe so the UI stays a thin shell over tested logic.
 */
import { Basket } from './Basket';
import { Radiant6CanadaEncoder } from './Radiant6CanadaEncoder';
import { BullochEncoder } from './BullochEncoder';
import { TopazEncoder } from './TopazEncoder';
import type { Channel, RegisterType } from './posTypes';
import type { PosLocale } from './currency';

export interface WireMessage {
  channel: Channel;
  data: string;
}

export interface AddItemInput {
  code: string;
  description: string;
  priceCents: number;
  quantity?: number;
}

export interface LineSnapshot {
  lineNumber: number;
  code: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  extendedCents: number;
  voided: boolean;
}

export interface SessionSnapshot {
  tx: number;
  started: boolean;
  locale: PosLocale;
  lines: LineSnapshot[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export type TenderKind = 'cash-exact' | 'next-dollar' | 'amount';

export interface RegisterSessionOptions {
  terminalNumber?: number;
  taxRateBps?: number;
  operatorId?: string;
  operatorName?: string;
  startTx?: number;
  clock?: () => Date;
  /**
   * Wire protocol: 'radiant6-canada' (VJ + pole, pole-authoritative totals),
   * 'radiant6-us' (VJ + pole, VJ 1005/1020 totals, no cash rounding),
   * 'bulloch' (pole-only) or 'verifone-topaz' (plaintext VJ + pole + scanner,
   * VJ-authoritative, cents-exact).
   */
  registerType?: RegisterType;
  /** Topaz basket-end ST# column (verifone-topaz only). */
  storeCode?: string;
}

export class RegisterSession {
  private readonly encoder: Radiant6CanadaEncoder;
  private readonly bulloch: BullochEncoder;
  private readonly topaz: TopazEncoder;
  private readonly registerType: RegisterType;
  private readonly taxRateBps: number;
  private readonly operatorId: string;
  private readonly operatorName: string;
  private readonly storeCode: string;
  private basket: Basket;
  private tx: number;
  private started = false;
  private suspended = false;
  locale: PosLocale = 'en';

  constructor(options: RegisterSessionOptions = {}) {
    this.encoder = new Radiant6CanadaEncoder({
      terminalNumber: options.terminalNumber ?? 1,
      clock: options.clock,
    });
    this.bulloch = new BullochEncoder();
    this.topaz = new TopazEncoder({
      registerId: options.terminalNumber ?? 1,
      clock: options.clock,
    });
    this.registerType = options.registerType ?? 'radiant6-canada';
    this.taxRateBps = options.taxRateBps ?? 500;
    this.operatorId = options.operatorId ?? '12599';
    this.operatorName = options.operatorName ?? 'Timothy';
    this.storeCode = options.storeCode ?? 'AB123';
    this.tx = options.startTx ?? 1;
    this.basket = new Basket({ taxRateBps: this.taxRateBps });
  }

  /** Bulloch is pole-only (no virtual journal); Radiant6 Canada is VJ + pole. */
  private get isBulloch(): boolean {
    return this.registerType === 'bulloch';
  }

  /**
   * Verifone Topaz — plaintext VJ (authoritative) + pole mirror + a separate
   * barcode-scanner feed. US: cents-exact, en-US only, no EventId protocol.
   */
  private get isTopaz(): boolean {
    return this.registerType === 'verifone-topaz';
  }

  /**
   * US Radiant6 is VJ-authoritative: it emits running tax (1020) + subtotal
   * (1005) after every item mutation and stamps totals on basket end (1002).
   * Canada is pole-authoritative and never sends these.
   */
  private get vjTotals(): boolean {
    return this.registerType === 'radiant6-us';
  }

  /**
   * CAD registers (radiant6-canada and bulloch) round cash to the nearest 5¢;
   * the US modes (radiant6-us, verifone-topaz) use exact totals. Bulloch still
   * emits no 1022 Arrondir VJ event (it has no VJ) — only its change math rounds.
   */
  private get cashRounding(): boolean {
    return this.registerType !== 'radiant6-us' && !this.isTopaz;
  }

  /** Topaz item-add message set: scanner echo (if coded) → VJ line → pole mirror. */
  private topazItemMessages(code: string, description: string, quantity: number, priceCents: number): WireMessage[] {
    const messages: WireMessage[] = [];
    if (code.trim() !== '') {
      messages.push({ channel: 'scanner', data: this.topaz.scan(code) });
    }
    messages.push({
      channel: 'vj',
      data: this.topaz.itemAdd({ description, priceCents, quantity }),
    });
    messages.push({ channel: 'pole', data: this.topaz.poleItem(description, priceCents) });
    return messages;
  }

  /** Running tax (1020) then subtotal (1005) — the legacy US order. */
  private vjTotalsMessages(): WireMessage[] {
    return [
      { channel: 'vj', data: this.encoder.tax({ tx: this.tx, amountCents: this.basket.taxCents() }) },
      { channel: 'vj', data: this.encoder.subtotal({ tx: this.tx, amountCents: this.basket.subtotalCents() }) },
    ];
  }

  /** Clear the lane state after a basket end (tender or void ticket). */
  private resetForNextSale(): void {
    this.basket = new Basket({ taxRateBps: this.taxRateBps });
    this.tx += 1;
    this.started = false;
    this.suspended = false;
  }

  /** A Bulloch `[C110]` item-add line carrying the running basket totals. */
  private bullochItemMessage(code: string, description: string, quantity: number, priceCents: number): WireMessage {
    return {
      channel: 'pole',
      data: this.bulloch.itemAdd({
        barcode: code,
        description,
        quantity,
        priceCents,
        subtotalCents: this.basket.subtotalCents(),
        taxCents: this.basket.taxCents(),
        totalCents: this.basket.totalCents(),
      }),
    };
  }

  /** A Bulloch `[C120]` undo-item line carrying the running basket totals. */
  private bullochVoidMessage(description: string): WireMessage {
    return {
      channel: 'pole',
      data: this.bulloch.undoItem({
        description,
        subtotalCents: this.basket.subtotalCents(),
        taxCents: this.basket.taxCents(),
        totalCents: this.basket.totalCents(),
      }),
    };
  }

  setLocale(locale: PosLocale): void {
    // US lanes (radiant6-us, verifone-topaz) are en-US only — ignore French.
    if ((this.registerType === 'radiant6-us' || this.isTopaz) && locale !== 'en') return;
    this.locale = locale;
  }

  /** Pole window reflecting the current running balance (incl. tax). */
  private balanceMessage(): WireMessage {
    return { channel: 'pole', data: this.encoder.poleBalance(this.basket.totalCents(), this.locale) };
  }

  /** Open the lane if not already open (idempotent). Returns any open messages. */
  private ensureStarted(): WireMessage[] {
    if (this.started) return [];
    this.started = true;
    if (this.isBulloch) {
      return [{ channel: 'pole', data: this.bulloch.newSale(this.locale) }];
    }
    if (this.isTopaz) {
      // Topaz has no explicit basket-start line — the journal just logs the
      // cashier; the player opens the basket on the first item add.
      return [{ channel: 'vj', data: this.topaz.cashier(this.operatorName) }];
    }
    return [
      { channel: 'vj', data: this.encoder.registerOpen({ tx: this.tx, operatorId: this.operatorId, operatorName: this.operatorName }) },
      { channel: 'vj', data: this.encoder.basketStarted({ tx: this.tx }) },
      this.balanceMessage(),
    ];
  }

  open(): WireMessage[] {
    return this.ensureStarted();
  }

  addItem(input: AddItemInput): WireMessage[] {
    const messages = this.ensureStarted();
    const li = this.basket.addItem(input);
    if (this.isBulloch) {
      messages.push(this.bullochItemMessage(li.code, li.description, li.quantity, li.unitPriceCents));
      return messages;
    }
    if (this.isTopaz) {
      // A prepay-fuel ITEM carries the pump in its description ("PREPAY CA #05").
      // The `#` routes it to the player's fuel branch, so emit that format —
      // no scanner echo (fuel has no barcode) and no sanitized generic line.
      if (/#\s*\d/.test(li.description)) {
        messages.push({ channel: 'vj', data: this.topaz.fuelPrepay({ description: li.description, priceCents: li.unitPriceCents }) });
        messages.push({ channel: 'pole', data: this.topaz.poleItem(li.description, li.unitPriceCents) });
        return messages;
      }
      messages.push(...this.topazItemMessages(li.code, li.description, li.quantity, li.unitPriceCents));
      return messages;
    }
    messages.push({
      channel: 'vj',
      data: this.encoder.itemAdd({
        tx: this.tx,
        lineNumber: li.lineNumber,
        barcode: li.code,
        description: li.description,
        priceCents: li.unitPriceCents,
        quantity: li.quantity,
        locale: this.locale,
      }),
    });
    if (this.vjTotals) messages.push(...this.vjTotalsMessages());
    messages.push({ channel: 'pole', data: this.encoder.poleItem(li.quantity, li.description, li.unitPriceCents, this.locale) });
    messages.push(this.balanceMessage());
    return messages;
  }

  voidLine(lineNumber: number): WireMessage[] {
    if (this.isBulloch) {
      const description = this.basket.find(lineNumber)?.description ?? '';
      this.basket.voidItem(lineNumber);
      return [this.bullochVoidMessage(description)];
    }
    if (this.isTopaz) {
      const li = this.basket.find(lineNumber);
      this.basket.voidItem(lineNumber);
      if (!li) return [];
      return [
        {
          channel: 'vj',
          data: this.topaz.itemVoid({
            description: li.description,
            priceCents: li.unitPriceCents,
            quantity: li.quantity,
          }),
        },
      ];
    }
    this.basket.voidItem(lineNumber);
    return [
      { channel: 'vj', data: this.encoder.itemVoid({ tx: this.tx, lineNumber }) },
      ...(this.vjTotals ? this.vjTotalsMessages() : []),
      this.balanceMessage(),
    ];
  }

  setQuantity(lineNumber: number, quantity: number): WireMessage[] {
    const li = this.basket.find(lineNumber);
    const oldQuantity = li?.quantity ?? 1;
    const description = li?.description ?? '';
    const oldUnitPriceCents = li?.unitPriceCents ?? 0;
    this.basket.setQuantity(lineNumber, quantity);
    const updated = this.basket.find(lineNumber);
    if (this.isTopaz) {
      // Verifone has no qty-change journal event — the register voids the old
      // line and re-rings it at the new quantity.
      return [
        {
          channel: 'vj',
          data: this.topaz.itemVoid({ description, priceCents: oldUnitPriceCents, quantity: oldQuantity }),
        },
        ...this.topazItemMessages(
          '',
          description,
          updated?.quantity ?? quantity,
          updated?.unitPriceCents ?? oldUnitPriceCents,
        ),
      ];
    }
    if (this.isBulloch) {
      // Legacy Bulloch parity: a quantity change is a void of the old line
      // followed by a re-add at the new quantity (both on the pole).
      return [
        this.bullochVoidMessage(description),
        this.bullochItemMessage(updated?.code ?? '', description, updated?.quantity ?? quantity, updated?.unitPriceCents ?? 0),
      ];
    }
    const extended = updated?.extendedCents() ?? 0;
    return [
      { channel: 'vj', data: this.encoder.qtyChange({ tx: this.tx, lineNumber, oldQuantity, newQuantity: quantity, extendedPriceCents: extended, locale: this.locale }) },
      ...(this.vjTotals ? this.vjTotalsMessages() : []),
      this.balanceMessage(),
    ];
  }

  setPrice(lineNumber: number, priceCents: number): WireMessage[] {
    const before = this.basket.find(lineNumber);
    const description = before?.description ?? '';
    const oldUnitPriceCents = before?.unitPriceCents ?? 0;
    const oldQuantity = before?.quantity ?? 1;
    this.basket.setPrice(lineNumber, priceCents);
    const updated = this.basket.find(lineNumber);
    if (this.isTopaz) {
      // No price-override journal event on Verifone either — void + re-ring.
      return [
        {
          channel: 'vj',
          data: this.topaz.itemVoid({ description, priceCents: oldUnitPriceCents, quantity: oldQuantity }),
        },
        ...this.topazItemMessages('', description, updated?.quantity ?? oldQuantity, priceCents),
      ];
    }
    if (this.isBulloch) {
      // Legacy Bulloch parity: a price change is a void + re-add at the new price.
      return [
        this.bullochVoidMessage(description),
        this.bullochItemMessage(updated?.code ?? '', description, updated?.quantity ?? 1, priceCents),
      ];
    }
    return [
      { channel: 'vj', data: this.encoder.priceOverride({ tx: this.tx, lineNumber, newUnitPriceCents: priceCents, locale: this.locale }) },
      ...(this.vjTotals ? this.vjTotalsMessages() : []),
      this.balanceMessage(),
    ];
  }

  /**
   * Void the whole ticket — EventId 1002 with TransactionCompletionType=Cancelled
   * (the parser decodes this as BASKET_VOIDED). Clears the pole and resets for
   * the next sale.
   */
  voidTicket(): WireMessage[] {
    const messages = this.ensureStarted();
    if (this.isBulloch) {
      messages.push({ channel: 'pole', data: this.bulloch.clearSale() });
      this.resetForNextSale();
      return messages;
    }
    if (this.isTopaz) {
      messages.push({ channel: 'vj', data: this.topaz.voidTicket(this.tx) });
      this.resetForNextSale();
      return messages;
    }
    // Capture totals before the reset — the US 1002 Cancelled carries them
    // too (legacy Radiant6RegisterEmulator.java:262).
    const totals = this.vjTotals
      ? { subtotalCents: this.basket.subtotalCents(), taxCents: this.basket.taxCents(), totalCents: this.basket.totalCents() }
      : undefined;
    messages.push({
      channel: 'vj',
      data: this.encoder.basketEnd({
        tx: this.tx,
        type: 'Sales',
        completion: 'Cancelled',
        ...(totals !== undefined ? { totals } : {}),
      }),
    });

    this.resetForNextSale();
    messages.push(this.balanceMessage()); // pole balance now 0
    return messages;
  }

  /**
   * EasyPay / loyalty scan (EventId 1024). cardNumber may be a loyalty id or a
   * 12-digit UPC. Bulloch has no virtual-journal loyalty path, so it's a no-op.
   */
  loyalty(cardNumber: string, cardId?: string): WireMessage[] {
    if (this.isBulloch) return [];
    const messages = this.ensureStarted();
    if (this.isTopaz) {
      // Topaz loyalty is a plaintext LOYALTY journal line (no EventId 1024).
      messages.push({ channel: 'vj', data: this.topaz.loyalty(cardNumber) });
      return messages;
    }
    messages.push({ channel: 'vj', data: this.encoder.loyalty({ tx: this.tx, cardNumber, cardId }) });
    return messages;
  }

  /** Suspend the in-flight basket (EventId 1003 / Topaz plaintext banner). */
  suspend(): WireMessage[] {
    if (this.isBulloch || !this.started || this.suspended) return [];
    this.suspended = true;
    if (this.isTopaz) {
      return [{ channel: 'vj', data: this.topaz.suspend(this.tx) }];
    }
    return [{ channel: 'vj', data: this.encoder.basketSuspend({ tx: this.tx }) }];
  }

  /** Recall a suspended basket (EventId 1004) and re-emit the pole balance. */
  resume(): WireMessage[] {
    if (this.isBulloch || !this.suspended) return [];
    this.suspended = false;
    if (this.isTopaz) {
      // Topaz has no recall journal line — the register simply resumes ringing.
      return [];
    }
    return [
      { channel: 'vj', data: this.encoder.basketResume({ tx: this.tx, storedTx: this.tx }) },
      this.balanceMessage(),
    ];
  }

  /**
   * Tender and finish the sale. Emits Arrondir rounding (if the cash total
   * differs from the exact total), the tender (1007), the pole change window,
   * the change (1008) and basket end (1002). Resets for the next sale.
   */
  tender(kind: TenderKind, amountCents?: number): WireMessage[] {
    const messages = this.ensureStarted();
    const exactTotal = this.basket.totalCents();
    // US cash has no nickel rounding — the due total stays the exact total.
    const dueTotal = this.cashRounding ? this.basket.roundCashTotal() : exactTotal;

    let tendered: number;
    if (kind === 'cash-exact') tendered = dueTotal;
    else if (kind === 'next-dollar') tendered = this.basket.nextDollarCents();
    else tendered = amountCents ?? dueTotal;

    const change = Math.max(0, tendered - dueTotal);
    const roundingDelta = dueTotal - exactTotal;

    if (this.isTopaz) {
      // Legacy Topaz journal order: Sub Total, Tax, Total, tender MOP, then
      // the ST#/DR#/TRAN# line (BASKET_END). Pole mirrors total/tender/change.
      messages.push({ channel: 'vj', data: this.topaz.subtotal(this.basket.subtotalCents()) });
      messages.push({ channel: 'vj', data: this.topaz.tax(this.basket.taxCents()) });
      messages.push({ channel: 'vj', data: this.topaz.total(exactTotal) });
      messages.push({ channel: 'vj', data: this.topaz.tender('CASH', tendered) });
      messages.push({ channel: 'pole', data: this.topaz.poleTotal(exactTotal) });
      messages.push({ channel: 'pole', data: this.topaz.poleTender('CASH', tendered) });
      messages.push({ channel: 'pole', data: this.topaz.poleChange(change) });
      messages.push({
        channel: 'vj',
        data: this.topaz.basketEnd({ store: this.storeCode, drawer: 1, tx: this.tx }),
      });
      this.resetForNextSale();
      return messages;
    }

    if (this.isBulloch) {
      // Bulloch closes the sale with a single pole [C200] line (no VJ, no
      // Arrondir event). TOTAL is the exact basket total; CHNG is the change.
      messages.push({
        channel: 'pole',
        data: this.bulloch.saleClose({
          tx: this.tx,
          totalCents: exactTotal,
          changeCents: change,
          taxCents: this.basket.taxCents(),
        }),
      });
      this.resetForNextSale();
      return messages;
    }

    // Capture totals before the reset — the US 1002 carries them (legacy
    // Radiant6RegisterEmulator.java:296); Canada omits them.
    const totals = this.vjTotals
      ? { subtotalCents: this.basket.subtotalCents(), taxCents: this.basket.taxCents(), totalCents: exactTotal }
      : undefined;

    if (roundingDelta !== 0) {
      messages.push({ channel: 'vj', data: this.encoder.rounding({ tx: this.tx, amountCents: roundingDelta, locale: this.locale }) });
    }
    messages.push({ channel: 'vj', data: this.encoder.tender({ tx: this.tx, amountCents: tendered, mopDescription: 'Cash', locale: this.locale }) });
    messages.push({ channel: 'pole', data: this.encoder.poleChange(change, this.locale) });
    messages.push({ channel: 'vj', data: this.encoder.change({ tx: this.tx, amountCents: change, locale: this.locale }) });
    messages.push({
      channel: 'vj',
      data: this.encoder.basketEnd({
        tx: this.tx,
        type: 'Sales',
        completion: 'Completed',
        ...(totals !== undefined ? { totals } : {}),
      }),
    });

    this.resetForNextSale();
    return messages;
  }

  snapshot(): SessionSnapshot {
    return {
      tx: this.tx,
      started: this.started,
      locale: this.locale,
      lines: this.basket.lineItems().map((li) => ({
        lineNumber: li.lineNumber,
        code: li.code,
        description: li.description,
        quantity: li.quantity,
        unitPriceCents: li.unitPriceCents,
        extendedCents: li.extendedCents(),
        voided: li.voided,
      })),
      subtotalCents: this.basket.subtotalCents(),
      taxCents: this.basket.taxCents(),
      totalCents: this.basket.totalCents(),
    };
  }
}
