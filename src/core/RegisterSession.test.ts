import { describe, it, expect } from 'vitest';
import { RegisterSession, type WireMessage } from './RegisterSession';

function eventIds(messages: WireMessage[]): string[] {
  return messages
    .filter((m) => m.channel === 'vj')
    .map((m) => m.data.match(/EventId=(\d+)/)?.[1] ?? '')
    .filter(Boolean);
}

describe('RegisterSession', () => {
  it('opens the lane once: registerOpen + basketStarted + pole balance', () => {
    const s = new RegisterSession();
    const msgs = s.open();
    expect(eventIds(msgs)).toEqual(['1001', '1009']);
    expect(msgs.some((m) => m.channel === 'pole')).toBe(true);
    // Idempotent — opening again emits nothing.
    expect(s.open()).toEqual([]);
  });

  it('auto-opens on first addItem and emits item add + pole windows', () => {
    const s = new RegisterSession();
    const msgs = s.addItem({ code: '049000000443', description: 'Coke', priceCents: 169 });
    expect(eventIds(msgs)).toEqual(['1001', '1009', '1011']);
    const snap = s.snapshot();
    expect(snap.lines).toHaveLength(1);
    expect(snap.subtotalCents).toBe(169);
  });

  it('void / qty / price emit their VJ events and a refreshed balance', () => {
    const s = new RegisterSession();
    s.addItem({ code: 'a', description: 'A', priceCents: 100 });
    expect(eventIds(s.setQuantity(1, 3))).toContain('1014');
    expect(s.snapshot().subtotalCents).toBe(300);
    expect(eventIds(s.setPrice(1, 50))).toContain('1013');
    expect(s.snapshot().subtotalCents).toBe(150);
    expect(eventIds(s.voidLine(1))).toContain('1012');
    expect(s.snapshot().subtotalCents).toBe(0);
  });

  it('addItem with quantity encodes Quantity (drives nthItemScanned / basket ad triggers)', () => {
    const s = new RegisterSession();
    const msgs = s.addItem({ code: '628700001111', description: 'Combo', priceCents: 100, quantity: 2 });
    const itemAdd = msgs.find((m) => m.data.includes('EventId=1011'))!;
    expect(itemAdd.data).toContain('Barcode=628700001111');
    expect(itemAdd.data).toContain('Quantity=2.000');
    expect(s.snapshot().lines[0].quantity).toBe(2);
  });

  it('loyalty emits EventId 1024 with the card number', () => {
    const s = new RegisterSession();
    const msgs = s.loyalty('8018782603800034999992');
    expect(msgs.find((m) => m.data.includes('EventId=1024'))?.data).toContain('DiscountCardNumber=8018782603800034999992');
  });

  it('loyalty-first opens the lane on the wire (1001 + 1009 precede 1024)', () => {
    const s = new RegisterSession();
    const msgs = s.loyalty('8018782603800034999992');
    const ids = msgs.filter((m) => m.channel === 'vj').map((m) => /EventId=(\d+)/.exec(m.data)![1]);
    expect(ids).toEqual(['1001', '1009', '1024']);
    // A later add must not re-open the lane.
    const addIds = s.addItem({ code: 'a', description: 'A', priceCents: 100 })
      .filter((m) => m.channel === 'vj')
      .map((m) => /EventId=(\d+)/.exec(m.data)![1]);
    expect(addIds).toEqual(['1011']);
  });

  it('cash-exact tender emits Arrondir rounding, tender, change, basketEnd and resets', () => {
    const s = new RegisterSession({ taxRateBps: 500 });
    s.addItem({ code: 'a', description: 'A', priceCents: 169 }); // total 177 → rounds to 175
    const msgs = s.tender('cash-exact');
    expect(eventIds(msgs)).toEqual(expect.arrayContaining(['1022', '1007', '1008', '1002']));
    expect(msgs.find((m) => m.data.includes('EventId=1022'))?.data).toContain('Description=Arrondir');
    // Resets: tx advanced, basket cleared.
    const snap = s.snapshot();
    expect(snap.tx).toBe(2);
    expect(snap.lines).toHaveLength(0);
    expect(snap.started).toBe(false);
  });

  it('voidTicket emits a cancelled basketEnd (1002), clears pole and resets', () => {
    const s = new RegisterSession();
    s.addItem({ code: 'a', description: 'A', priceCents: 169 });
    const msgs = s.voidTicket();
    const end = msgs.find((m) => m.data.includes('EventId=1002'))!;
    expect(end.data).toContain('TransactionCompletionType=Cancelled');
    const snap = s.snapshot();
    expect(snap.tx).toBe(2);
    expect(snap.lines).toHaveLength(0);
    expect(snap.started).toBe(false);
  });

  it('no rounding event when the total is already a multiple of 5 cents', () => {
    const s = new RegisterSession({ taxRateBps: 0 });
    s.addItem({ code: 'a', description: 'A', priceCents: 200 });
    expect(eventIds(s.tender('cash-exact'))).not.toContain('1022');
  });

  it('fr locale produces fr pole windows', () => {
    const s = new RegisterSession();
    s.setLocale('fr');
    const msgs = s.addItem({ code: 'a', description: 'Cafe', priceCents: 194 });
    const poleBalance = msgs.filter((m) => m.channel === 'pole').pop()!;
    expect(poleBalance.data.replace(/�/g, ' ')).toMatch(/Solde d.:/);
  });
});

