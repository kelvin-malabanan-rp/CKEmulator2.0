import { describe, it, expect } from 'vitest';
import { Basket } from './Basket';

describe('Basket', () => {
  it('adds items with incrementing line numbers and computes subtotal', () => {
    const b = new Basket({ taxRateBps: 500 });
    const a = b.addItem({ code: '049000000443', description: 'Coke', priceCents: 169 });
    const c = b.addItem({ code: '012000001291', description: 'Chips', priceCents: 250 });
    expect(a.lineNumber).toBe(1);
    expect(c.lineNumber).toBe(2);
    expect(b.subtotalCents()).toBe(419);
  });

  it('stores minAge on the line item (undefined when unspecified)', () => {
    const b = new Basket({ taxRateBps: 500 });
    const beer = b.addItem({ code: 'BEER', description: 'Beer', priceCents: 899, minAge: 21 });
    const coke = b.addItem({ code: 'COKE', description: 'Coke', priceCents: 169 });
    expect(beer.minAge).toBe(21);
    expect(coke.minAge).toBeUndefined();
  });

  it('computes tax and total in cents (5%) and CAD cash rounding', () => {
    const b = new Basket({ taxRateBps: 500 });
    b.addItem({ code: '049000000443', description: 'Coke', priceCents: 169 });
    expect(b.taxCents()).toBe(8); // 169 * 0.05 = 8.45 → 8
    expect(b.totalCents()).toBe(177);
    expect(b.roundCashTotal()).toBe(175); // 177 → nearest 0.05
  });

  it('excludes voided items from totals', () => {
    const b = new Basket({ taxRateBps: 0 });
    b.addItem({ code: 'a', description: 'A', priceCents: 100 });
    const two = b.addItem({ code: 'b', description: 'B', priceCents: 200 });
    b.voidItem(two.lineNumber);
    expect(b.subtotalCents()).toBe(100);
    expect(two.voided).toBe(true);
  });

  it('applies quantity to extended price', () => {
    const b = new Basket({ taxRateBps: 0 });
    const li = b.addItem({ code: 'a', description: 'A', priceCents: 150, quantity: 3 });
    expect(li.extendedCents()).toBe(450);
    expect(b.subtotalCents()).toBe(450);
  });

  it('setQuantity and setPrice update the line', () => {
    const b = new Basket({ taxRateBps: 0 });
    const li = b.addItem({ code: 'a', description: 'A', priceCents: 100 });
    b.setQuantity(li.lineNumber, 2);
    expect(li.quantity).toBe(2);
    expect(b.subtotalCents()).toBe(200);
    b.setPrice(li.lineNumber, 75);
    expect(li.unitPriceCents).toBe(75);
    expect(b.subtotalCents()).toBe(150);
  });

  it('computes change, next-dollar and exact-dollar tenders', () => {
    const b = new Basket({ taxRateBps: 0 });
    b.addItem({ code: 'a', description: 'A', priceCents: 175 });
    expect(b.exactDollarCents()).toBe(175);
    expect(b.nextDollarCents()).toBe(200);
    expect(b.changeDueCents(200)).toBe(25);
  });
});
