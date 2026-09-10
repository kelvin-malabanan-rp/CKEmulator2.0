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
import { OctaneEncoder, DEFAULT_OCTANE_LOCALE, type OctaneLocale } from './OctaneEncoder';
import { baseRegisterType, type WireChannel, type RegisterType } from './posTypes';
import { buildOrderDoc, type NgrpStatus, type NgrpCustomer } from './NgrpEncoder';
import type { PosLocale } from './currency';

export interface WireMessage {
  channel: WireChannel;
  data: string;
}

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Octane fuel-UPC prefix. Ported verbatim from the legacy emulator
 * (OctaneRegisterEmulator.isFuelCode): "this is an assumption about fuel UPCs.
 * At the time of writing this code, only fuel UPCs in Ireland start with these
 * digits". A match routes the line to `lineId 2` (litres) instead of `lineId 1`.
 */
const OCTANE_FUEL_CODE_PREFIX = '11145';

/** True when an Octane item code should ring as fuel rather than drystock. */
function isOctaneFuelCode(code: string): boolean {
  return code.startsWith(OCTANE_FUEL_CODE_PREFIX);
}

/**
 * Discount-coupon UPC prefixes. Ported from the legacy emulator
 * (OctaneRegisterEmulator.isDiscountCode). Scanning one of these is NOT an
 * item: the register books a `lineId 3` discount line and adds nothing to the
 * basket, so the coupon reduces the total instead of appearing as a product.
 */
const OCTANE_DISCOUNT_CODE_PREFIXES = ['D7826', 'D8018', '8018'];

/** True when an Octane scan is a discount coupon rather than a product. */
function isOctaneDiscountCode(code: string): boolean {
  return OCTANE_DISCOUNT_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));
}

/**
 * Strip the legacy `code<sep>` scan prefix: the emulator's operators type
 * `code:12345` to force a raw PLU, and the register rings `12345`. Ported
 * verbatim from OctaneRegisterEmulator.addItem — a case-insensitive `code`
 * test with a fixed `substring(5)`, so the separator character is consumed
 * along with the four letters.
 */
function stripOctaneCodePrefix(code: string): string {
  return code.toLowerCase().startsWith('code') ? code.slice(5) : code;
}

/** The line fields the Octane encoders need — satisfied by Basket's LineItem. */
interface OctaneLine {
  code: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
}

/**
 * Default order-uuid generator (LOA mode). base62 of a random 128-bit value —
 * the shape the reference emulator's CharsetUtils.generateRandomUuidBase62()
 * produces; a hyphenated hex uuid would break reporting's ascii85 conversion.
 * Injectable via RegisterSessionOptions.orderUuidGen for deterministic tests.
 */
function defaultOrderUuidGen(): string {
  let hex = '';
  for (let i = 0; i < 32; i += 1) hex += Math.floor(Math.random() * 16).toString(16);
  let quotient = BigInt(`0x${hex}`);
  let out = '';
  while (quotient > 0n) {
    out = BASE62_CHARS.charAt(Number(quotient % 62n)) + out;
    quotient = quotient / 62n;
  }
  return out || '0';
}

export interface AddItemInput {
  code: string;
  description: string;
  priceCents: number;
  quantity?: number;
  /**
   * Minimum customer age. >0 marks the item age-restricted; carried onto the
   * Radiant6 wire as `AgeMinimum` (1011) so the player gates age verification.
   */
  minAge?: number;
}

export interface LineSnapshot {
  lineNumber: number;
  code: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  extendedCents: number;
  voided: boolean;
  /** Minimum customer age (>0 = age-restricted); undefined when unknown. */
  minAge?: number;
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
   * 'bulloch' (pole-only), 'verifone-topaz' (plaintext VJ + pole + scanner,
   * VJ-authoritative, cents-exact) or 'octane' (EU, JSON journal over HTTP,
   * no pole).
   */
  registerType?: RegisterType;
  /** Octane price dialect (comma vs dot decimals). Octane only. */
  octaneLocale?: OctaneLocale;
  /** `{tenant}-{location}-{player}` — stamped into Octane's siteNo/posNo. */
  playerCode?: string;
  /** Topaz basket-end ST# column (verifone-topaz only); LOA order storeId. */
  storeCode?: string;
  /** Order-uuid generator for LOA mode. Defaults to a random base62 uuid. */
  orderUuidGen?: () => string;
}

