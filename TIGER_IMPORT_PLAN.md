# Tiger Broker Import Plan

## Goal

Add Tiger Broker CSV import support with the same end-user outcome we already have for MooMoo:

- import `Holdings` from stock trades only
- import `Positions` from options trades only
- support preview, validation, commit, history, and rollback
- feed the same holdings/positions/cash-ledger/reporting models already used by the app

Current scope exclusions for Tiger Phase 1:

- do **not** import deposits, withdrawals, dividends, interest, fund positions, or allowance rows
- do **not** rely on Tiger statement-level cash summaries as source-of-truth ledger imports
- do **not** build unrealized market-price integrations

## Status Guide

| Status | Meaning |
|---|---|
| `Plan` | documented and queued, not started yet |
| `In Progress` | actively being worked |
| `Done` | implemented and validated for the intended phase |

## Phase Tracker

| Phase | Scope | Status |
|---|---|---|
| Phase 0 | Broker-aware import framework | `Done` |
| Phase 1 | Tiger preview parser | `Done` |
| Phase 2 | Tiger row normalization and deduping | `Done` |
| Phase 3 | Holdings import (stocks only) | `Done` |
| Phase 4 | Options position import | `Done` |
| Phase 5 | Roll detection | `In Progress` |
| Phase 6 | Cash ledger policy for Tiger | `Plan` |
| Phase 7 | Import history / rollback | `Plan` |
| Phase 8 | UI / UX changes | `In Progress` |
| Phase 9 | Manual data entry / app behavior review | `Plan` |
| Phase 10 | Reports impact review | `Plan` |

## What We Found In This Tiger CSV

File reviewed:

- `C:\Users\kyawzin.oo\Downloads\TJ Files\Tiger\Statement_50692025_20260201_20260513.csv`

Observed statement structure:

- `Cash Report` section
- `Trades` section for `Option` and `Stock`
- `Holdings` section for current snapshot only
- `Allowance` and `Segment Transfer` sections
- per-symbol `TOTAL` rows and grand total rows

Important Tiger-specific quirks:

1. Trade timestamps are quoted and span multiple lines.
- Example:
  - `"2026-02-04`
  - `15:41:31, US/Eastern"`
- Parser must support embedded newlines inside quoted CSV fields.

2. Many trade rows appear twice.
- First row has populated symbol / description.
- Second row is nearly identical but symbol cell is blank.
- This looks like Tiger exporting a duplicate companion row, not a second real fill.

3. Tiger does **not** give MooMoo-style spread summary rows for the options examples reviewed.
- Instead, we get individual option leg rows.
- So spread / iron condor / roll detection must be inferred from grouped leg activity.

4. `Trades ... TOTAL` rows are statement summaries, not transactional rows.
- Must always skip them.

5. `Holdings` section looks like an end-of-period snapshot only.
- Useful for later reconciliation checks.
- Not suitable as the primary source for holdings event history.

6. `Cash Report` is aggregate-period summary, not transaction-detail ledger.
- Good for high-level cross-checking only.
- Not sufficient for per-event cash ledger import.

## Recommended Data Source Policy

Use `Trades` as the operational source of truth.

### Holdings

Use:

- `Trades,Stock,,DATA,...`

Ignore for import creation:

- `Holdings,Stock`
- `Holdings,Fund`
- `Cash Report`
- `Allowance`
- `Segment Transfer`

### Options Positions

Use:

- `Trades,Option,,DATA,...`

Ignore:

- `Trades,Option,,TOTAL,...`

## Tiger vs MooMoo: Key Design Difference

MooMoo often gave us a higher-level grouped row plus component rows.

Tiger appears to do the opposite:

- mostly leg-level trade rows
- no reliable grouped spread summary rows
- duplicate companion rows that must be removed before grouping

So the Tiger pipeline should be:

1. parse raw rows
2. normalize values
3. dedupe Tiger companion rows
4. group real trade bundles by timestamp + symbol family
5. infer position/holding events from grouped bundles

Not:

1. trust statement summary rows first
2. then use leg rows as support

## Phase Plan

## Phase 0 - Broker-Aware Import Framework

### Goal

Refactor import routing so `/imports` can dispatch by broker instead of being MooMoo-only.

### Work

- create broker-aware preview dispatcher
- create broker-aware commit dispatcher
- move MooMoo-specific checks/messages behind broker routing
- keep existing MooMoo behavior unchanged

