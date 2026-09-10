/**
 * OctaneEncoder — produces the Octane virtual-journal JSON messages CK Player
 * 2.0's `octane` plugin consumes. Octane is the EU POS (Ireland, Norway,
 * Sweden, Denmark, Latvia, …) and is the only register family whose journal is
 * **HTTP, not a socket**: the POS POSTs one JSON document per event to the
 * player's `/add_salesline` servlet (default port 8023), and the player pushes
 * completer injects back to an HTTP server the POS runs on port 8020.
 *
 * This class owns only the message bodies; `OctaneTransport` owns the HTTP.
 * Pure / browser-safe (no Node or Electron imports).
 *
 * Formats cross-checked against the authoritative consumers:
 *   ../CKPlayer2.0/electron/plugins/octane/OctaneMessageParser.ts
 *   ../liftck_player/.../player/register/octane/OctaneVirtualJournal.java
 * and the legacy emulator this ports:
 *   ../liftck_player/.../emulator/.../register/octane/OctaneRegisterEmulator.java
 *
 * Every message carries a `lineId` — the Octane line-type number (see
 * `liftck_player/doc/octane/events.md`) — which is what both parsers switch on.
 */

/** Octane line-type numbers (`lineId`), the event discriminator on the wire. */
export const OCTANE_LINE_ID = {
  /** 1 — drystock sales line; a void is the same line with `itemMask:["ABORT"]`. */
  ADD_VOID_ITEM: '1',
  /** 2 — fuel sales line; a void is the same line with `itemMask:["ABORT"]`. */
  ADD_VOID_FUEL: '2',
  /** 3 — manual discount line. */
  DISCOUNT: '3',
  /** 5 — receipt total (incl. VAT). */
  BASKET_TOTAL: '5',
  /** 6 — receipt header, i.e. basket start. */
  CREATE_BASKET: '6',
  /** 7 — receipt footer, i.e. end of transaction. */
  END_OF_TRANSACTION: '7',
  /** 27 — void the whole transaction. */
  VOID_TICKET: '27',
  /** 33 — stored transaction (the player suspends the basket). */
  STORED_TRANSACTION: '33',
  /** 55 — tender line. */
  TENDER: '55',
  /** 60 — change line. */
  CHANGE: '60',
  /** 379 — split tax total line. */
  TAX_IN_BASKET: '379',
} as const;

/**
 * `itemMask` token marking a line as a void. Both parsers key off this exact
 * string (`OCTANE_VOID_SIGNAL` in Java, `itemMask?.includes('ABORT')` in CKP2.0)
 * — the lineId is identical for an add and a void.
 */
export const OCTANE_VOID_SIGNAL = 'ABORT';

/** Octane cash tender type. CKP2.0 treats `tenderType === '0'` as cash. */
export const OCTANE_CASH_TENDER_TYPE = '0';

/**
 * Price locales the emulator can format for. This is the tenant's Octane
 * decimal dialect and MUST match the player's `virtualjournal.priceLocale`,
 * or every amount parses wrong.
 *
 * ⚠ `pl` (Poland) is COMMA-decimal here because that is what CK Player 2.0
 * does, and CK Player 2.0 is what this emulator drives. The two players
 * disagree, and each is deliberate about it:
 *   - CKP2.0 `CurrencyManipulator.ts` puts 'pl' in `isEuropeanLocale`, locked
 *     by `__tests__/CurrencyManipulator.test.ts` ("europeanLocales: ['no',
 *     'sv', 'da', 'lv', 'pl']"). Verified: locale pl parses "1,50" → 1.5 and
 *     "1.50" → 150.
 *   - Legacy Java `CurrencyManipulator.java` takes the comma path only for
 *     fr/no plus EUROPEAN_TENANTS (ee/lv/lt/da), so pl is dot-decimal there —
 *     matching the legacy `OctaneVirtualJournal` comment "Dot decimal (1.37):
 *     pl, ie, en". Its `replaceAll("[^\\d.]","")` turns "1,50" into 150.
 * A Polish journal is therefore off by 100× against one of the two, whichever
 * we pick. This needs reconciling upstream; until then the picker lets you
 * switch dialect by hand when pointing at the legacy player.
 */