export class RegisterSession {
  private readonly encoder: Radiant6CanadaEncoder;
  private readonly bulloch: BullochEncoder;
  private readonly topaz: TopazEncoder;
  private octane: OctaneEncoder;
  /** Octane price dialect; rebuilding the encoder is the only way to change it. */
  private octaneLocale: OctaneLocale;
  private readonly playerCode: string;
  private readonly clock: (() => Date) | undefined;
  private readonly registerType: RegisterType;
  private readonly terminalNumber: number;
  private readonly taxRateBps: number;
  private readonly operatorId: string;
  private readonly operatorName: string;
  private readonly storeCode: string;
  private basket: Basket;
  private tx: number;
  private started = false;
  private suspended = false;
  locale: PosLocale = 'en';
  /** LOA mode: order uuid for the in-flight basket (regenerated per sale). */
  private orderUuid = '';
  /** LOA mode: signed-in loyalty customer, cleared on reset/sign-out. */
  private loaCustomer: NgrpCustomer | null = null;
  private readonly orderUuidGen: () => string;

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
    // Normalize to the base protocol type: verifone-topaz-lol is plain Topaz
    // pointed at the LoL VM, so all downstream behavior checks see 'verifone-topaz'.
    this.registerType = baseRegisterType(options.registerType ?? 'radiant6-canada');
    this.terminalNumber = options.terminalNumber ?? 1;
    this.taxRateBps = options.taxRateBps ?? 500;
    this.operatorId = options.operatorId ?? '12599';
    this.operatorName = options.operatorName ?? 'Timothy';
    this.storeCode = options.storeCode ?? 'AB123';
    this.orderUuidGen = options.orderUuidGen ?? defaultOrderUuidGen;
    this.tx = options.startTx ?? 1;
    this.basket = new Basket({ taxRateBps: this.taxRateBps });
    this.octaneLocale = options.octaneLocale ?? DEFAULT_OCTANE_LOCALE;
    this.playerCode = options.playerCode ?? '';
    this.clock = options.clock;
    this.octane = this.buildOctaneEncoder();
  }

  /**
   * Build the Octane encoder for the current price locale. The locale is baked
   * into the encoder (it drives every amount and the currency code), so a
   * locale change rebuilds rather than mutates.
   */
  private buildOctaneEncoder(): OctaneEncoder {
    return new OctaneEncoder({
      locale: this.octaneLocale,
      playerCode: this.playerCode,
      operatorId: this.operatorId,
      operatorName: this.operatorName,
      ...(this.clock !== undefined ? { clock: this.clock } : {}),
    });
  }

  /**
   * Switch the Octane price dialect mid-session (the Config picker). No-op for
   * every other register type, and never touches the in-flight basket — only
   * how subsequent amounts are formatted on the wire.
   */
  setOctaneLocale(locale: OctaneLocale): void {
    if (locale === this.octaneLocale) return;
    this.octaneLocale = locale;
    this.octane = this.buildOctaneEncoder();
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
   * LOA mode — the player is embedded as an iframe and driven over postMessage
   * with a full NGRP order document per change (not the incremental POS wire).
   */
  private get isLoa(): boolean {
    return this.registerType === 'loa-player';
  }

  /**
   * Octane (EU) — a JSON journal POSTed over HTTP, one document per event.
   * No pole display, and the player owns tax/rounding, so the emulator sends
   * exact amounts and never emits a rounding event.
   */
  private get isOctane(): boolean {
    return this.registerType === 'octane';
  }

  /**
   * One Octane journal line. Octane rides the `vj` channel like any other
   * journal — the HTTP framing is OctaneTransport's job, not the session's.
   */
  private octaneMessage(data: string): WireMessage {
    return { channel: 'vj', data };
  }

  /**
   * Octane item-add line: `lineId 2` (litres) for a fuel UPC, else `lineId 1`.
   * `total` is the EXTENDED amount — the player derives the unit price.
   */
  private octaneItemMessage(li: OctaneLine): WireMessage {
    const extendedCents = Math.round(li.unitPriceCents * li.quantity);
    if (isOctaneFuelCode(li.code)) {
      return this.octaneMessage(
        this.octane.fuelAdd({ description: li.description, litres: li.quantity, extendedCents }),
      );
    }
    return this.octaneMessage(
      this.octane.itemAdd({
        description: li.description,
        barcode: stripOctaneCodePrefix(li.code),
        quantity: li.quantity,
        extendedCents,
      }),
    );
  }

  /** Octane item-void line — the add's lineId with `itemMask:["ABORT"]`. */
  private octaneVoidMessage(li: OctaneLine): WireMessage {
    const extendedCents = Math.round(li.unitPriceCents * li.quantity);
    if (isOctaneFuelCode(li.code)) {
      return this.octaneMessage(
        this.octane.fuelVoid({ description: li.description, litres: li.quantity, extendedCents }),
      );
    }
    return this.octaneMessage(
      this.octane.itemVoid({
        description: li.description,
        barcode: stripOctaneCodePrefix(li.code),
        quantity: li.quantity,
        extendedCents,
      }),
    );
  }

  /**
   * `lineId 7` end-of-transaction — the line that actually closes the basket
   * on the player. Emitted after a tender AND after a ticket void, matching
   * the legacy emulator (both paths run through `Emulator.endBasket()`) and
   * what CK Player 2.0 expects ("Octane sends BASKET_END after
   * VOID_TRANSACTION" — Register.ts).
   */
  private octaneEndMessage(): WireMessage {
    return this.octaneMessage(
      this.octane.endOfTransaction({ receiptNumber: this.tx, terminalNumber: this.terminalNumber }),
    );
  }

  /** Build the single `loa`-channel message: the NGRP document for the current basket. */
  private loaMessage(status: NgrpStatus): WireMessage {
    const doc = buildOrderDoc(this.snapshot(), {
      uuid: this.orderUuid,
      storeId: this.storeCode,
      status,
      ...(this.loaCustomer ? { customer: this.loaCustomer } : {}),
    });
    return { channel: 'loa', data: JSON.stringify(doc) };
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
    // Octane rounds on the PLAYER (`receiptRound5Cents` / the whole-rounded
    // Nordic tenants), driven off the tender's `tenderType:"0"` — so the
    // emulator sends exact amounts and lets the player decide.
    return this.registerType !== 'radiant6-us' && !this.isTopaz && !this.isOctane;
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
    this.orderUuid = '';
    this.loaCustomer = null;
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
    // Octane's language is its price locale (setOctaneLocale), not the CA
    // en/fr toggle, so the toggle is inert there too.
    if ((this.registerType === 'radiant6-us' || this.isTopaz || this.isOctane) && locale !== 'en') return;
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
    if (this.isLoa) {
      // No "basket start" document — an empty order is harmful (the player's
      // rate limiter would keep it and drop the first item's doc). Just mint the
      // order uuid; the first real action (addItem/loyalty) sends the document.
      if (!this.orderUuid) this.orderUuid = this.orderUuidGen();
      return [];
    }
    if (this.isOctane) {
      // `lineId 6` receipt header opens the basket and identifies the cashier.
      return [
        this.octaneMessage(
          this.octane.createBasket({ receiptNumber: this.tx, terminalNumber: this.terminalNumber }),
        ),
      ];
    }
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
    // A discount coupon never becomes a basket line — checked BEFORE the basket
    // is touched, exactly as the legacy emulator returns early from addItem.
    if (this.isOctane && isOctaneDiscountCode(input.code)) {
      messages.push(
        this.octaneMessage(
          this.octane.discount({ text: input.description, amountCents: input.priceCents }),
        ),
      );
      return messages;
    }
    const li = this.basket.addItem(input);
    if (this.isLoa) return [this.loaMessage('OPEN')];
    if (this.isOctane) {
      messages.push(this.octaneItemMessage(li));
      return messages;
    }
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
        ...(li.minAge !== undefined ? { minAge: li.minAge } : {}),
      }),
    });
    if (this.vjTotals) messages.push(...this.vjTotalsMessages());
    messages.push({ channel: 'pole', data: this.encoder.poleItem(li.quantity, li.description, li.unitPriceCents, this.locale) });
    messages.push(this.balanceMessage());
    return messages;
  }

  voidLine(lineNumber: number): WireMessage[] {
    if (this.isLoa) {
      this.basket.voidItem(lineNumber);
      // Parity with the reference emulator: voiding the last live line cancels
      // the basket (EmulatorUtils.checkIfAllItemsVoided).
      const lines = this.basket.lineItems();
      const allVoided = lines.length > 0 && lines.every((li) => li.voided);
      return [this.loaMessage(allVoided ? 'CANCELED' : 'OPEN')];
    }
    if (this.isOctane) {
      const li = this.basket.find(lineNumber);
      this.basket.voidItem(lineNumber);
      // Nothing to say about a line that was never rung.
      return li ? [this.octaneVoidMessage(li)] : [];
    }
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
    if (this.isLoa) return [this.loaMessage('OPEN')];
    if (this.isOctane) {
      // Octane has no quantity-change line type — the register aborts the old
      // line and re-rings it, which is exactly what the void+add pair encodes.
      const code = updated?.code ?? '';
      return [
        this.octaneVoidMessage({ code, description, quantity: oldQuantity, unitPriceCents: oldUnitPriceCents }),
        this.octaneItemMessage({
          code,
          description,
          quantity: updated?.quantity ?? quantity,
          unitPriceCents: updated?.unitPriceCents ?? oldUnitPriceCents,
        }),
      ];
    }
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
    if (this.isLoa) return [this.loaMessage('OPEN')];
    if (this.isOctane) {
      // No price-override line type on Octane either — void + re-ring. (Real
      // Octane restates prices via the dine-in/out resend; the emulator has no
      // dine-in/out mode, so the void+add pair is the honest equivalent.)
      const code = updated?.code ?? '';
      return [
        this.octaneVoidMessage({ code, description, quantity: oldQuantity, unitPriceCents: oldUnitPriceCents }),
        this.octaneItemMessage({
          code,
          description,
          quantity: updated?.quantity ?? oldQuantity,
          unitPriceCents: priceCents,
        }),
      ];
    }
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
    if (this.isLoa) {
      const msg = this.loaMessage('CANCELED');
      this.resetForNextSale();
      return [msg];
    }
    if (this.isOctane) {
      // `27` void-transaction then `7` end-of-transaction — the legacy
      // emulator's voidTicket() falls through to endBasket(), and CK Player
      // 2.0 explicitly expects the BASKET_END that follows a void.
      messages.push(this.octaneMessage(this.octane.voidTicket()));
      messages.push(this.octaneEndMessage());
      this.resetForNextSale();
      return messages;
    }
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
    // Octane has no loyalty-identification line type: the only loyalty the
    // journal carries is the resulting DISCOUNT (`793`), which the POS emits
    // after IT resolves the member. There is nothing faithful to send here.
    if (this.isBulloch || this.isOctane) return [];
    const messages = this.ensureStarted();
    if (this.isLoa) {
      // Attach a signed-in customer (real 4-field shape) and resend the doc.
      this.loaCustomer = { brierleyId: '', mobileNumber: '', oktaId: '', loyaltyCard: cardNumber };
      return [this.loaMessage('OPEN')];
    }
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
    if (this.isOctane) {
      // `33` STORED_TRANSACTION — both players map it to BASKET_SUSPEND.
      return [this.octaneMessage(this.octane.storedTransaction())];
    }
    if (this.isTopaz) {
      return [{ channel: 'vj', data: this.topaz.suspend(this.tx) }];
    }
    return [{ channel: 'vj', data: this.encoder.basketSuspend({ tx: this.tx }) }];
  }

  /** Recall a suspended basket (EventId 1004) and re-emit the pole balance. */
  resume(): WireMessage[] {
    if (this.isBulloch || !this.suspended) return [];
    this.suspended = false;
    if (this.isOctane) {
      // Octane has no recall line type — the POS just resumes ringing, so the
      // journal says nothing (same as Verifone).
      return [];
    }
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
    if (this.isLoa) {
      // LOA has no cash/tender math on the wire — the order simply closes as
      // TENDERED and the lane resets for the next sale.
      const msg = this.loaMessage('TENDERED');
      this.resetForNextSale();
      return [msg];
    }
    const exactTotal = this.basket.totalCents();
    // US cash has no nickel rounding — the due total stays the exact total.
    const dueTotal = this.cashRounding ? this.basket.roundCashTotal() : exactTotal;

    let tendered: number;
    if (kind === 'cash-exact') tendered = dueTotal;
    else if (kind === 'next-dollar') tendered = this.basket.nextDollarCents();
    else tendered = amountCents ?? dueTotal;

    const change = Math.max(0, tendered - dueTotal);
    const roundingDelta = dueTotal - exactTotal;

    if (this.isOctane) {
      // Legacy Octane emulator order: basket total (5), tender (55), change
      // (60), tax in basket (379) — then end-of-transaction (7), which
      // super.tender() reaches via endBasket().
      messages.push(
        this.octaneMessage(
          this.octane.basketTotal({ totalCents: exactTotal, taxCents: this.basket.taxCents() }),
        ),
      );
      messages.push(
        this.octaneMessage(
          this.octane.tender({
            amountCents: tendered,
            totalCents: exactTotal,
            description: 'CASH PAYMENT',
          }),
        ),
      );
      messages.push(this.octaneMessage(this.octane.change({ changeCents: change })));
      messages.push(this.octaneMessage(this.octane.taxInBasket({ taxCents: this.basket.taxCents() })));
      messages.push(this.octaneEndMessage());
      this.resetForNextSale();
      return messages;
    }

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
        ...(li.minAge !== undefined ? { minAge: li.minAge } : {}),
      })),
      subtotalCents: this.basket.subtotalCents(),
      taxCents: this.basket.taxCents(),
      totalCents: this.basket.totalCents(),
    };
  }
}
