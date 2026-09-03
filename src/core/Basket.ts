/**
 * Pure, browser-safe basket model for CKEmulator 2.0.
 *
 * All money is integer cents — never floats. Tax is computed from a basis-point
 * rate (500 = 5.00%). CAD cash rounding ("Arrondir") rounds the total to the
 * nearest five cents.
 */

export interface AddItemInput {
  code: string;
  description: string;
  priceCents: number;
  /** Defaults to 1. May be fractional for weighed items. */
  quantity?: number;
  /**
   * Minimum customer age for the item. >0 marks it age-restricted (legacy
   * Register.isAgeRestricted: minAge > 0). Carried onto the wire as
   * `AgeMinimum` so the player can gate age verification. Absent → unrestricted.
   */
  minAge?: number;
}

export interface BasketOptions {
  /** Tax rate in basis points (500 = 5%). */
  taxRateBps: number;
}

export class LineItem {
  voided = false;

  constructor(
    public readonly lineNumber: number,
    public readonly code: string,
    public description: string,
    public unitPriceCents: number,
    public quantity: number,
    /** Minimum customer age (>0 = age-restricted); undefined when unknown. */
    public readonly minAge?: number,
  ) {}

  /** Extended price = unit price × quantity, in cents. */
  extendedCents(): number {
    return Math.round(this.unitPriceCents * this.quantity);
  }
}

export class Basket {
  private readonly taxRateBps: number;
  private readonly items: LineItem[] = [];
  private nextLineNumber = 1;

  constructor(options: BasketOptions) {
    this.taxRateBps = options.taxRateBps;
  }

  /** All line items including voided ones (read-only view). */
  lineItems(): readonly LineItem[] {
    return this.items;
  }

  find(lineNumber: number): LineItem | undefined {
    return this.items.find((li) => li.lineNumber === lineNumber);
  }

  addItem(input: AddItemInput): LineItem {
    const li = new LineItem(
      this.nextLineNumber++,
      input.code,
      input.description,
      input.priceCents,
      input.quantity ?? 1,
      input.minAge,
    );
    this.items.push(li);
    return li;
  }

  voidItem(lineNumber: number): void {
    const li = this.find(lineNumber);
    if (li) li.voided = true;
  }

  setQuantity(lineNumber: number, quantity: number): void {
    const li = this.find(lineNumber);
    if (li) li.quantity = quantity;
  }

  setPrice(lineNumber: number, priceCents: number): void {
    const li = this.find(lineNumber);
    if (li) li.unitPriceCents = priceCents;
  }

  subtotalCents(): number {
    return this.items
      .filter((li) => !li.voided)
      .reduce((sum, li) => sum + li.extendedCents(), 0);
  }

  taxCents(): number {
    return Math.round((this.subtotalCents() * this.taxRateBps) / 10000);
  }

  totalCents(): number {
    return this.subtotalCents() + this.taxCents();
  }

  /** CAD cash rounding — total rounded to the nearest five cents. */
  roundCashTotal(): number {
    return Math.round(this.totalCents() / 5) * 5;
  }

  /** Tender amount for "exact dollar" — the rounded cash total. */
  exactDollarCents(): number {
    return this.roundCashTotal();
  }

  /** Tender amount for "next dollar" — total rounded up to the next whole dollar. */
  nextDollarCents(): number {
    return Math.ceil(this.totalCents() / 100) * 100;
  }

  /** Change due for a given tender, in cents (never negative). */
  changeDueCents(tenderedCents: number): number {
    return Math.max(0, tenderedCents - this.roundCashTotal());
  }
}
