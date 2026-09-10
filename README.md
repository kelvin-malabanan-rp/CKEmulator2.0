# CKEmulator 2.0

A standalone **Electron + React + TypeScript** desktop app that simulates POS
registers (Canada **and** US) and emits the exact wire stream **CK Player
2.0**'s register plugins consume. Use it to drive and test the player without
physical POS hardware. (Formerly the *Canada POS Emulator* — it now covers more
than Canada.)

Supports five register families:

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
- **Octane** — EU (Ireland, Norway, Sweden, Denmark, Latvia). A **JSON journal
  over HTTP**, not a socket: the emulator POSTs one document per event to the
  player and RUNS its own HTTP server for the player's completer injects. No
  pole display. Amounts follow the tenant's decimal dialect.

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
- **Virtual Journal** (TCP, default `127.0.0.1:10002`): plaintext lines framed
  `MM/dd/yy HH:mm:ss <registerId> <payload>` — item add/void, `Sub Total`,
  `Tax`, `Total`, `CASH` tender, `LOYALTY <digits>`, `VOID TICKET`,
  `TRANSACTION SUSPENDED`, `CSH:` cashier, `ST#…TRAN#` basket end. The VJ is
  authoritative; money is dollars on the wire; no cash rounding.
- **Pole Display** (TCP, default `127.0.0.1:10001`): `ESC l \x01 \x01|\x02` +
  20-char frames — `TOTAL`, `CASH` tender, `CHANGE`, item mirrors.
- **Barcode scanner** (TCP, default `127.0.0.1:10000`): one CRLF-terminated
  barcode per scan, echoed before each coded item add (`register.confirmScans`
  flow).
- In prod all three Topaz feeds are **serial COM ports** (scanner COM1, pole
  COM2, VJ COM3 — LIFT-2669); the TCP ports follow the **legacy dev
  convention** (liftck_player `system.properties`, release/8.2.8.0): scanner
  `10000`, pole `10001`, VJ `10002`. Point the player at them with
  `scanner.ioParams=TCP:10000`, `poledisplay.ioParams=TCP:10001`,
  `virtualjournal.ioParams=TCP:10002` (CKP2.0's `IODeviceFactory` accepts
  `TCP:<port>` and listens) — CKP2.0's `system.properties` Topaz block
  already ships these values.

**Octane** (`octane` register type)
- **Virtual Journal** (HTTP client, default `POST http://127.0.0.1:8023/add_salesline`):
  one JSON document per event, CRLF-terminated, `Content-Type: application/json`.
  `lineId` is the event discriminator — `6` basket start, `1` item add/void
  (`itemMask:["ABORT"]`), `2` fuel add/void, `3` discount, `5` basket total,
  `55` tender, `60` change, `379` tax in basket, `33` stored (suspended)
  transaction, `27` void transaction, `7` end of transaction.
- **Scan server** (HTTP **server**, default `:8020/function`): the emulator
  listens here for the player's completer injects
  (`{"function":{"sale":{"articleNo":"…","quantity":N}}}`) and answers `200`.
  This is the one register type whose scanner port is **inbound** — the player
  discovers the address from the journal POSTs it receives
  (`scanner.octanePosHost`) and dials it.
- **No pole display.** CK Player 2.0's octane plugin has no pole module, so no
  pole channel is ever opened and the status panel lists only VJ + Scan-in.
- Item lines carry the **extended** amount (`total` = unit × `qty`); CKP2.0
  divides it back out to recover the unit price.
- Tenders send **exact** amounts plus `tenderType:"0"`. Octane rounding lives on
  the player (`receiptRound5Cents`, and the whole-rounded Nordic tenants), and
  it only applies that to a cash tender — the legacy emulator omitted
  `tenderType` entirely, so its cash tenders never rounded.
- **Price locale** is the tenant decimal dialect and **must match the player's
  `virtualjournal.priceLocale`** — `ie`/`en` use `1.50`; `no`/`sv`/`da`/`lv`/`pl`
  use `1,50`. A mismatch silently scales every amount by 100.
  It is **derived from the registered tenant** (the leading segment of the
  player code: `pl-79989-1` → `pl` → `1,50`) and is not configurable — a manual
  setting could only ever disagree with the player it points at. Tenant and
  locale codes differ for two markets: Sweden is tenant `se` / locale `sv`,
  Denmark is `dk` / `da`.
- ⚠ **Poland is a known conflict between the two players.** CK Player 2.0 treats
  `pl` as comma-decimal (`CurrencyManipulator.ts`, locked by its
  `__tests__/CurrencyManipulator.test.ts`); the legacy Java player treats it as
  dot-decimal (`CurrencyManipulator.java` takes the comma path only for fr/no +
  ee/lv/lt/da). The emulator emits **comma** because it drives CK Player 2.0 —
  against the legacy player a Polish amount will be 100× off, so switch the
  picker to a dot dialect if you point it there.
  Point the player at the emulator with:
  ```properties
  register.className=plugins/octane/OctaneRegister
  virtualjournal.className=plugins/octane/OctaneVirtualJournal
  virtualjournal.octaneServletPort=8023
  virtualjournal.octaneServletPath=/add_salesline
  virtualjournal.priceLocale=ie
  scanner.className=plugins/octane/OctaneScanner
  scanner.octanePosUrl=http://127.0.0.1:8020/function
  ```

## Currency in the emulator's own UI

Basket totals, quick-key prices and log lines render in the **registered
tenant's** currency — `pl-79989-1` shows `2,10 zł`, a CA player `$2.10`, an
Irish one `€2.10` (and `94c` below a euro). There is nothing to configure: the
tenant comes from the player code, so registering is all it takes.

