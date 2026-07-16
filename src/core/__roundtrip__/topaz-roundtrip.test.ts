/**
 * Round-trip test: feed the emulator's TopazEncoder output through CK Player
 * 2.0's REAL verifone Topaz parsers and assert they decode the expected events.
 *
 * Same proof pattern as parser-roundtrip.test.ts (Radiant6 Canada): if the
 * sibling repo's parsers accept our bytes and emit the right RegisterEvents,
 * the player will too. Both parsers are pure, so they run unchanged here.
 */
import { describe, it, expect } from 'vitest';
import { TopazEncoder } from '../TopazEncoder';

// CK Player 2.0 sibling repo — real parsers, not copies.
import { TopazMessageParser } from '../../../../CKPlayer2.0/electron/plugins/verifone/TopazMessageParser';
import {
  TopazPoleDisplayParser,
  createTopazPoleDisplayContext,
} from '../../../../CKPlayer2.0/electron/plugins/verifone/TopazPoleDisplayParser';
import { DEFAULT_TOPAZ_CONTEXT } from '../../../../CKPlayer2.0/electron/plugins/verifone/types';

const SOURCE = { name: 'emulator' };

const enc = new TopazEncoder({ registerId: 101, clock: () => new Date(2026, 6, 15, 13, 45, 12) });

/** Fresh parser fed one or more encoder lines; returns the emitted events. */
function vjEvents(...lines: string[]): Array<{ action: string; data: Record<string, unknown> }> {
  const parser = new TopazMessageParser({ ...DEFAULT_TOPAZ_CONTEXT }, SOURCE);
  return lines.flatMap((l) => parser.append(l)) as Array<{ action: string; data: Record<string, unknown> }>;
}

describe('round-trip: VJ encoder → CKPlayer2.0 TopazMessageParser', () => {
  it('itemAdd decodes to ITEM_ADDED with description, quantity and dollar price', () => {
    const events = vjEvents(enc.itemAdd({ description: 'COKE 20OZ', priceCents: 219, quantity: 1 }));
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('ITEM_ADDED');
    expect(events[0].data.description).toBe('COKE 20OZ');
    expect(events[0].data.quantity).toBe(1);
    expect(events[0].data.price).toBeCloseTo(2.19, 5);
    expect(events[0].data.terminalId).toBe(101);
  });

  it('itemAdd carries a multi-unit quantity through', () => {
    const events = vjEvents(enc.itemAdd({ description: 'MONSTER 16OZ', priceCents: 358, quantity: 2 }));
    expect(events[0].action).toBe('ITEM_ADDED');
    expect(events[0].data.quantity).toBe(2);
    expect(events[0].data.price).toBeCloseTo(3.58, 5);
  });

  it('itemVoid decodes to ITEM_VOID with a negative price and voided=true', () => {
    const events = vjEvents(enc.itemVoid({ description: 'COKE 20OZ', priceCents: 219, quantity: 1 }));
    expect(events).toHaveLength(1);
    expect(events[0].action).toBe('ITEM_VOID');
    expect(events[0].data.description).toBe('COKE 20OZ');
    expect(events[0].data.price).toBeCloseTo(-2.19, 5);
    expect(events[0].data.voided).toBe(true);
  });

  it('subtotal decodes as BASKET_TOTAL (legacy "Sub Total" shadowing, preserved by CKP2.0)', () => {
    const events = vjEvents(enc.subtotal(1129));
    expect(events[0].action).toBe('BASKET_TOTAL');
    expect(events[0].data.total).toBeCloseTo(11.29, 5);
  });

  it('tax decodes to TAX with the dollar amount', () => {
    const events = vjEvents(enc.tax(56));
    expect(events[0].action).toBe('TAX');
    expect(events[0].data.tax).toBeCloseTo(0.56, 5);
  });

  it('total decodes to BASKET_TOTAL', () => {
    const events = vjEvents(enc.total(1185));
    expect(events[0].action).toBe('BASKET_TOTAL');
    expect(events[0].data.total).toBeCloseTo(11.85, 5);
  });

  it('tender decodes to TENDER with the MOP', () => {
    const events = vjEvents(enc.tender('CASH', 2000));
    expect(events[0].action).toBe('TENDER');
    expect(events[0].data.tenderType).toBe('CASH');
    expect(events[0].data.total).toBeCloseTo(20, 5);
  });

  it('22-digit loyalty decodes to LOYALTY_SWIPE', () => {
    const card = '8018000000000000000000';
    const events = vjEvents(enc.loyalty(card));
    expect(events[0].action).toBe('LOYALTY_SWIPE');
    expect(events[0].data.loyaltyCard).toBe(card);
  });

  it('10-digit loyalty decodes to LOYALTY_MOBILE_SIGNIN', () => {
    const events = vjEvents(enc.loyalty('5551234567'));
    expect(events[0].action).toBe('LOYALTY_MOBILE_SIGNIN');
    expect(events[0].data.mobileNumber).toBe('5551234567');
  });

  it('voidTicket decodes to BASKET_VOIDED', () => {
    const events = vjEvents(enc.voidTicket(12));
    expect(events[0].action).toBe('BASKET_VOIDED');
  });

  it('suspend decodes to BASKET_SUSPEND', () => {
    const events = vjEvents(enc.suspend(12));
    expect(events[0].action).toBe('BASKET_SUSPEND');
  });

  it('basketEnd decodes to BASKET_END carrying the TRAN# as receiptNum', () => {
    const events = vjEvents(enc.basketEnd({ store: 'AB123', drawer: 1, tx: 1001 }));
    expect(events[0].action).toBe('BASKET_END');
    expect(events[0].data.receiptNum).toBe('1001');
  });

  it('cashier decodes to CASHIER_RECOGNIZED with the trimmed name', () => {
    const events = vjEvents(enc.cashier('Timothy'));
    expect(events[0].action).toBe('CASHIER_RECOGNIZED');
    expect(events[0].data.cashierName).toBe('Timothy');
  });

  it('a full sale drains in order: add, add, subtotal, tax, total, tender, basket end', () => {
    const actions = vjEvents(
      enc.itemAdd({ description: 'COKE 20OZ', priceCents: 219, quantity: 1 }),
      enc.itemAdd({ description: 'CHIPS BBQ', priceCents: 349, quantity: 1 }),
      enc.subtotal(568),
      enc.tax(28),
      enc.total(596),
      enc.tender('CASH', 600),
      enc.basketEnd({ store: 'AB123', drawer: 1, tx: 1001 }),
    ).map((e) => e.action);
    expect(actions).toEqual([
      'ITEM_ADDED',
      'ITEM_ADDED',
      'BASKET_TOTAL',
      'TAX',
      'BASKET_TOTAL',
      'TENDER',
      'BASKET_END',
    ]);
  });

  it('reassembles a VJ line split across two chunks', () => {
    const line = enc.itemAdd({ description: 'COKE 20OZ', priceCents: 219, quantity: 1 });
    const parser = new TopazMessageParser({ ...DEFAULT_TOPAZ_CONTEXT }, SOURCE);
    const first = parser.append(line.slice(0, 12));
    const rest = parser.append(line.slice(12));
    expect(first).toHaveLength(0);
    expect(rest.map((e) => e.action)).toEqual(['ITEM_ADDED']);
  });
});

