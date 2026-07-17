/**
 * TopazEncoder — produces the Verifone Topaz wire bytes that CK Player 2.0's
 * `verifone` plugin parses. Three feeds (all serial COM ports in prod, TCP for
 * emulation — see posTypes.ts):
 *
 *   - Virtual Journal (AUTHORITATIVE in the US): plaintext lines framed as
 *     `MM/dd/yy HH:mm:ss <registerId> <payload{10,40}>\n`, matched by
 *     TopazMessageParser's regex cascade. No EventId=key,value protocol.
 *   - Pole display (present, NON-authoritative): `ESC l \x01 \x01|\x02` frames
 *     carrying exactly 20 printable chars (TOPAZ_POLE_LINE_REGEX).
 *   - Barcode scanner: one raw barcode per write (BarcodeScanner trims it).
 *
 * Pure / browser-safe (no Node or Electron imports). Formats cross-checked
 * against the authoritative consumer:
 *   ../CKPlayer2.0/electron/plugins/verifone/TopazMessageParser.ts
 *   ../CKPlayer2.0/electron/plugins/verifone/TopazPoleDisplayParser.ts
 *
 * Money is ALWAYS period-decimal dollars on the wire ("2.19"), per the Topaz
 * RegisterEvent dollar contract (see CKP2.0 verifone/types.ts MONEY UNITS).
 *
 * Parser quirks the encoder designs around:
 *   - The item regex's optional `[A-Z]{1,4}` department group would otherwise
 *     eat the first word of an uppercase description, so every item-add line
 *     carries an explicit one-letter dept prefix ("T ").
 *   - `#` in a description would match the fuel branch (VJ) or the prepay-fuel
 *     branch (pole) — stripped.
 *   - A leading `MXM ` would match the MXM-discount branch — de-fanged.
 *   - "Sub Total" decodes as BASKET_TOTAL (legacy total-shadows-subtotal,
 *     preserved verbatim in CKP2.0) — callers should expect BASKET_TOTAL.
 *   - Descriptions with a word starting in "V" can trip the positive-void
 *     description rescue (legacy Java quirk) — not guarded, matches prod.
 */

export interface TopazEncoderOptions {
  /** Register id stamped in every VJ header (legacy `<registerId>`). Default 1. */
  registerId?: number;
  /** Clock for the VJ header timestamp — injectable for tests. */
  clock?: () => Date;
}

export interface TopazItemArgs {
  description: string;
  priceCents: number;
  quantity: number;
  /** One-to-four uppercase letters; the VJ item line's department column. */
  dept?: string;
}

export interface TopazBasketEndArgs {
  /** Store code for the ST# column (printable, capped at 8 chars). */
  store: string;
  /** Drawer number for the DR# column. */
  drawer: number;
  /** Transaction number — decodes as the basket's receiptNum. */
  tx: number;
}

/** Two-decimal, period-style wire amount in dollars ("2.19"). */
function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

const two = (n: number): string => n.toString().padStart(2, '0');

/**
 * Make a description safe for the Topaz cascades: printable ASCII only, no
 * `#` (fuel branch), no leading `MXM ` (discount branch), truncated to the
 * parser's 20-char capture, padded to its 5-char minimum.
 */