describe('RegisterSession — suspend/resume', () => {
  it('emits 1003 then 1004 keeping the basket intact (radiant6)', () => {
    const s = new RegisterSession();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    const sus = s.suspend();
    expect(sus).toHaveLength(1);
    expect(sus[0].data).toContain('EventId=1003');
    const res = s.resume();
    expect(res[0].data).toContain('EventId=1004');
    expect(s.snapshot().lines).toHaveLength(1); // basket kept
  });

  it('resume re-emits the pole balance and echoes the stored transaction', () => {
    const s = new RegisterSession();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    s.suspend();
    const res = s.resume();
    expect(res[0].data).toContain('StoredTransactionNumber=1');
    expect(res.some((m) => m.channel === 'pole')).toBe(true);
  });

  it('suspend before any activity emits nothing', () => {
    expect(new RegisterSession().suspend()).toEqual([]);
  });

  it('resume without a prior suspend emits nothing', () => {
    const s = new RegisterSession();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    expect(s.resume()).toEqual([]);
  });

  it('double-suspend emits nothing the second time', () => {
    const s = new RegisterSession();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    expect(s.suspend()).toHaveLength(1);
    expect(s.suspend()).toEqual([]);
  });

  it('voidTicket clears a pending suspend so resume emits nothing', () => {
    const s = new RegisterSession();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    s.suspend();
    s.voidTicket();
    expect(s.resume()).toEqual([]);
  });

  it('is a no-op for bulloch', () => {
    const s = new RegisterSession({ registerType: 'bulloch' });
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    expect(s.suspend()).toEqual([]);
    expect(s.resume()).toEqual([]);
  });
});

