# Split / Reverse Split Support Plan

This document is a design-first brainstorm for handling stock splits and reverse splits in the Trading Journal App.

The goal is not to implement yet. The goal is to decide whether the current data model and workflow can safely support real-world corporate actions, especially for:

- holdings
- stock positions
- option positions linked to adjusted contracts

## Real-World Trigger

Example case:

- A stock in the broker account goes through a reverse split, such as `1-for-10`
- Before the action: `1,000` shares at cost basis `$0.80`
- After the action: `100` shares at adjusted cost basis `$8.00`
- Total economic cost should remain the same before and after the split

This is relatively straightforward for holdings.

It becomes more complex when there are linked option positions because OCC-adjusted option contracts may no longer remain standard:

- strike prices may change
- deliverable may change
- contract count may change
- symbols may be adjusted
- multiplier/deliverable may no longer map cleanly to the original leg structure

## Current Support Assessment

## Holdings

Current schema is partially ready:

- `HoldingEventType` already includes `SPLIT`
- `HoldingSourceType` already includes `CORPORATE_ACTION`
- `RawTransactionType` already includes `CORPORATE_ACTION`

Relevant models:

- [schema.prisma](D:/PTCL/Projects/trading-journal-app/prisma/schema.prisma)

What this means:

- the system can represent the idea of a split event
- the system does not yet appear to contain the business logic to apply a split end-to-end

Current likely gaps for holdings:

- no explicit split ratio storage such as `1:10` or `4:1`
- no dedicated workflow for recalculating:
  - `quantity`
  - `openQuantity`
  - `remainingQuantity`
  - `costBasisPerShare`
- no confirmed snapshot rebuild flow specifically for split events
- no importer flow that detects and applies corporate actions into holdings

Assessment:

- `Holdings`: schema-supported but workflow-incomplete

## Positions

Current schema is weaker for split support:

- `PositionActionType` does not include a dedicated split/reverse-split action
- `PositionLeg` can store adjusted strike/quantity values, but there is no explicit corporate-action workflow around it
- `ActionLegChange` can represent leg replacement, but not the semantic reason of a corporate action cleanly enough on its own

What this means:

- the system can technically mutate leg records
- the system does not yet model split/reverse-split adjustments as a first-class position workflow

Assessment:

- `Stock positions`: potentially supportable with moderate enhancement
- `Option positions`: not safely supported yet

## Why Holdings Are Easier Than Positions

A holding split is usually just an economic transformation:

- shares go up or down by ratio
- cost basis per share moves inversely
- total cost basis remains unchanged

A position split, especially options, can involve contract adjustment behavior that is broker/OCC specific:

- `2` contracts may become `1`
- strike price may move from `10` to `100`
- deliverable may become `10 shares` instead of `100 shares`
- contract symbol may become adjusted/non-standard
- a short call covered by shares may temporarily stop looking like a clean covered-call structure

That is why holdings support should be designed first and positions support should be more cautious.

## Safe Functional Goal

The safest end-state would be:

1. Holdings support split/reverse split correctly
2. Stock positions support split/reverse split next
3. Option positions support only after adjusted-contract rules are explicitly defined

## Recommended Data Enhancements

## Holdings

Recommended additions for a holding split event:

- store split ratio explicitly
- keep a before/after audit trail
- rebuild the holding snapshot after the event

Suggested event payload concept:

- event type: `SPLIT`
- ratio numerator: `1`
- ratio denominator: `10`
- direction can be inferred from the ratio
- optional broker memo / reference
- optional pre/post quantity notes for audit clarity

Possible additional fields in `HoldingEvent` or a related detail structure:

- `splitFromQuantity`
- `splitToQuantity`
- `splitRatioNumerator`
- `splitRatioDenominator`
- `corporateActionMemo`

Important invariant:

- total economic basis should remain unchanged unless broker explicitly reports cash-in-lieu or another side effect

## Positions

Recommended additions for later, not first:

- dedicated `PositionActionType` for split/reverse split or generic corporate action
- ability to tag a position action as a non-trade structural adjustment
- ability to record old vs new leg structures with clearer semantics than a generic replacement

