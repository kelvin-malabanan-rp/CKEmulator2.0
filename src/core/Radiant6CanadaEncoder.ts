/**
 * Radiant6CanadaEncoder — produces the exact Virtual Journal (TCP:5438) lines
 * and Pole Display (TCP:5439) 20-char windows that CK Player 2.0's
 * `radiant6-canada` plugin parses.
 *
 * Pure / browser-safe (no Node or Electron imports). Cross-checked against
 *   ../CKPlayer2.0/electron/plugins/radiant6-canada/Radiant6CanadaMessageParser.ts
 *   ../CKPlayer2.0/electron/plugins/radiant6-canada/Radiant6CanadaPoleDisplayParser.ts
 *
 * Canada policy honoured here:
 *   - Tax/balance are pole-authoritative in Canada — never emitting VJ
 *     EventId 1005 (subtotal) or 1020 (tax) is Canada policy enforced by
 *     RegisterSession (radiant6-canada mode). The encoder itself provides
 *     `subtotal` (1005) and `tax` (1020) for the radiant6-us mode.
 *   - Cash rounding emits EventId 1022 Description=Arrondir.
 *   - EasyPay loyalty emits EventId 1024 (the 12-digit-UPC discriminator runs
 *     player-side; the encoder just carries the card number).
 *   - The pole display is bilingual; fr-CA balance uses the legacy `dû` which
 *     the player receives as U+FFFD and replaces with a space.
 */

import { formatCurrency, type PosLocale } from './currency';

const REPLACEMENT_CHAR = '�'; // � — legacy substitute for fr `û` in pole output

export interface EncoderOptions {
  terminalNumber: number;
  /** Injectable clock for deterministic tests. Defaults to `new Date()`. */
  clock?: () => Date;
}

/** Format a Date as Radiant6 wire EventTime: `yyyy-MM-ddTHH:mm:ss.SSS` (local). */
function formatEventTime(d: Date): string {
  const p = (n: number, len = 2): string => n.toString().padStart(len, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

/** Plain numeric wire amount (no currency symbol, no thousands separator). */
function wireAmount(cents: number, locale: PosLocale): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, '0');
  const decimal = locale === 'fr' ? ',' : '.';
  return `${negative ? '-' : ''}${dollars}${decimal}${frac}`;
}

/** Build a fixed-width pole window: label left-justified, amount right-justified. */
function poleWindow(label: string, fieldWidth: number, amount: string): string {
  return label + amount.padStart(fieldWidth, ' ');
}

type Field = [key: string, value: string | number];

export class Radiant6CanadaEncoder {
  private readonly terminalNumber: number;
  private readonly clock: () => Date;

  constructor(options: EncoderOptions) {
    this.terminalNumber = options.terminalNumber;
    this.clock = options.clock ?? ((): Date => new Date());
  }

  // ---- Virtual Journal -----------------------------------------------------

  /** Assemble one `EventId=..,TerminalNumber=..,EventTime=..,<fields>\r\n` line. */
  private eventLine(eventId: number, fields: Field[]): string {
    const parts: Field[] = [
      ['EventId', eventId],
      ['TerminalNumber', this.terminalNumber],
      ['EventTime', formatEventTime(this.clock())],
      ...fields,
    ];
    return parts.map(([k, v]) => `${k}=${v}`).join(',') + '\r\n';
  }

  registerOpen(args: { tx: number; operatorId: string; operatorName: string }): string {
    return this.eventLine(1001, [
      ['TransactionNumber', args.tx],
      ['OperatorId', args.operatorId],
      ['OperatorName', args.operatorName],
    ]);
  }

  basketStarted(args: { tx: number }): string {
    return this.eventLine(1009, [
      ['TransactionNumber', args.tx],
      ['TransactionType', 'Sales'],
    ]);
  }