### Files Likely Impacted

- `src/app/api/imports/preview/route.ts`
- `src/app/api/imports/commit/route.ts`
- `src/app/(portal)/imports/import-preview-panel.tsx`
- `src/app/(portal)/imports/page.tsx`

### Notes

- UI copy should stop saying only `MooMoo CSV`
- import panel should reflect selected broker account’s broker type

## Phase 1 - Tiger Preview Parser

### Goal

Build a Tiger preview parser equivalent to `parseMoomooCsvPreview`.

### New Module

- `src/lib/tiger-import/parser.ts`

### Preview Responsibilities

- parse Tiger CSV safely
- detect section + row type
- keep only relevant trade rows
- skip `TOTAL` rows
- detect statement currency
- classify row as:
  - `HOLDING`
  - `POSITION`
  - `SKIPPED`
- calculate normalized fee total from row fee columns
- expose warnings for:
  - duplicate companion rows
  - unsupported sections
  - non-USD/non-matching currency

### Required Tiger Row Fields

At minimum:

- asset type (`Stock` or `Option`)
- activity type
- quantity
- trade price
- amount
- fee columns
- trade time
- currency
- symbol / description text

### Output Target

Tiger preview shape should mirror MooMoo preview as much as possible so the preview UI can stay shared.

## Phase 2 - Tiger Row Normalization and Deduping

### Goal

Remove non-transaction noise before import logic runs.

### Rules To Add

1. Skip all `TOTAL` rows.
2. Skip `Fund` rows for current scope.
3. Skip `Cash Report`, `Holdings`, `Allowance`, `Segment Transfer` for import creation.
4. Collapse duplicate companion rows.

### Duplicate Strategy

Use a deterministic fingerprint based on:

- asset class
- activity type
- quantity
- trade price
- amount
- trade timestamp
- currency
- underlying/contract text

If two adjacent rows are identical except one has blank symbol/description, keep the richer row and mark the blank row as skipped duplicate.

### Important Warning

This is the first area that can quietly corrupt imports if done badly.

We should keep explicit comments in the Tiger importer around:

- why blank-symbol duplicates exist
- why we skip one and keep the other

### Current Implementation

- `src/lib/tiger-import/normalize.ts` now owns Tiger trade parsing, normalization, and companion-row deduping
- `src/lib/tiger-import/parser.ts` is now a thin preview wrapper over the shared normalization layer
- later Tiger commit/import logic should consume the same normalized row output so preview and import stay aligned

## Phase 3 - Holdings Import (Stocks Only)

### Goal

Map Tiger stock trades into existing holding + holding event model.

### Activity Mapping

- `Open` stock row -> acquire shares
- `Close` stock row -> sell shares

### Expected Result

- create or extend `Holding`
- create `HoldingEvent`
- create cash ledger entries for stock purchase/sale and fees
- sync holding PnL snapshot

### Matching Logic

Same as current holding model:

- one holding per symbol per broker account
- repeated buys increase the existing holding
- sells reduce remaining quantity chronologically through current average-cost model

### Scope Notes

- no short stock support in this Tiger phase unless the CSV clearly shows a user need
- no dividend/cash adjustments from Tiger statement in this phase
- no use of `Holdings` snapshot section for write operations

### Current Implementation

- `src/lib/tiger-import/importer.ts` now commits normalized Tiger stock trades into:
  - `holdings`
  - `holding_events`
  - `cash_ledger`
  - `raw_transactions`
  - `import_batches`
- repeated Tiger stock buys extend an existing holding
- Tiger stock closes reduce an existing holding
- if a statement starts with a stock close before the opening buy exists in the app, the importer auto-seeds opening inventory the same way the MooMoo holdings importer does
- Tiger option rows are currently recorded as explicit failed rows during commit so the batch remains honest while Phase 4 is still being built

## Phase 4 - Options Position Import

### Goal

Infer options strategies from Tiger leg rows and map them into `Position`, `PositionLeg`, and `PositionAction`.

### Challenge

Tiger does not appear to provide a clean spread summary row like MooMoo.

So we must infer grouped strategies from synchronized leg rows.

### Bundle Grouping Heuristic

Group option rows by:

- trade timestamp
- underlying symbol
- expiry
- quantity
- activity direction family

Then infer:

- single-leg long call / long put
- single-leg short call / short put
- CSP / CC candidates
- vertical spreads
- iron condors
- custom multi-leg openings

### Activity Mapping

Likely Tiger meanings from sample:

- `OpenShort` -> short option entry
- `Open` -> long option entry
- `Close` with positive quantity -> close short leg by buyback? or close long leg by sell? must be derived from amount/sign + original side
- `Close` with negative quantity -> opposite close direction for the leg

This mapping must be validated carefully in parser tests before commit logic is trusted.

### Implementation Approach

Do not hardcode Tiger `Close` as one action type immediately.

Instead normalize each row into:

- opening/closing intent
- long/short leg side
- option contract identity
- signed cash impact

Then reuse the existing position action engine concepts:

- `STO`
- `BTO`
- `BTC`
- `STC`
- grouped spread open/close
- roll debit / roll credit

### Current Implementation

- Tiger single-leg options now import with shared position tables and cash ledger entries
- Tiger same-timestamp multi-leg bundles now support:
  - 2-leg same-expiry vertical spreads
  - 4-leg same-expiry iron condors
- Tiger `Exercise and Expiration -> Option Expire` rows now close options as `EXPIRED_WORTHLESS`
  - single-leg option expiry
  - grouped spread / iron condor expiry
- supported baseline mappings:
  - `OpenShort` -> `STO`
  - `Open` -> `BTO`
  - `Close` with positive quantity -> `BTC`
  - `Close` with negative quantity -> `STC`
- strategy inference is live for:
  - `CSP`
  - `CC`
  - `SHORT_CALL`
  - `LONG_CALL`
  - `LONG_PUT`
  - `LEAPS_CALL`
  - `LEAPS_PUT`
- unsupported Tiger bundles are still failed explicitly for now:
  - mixed-expiry roll bundles
  - custom multi-leg bundles
  - ambiguous same-timestamp structures

## Phase 5 - Roll Detection

### Goal

Support the same real-world roll scenarios already handled for MooMoo.

### Required Cases

- CSP roll
- CC roll
- vertical spread roll
- iron condor side roll
- iron condor opened then partially closed by side
- repeated same-contract additions to existing positions

### Tiger Roll Inference Concept

Because Tiger is leg-driven, roll detection should likely happen after bundle normalization:

- close bundle + open bundle
- same underlying
- same option family / side
- same timestamp or near-identical timestamp

Then classify as:

- `ROLL_CREDIT`
- `ROLL_DEBIT`

### Current Implementation

- supported Tiger same-timestamp roll groups now include:
  - 1-leg option roll
  - 2-leg vertical spread roll
  - 4-leg iron condor full roll
- current grouping expectation:
  - same underlying
  - same timestamp
  - same absolute quantity
  - clean open/close split inside the group
- unsupported roll shapes still fail explicitly:
  - custom mixed-leg rolls
  - ambiguous same-timestamp bundles
  - side-only iron condor roll shapes that do not form a clean matched subgroup yet

### Risk

This is the highest-complexity area.

Tiger roll support should come only after:

1. single-leg opens/closes are correct
2. stock holdings are correct
3. normal spreads are correct

## Phase 6 - Cash Ledger Policy For Tiger

### Current User Scope

User requested:

- holdings
- positions (options)
- exclude deposits and other unrelated cash sections

### Recommendation

Still create cash ledger entries from imported trade events only:

- `STOCK_PURCHASE`
- `STOCK_SALE`
- `OPTIONS_PREMIUM`
- `FEE` / `COMMISSION` / `TAX` as already used by current model

Do not import:

- `Starting Cash`
- `Ending Cash`
- `Net Trades` summary rows
- `Allowance`
- `Segment Transfer`

Reason:

- reports and dashboard depend on event-level cash movement
- but statement aggregate rows would double-count if imported directly

## Phase 7 - Import History / Rollback

### Goal

Tiger imports should behave identically to MooMoo imports from the user’s perspective.

### Requirements

- save `ImportBatch`
- save `RawTransaction`
- mark failures with readable reasons
- support batch rollback using existing rollback engine

### Notes

No schema change should be needed if we keep:

- `ImportSourceType = CSV`
- broker identity on `BrokerAccount`
- Tiger-specific raw payload stored inside `raw_transactions.raw_payload`

## Phase 8 - UI / UX Changes

### Imports Page