describe('RegisterSession — radiant6-us', () => {
  const us = (): RegisterSession => new RegisterSession({ registerType: 'radiant6-us' });

  it('emits 1020 then 1005 after each item mutation', () => {
    const msgs = us().addItem({ code: '1', description: 'A', priceCents: 202 });
    expect(eventIds(msgs)).toEqual(['1001', '1009', '1011', '1020', '1005']);
  });

  it('voidLine / setQuantity / setPrice each append 1020 then 1005', () => {
    const s = us();
    s.addItem({ code: '1', description: 'A', priceCents: 202 });
    s.addItem({ code: '2', description: 'B', priceCents: 100 });
    const mutations: Array<[string, () => WireMessage[]]> = [
      ['1014', () => s.setQuantity(1, 3)],
      ['1013', () => s.setPrice(1, 150)],
      ['1012', () => s.voidLine(1)],
    ];
    for (const [id, run] of mutations) {
      expect(eventIds(run())).toEqual([id, '1020', '1005']);
    }
  });

  it('does not emit Arrondir and tenders the exact total', () => {
    const s = us();
    s.addItem({ code: '1', description: 'A', priceCents: 202 }); // tax 10 → total 212 (no nickel rounding)
    const msgs = s.tender('cash-exact');
    expect(msgs.some((m) => m.data.includes('Description=Arrondir'))).toBe(false);
    expect(eventIds(msgs)).not.toContain('1022');
    const tender = msgs.find((m) => m.data.includes('EventId=1007'))!;
    expect(tender.data).toContain('Amount=2.12');
  });

  it('next-dollar change math uses the exact total (no nickel rounding)', () => {
    const s = us();
    s.addItem({ code: '1', description: 'A', priceCents: 202 }); // total 212 → tender 300 → change 88
    const msgs = s.tender('next-dollar');
    expect(msgs.find((m) => m.data.includes('EventId=1007'))?.data).toContain('Amount=3.00');
    expect(msgs.find((m) => m.data.includes('EventId=1008'))?.data).toContain('Amount=0.88');
  });

  it('basket end carries totals in US mode', () => {
    const s = us();
    s.addItem({ code: '1', description: 'A', priceCents: 202 });
    const end = s.tender('cash-exact').find((m) => m.data.includes('EventId=1002'))!;
    expect(end.data).toContain('SubtotalAmount=2.02');
    expect(end.data).toContain('TaxAmount=0.10');
    expect(end.data).toContain('TotalAmount=2.12');
  });

  it('voidTicket carries totals on the cancelled basket end', () => {
    const s = us();
    s.addItem({ code: '1', description: 'A', priceCents: 202 });
    const end = s.voidTicket().find((m) => m.data.includes('EventId=1002'))!;
    expect(end.data).toContain('TransactionCompletionType=Cancelled');
    expect(end.data).toContain('SubtotalAmount=2.02');
    expect(end.data).toContain('TaxAmount=0.10');
    expect(end.data).toContain('TotalAmount=2.12');
  });

  it('suspend/resume still works (inherits the radiant6 path)', () => {
    const s = us();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    const sus = s.suspend();
    expect(sus[0].data).toContain('EventId=1003');
    const res = s.resume();
    expect(res[0].data).toContain('EventId=1004');
    expect(s.snapshot().lines).toHaveLength(1);
  });

  it('ignores setLocale(fr) — locale stays en', () => {
    const s = us();
    s.setLocale('fr');
    expect(s.locale).toBe('en');
    const msgs = s.addItem({ code: '1', description: 'A', priceCents: 194 });
    const poleBalance = msgs.filter((m) => m.channel === 'pole').pop()!;
    expect(poleBalance.data).toContain('Balance Due');
  });

  it('canada emits no 1005/1020 (regression)', () => {
    const msgs = new RegisterSession().addItem({ code: '1', description: 'A', priceCents: 202 });
    expect(msgs.some((m) => /EventId=10(05|20)/.test(m.data))).toBe(false);
  });

  it('canada basket end carries no totals (regression)', () => {
    const s = new RegisterSession();
    s.addItem({ code: '1', description: 'A', priceCents: 202 });
    const end = s.tender('cash-exact').find((m) => m.data.includes('EventId=1002'))!;
    expect(end.data).not.toContain('SubtotalAmount=');
    expect(end.data).not.toContain('TaxAmount=');
    expect(end.data).not.toContain('TotalAmount=');
  });
});

describe('RegisterSession — reset for next sale', () => {
  it('suspend → tender → resume returns [] (tender clears the suspended flag)', () => {
    const s = new RegisterSession();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    s.suspend();
    s.tender('cash-exact');
    expect(s.resume()).toEqual([]);
  });
});

function poleDatas(messages: WireMessage[]): string[] {
  return messages.filter((m) => m.channel === 'pole').map((m) => m.data);
}