  /**
   * EventId 1002 — basket end. `totals` is US-mode only: the legacy US
   * register stamps SubtotalAmount/TaxAmount/TotalAmount on the 1002 line
   * (liftck_player Radiant6RegisterEmulator.java:296). Canada omits them —
   * pole-authoritative; RegisterSession enforces the policy.
   */
  basketEnd(args: {
    tx: number;
    type: 'Sales' | 'Refund' | 'Cancelled';
    completion: 'Completed' | 'Cancelled';
    totals?: { subtotalCents: number; taxCents: number; totalCents: number };
  }): string {
    return this.eventLine(1002, [
      ['TransactionNumber', args.tx],
      ['TransactionType', args.type],
      ['TransactionCompletionType', args.completion],
      ...(args.totals !== undefined
        ? ([
            ['SubtotalAmount', wireAmount(args.totals.subtotalCents, 'en')],
            ['TaxAmount', wireAmount(args.totals.taxCents, 'en')],
            ['TotalAmount', wireAmount(args.totals.totalCents, 'en')],
          ] as Field[])
        : []),
    ]);
  }

  /**
   * EventId 1005 — running subtotal. US mode only: the legacy US register
   * emits 1020 (tax) then 1005 (subtotal) after every item mutation
   * (liftck_player Radiant6RegisterEmulator.java:149-150). Canada is
   * pole-authoritative and never sends this; RegisterSession enforces
   * the policy.
   */
  subtotal(args: { tx: number; amountCents: number }): string {
    return this.eventLine(1005, [
      ['TransactionNumber', args.tx],
      ['Amount', wireAmount(args.amountCents, 'en')],
    ]);
  }

  /**
   * EventId 1020 — running tax. US mode only (see `subtotal`); emitted
   * before 1005 in the legacy order. Canada never sends this;
   * RegisterSession enforces the policy.
   */
  tax(args: { tx: number; amountCents: number }): string {
    return this.eventLine(1020, [
      ['TransactionNumber', args.tx],
      ['Amount', wireAmount(args.amountCents, 'en')],
    ]);
  }

  basketSuspend(args: { tx: number }): string {
    return this.eventLine(1003, [['TransactionNumber', args.tx]]);
  }

  /** EventId 1004 — resume. `storedTx` is the suspended transaction being recalled. */
  basketResume(args: { tx: number; storedTx?: number }): string {
    return this.eventLine(1004, [
      ['TransactionNumber', args.tx],
      ...(args.storedTx !== undefined ? [['StoredTransactionNumber', args.storedTx] as Field] : []),
    ]);
  }

  itemAdd(args: {
    tx: number;
    lineNumber: number;
    barcode: string;
    description: string;
    priceCents: number;
    quantity: number;
    locale?: PosLocale;
    /**
     * Item's minimum customer age. Emitted as `AgeMinimum` on the 1011 line
     * (legacy Radiant6RegisterEmulator.java:132). >0 marks the item
     * age-restricted, which drives the player's age-verify scan hold
     * (Radiant6Register.checkAgeVerification). Defaults to 0 (unrestricted).
     */
    minAge?: number;
  }): string {
    const locale = args.locale ?? 'en';
    const extended = wireAmount(Math.round(args.priceCents * args.quantity), locale);
    return this.eventLine(1011, [
      ['TransactionNumber', args.tx],
      ['ItemNumber', args.lineNumber],
      ['Barcode', args.barcode],
      ['ItemType', 'Regular Sales Item'],
      ['Description', args.description],
      ['UnitPrice', wireAmount(args.priceCents, locale)],
      ['ExtendedPrice', extended],
      ['Quantity', args.quantity.toFixed(3)],
      ['AgeMinimum', args.minAge ?? 0],
    ]);
  }

  itemVoid(args: { tx: number; lineNumber: number }): string {
    return this.eventLine(1012, [
      ['TransactionNumber', args.tx],
      ['ItemNumber', args.lineNumber],
    ]);
  }

  priceOverride(args: { tx: number; lineNumber: number; newUnitPriceCents: number; locale?: PosLocale }): string {
    return this.eventLine(1013, [
      ['TransactionNumber', args.tx],
      ['ItemNumber', args.lineNumber],
      ['NewUnitPrice', wireAmount(args.newUnitPriceCents, args.locale ?? 'en')],
    ]);
  }