function sanitizeDescription(description: string): string {
  let d = (description ?? '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/#/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^MXM /, 'MXM-');
  if (d.length > 20) d = d.slice(0, 20).trimEnd();
  return d.padEnd(5);
}

export class TopazEncoder {
  private readonly registerId: number;
  private readonly clock: () => Date;

  constructor(options: TopazEncoderOptions = {}) {
    this.registerId = options.registerId ?? 1;
    this.clock = options.clock ?? ((): Date => new Date());
  }

  /** `MM/dd/yy HH:mm:ss <registerId> ` — the frame every VJ payload rides in. */
  private header(): string {
    const now = this.clock();
    const date = `${two(now.getMonth() + 1)}/${two(now.getDate())}/${two(now.getFullYear() % 100)}`;
    const time = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
    return `${date} ${time} ${this.registerId} `;
  }

  private vjLine(payload: string): string {
    return `${this.header()}${payload}\n`;
  }

  // ─── Virtual Journal lines ────────────────────────────────────────────────

  /**
   * `T <desc(20)>  <qty>  <price>` → ITEM_ADDED. The explicit dept letter
   * keeps the parser's department group from eating the description.
   */
  itemAdd(args: TopazItemArgs): string {
    const dept = /^[A-Z]{1,4}$/.test(args.dept ?? '') ? (args.dept as string) : 'T';
    const desc = sanitizeDescription(args.description).padEnd(20);
    const qty = Math.max(1, Math.min(9999, Math.trunc(args.quantity))).toString().padStart(2);
    return this.vjLine(`${dept} ${desc}  ${qty}  ${money(args.priceCents).padStart(7)}`);
  }

  /**
   * `<label> # <pump>   1  <amount>` → ITEM_ADD via the parser's fuel branch
   * (cascade step 11, checked BEFORE the generic item add — the `#` is what
   * routes it there). A prepay is a normal ITEM whose description carries the
   * pump number (`PREPAY CA #05`); the player ignores the label text and
   * quantity, stamps its configured prepayFuelDescription, and takes only the
   * amount from the line.
   */
  fuelPrepay(args: { description: string; priceCents: number }): string {
    const hashIdx = args.description.indexOf('#');
    const pump = /#\s*(\d+)/.exec(args.description)?.[1] ?? '0';
    const label = (hashIdx >= 0 ? args.description.slice(0, hashIdx) : args.description)
      .replace(/[^\x20-\x7E]/g, '')
      .trim()
      .padEnd(3)
      .slice(0, 18)
      .trimEnd();
    return this.vjLine(`${label} # ${pump}   1  ${money(args.priceCents).padStart(7)}`);
  }

  /** ` V <desc(20)> <qty>  -<price>` → ITEM_VOID (voided, negative price). */
  itemVoid(args: TopazItemArgs): string {
    const desc = sanitizeDescription(args.description).padEnd(20);
    const qty = Math.max(1, Math.min(9999, Math.trunc(args.quantity))).toString().padStart(2);
    return this.vjLine(` V ${desc} ${qty}  -${money(args.priceCents)}`);
  }

  /**
   * `        Sub Total  <amount>` — NOTE: decodes as BASKET_TOTAL, not
   * SUBTOTAL, because the legacy total pattern substring-matches "Sub Total"
   * first and CKP2.0 preserves that shadowing verbatim.
   */
  subtotal(amountCents: number): string {
    return this.vjLine(`        Sub Total${money(amountCents).padStart(10)}`);
  }

  /** `              Tax  <amount>` → TAX. */
  tax(amountCents: number): string {
    return this.vjLine(`              Tax${money(amountCents).padStart(10)}`);
  }

  /** `            Total  <amount>` → BASKET_TOTAL. */
  total(amountCents: number): string {
    return this.vjLine(`            Total${money(amountCents).padStart(10)}`);
  }

  /** `             CASH  <amount>` → TENDER with tenderType=mop. */
  tender(mop: 'CASH' | 'CREDIT' | 'DEBIT' | 'FOODSTAMP', amountCents: number): string {
    return this.vjLine(`             ${mop}${money(amountCents).padStart(10)}`);
  }

  /**
   * `  LOYALTY <digits>` → LOYALTY_SWIPE, except exactly 10 digits which the
   * parser routes as LOYALTY_MOBILE_SIGNIN (legacy mobile-number rule).
   */
  loyalty(cardNumber: string): string {
    const digits = (cardNumber ?? '').replace(/\D/g, '');
    return this.vjLine(`  LOYALTY ${digits}`);
  }

  /** `  VOID TICKET <tx>` → BASKET_VOIDED. */
  voidTicket(tx: number): string {
    return this.vjLine(`  VOID TICKET ${tx}`);
  }

  /** `TRANSACTION SUSPENDED # <tx>` → BASKET_SUSPEND. */
  suspend(tx: number): string {
    return this.vjLine(`TRANSACTION SUSPENDED # ${tx}`);
  }

  /** `ST# <store> DR# <drawer> TRAN# <tx>` → BASKET_END (receiptNum = tx). */
  basketEnd(args: TopazBasketEndArgs): string {
    const store = args.store.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, '').slice(0, 8) || '0';
    return this.vjLine(`ST# ${store} DR# ${args.drawer} TRAN# ${args.tx}`);
  }

  /** `CSH: <name(17)>` → CASHIER_RECOGNIZED (parser captures exactly 17 chars). */
  cashier(name: string): string {
    const clean = name.replace(/[^\x20-\x7E]/g, '').slice(0, 17).padEnd(17);
    return this.vjLine(`CSH: ${clean}`);
  }

  /** `*** ERROR CORRECT ***` — arms the parser's next-item-add-is-a-void flip. */
  errorCorrect(): string {
    return this.vjLine('*** ERROR CORRECT ***');
  }

  // ─── Pole display frames (20 printable chars each) ────────────────────────

  /** `ESC l \x01 <\x01|\x02>` + exactly 20 printable chars. */
  private poleFrame(lineNo: 1 | 2, text: string): string {
    const payload = text.replace(/[^\x20-\x7E]/g, ' ').slice(0, 20).padEnd(20);
    return `\u001Bl\u0001${lineNo === 1 ? '\u0001' : '\u0002'}${payload}`;
  }

  /** Line-1 item mirror (`COKE 20OZ       2.19`). Mirror-only: the player
   *  ignores generic pole item lines — the VJ owns items in the US. */
  poleItem(description: string, priceCents: number): string {
    const amount = money(priceCents);
    const desc = sanitizeDescription(description).trimEnd().slice(0, 20 - amount.length - 1);
    return this.poleFrame(1, `${desc.padEnd(20 - amount.length - 1)} ${amount}`);
  }

  /** `     TOTAL     11.29` → POLEDISP_TOTAL (line 2). */
  poleTotal(totalCents: number): string {
    return this.poleFrame(2, `     TOTAL${money(totalCents).padStart(10)}`);
  }

  /** `CASH           18.25` → POLEDISP_TENDER (line 2). */
  poleTender(mop: 'CASH' | 'CHECK' | 'DEBIT' | 'CREDIT', tenderCents: number): string {
    return this.poleFrame(2, `${mop}${money(tenderCents).padStart(20 - mop.length)}`);
  }

  /** `CHANGE          8.15` → POLEDISP_CHANGE (line 1). */
  poleChange(changeCents: number): string {
    return this.poleFrame(1, `CHANGE${money(changeCents).padStart(14)}`);
  }

  // ─── Scanner feed ─────────────────────────────────────────────────────────

  /** One CRLF-terminated barcode per write — the scanner trims and routes it. */
  scan(barcode: string): string {
    return `${barcode.trim()}\r\n`;
  }
}
