import { describe, it, expect } from 'vitest';
import { TopazEncoder } from './TopazEncoder';

/** Fixed clock so VJ headers are deterministic: 07/15/26 13:45:12. */
const clock = (): Date => new Date(2026, 6, 15, 13, 45, 12);

const enc = new TopazEncoder({ registerId: 101, clock });

/** `MM/dd/yy HH:mm:ss <registerId> <payload>` — the Topaz VJ header framing. */
const VJ_LINE = /^(\d{2}\/\d{2}\/\d{2}) (\d{2}:\d{2}:\d{2}) (\d+) (.*)\n$/;

function payloadOf(line: string): string {
  const m = VJ_LINE.exec(line);
  expect(m, `not a framed VJ line: ${JSON.stringify(line)}`).not.toBeNull();
  return m![4];
}

describe('TopazEncoder VJ framing', () => {
  it('stamps every VJ line with the MM/dd/yy HH:mm:ss <registerId> header', () => {
    const line = enc.itemAdd({ description: 'COKE 20OZ', priceCents: 219, quantity: 1 });
    const m = VJ_LINE.exec(line)!;
    expect(m[1]).toBe('07/15/26');
    expect(m[2]).toBe('13:45:12');
    expect(m[3]).toBe('101');
  });

  it('keeps every payload within the parser frame window (10-40 chars)', () => {
    const lines = [
      enc.itemAdd({ description: 'COKE 20OZ', priceCents: 219, quantity: 1 }),
      enc.itemAdd({ description: 'A VERY LONG DESCRIPTION THAT KEEPS GOING', priceCents: 123456, quantity: 999 }),
      enc.itemVoid({ description: 'COKE 20OZ', priceCents: 219, quantity: 1 }),
      enc.subtotal(1129),
      enc.tax(56),
      enc.total(1185),
      enc.tender('CASH', 2000),
      enc.loyalty('8018000000000000000000'),
      enc.voidTicket(12),
      enc.suspend(12),
      enc.basketEnd({ store: 'AB123', drawer: 1, tx: 1001 }),
      enc.cashier('Timothy'),
      enc.errorCorrect(),
    ];
    for (const line of lines) {
      const payload = payloadOf(line);
      expect(payload.length, `payload out of window: ${JSON.stringify(payload)}`).toBeGreaterThanOrEqual(10);
      expect(payload.length, `payload out of window: ${JSON.stringify(payload)}`).toBeLessThanOrEqual(40);
    }
  });

  it('sanitizes descriptions: strips #, truncates to 20, pads to 5 printable chars', () => {
    const hash = payloadOf(enc.itemAdd({ description: 'ITEM #4 SPECIAL', priceCents: 100, quantity: 1 }));
    expect(hash).not.toContain('#');

    const long = payloadOf(
      enc.itemAdd({ description: 'A VERY LONG DESCRIPTION THAT KEEPS GOING', priceCents: 100, quantity: 1 }),
    );
    expect(long.length).toBeLessThanOrEqual(40);

    const short = payloadOf(enc.itemAdd({ description: 'AB', priceCents: 100, quantity: 1 }));
    expect(short).toContain('AB');
  });
});

describe('TopazEncoder pole frames', () => {
  // ESC l SOH (SOH|STX) + exactly 20 printable chars = the frame
  // shape TOPAZ_POLE_LINE_REGEX consumes (built from escapes, not literals).
  const FRAME = new RegExp('^\\u001Bl\\u0001([\\u0001\\u0002])([\\x20-\\x7E]{20})$');

  it('emits ESC l frames with exactly 20 printable chars', () => {
    for (const frame of [
      enc.poleItem('COKE 20OZ', 219),
      enc.poleTotal(1129),
      enc.poleTender('CASH', 2000),
      enc.poleChange(815),
    ]) {
      expect(frame, `bad pole frame: ${JSON.stringify(frame)}`).toMatch(FRAME);
    }
  });

  it('formats the running total like the legacy pole ("     TOTAL     11.29")', () => {
    const m = FRAME.exec(enc.poleTotal(1129))!;
    expect(m[2]).toBe('     TOTAL     11.29');
  });

  it('keeps # out of pole item mirrors (would decode as a prepay-fuel line)', () => {
    const m = FRAME.exec(enc.poleItem('ITEM #4', 100))!;
    expect(m[2]).not.toContain('#');
  });
});

describe('TopazEncoder scanner feed', () => {
  it('emits one CRLF-terminated barcode per scan', () => {
    expect(enc.scan('049000000443')).toBe('049000000443\r\n');
  });

  it('strips whitespace from the barcode', () => {
    expect(enc.scan(' 049000000443 ')).toBe('049000000443\r\n');
  });
});