  qtyChange(args: {
    tx: number;
    lineNumber: number;
    oldQuantity: number;
    newQuantity: number;
    extendedPriceCents: number;
    locale?: PosLocale;
  }): string {
    return this.eventLine(1014, [
      ['TransactionNumber', args.tx],
      ['ItemNumber', args.lineNumber],
      ['OldQuantity', args.oldQuantity.toFixed(3)],
      ['NewQuantity', args.newQuantity.toFixed(3)],
      ['ExtendedPrice', wireAmount(args.extendedPriceCents, args.locale ?? 'en')],
    ]);
  }

  tender(args: { tx: number; amountCents: number; mopDescription: string; mopId?: number; locale?: PosLocale }): string {
    return this.eventLine(1007, [
      ['TransactionNumber', args.tx],
      ['MOPId', args.mopId ?? 5],
      ['MOPDescription', args.mopDescription],
      ['Amount', wireAmount(args.amountCents, args.locale ?? 'en')],
    ]);
  }

  change(args: { tx: number; amountCents: number; mopDescription?: string; locale?: PosLocale }): string {
    return this.eventLine(1008, [
      ['TransactionNumber', args.tx],
      ['MOPId', 5],
      ['MOPDescription', args.mopDescription ?? 'Cash'],
      ['Amount', wireAmount(args.amountCents, args.locale ?? 'en')],
    ]);
  }

  /** EventId 1022 — CAD cash rounding. The player ignores Arrondir/Rounding. */
  rounding(args: { tx: number; amountCents: number; description?: 'Arrondir' | 'Rounding'; locale?: PosLocale }): string {
    return this.eventLine(1022, [
      ['TransactionNumber', args.tx],
      ['Description', args.description ?? 'Arrondir'],
      ['Amount', wireAmount(args.amountCents, args.locale ?? 'en')],
    ]);
  }

  /** EventId 1024 — EasyPay / loyalty. cardNumber may be a loyalty id or a 12-digit UPC. */
  loyalty(args: { tx: number; cardId?: string; cardNumber: string }): string {
    return this.eventLine(1024, [
      ['TransactionNumber', args.tx],
      ['DiscountCardId', args.cardId ?? '70000000001'],
      ['DiscountCardNumber', args.cardNumber],
    ]);
  }

  // ---- Pole display (20-char printable windows) ----------------------------

  /** Running balance (incl. tax). en: `Balance Due` + 9; fr: `Solde d�:` + 11. */
  poleBalance(cents: number, locale: PosLocale): string {
    if (locale === 'fr') {
      return poleWindow(`Solde d${REPLACEMENT_CHAR}:`, 11, formatCurrency(cents, 'fr'));
    }
    return poleWindow('Balance Due', 9, formatCurrency(cents, 'en'));
  }

  /** Change due. en: `Change Due` + 10; fr: `Monnaie due:` + 8. */
  poleChange(cents: number, locale: PosLocale): string {
    if (locale === 'fr') {
      return poleWindow('Monnaie due:', 8, formatCurrency(cents, 'fr'));
    }
    return poleWindow('Change Due', 10, formatCurrency(cents, 'en'));
  }

  /**
   * Item line. The player's product regex only matches en (`$#.##`, period
   * decimal); fr item lines are produced for realism but drop at the parser
   * (documented limitation) — balance/change still carry fr amounts.
   */
  poleItem(quantity: number, description: string, priceCents: number, locale: PosLocale): string {
    const qty = String(Math.trunc(quantity));
    const price = locale === 'fr' ? formatCurrency(priceCents, 'fr') : formatCurrency(priceCents, 'en');
    const prefix = `${qty} ${description}`;
    const gap = Math.max(1, 20 - prefix.length - price.length);
    let window = prefix + ' '.repeat(gap) + price;
    if (window.length > 20) {
      // Trim the description so the whole window fits 20 chars.
      const overflow = window.length - 20;
      const trimmedDesc = description.slice(0, Math.max(0, description.length - overflow));
      window = `${qty} ${trimmedDesc} ${price}`;
    }
    return window.padEnd(20, ' ').slice(0, 20);
  }
}