export type OctaneLocale = 'ie' | 'en' | 'no' | 'sv' | 'da' | 'lv' | 'pl';

/**
 * Display labels for the Config price-locale picker: the locale CODE plus a
 * sample amount. The code — not the country name — is what has to be typed
 * into the player's `virtualjournal.priceLocale`, and the sample shows the
 * decimal dialect at a glance. Shown in the log line that announces the
 * detected dialect; there is no picker (the tenant decides).
 */
export const OCTANE_LOCALE_LABELS: Record<OctaneLocale, string> = {
  ie: 'IE 1.50',
  en: 'EN 1.50',
  no: 'NO 1,50',
  sv: 'SV 1,50',
  da: 'DA 1,50',
  lv: 'LV 1,50',
  pl: 'PL 1,50',
};

/** CK Player 2.0's `virtualjournal.priceLocale` default (OctaneVirtualJournal.ts). */
export const DEFAULT_OCTANE_LOCALE: OctaneLocale = 'ie';

/**
 * Backend TENANT code → Octane price locale. These are two different
 * vocabularies and they do not always match: the tenant for Sweden is `se` but
 * its price locale is `sv`, and Denmark is `dk` / `da`. The tenant is the
 * leading segment of the player code (`pl-9999-2` → `pl`), so registering a
 * player is enough to resolve the dialect.
 *
 * Estonia (`ee`) and Lithuania (`lt`) are absent on purpose — the legacy player
 * handles them, but CK Player 2.0's `Locale` union has no entry for either, so
 * there is no value we could put in `virtualjournal.priceLocale` that it would
 * honour. They fall through to "leave the current selection alone".
 */
const TENANT_TO_OCTANE_LOCALE: Record<string, OctaneLocale> = {
  ie: 'ie',
  en: 'en',
  no: 'no',
  se: 'sv',
  dk: 'da',
  lv: 'lv',
  pl: 'pl',
};

/**
 * The Octane price locale for a backend tenant code, or null when the tenant
 * isn't an Octane market (or isn't one CK Player 2.0 can be configured for).
 * Null means "keep whatever is selected" — never a silent fallback to `ie`,
 * which would format Polish amounts with the wrong decimal separator.
 */
export function octaneLocaleForTenant(tenant: string | undefined | null): OctaneLocale | null {
  if (!tenant) return null;
  return TENANT_TO_OCTANE_LOCALE[tenant.trim().toLowerCase()] ?? null;
}

/** U+00A0 non-breaking space — the Nordic thousands separator. */
const NBSP = '\u00A0';

/**
 * Decimal + thousands separators per locale. Both consumers strip the
 * thousands separator before parsing (Java `replaceAll("[^\\d.]","")` after the
 * European comma pass; CKP2.0 `replace(/[\.\s]/g,'')` / `replace(/[^\d.]/g,'')`),
 * so these are cosmetic realism — but they must not be the decimal separator
 * of the same locale, or the amount silently changes magnitude.
 */
const SEPARATORS: Record<OctaneLocale, { decimal: string; thousands: string }> = {
  ie: { decimal: '.', thousands: ',' },
  en: { decimal: '.', thousands: ',' },
  no: { decimal: ',', thousands: NBSP },
  sv: { decimal: ',', thousands: NBSP },
  da: { decimal: ',', thousands: '.' },
  lv: { decimal: ',', thousands: '.' },
  // Comma per CK Player 2.0, NOT per the legacy Java player — see OctaneLocale.
  pl: { decimal: ',', thousands: '.' },
};