describe('round-trip: pole encoder → CKPlayer2.0 TopazPoleDisplayParser', () => {
  it('poleTotal decodes to POLEDISP_TOTAL with integer cents', () => {
    const ctx = createTopazPoleDisplayContext();
    const events = TopazPoleDisplayParser.parseChunk(SOURCE, enc.poleTotal(1129), ctx);
    const total = events.find((e) => e.action === 'POLEDISP_TOTAL');
    expect(total).toBeDefined();
    expect((total!.data.poleDisplay as { totalCents: number }).totalCents).toBe(1129);
  });

  it('poleTender decodes to POLEDISP_TENDER with the MOP and cents', () => {
    const ctx = createTopazPoleDisplayContext();
    const events = TopazPoleDisplayParser.parseChunk(SOURCE, enc.poleTender('CASH', 2000), ctx);
    const tender = events.find((e) => e.action === 'POLEDISP_TENDER');
    expect(tender).toBeDefined();
    expect((tender!.data.poleDisplay as { mop: string; tenderCents: number }).mop).toBe('CASH');
    expect((tender!.data.poleDisplay as { mop: string; tenderCents: number }).tenderCents).toBe(2000);
  });

  it('poleChange decodes to POLEDISP_CHANGE with the change cents', () => {
    const ctx = createTopazPoleDisplayContext();
    const events = TopazPoleDisplayParser.parseChunk(SOURCE, enc.poleChange(815), ctx);
    const change = events.find((e) => e.action === 'POLEDISP_CHANGE');
    expect(change).toBeDefined();
    expect((change!.data.poleDisplay as { changeCents: number }).changeCents).toBe(815);
  });

  it('poleItem mirrors to POLEDISP_UPDATED only (items are VJ-authoritative in the US)', () => {
    const ctx = createTopazPoleDisplayContext();
    const events = TopazPoleDisplayParser.parseChunk(SOURCE, enc.poleItem('COKE 20OZ', 219), ctx);
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(['POLEDISP_UPDATED']);
  });
});

describe('round-trip: full RegisterSession sale → CKPlayer2.0 Topaz parsers', () => {
  it('decodes a whole cash sale in journal order', async () => {
    const { RegisterSession } = await import('../RegisterSession');
    const s = new RegisterSession({
      registerType: 'verifone-topaz',
      clock: () => new Date(2026, 6, 15, 13, 45, 12),
    });
    const messages = [
      ...s.open(),
      ...s.addItem({ code: '049000000443', description: 'COKE 20OZ', priceCents: 219 }),
      ...s.addItem({ code: '028400090032', description: 'CHIPS BBQ', priceCents: 349 }),
      ...s.loyalty('8018000000000000000000'),
      ...s.tender('cash-exact'),
    ];

    const parser = new TopazMessageParser({ ...DEFAULT_TOPAZ_CONTEXT }, SOURCE);
    const vjActions = messages
      .filter((m) => m.channel === 'vj')
      .flatMap((m) => parser.append(m.data))
      .map((e) => e.action);
    expect(vjActions).toEqual([
      'CASHIER_RECOGNIZED',
      'ITEM_ADDED',
      'ITEM_ADDED',
      'LOYALTY_SWIPE',
      'BASKET_TOTAL', // legacy shadowing: "Sub Total" decodes as a total line
      'TAX',
      'BASKET_TOTAL',
      'TENDER',
      'BASKET_END',
    ]);

    const ctx = createTopazPoleDisplayContext();
    const poleActions = messages
      .filter((m) => m.channel === 'pole')
      .flatMap((m) => TopazPoleDisplayParser.parseChunk(SOURCE, m.data, ctx))
      .map((e) => e.action)
      .filter((a) => a !== 'POLEDISP_UPDATED');
    expect(poleActions).toEqual(['POLEDISP_TOTAL', 'POLEDISP_TENDER', 'POLEDISP_CHANGE']);

    const scans = messages.filter((m) => m.channel === 'scanner').map((m) => m.data);
    expect(scans).toEqual(['049000000443\r\n', '028400090032\r\n']);
  });
});
