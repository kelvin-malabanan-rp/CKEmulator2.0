# CKEmulator 2.0

A standalone **Electron + React + TypeScript** desktop app that simulates POS
registers (Canada **and** US) and emits the exact wire stream **CK Player
2.0**'s register plugins consume. Use it to drive and test the player without
physical POS hardware. (Formerly the *Canada POS Emulator* — it now covers more
than Canada.)

Supports four register types:

- **Radiant6 Canada** — Virtual Journal (`EventId=…`) **+** Pole Display.
- **Radiant6 US** — same VJ/pole ports as Canada (5438/5439), but the VJ is
  authoritative: it additionally emits `1005` subtotal + `1020` tax after every
  item mutation and stamps `SubtotalAmount`/`TaxAmount`/`TotalAmount` on the
  `1002` basket end. No Arrondir — cash totals are exact. en-US only (the FR
  toggle is hidden). Legacy US loyalty cards use the `D7826`/`D8018`/`8018`
  prefixes for the `1024` flow; the emulator sends whatever card you configure.
- **Bulloch** — **pole-display only** (`[C000]/[C110]/[C120]/[C121]/[C200]`); no
  virtual journal, mirroring the real Bulloch lane.
- **Verifone Topaz** — US, **plaintext** VJ (no `EventId=` protocol) **+** pole
  display **+** a separate barcode-scanner feed. VJ-authoritative, cents-exact,
  en-US only.

It replaces the empty `Radiant6CanadaRegisterEmulator` / `BullochRegisterEmulator`
stubs in the legacy `liftck_player` emulator module.

## What it emits

**Radiant6 Canada** (`radiant6-canada` register type)
- **Virtual Journal** (TCP, default `127.0.0.1:5438`): 1001 register open,
  1009 basket start, 1011 item add, 1012 void, 1013 price override, 1014 qty
  change, 1007 tender, 1008 change, 1022 **Arrondir** rounding, 1024
  **EasyPay/loyalty**, 1002 basket end.
- **Pole Display** (TCP, default `127.0.0.1:5439`): 20-char balance / change /
  item windows, **en-CA and fr-CA**.

**Radiant6 US** (`radiant6-us` register type)
- Same VJ + pole streams and ports as Canada, plus the VJ-authoritative totals:
  `1020` running tax then `1005` running subtotal (legacy order) after every
  item add/void/qty/price change, and `SubtotalAmount`/`TaxAmount`/`TotalAmount`
  on the `1002` basket end. No `1022` Arrondir — cash tenders use exact totals.
  Locale is fixed to en-US.

**Bulloch** (`bulloch` register type)
- **Pole Display only** (TCP, default `127.0.0.1:5440`): `[C000] NEWSALE LANG=…`,
  `[C110] <barcode> <desc> QT= PR= AMT= STTL= DSC= TAX= TOTAL=`, `[C120] Undo
  Item`, `[C121] CLEAR SALE`, `[C200] Sale TRANS= TOTAL= CHNG= TAX=`. **No VJ
  socket is opened** for Bulloch (items are pole-authoritative).

**Verifone Topaz** (`verifone-topaz` register type)
- **Virtual Journal** (TCP, default `127.0.0.1:5441`): plaintext lines framed
  `MM/dd/yy HH:mm:ss <registerId> <payload>` — item add/void, `Sub Total`,
  `Tax`, `Total`, `CASH` tender, `LOYALTY <digits>`, `VOID TICKET`,
  `TRANSACTION SUSPENDED`, `CSH:` cashier, `ST#…TRAN#` basket end. The VJ is
  authoritative; money is dollars on the wire; no cash rounding.
- **Pole Display** (TCP, default `127.0.0.1:5442`): `ESC l \x01 \x01|\x02` +
  20-char frames — `TOTAL`, `CASH` tender, `CHANGE`, item mirrors.
- **Barcode scanner** (TCP, default `127.0.0.1:5443`): one CRLF-terminated
  barcode per scan, echoed before each coded item add (`register.confirmScans`
  flow).
- In prod all three Topaz feeds are **serial COM ports** (scanner COM1, pole
  COM2, VJ COM3 — LIFT-2669); ports 5441-5443 are this emulator's TCP
  convention. Point the player at them with `virtualjournal.ioParams=TCP:5441`,
  `poledisplay.ioParams=TCP:5442`, `scanner.ioParams=TCP:5443` (CKP2.0's
  `IODeviceFactory` accepts `TCP:<port>` and listens).

Canada rules honoured: tax/balance are **pole-authoritative** (the Radiant6
Canada VJ never emits `1005`/`1020`); cash rounds to the nearest 5¢ and emits
`Arrondir`; fr-CA balance uses the legacy `dû` → `U+FFFD` → space substitution.

## Run

```bash
npm install
npm run dev      # launch the emulator (Electron) — renderer dev server on :5273
npm test         # unit + round-trip tests
npm run build    # typecheck + production build
```

