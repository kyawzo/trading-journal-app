# Import Rollback Plan

## Decision

Chosen direction:

- **hard delete**
- **rollback by import batch only**

This means:

- no reversal entries
- no partial rollback by row
- no rollback by single trade
- one action removes one whole import batch

## Goal

Allow the user to safely undo an accidentally imported CSV batch.

Primary use cases:

- wrong CSV file
- unsupported scenario discovered after import
- bad import result during testing
- duplicate/broken import data that should be removed cleanly

## Rollback Unit

Rollback unit is exactly:

- `importBatchId`

User flow:

1. open import history
2. choose one batch
3. click `Undo Import`
4. confirm
5. system hard deletes data created by that batch when it passes safety checks

## Product Rule

`Undo Import` should:

- remove imported records permanently
- operate on one batch only
- be blocked if newer records depend on that batch

This keeps the feature simple and predictable.

## What Should Be Deleted

Rollback should remove batch-owned records such as:

- `ImportBatch`
- `RawTransaction`
- imported `CashLedger`
- imported `PositionAction`
- imported `PositionLeg`
- imported `Position`
- imported `HoldingEvent`
- imported `Holding` if that holding was created entirely by the batch

## Important Holding Rule

Holdings need one extra rule.

If a batch:

- created a brand new holding from import

then rollback can hard delete that holding.

If a batch:

- appended events to an already existing holding

then rollback should:

1. delete the imported holding events from that batch
2. recompute the current holding snapshot

That recomputation must update:

- `quantity`
- `openQuantity`
- `remainingQuantity`
- `costBasisPerShare`
- `holdingStatus`
- `closedAt`

## What Must Block Rollback

Rollback should be blocked if later records depend on the imported batch.

Examples:

- later manual actions were added to an imported position
- later imports added more actions to the same imported position
- later holding events depend on an imported holding state
- imported records were edited in ways that make safe reconstruction unclear

Recommended user message:

`This import batch cannot be undone automatically because newer records depend on it.`

## Existing Good Foundations

The current importer already gives us useful linkage:

- `RawTransaction.importBatchId`
- `PositionAction.brokerReference = IMPORT:<batchId>:ROW:<n>`
- `CashLedger.externalReference = IMPORT:<batchId>:...`

This is enough to build the first rollback version.

## Recommended Small Improvement Before Implementation

To make rollback safer and simpler, add explicit batch linkage where useful:

- `HoldingEvent.importBatchId`
- optional: `Holding.importBatchId`
- optional: `Position.importBatchId`
- optional: `CashLedger.importBatchId`

This is not strictly required, but it will make:

- rollback
- debugging
- import history review

much easier.

## Rollback Execution Order

Rollback should run inside one database transaction.

Recommended order:

1. load batch
2. verify authenticated user owns the broker account for that batch
3. run dependency/safety checks
4. collect affected records
5. delete imported cash ledger rows
6. delete imported position actions
7. delete imported position legs
8. delete imported positions
9. delete imported holding events
10. recompute or delete holdings
11. delete raw transactions
12. delete import batch

## First Implementation Scope

Recommended first version:

- hard delete by batch only
- support imported positions fully
- support imported cash ledger fully
- support raw transactions fully
- support holdings only when safe

Practical safe rule for v1:

- if a batch only created imported positions/cash rows, undo works
- if a batch touched holdings, undo works only when holdings can be safely recomputed
- otherwise block rollback with a clear message

## API Plan

Recommended endpoint:

- `POST /api/imports/:id/rollback`

Behavior:

1. require auth
2. verify ownership
3. run rollback safety checks
4. hard delete within transaction
5. return summary counts

Suggested response:

```json
{
  "ok": true,
  "importBatchId": "uuid",
  "deleted": {
    "positions": 1,
    "positionActions": 5,
    "positionLegs": 6,
    "holdings": 0,
    "holdingEvents": 0,
    "cashLedgerEntries": 10,
    "rawTransactions": 18
  }
}
```

## UI Plan

Recommended UI:

- import history table/card list
- each batch shows:
  - file name
  - broker account
  - imported at
  - status
  - imported rows / failed rows
- action button:
  - `Undo Import`

Confirmation modal should show:

- file name
- broker account
- import date/time
- warning that deletion is permanent

Example copy:

`Undo import for this batch? This will permanently delete imported records created from this CSV.`

## Testing Plan

Minimum test cases:

1. undo deletes imported positions from one batch
2. undo deletes imported cash ledger rows from one batch
3. undo deletes raw transactions and import batch row
4. undo recomputes holding correctly after imported holding events are removed
5. undo is blocked when newer dependent records exist
6. user A cannot undo user B import batch

## Recommended Build Order

1. add explicit batch linkage fields where needed
2. build rollback service function
3. implement position/cash/raw-transaction rollback first
4. implement holdings recomputation
5. add API route
6. add UI button + confirmation modal
7. add automated tests

## Best MVP

Best MVP definition:

`Allow hard-delete rollback of one import batch when imported records are still isolated and safe to remove. Block undo for unsafe batches until holdings recomputation/dependency checks are fully implemented.`

## Current MVP Status

Implemented now:

- batch-level `Undo Import` button in import history
- authenticated rollback API
- hard delete rollback for isolated import batches that created position-side data
- deletion of:
  - `ImportBatch`
  - `RawTransaction`
  - imported `CashLedger`
  - imported `PositionAction`
  - imported `PositionLeg`
  - imported `Position`
  - imported `Order`
  - imported `Execution`

Current safety limits:

- rollback is blocked when imported positions have newer dependent records such as:
  - non-batch actions
  - journal or note data
  - holding links
  - non-batch cash ledger rows
- rollback is blocked when imported holding history is no longer isolated and safe, for example:
  - newer non-batch holding events exist after the batch events
  - non-batch positions depend on the touched holding
  - non-batch cash ledger rows are linked to the touched holding
  - the importer cannot tell whether the holding existed before the batch

Next rollback step:
- broaden dependency detection around more advanced holding-position relationships as new import scenarios are added

That gives you a practical safety net without overcomplicating the first version.