Possible concept:

- `PositionActionType.CORPORATE_ACTION`
- `ActionEffectType.ADJUST`

Then use `ActionLegChange` rows to link:

- old adjusted leg
- new adjusted leg
- quantity/strike change explanation

## Workflow Recommendations

## Phase 1: Holdings Only

This should be the first implementation target.

Desired behavior:

1. User records a split/reverse split on an existing holding
2. System stores the event with ratio + timestamp
3. System recalculates:
   - `quantity`
   - `openQuantity`
   - `remainingQuantity`
   - `costBasisPerShare`
4. System rebuilds `holding_pnl_snapshots`
5. Holding history clearly shows before/after effect

This phase is high-value and comparatively low-risk.

## Phase 2: Stock Positions

If you use stock positions directly in the positions module, then support can be added next.

Desired behavior:

1. position quantity changes by ratio
2. any price-per-share display values adjust appropriately
3. historical cash actions remain untouched
4. position summary remains understandable after the action

This is still manageable because stock positions behave much more like holdings than options do.

## Phase 3: Option Positions

This needs explicit policy before coding.

Possible strategies:

### Option A: Read-Only Corporate Action Marker

- record that a corporate action occurred
- do not automatically rewrite legs
- require user review/manual adjustment

Pros:

- safest
- lowest risk of corrupting real option history

Cons:

- less automated

### Option B: Structural Leg Replacement

- create a corporate action position event
- retire old legs
- create replacement adjusted legs
- preserve link between old and new legs

Pros:

- cleaner long-term reporting

Cons:

- much more complex
- adjusted contracts may still not map neatly to standard UI assumptions

Recommended choice:

- start with `Option A`
- only move to `Option B` after we define how adjusted contracts should display in list/detail/reporting views

## Import Considerations

This is important for your real workflow.

If the split happens before you import that symbol into the app:

- this is the safest case
- you can import post-split history/state without needing historical in-app transformation

If the split happens after the holding already exists in the app:

- importer should ideally detect a corporate action row
- if unsupported, importer should stop and ask for review instead of guessing

Recommended importer rule later:

- if CSV contains a corporate action row matching split/reverse split:
  - for holdings-only symbols: allow guided application
  - for open option positions: warn/block until manual review policy is defined

## Reporting / Snapshot Considerations

Any split support must preserve these invariants:

- realized PnL before the split should not change
- open economic basis should remain equivalent after the split
- snapshot refresh should happen after the corporate action
- holdings and linked positions should remain broker-account scoped

Potential impact areas:

- `holding_pnl_snapshots`
- `position_pnl_snapshots`
- holdings list displays
- position summaries
- management reports that aggregate quantities or open cost

## Main Risk Areas

### Holdings

Risks are mostly operational:

- wrong ratio entered
- quantity adjusted but cost basis not adjusted
- snapshot not refreshed after the event

These are solvable.

### Positions

Risks are structural:

- adjusted option contracts no longer match current UI assumptions
- strike and quantity may look valid but represent the wrong economics
- linked holding / covered-call logic may become misleading after adjustment

This is why option-position support should not be rushed.

## Recommended Product Decision

Recommended roadmap:

1. Support `split/reverse split for holdings` first
2. Support `split/reverse split for stock positions` second, only if needed in your workflow
3. For `option positions`, start with warning/review-only support before automatic leg rewrites

## Final Assessment

Today, based on the current workflow and schema:

- `Holdings`: yes, good candidate for enhancement
- `Stock positions`: probably supportable with moderate design work
- `Option positions`: not safely supported yet without a dedicated corporate-action design

That means your instinct is right:

- if the stock has not been imported yet, you are still safe
- if we enhance this area, holdings should be the first target
- option positions should be treated as a separate, more careful problem

## Suggested Next Brainstorm Topics

When you want to continue, the next useful design doc would be one of these:

1. `Holdings split/reverse split UX flow`
2. `Importer behavior for corporate actions`
3. `Adjusted option contract policy after split/reverse split`