describe('RegisterSession — Bulloch (pole-only)', () => {
  const bulloch = (): RegisterSession => new RegisterSession({ registerType: 'bulloch', taxRateBps: 0 });

  it('never emits virtual-journal messages', () => {
    const s = bulloch();
    const all = [...s.addItem({ code: '1', description: 'A', priceCents: 100 }), ...s.tender('cash-exact')];
    expect(all.some((m) => m.channel === 'vj')).toBe(false);
  });

  it('opens with [C000] NEWSALE LANG=EN and no VJ', () => {
    const s = bulloch();
    expect(poleDatas(s.open())).toEqual(['[C000] NEWSALE LANG=EN\n']);
  });

  it('uses LANG=FR when the locale is fr', () => {
    const s = bulloch();
    s.setLocale('fr');
    expect(poleDatas(s.open())[0]).toBe('[C000] NEWSALE LANG=FR\n');
  });

  it('auto-opens then emits a [C110] item line with embedded running totals', () => {
    const s = bulloch();
    const datas = poleDatas(s.addItem({ code: '0000000002125', description: 'FROSTER SWIRL 350M', priceCents: 219 }));
    expect(datas[0]).toBe('[C000] NEWSALE LANG=EN\n');
    expect(datas[1]).toBe(
      '[C110] 0000000002125 FROSTER SWIRL 350M QT=1 PR=2.19 AMT=2.19 STTL=2.19 DSC=0.00 TAX=0.00 TOTAL=2.19\n',
    );
  });

  it('voidLine emits [C120] Undo Item with the line description', () => {
    const s = bulloch();
    s.addItem({ code: '1', description: 'HD CHEESE STICKS H', priceCents: 169 });
    const datas = poleDatas(s.voidLine(1));
    expect(datas[0]).toBe('[C120] Undo Item  HD CHEESE STICKS H STTL=0.00 DSC=0.00 TAX=0.00 TOTAL=0.00\n');
  });

  it('setQuantity emits a void then a re-add (legacy void+re-add parity)', () => {
    const s = bulloch();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    const datas = poleDatas(s.setQuantity(1, 3));
    expect(datas[0].startsWith('[C120] Undo Item  A ')).toBe(true);
    expect(datas[1]).toBe('[C110] 1 A QT=3 PR=1.00 AMT=3.00 STTL=3.00 DSC=0.00 TAX=0.00 TOTAL=3.00\n');
  });

  it('setPrice emits a void then a re-add at the new price', () => {
    const s = bulloch();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    const datas = poleDatas(s.setPrice(1, 250));
    expect(datas[0].startsWith('[C120] Undo Item  A ')).toBe(true);
    expect(datas[1]).toBe('[C110] 1 A QT=1 PR=2.50 AMT=2.50 STTL=2.50 DSC=0.00 TAX=0.00 TOTAL=2.50\n');
  });

  it('loyalty is a no-op for Bulloch (no VJ 1024 path)', () => {
    const s = bulloch();
    expect(s.loyalty('8018782603800034999992')).toEqual([]);
  });

  it('voidTicket emits [C121] CLEAR SALE and resets', () => {
    const s = bulloch();
    s.addItem({ code: '1', description: 'A', priceCents: 100 });
    expect(poleDatas(s.voidTicket())).toContain('[C121] CLEAR SALE\n');
    const snap = s.snapshot();
    expect(snap.tx).toBe(2);
    expect(snap.lines).toHaveLength(0);
    expect(snap.started).toBe(false);
  });

  it('tender emits [C200] Sale with TRANS/TOTAL/CHNG/TAX and resets', () => {
    const s = bulloch();
    s.addItem({ code: '1', description: 'A', priceCents: 200 });
    const datas = poleDatas(s.tender('amount', 500));
    expect(datas).toContain('[C200] Sale TRANS=000001 TOTAL=2.00 CHNG=3.00 TAX=0.00\n');
    expect(s.snapshot().tx).toBe(2);
  });

  it('change math keeps CAD nickel rounding on non-nickel totals (regression)', () => {
    // 202¢ @ 5% → tax 10 → exact total 212 → cash-rounds to 210; next-dollar
    // tenders 300 so change is 90. TOTAL stays the exact 2.12.
    const s = new RegisterSession({ registerType: 'bulloch', taxRateBps: 500 });
    s.addItem({ code: '1', description: 'A', priceCents: 202 });
    const datas = poleDatas(s.tender('next-dollar'));
    expect(datas).toContain('[C200] Sale TRANS=000001 TOTAL=2.12 CHNG=0.90 TAX=0.10\n');
  });
});