Both maps are ported verbatim from CK Player 2.0 so the two render money
identically side by side — `TenantUtils.getDefaultLocale` (tenant → locale) and
`RegionalCurrencyFormatter.LOCALE_FORMAT_MAP` (locale → symbol, placement,
separators). `src/core/tenantCurrency.ts` also carries CKP2.0's
`Currency.ts` `CURRENCY_SYMBOLS` table, and `currencySymbolsAgree()` asserts the
two stay in step. They differ on exactly one entry: **CAD is `CA$` in
`CURRENCY_SYMBOLS` and `$` in the `en-CA`/`fr-CA` locale configs.** The locale
configs win, because `$` is what a Canadian lane renders and what the CA
pole/VJ wire carries; `CA$` is the disambiguating form CKP2.0 uses in microsite
price bubbles.

This is **display only** — the wire is untouched. Radiant6/pole strings stay in
`currency.ts` (CAD-only, byte-exact for the CA parsers) and Octane amounts go
out as bare locale-formatted numbers with no symbol at all.

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

1. Pick the **register type** in the Config tab (`Radiant6 Canada`,
   `Radiant6 US`, `Bulloch`, `Verifone Topaz`, `Octane`, or a LOA mode) — this
   sets the ports. Octane also gets a **Price locale** picker.
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
- **Wire Log** — everything sent on the VJ/pole channels (for Octane, the JSON
  journal documents as they are POSTed).

## Verifying an Octane run from the logs

Octane's traffic is HTTP in both directions, so the emulator's console is the
fastest proof it is wired up. Run the emulator from a terminal and filter:

```bash
npm run dev 2>&1 | grep -E '\[OctaneTransport\] (vj|scan)'
```

| Pattern | Confirms | If absent |
| --- | --- | --- |
| `\[OctaneTransport\] vj: connected` | the player's `/add_salesline` servlet answered — port and host are right | the player isn't up, or `virtualjournal.octaneServletPort` differs from the emulator's VJ port |
| `→ vj \(HTTP 200\)` | the player accepted a journal document | a `✗ vj POST failed` line names the transport error; `⏸ vj not reachable` means it was queued, not lost |
| `scan server listening on :8020/function` | the emulator is ready to receive injects | usually `EADDRINUSE` — a legacy emulator or a stale run still holds 8020 |
| `← scan inject: <upc> ×<n>` | the player pushed a completer and the emulator rang it up | the player never resolved `scanner.octanePosHost`, i.e. no journal document reached it yet |

To confirm a full sale reached the player, filter its lineIds in order:

```bash
npm run dev 2>&1 | grep -oE '"lineId":"(6|1|2|5|55|60|379|27|33|7)"'
```

A completed cash sale reads `6 … 1 … 5 55 60 379 7`; a voided ticket reads
`6 … 27 7`. A missing trailing `7` means the player never closed the basket.

## LOA mode (postMessage, no TCP)

The two **LOA** register types drive a real player embedded as a cross-origin
iframe over `window.postMessage` — the transport a Mashgin kiosk uses — instead of
a TCP socket. Both ports are `0`; there is no VJ and no pole display. The emulator
sends a **full NGRP order document** on every basket change (declarative state
sync), not incremental POS events.

- **LOA Legacy** (`loa-player`) — the deployed legacy loa-player, e2e.
- **CKP2.0 LOA Mode** (`ckp2-loa`) — CK Player 2.0's own Mashgin mode, local.

Start CK Player 2.0 with **`npm run dev:web` only** (plain vite, port pinned to
5173). Mashgin mode never needs CK Player 2.0's own Electron shell, and
`npm run dev` just gets in the way.

### The standalone boot contract

CK Player 2.0's Mashgin mode is opt-in and entirely URL-driven. Three parts of the
entry URL are load-bearing — miss any one and the player boots looking perfectly
healthy while the integration is silently inert:

| Part | Why |
|---|---|
| `shopper.html` | The shopper display entry — the surface Mashgin embeds. |
| `?host=standalone` | Standalone boot is opt-in (LIFT-2826). `maybeInstallElectronShim()` (`installElectronShim.ts:66`) installs the shim only for `host=standalone` in the query, the hash, or `VITE_HOST_MODE`. Without it: no `StandaloneShim`, empty `hwPlatform`, so `isMashginPlatform()` is false and `AppInitService` starts neither `PostMessageBridge` nor `NgrpBasketReceiver`. Nothing listens. |
| `hw` in the **hash** | `main.tsx` reads it from `window.location.hash` only — a `hw` in the query string is ignored and `hwPlatform` falls back to its default. |

`loaEntryUrl()` builds this, so the URL actually loaded is:

```
http://localhost:5173/shopper.html?host=standalone#playerKey=<uuid>&hw=mashgin_11
```

Only the hash is rewritten — a query string on the target survives. A player key is
required: CK Player 2.0's standalone branch is gated on one, so with the field empty
the frame says so rather than booting a player that ignores every document.

### Outbound pacing

Both players **silently drop** NGRP documents that arrive inside a rate-limit
window — CK Player 2.0 at 200ms (`NgrpBasketReceiver.ts`, terminal docs included),
loa-player at 1000ms (`basket.rateLimitingThresholdMs`). The emulator re-sends the
whole document on every basket change, so bursts are easy to produce: a
multi-completer `rp-inject-item` rings up one item per completer back-to-back.
`loaSendQueue` paces outbound docs past each player's threshold, collapsing
consecutive documents for the same open basket (they are full state, so the later
one wins) while never collapsing a terminal doc or a basket boundary.

Wire Log timestamps are enqueue time, not post time.

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