Update copy from MooMoo-only wording to broker-aware wording.

Examples:

- `Upload CSV Preview` stays generic
- replace `validates MooMoo CSV structure` with broker-specific message
- show selected broker code in preview panel

### Preview Messaging

Add Tiger-specific warnings if found:

- duplicate companion rows removed
- fund rows ignored
- statement summary rows ignored
- unsupported trade rows skipped

### Import Review

No new screen is required structurally if we reuse current import history + failure drilldown.

But Tiger failure reasons should be explicit, for example:

- `Skipped duplicate Tiger companion row`
- `Unsupported Tiger activity type`
- `Unable to infer Tiger option bundle strategy`

## Phase 9 - Manual Data Entry / App Behavior Review

Manual entry does not need major structural changes, because Tiger imports land into the same tables.

Still review these areas:

### Positions Manual Flow

- confirm Tiger-imported positions can still be edited manually
- confirm imported leg structures display cleanly in positions list/detail

### Holdings Manual Flow

- confirm Tiger-imported holdings blend correctly with manual add/sell events
- confirm split/reverse split support still works on imported Tiger holdings

### Broker Account UX

- Tiger broker accounts already fit existing `BrokerCode.TIGER`
- ensure import screen routes correctly based on selected active broker account

## Phase 10 - Reports Impact

Most reports should work automatically once Tiger trades land correctly into the shared tables.

### Should Work Automatically

- Dashboard
- Trading Summary (Options)
- Monthly Performance Trend (Options)
- Monthly Performance Trend (Holdings)
- Strategy Performance
- Holding Performance Snapshot
- Cash Flow Report
- Realized P/L & Open Exposure
- Import Quality Report

### Needs Review

1. `Cash Flow Report`
- verify Tiger trade-created cash ledger entries match report assumptions

2. `Import Quality Report`
- show Tiger broker imports naturally alongside MooMoo

3. Labels / descriptions
- where wording says `MooMoo`, make it broker-neutral

## Suggested Delivery Order

## Stage A - Foundation

1. Broker-aware import routing
2. Tiger parser
3. Tiger preview output
4. Tiger dedupe layer

## Stage B - Safe Holdings

1. Stock holdings import only
2. Holding events
3. Cash ledger for stock trades
4. Rollback verification

## Stage C - Safe Options Basics

1. Single-leg long/short option import
2. Vertical spreads
3. Iron condors
4. Repeated add-to-same-position logic

## Stage D - Advanced Options

1. Roll detection
2. Partial close side handling
3. Expiration / assignment / exercise cases if present in Tiger statements

## Stage E - Polish

1. UI wording cleanup
2. import review labels
3. docs/tests/fixtures

## Testing Strategy

We should treat Tiger like MooMoo and build real fixture-driven tests early.

### Recommended Fixtures

1. stock buy -> partial sell -> full sell
2. single long call open/close
3. CSP open/close
4. vertical open/close
5. iron condor open/close
6. roll case
7. duplicate companion row case
8. mixed stock + option statement

### Validation Targets

- no duplicate holdings/events/actions created
- fees imported once only
- grouped positions close correctly
- import rollback fully removes Tiger-created records safely

## Possible Schema Changes

Current expectation:

- likely **no mandatory schema changes**

Reason:

- Tiger can reuse existing `ImportBatch`, `RawTransaction`, `Holding`, `HoldingEvent`, `Position`, `PositionAction`, `PositionLeg`, `CashLedger`, and snapshot models

Possible optional additions later:

- parser/importer version constant for Tiger
- broker-specific processing note helpers

## Acceptance Criteria For Tiger Phase 1

Tiger support is ready for first real use when all of these are true:

1. Preview works for Tiger broker accounts.
2. Currency validation works against active broker account currency.
3. Duplicate Tiger companion rows do not create duplicate imports.
4. Stock trades create correct holdings and holding events.
5. Basic option positions import cleanly.
6. Import history shows Tiger batch results and failures clearly.
7. Rollback works for Tiger batches.
8. Dashboard and reports reflect Tiger-imported data without broker-specific hacks.

## Recommended First Implementation Slice

If we want the safest first build, do this first:

1. broker-aware import routing
2. Tiger parser + preview
3. stock holdings import only
4. Tiger option single-leg import only

Then expand to grouped spreads and rolls after we trust the normalization layer.