> Launch order doesn't matter: the emulator's Vite dev server runs on **5273**
> (distinct from CK Player 2.0's `5173`), so starting it first no longer blanks
> the player. See *Tips*.

## Bundled, self-contained fixtures

No external `liftck_player` checkout is required — the emulator ships its own:

- `resources/quickkey/usualsuspects.qk` — quick keys (legacy `usualsuspects`
  format), loaded automatically on startup.
- `resources/pricebook/sample.xml` — an OCT2000 sample pricebook (auto-loaded),
  so item descriptions/prices and quick-key colouring work out of the box.

## Register & connect (auto-detected backend)

1. Pick the **register type** in the top bar (`Radiant6 Canada`, `Radiant6 US`
   or `Bulloch`) — this sets the VJ/pole ports.
2. Paste your **player.key** in the creds bar and click **Register**. GlobalInit
   probes the datacenters, and the matching one (e2e / dev / prod) resolves the
   **player code + backend automatically** — you don't enter a backend URL.
3. Click **Connect** (status dots turn green).

## UI

- **Quick Keys** — fixed 3×3 paginated grid from the bundled `.qk`. Tapping fires
  an item; keys turn green when their UPC is an ad trigger.
- **Triggers & Completers** — loads the **live ads manifest** for the player and
  background-prefetches each ad's triggers/completers. Per ad: a 🟢/grey dot
  (has completers?), the **template name** with a blue accent for interactive
  (microsite/figs) templates, and **Triggers** / **Completers** buttons. Clicking
  a trigger scans it (with its real description) then opens the ad's completers;
  selecting a completer scans it. The modal auto-closes when CK Player 2.0 acts
  on the offer (completer inject) or the transaction ends.
- **Scenarios** — one button per canned end-to-end flow for the current register
  type, with a live step ticker while a run is active and a
  **PASS/FAIL/CANCELLED** verdict afterwards. A params row sets the loyalty card
  and the gap between steps (both persisted). Silent-capable ads (ads with an
  `injectItem`/`addDiscount` completer) also get a per-ad **Silent ▶** button in
  Triggers & Completers; its progress and outcome surface in the Scenarios
  panel. The headline scenario is the **silent loyalty discount injection**:
  scan a trigger, send the `1024` loyalty sign-in, the player confirms the
  member, then the run waits for the player's EventId `2001` completer inject
  (15 s timeout) before tendering.
- **Transaction** — the running basket + tender (Cash exact / Next $ / +$5 /
  Void).
- **Wire Log** — everything sent on the VJ/pole channels.

## Verify against CK Player 2.0

1. Configure the CK Player 2.0 Canada register in `system.properties`:
   - **Radiant6 Canada:** `virtualjournal.ioParams=TCP:5438`,
     `poledisp.className=plugins/radiant6-canada/Radiant6CanadaPoleDisplay`,
     `poledisp.ioParams=TCP:5439`.
   - **Bulloch:** `register.className=plugins/bulloch/BullochRegister`,
     `register.realTimeInputs=poledisp`,
     `poledisp.className=plugins/bulloch/BullochPoleDisplay`,
     `poledisp.ioParams=TCP:5440`.
   - **Radiant6 US:** CK Player 2.0 has no US Radiant6 plugin yet — the
     `radiant6-us` mode emits the legacy US wire stream (VJ-authoritative
     totals) so the emulator is ready for that plugin and can be used to
     develop it.
2. Start CK Player 2.0 (it listens on those ports), then the emulator → Connect.
3. Tap quick keys / scan / tender. The matching register type's items appear in
   the player's basket and shopper receipt.

> The `parser-roundtrip` test imports CK Player 2.0's **real** Radiant6 Canada
> parsers from the sibling repo and asserts the emulator's output decodes to the
> expected `RegisterEvent`s — automated proof of compatibility.

## Tips

- **Launch order is free.** The emulator's renderer dev server is pinned to
  **5273** (`electron.vite.config.ts`), separate from CK Player 2.0's `5173`
  (which CKP2 requires via `strictPort`). Previously both defaulted to `5173`, so
  starting the emulator first stole the port and CK Player 2.0 rendered a
  **blank/white screen** — that's fixed; start them in any order.
- **Bulloch** connects pole-only — the VJ socket is intentionally never opened,
  so there's no `5438` reconnect spam in that mode.
- The completer modal **auto-closes** when CK Player 2.0 acts on the offer (a
  completer inject over the VJ reverse channel) or the transaction ends.

## Architecture

- `electron/` (main) — `PosTransport`: TCP client socket(s) + auto-reconnect;
  pole-only for Bulloch. IPC for pricebook / quick-keys / ads-manifest fetch and
  GlobalInit registration.
- `src/core/` — pure, browser-safe, unit-tested: `currency`, `Basket`,
  `Radiant6CanadaEncoder`, `BullochEncoder`, `RegisterSession` (routes by
  register type), `quickkeys`, `pricebook`, `adTriggers`, `globalInit`,
  `posTypes`, `scenarios`, `scenarioRunner`.
- `src/renderer/` — React UI (`useEmulator` hook over `RegisterSession`).
- `src/preload/` — typed `window.emulator` bridge.

Plans and designs: `docs/plans/`.