/** Group an integer-string into thousands using `sep`. */
function groupThousands(intStr: string, sep: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Format integer cents as an Octane wire amount — always two decimals, no
 * currency symbol (Octane amounts are bare numbers; the currency travels in
 * `currencyCodeIso4217`). Mirrors the legacy emulator's `Numbers.formatForLocale`
 * (`NumberFormat` with min/max fraction digits 2).
 *
 * Built from integer cents so there is no float drift. Negatives use Octane's
 * TRAILING-minus notation (`"10,00-"`) — never a leading sign — which is what
 * both parsers strip and negate.
 */
export function formatOctaneAmount(cents: number, locale: OctaneLocale): string {
  const { decimal, thousands } = SEPARATORS[locale];
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = groupThousands(Math.floor(abs / 100).toString(), thousands);
  const frac = (abs % 100).toString().padStart(2, '0');
  return `${whole}${decimal}${frac}${negative ? '-' : ''}`;
}

/**
 * Format a quantity for the wire. Whole numbers go out bare ("2") — the shape
 * the legacy emulator's `BigDecimal.toPlainString()` produces for the integer
 * quantities a register rings. A fractional quantity uses the LOCALE decimal
 * separator, because both parsers run quantities through the same
 * locale-aware currency parser as amounts: a dot-decimal "1.5" under a
 * comma-decimal locale would be read as 15.
 */
export function formatOctaneQuantity(quantity: number, locale: OctaneLocale): string {
  if (Number.isInteger(quantity)) return String(quantity);
  return quantity.toString().replace('.', SEPARATORS[locale].decimal);
}

/**
 * ISO-8601 timestamp with the local UTC offset — the shape real Octane sends
 * (`2021-08-31T12:49:51.687+02:00`), not the `Z` form `Date.toISOString()`
 * produces. CKP2.0 parses it with `new Date(...)`; the Java player currently
 * skips timestamp parsing entirely (JDK-21 compatibility TODO).
 */
export function octaneTimestamp(date: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/**
 * ISO-4217 numeric currency codes by Octane locale. Ported from the legacy
 * emulator's `OctaneVirtualJournalMessage.getCurrencyCode()` tenant map, plus
 * `ie` → 978 (EUR), which the legacy map omits — it falls through to "" there,
 * an oversight rather than a contract, and neither parser reads this field.
 */
const CURRENCY_CODES: Record<OctaneLocale, string> = {
  ie: '978', // EUR
  en: '', // no tenant → legacy sends empty
  no: '578', // NOK
  sv: '752', // SEK — legacy keys this 'se'
  da: '208', // DKK — legacy keys this 'dk'
  lv: '978', // EUR
  pl: '985', // PLN
};

export interface OctaneEncoderOptions {
  /** Tenant price dialect; must match the player's `virtualjournal.priceLocale`. */
  locale?: OctaneLocale;
  /** `{tenant}-{location}-{player}` — `siteNumber`/`posNo` are sliced out of it. */
  playerCode?: string;
  operatorId?: string;
  operatorName?: string;
  /** Injectable clock for deterministic tests. */
  clock?: () => Date;
  /** Deterministic receipt-uuid generator for tests. */
  receiptUuidGen?: () => string;
}

/** The envelope every Octane journal message carries. */
interface Envelope {
  msgType: 'journal';
  timestamp: string;
  siteNumber: string;
  posNo: string;
  languageCodeIso639_1: string;
  currencyCodeIso4217: string;
  /**
   * Always empty on the wire — the legacy field name is a copy/paste of the
   * 4217 currency key (a country code would be ISO-3166), and real Octane
   * leaves it blank. Kept for shape parity; no parser reads it.
   */
  countryCodeIso4217: '';
  lineId: string;
}

export class OctaneEncoder {
  private readonly locale: OctaneLocale;
  private readonly siteNumber: string;
  private readonly posNumber: string;
  private readonly operatorId: string;
  private readonly operatorName: string;
  private readonly clock: () => Date;
  private readonly receiptUuidGen: () => string;

  constructor(options: OctaneEncoderOptions = {}) {
    this.locale = options.locale ?? DEFAULT_OCTANE_LOCALE;
    // Legacy: siteNumber = playerCode[1], posNo = playerCode[2] of
    // "{tenantCode}-{locationNumber}-{playerNumber}". Both are cosmetic (no
    // parser reads them), so a missing/short code just yields empty strings.
    const parts = (options.playerCode ?? '').split('-');
    this.siteNumber = parts[1] ?? '';
    this.posNumber = parts[2] ?? '';
    this.operatorId = options.operatorId ?? '12599';
    this.operatorName = options.operatorName ?? 'Timothy';
    this.clock = options.clock ?? ((): Date => new Date());
    this.receiptUuidGen = options.receiptUuidGen ?? ((): string => crypto.randomUUID());
  }

  /** Two-decimal wire amount in the configured locale. */
  private money(cents: number): string {
    return formatOctaneAmount(cents, this.locale);
  }

  private envelope(lineId: string, at: Date): Envelope {
    return {
      msgType: 'journal',
      timestamp: octaneTimestamp(at),
      siteNumber: this.siteNumber,
      posNo: this.posNumber,
      languageCodeIso639_1: this.locale,
      currencyCodeIso4217: CURRENCY_CODES[this.locale],
      countryCodeIso4217: '',
      lineId,
    };
  }

  /**
   * Serialize one message. Terminated with CRLF to match the legacy emulator
   * (which appends the journal device's line separator) and CK Player 2.0's
   * documented `virtualjournal.lineSeparator=\r\n`; JSON parsers on both sides
   * ignore the trailing whitespace.
   */
  private serialize(lineId: string, body: Record<string, unknown>): string {
    return `${JSON.stringify({ ...this.envelope(lineId, this.clock()), ...body })}\r\n`;
  }

  /**
   * `lineId 6` — basket start (Octane's receipt header). Carries the cashier,
   * which is what makes the player switch to this operator.
   */
  createBasket(args: { receiptNumber: number | string; terminalNumber: number | string }): string {
    const at = this.clock();
    return this.serialize(OCTANE_LINE_ID.CREATE_BASKET, {
      shiftNo: '1',
      operatorNo: this.operatorId,
      operatorName: this.operatorName,
      receiptUniqueId: this.receiptUuidGen(),
      // Legacy joda patterns "M/d/Y" and "H:m" — unpadded, and month-first
      // where real Octane sends day-first. Kept as-is: this is the shape the
      // legacy emulator produced, and neither parser reads date/time (both
      // take the wall clock from `timestamp`, or from arrival).
      date: `${at.getMonth() + 1}/${at.getDate()}/${at.getFullYear()}`,
      time: `${at.getHours()}:${at.getMinutes()}`,
      siteNo: this.siteNumber,
      lineText: [],
      receiptNo: String(args.receiptNumber),
      terminalNo: String(args.terminalNumber),
    });
  }

  /**
   * `lineId 1` — drystock item add. `total` is the EXTENDED amount (unit ×
   * qty): CKP2.0 divides it by `qty` to recover the unit price, and the Java
   * player takes it as the line price directly.
   */
  itemAdd(args: { description: string; barcode: string; quantity: number; extendedCents: number }): string {
    return this.serialize(OCTANE_LINE_ID.ADD_VOID_ITEM, {
      textLong: args.description,
      total: this.money(args.extendedCents),
      qty: formatOctaneQuantity(args.quantity, this.locale),
      ean: args.barcode,
      itemMask: [],
    });
  }

  /**
   * `lineId 1` + `itemMask:["ABORT"]` — drystock item void. The amount carries
   * Octane's trailing-minus so the player books it as a negative line.
   */
  itemVoid(args: { description: string; barcode: string; quantity: number; extendedCents: number }): string {
    return this.serialize(OCTANE_LINE_ID.ADD_VOID_ITEM, {
      textLong: args.description,
      total: this.money(-Math.abs(args.extendedCents)),
      qty: formatOctaneQuantity(args.quantity, this.locale),
      ean: args.barcode,
      itemMask: [OCTANE_VOID_SIGNAL],
    });
  }

  /**
   * `lineId 2` — fuel sales line. Quantity is `litres`, and there is no `ean`
   * (a pump has no barcode); the player's fuel branch keys off the lineId.
   */
  fuelAdd(args: { description: string; litres: number; extendedCents: number }): string {
    return this.serialize(OCTANE_LINE_ID.ADD_VOID_FUEL, {
      text: args.description,
      litres: formatOctaneQuantity(args.litres, this.locale),
      total: this.money(args.extendedCents),
      itemMask: [],
    });
  }

  /** `lineId 2` + `itemMask:["ABORT"]` — fuel void. */
  fuelVoid(args: { description: string; litres: number; extendedCents: number }): string {
    return this.serialize(OCTANE_LINE_ID.ADD_VOID_FUEL, {
      text: args.description,
      litres: formatOctaneQuantity(args.litres, this.locale),
      total: this.money(Math.abs(args.extendedCents)),
      itemMask: [OCTANE_VOID_SIGNAL],
    });
  }

  /**
   * `lineId 3` — manual discount. The amount is trailing-minus negative; a
   * POSITIVE discount means "void the earlier discount" to both parsers, so
   * this always sends the reduction as negative.
   */
  discount(args: { text: string; amountCents: number }): string {
    return this.serialize(OCTANE_LINE_ID.DISCOUNT, {
      text: args.text,
      discount: this.money(-Math.abs(args.amountCents)),
    });
  }

  /** `lineId 5` — basket total (incl. VAT) with the basket's tax in `vat`. */
  basketTotal(args: { totalCents: number; taxCents: number }): string {
    return this.serialize(OCTANE_LINE_ID.BASKET_TOTAL, {
      total: this.money(args.totalCents),
      vat: this.money(args.taxCents),
    });
  }

  /**
   * `lineId 55` — tender. `amount` is what the customer handed over and
   * `total` what the basket owed; the player derives change from the pair.
   *
   * `tenderType: "0"` (cash) is NET-NEW versus the legacy emulator, which
   * omitted the field entirely — CKP2.0's `handleTender` gates its cash
   * rounding on `tenderType === '0'`, so without it a cash tender is treated
   * as card and never rounds. Real Octane sends it (see the sample events in
   * OctaneVirtualJournal.java).
   */
  tender(args: { amountCents: number; totalCents: number; description: string; cash?: boolean }): string {
    return this.serialize(OCTANE_LINE_ID.TENDER, {
      amount: this.money(args.amountCents),
      tenderText: args.description,
      total: this.money(args.totalCents),
      ...(args.cash !== false ? { tenderType: OCTANE_CASH_TENDER_TYPE } : {}),
    });
  }

  /**
   * `lineId 60` — change. Octane reports change as a trailing-minus amount
   * ("10,00-"); CKP2.0 takes its absolute value, the Java player keeps the
   * sign, so the negative form is the one both agree on.
   */
  change(args: { changeCents: number }): string {
    return this.serialize(OCTANE_LINE_ID.CHANGE, {
      amountDue: this.money(-Math.abs(args.changeCents)),
    });
  }

  /** `lineId 379` — split tax total, the basket's VAT restated after tender. */
  taxInBasket(args: { taxCents: number }): string {
    return this.serialize(OCTANE_LINE_ID.TAX_IN_BASKET, { vat: this.money(args.taxCents) });
  }

  /** `lineId 7` — end of transaction (the player closes and books the basket). */
  endOfTransaction(args: { receiptNumber: number | string; terminalNumber: number | string }): string {
    return this.serialize(OCTANE_LINE_ID.END_OF_TRANSACTION, {
      receiptNo: String(args.receiptNumber),
      terminalNo: String(args.terminalNumber),
    });
  }

  /** `lineId 27` — void the whole transaction. Carries no fields of its own. */
  voidTicket(): string {
    return this.serialize(OCTANE_LINE_ID.VOID_TICKET, {});
  }

  /** `lineId 33` — stored transaction; the player suspends the basket. */
  storedTransaction(): string {
    return this.serialize(OCTANE_LINE_ID.STORED_TRANSACTION, {});
  }
}