describe('RegisterSession — Verifone Topaz (VJ + pole + scanner)', () => {
  const topaz = (): RegisterSession => new RegisterSession({ registerType: 'verifone-topaz' });

  const vjDatas = (messages: WireMessage[]): string[] =>
    messages.filter((m) => m.channel === 'vj').map((m) => m.data);

  it('speaks plaintext — never the EventId=key,value protocol', () => {
    const s = topaz();
    const msgs = [
      ...s.addItem({ code: '049000000443', description: 'COKE 20OZ', priceCents: 219 }),
      ...s.loyalty('8018000000000000000000'),
      ...s.tender('cash-exact'),
    ];
    for (const m of msgs) expect(m.data).not.toContain('EventId=');
  });

  it('verifone-topaz-lol is byte-identical to verifone-topaz (LoL is Topaz on the VM)', () => {
    const lol = new RegisterSession({ registerType: 'verifone-topaz-lol' });
    const base = topaz();
    const addLol = lol.addItem({ code: '049000000443', description: 'COKE 20OZ', priceCents: 219 });
    const addBase = base.addItem({ code: '049000000443', description: 'COKE 20OZ', priceCents: 219 });
    expect(addLol.map((m) => `${m.channel}:${m.data}`)).toEqual(addBase.map((m) => `${m.channel}:${m.data}`));
    // And it inherits Topaz's en-US-only locale (fr ignored).
    lol.setLocale('fr');
    expect(lol.snapshot().locale).toBe('en');
  });

  it('a prepay-fuel item (# in the description) emits the fuel VJ line with no scanner echo', () => {
    const s = topaz();
    s.open(); // consume the one-time CSH: lane-open line
    const msgs = s.addItem({ code: '', description: 'PREPAY CA #05', priceCents: 3000 });
    expect(msgs.map((m) => m.channel)).toEqual(['vj', 'pole']);
    expect(msgs[0].data).toContain('# 05');
    expect(msgs[0].data).toContain('30.00');
    expect(s.snapshot().subtotalCents).toBe(3000);
    expect(s.snapshot().lines[0].description).toBe('PREPAY CA #05');
  });

  it('addItem emits scanner scan → VJ item line → pole mirror, in that order', () => {
    const s = topaz();
    s.open(); // consume the one-time CSH: lane-open line
    const msgs = s.addItem({ code: '049000000443', description: 'COKE 20OZ', priceCents: 219 });
    expect(msgs.map((m) => m.channel)).toEqual(['scanner', 'vj', 'pole']);
    expect(msgs[0].data).toBe('049000000443\r\n');
    expect(msgs[1].data).toContain('COKE 20OZ');
    expect(s.snapshot().subtotalCents).toBe(219);
  });

  it('skips the scanner echo when the item has no barcode', () => {
    const s = topaz();
    const msgs = s.addItem({ code: '', description: 'MYSTERY', priceCents: 100 });
    expect(msgs.some((m) => m.channel === 'scanner')).toBe(false);
  });

  it('voidLine emits a V-marked negative-price VJ line', () => {
    const s = topaz();
    s.addItem({ code: '1', description: 'COKE 20OZ', priceCents: 219 });
    const datas = vjDatas(s.voidLine(1));
    expect(datas).toHaveLength(1);
    expect(datas[0]).toMatch(/ V .*COKE 20OZ.*-2\.19/);
    expect(s.snapshot().subtotalCents).toBe(0);
  });

  it('setQuantity re-rings the line: void then re-add at the new quantity', () => {
    const s = topaz();
    s.addItem({ code: '1', description: 'COKE 20OZ', priceCents: 219 });
    const datas = vjDatas(s.setQuantity(1, 3));
    expect(datas).toHaveLength(2);
    expect(datas[0]).toContain(' V ');
    expect(datas[1]).toMatch(/COKE 20OZ\s+3\s+2\.19/);
    expect(s.snapshot().subtotalCents).toBe(657);
  });

  it('setPrice re-rings the line: void then re-add at the new price', () => {
    const s = topaz();
    s.addItem({ code: '1', description: 'COKE 20OZ', priceCents: 219 });
    const datas = vjDatas(s.setPrice(1, 199));
    expect(datas).toHaveLength(2);
    expect(datas[0]).toContain(' V ');
    expect(datas[1]).toContain('1.99');
    expect(s.snapshot().subtotalCents).toBe(199);
  });

  it('loyalty emits the plaintext LOYALTY line', () => {
    const s = topaz();
    const datas = vjDatas(s.loyalty('8018000000000000000000'));
    expect(datas.some((d) => d.includes('LOYALTY 8018000000000000000000'))).toBe(true);
  });

  it('cash-exact tender is cents-exact: Sub Total, Tax, Total, CASH, TRAN# — no rounding', () => {
    const s = topaz();
    s.addItem({ code: '1', description: 'A ITEM', priceCents: 202 });
    // 202¢ @ 5% → tax 10 → exact total 212; US Topaz never nickel-rounds.
    const msgs = s.tender('cash-exact');
    const vj = vjDatas(msgs).join('');
    expect(vj).toContain('Sub Total      2.02');
    expect(vj).toContain('Tax      0.10');
    expect(vj).toContain('Total      2.12');
    expect(vj).toContain('CASH      2.12');
    expect(vj).toContain('TRAN# 1');
    expect(vj).not.toContain('Arrondir');
    const poles = msgs.filter((m) => m.channel === 'pole');
    expect(poles.length).toBeGreaterThanOrEqual(3); // total, tender, change
    expect(s.snapshot().tx).toBe(2);
    expect(s.snapshot().lines).toHaveLength(0);
  });

  it('next-dollar change math uses the exact total', () => {
    const s = topaz();
    s.addItem({ code: '1', description: 'A ITEM', priceCents: 202 });
    const msgs = s.tender('next-dollar');
    // exact total 212 → next dollar 300 → change 0.88 (no nickel rounding)
    const change = msgs.find((m) => m.channel === 'pole' && m.data.includes('CHANGE'));
    expect(change).toBeDefined();
    expect(change!.data).toContain('0.88');
  });

  it('voidTicket emits VOID TICKET and resets for the next sale', () => {
    const s = topaz();
    s.addItem({ code: '1', description: 'A ITEM', priceCents: 100 });
    const datas = vjDatas(s.voidTicket());
    expect(datas.some((d) => d.includes('VOID TICKET'))).toBe(true);
    const snap = s.snapshot();
    expect(snap.tx).toBe(2);
    expect(snap.lines).toHaveLength(0);
    expect(snap.started).toBe(false);
  });

  it('suspend emits TRANSACTION SUSPENDED; resume emits no VJ line', () => {
    const s = topaz();
    s.addItem({ code: '1', description: 'A ITEM', priceCents: 100 });
    const suspendDatas = vjDatas(s.suspend());
    expect(suspendDatas.some((d) => d.includes('TRANSACTION SUSPENDED'))).toBe(true);
    const resume = s.resume();
    expect(vjDatas(resume)).toEqual([]);
    expect(s.snapshot().lines).toHaveLength(1);
  });

  it('ignores setLocale(fr) — Topaz lanes are en-US only', () => {
    const s = topaz();
    s.setLocale('fr');
    expect(s.snapshot().locale).toBe('en');
  });
});
