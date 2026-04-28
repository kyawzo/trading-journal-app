# PnL Snapshot Design

## Goal

Avoid recalculating dashboard PnL from raw `position_actions` and `holding_events` on every dashboard visit.

The current app can always derive PnL from transactional rows, but holdings especially require line-by-line cost-basis math. As data grows, recalculating that logic every time the dashboard loads will become unnecessarily expensive.

## Chosen Approach

Use cached snapshot tables at the entity level instead of one broker-level dashboard table.

### Why this is the better fit

- `Position` PnL is naturally derived from `position_actions`
- `Holding` PnL is naturally derived from `holding_events`
- snapshots can be reused by multiple screens later, not just dashboard
- import, rollback, manual edits, and future workflows are easier to keep consistent at the position/holding layer
- broker-level dashboard totals can be computed quickly by summing snapshot rows

## Implemented Tables

### `position_pnl_snapshots`

One row per `position`

Stored fields:
- `broker_account_id`
- `currency`
- `gross_credits`
- `gross_debits`
- `total_fees`
- `net_cash_flow`
- `ignored_amount_count`
- `refreshed_at`

### `holding_pnl_snapshots`

One row per `holding`

Stored fields:
- `broker_account_id`
- `currency`
- `acquired_shares`
- `sold_shares`
- `gross_purchase_cost`
- `gross_sale_proceeds`
- `acquisition_fees`
- `disposition_fees`
- `total_fees`
- `effective_cost_basis_per_share`
- `estimated_cost_of_sold_shares`
- `estimated_realized_pnl`
- `estimated_open_cost`
- `refreshed_at`

## Refresh Strategy

Snapshots are refreshed immediately after the source records change.

### Position snapshot refresh

Recalculate after:
- manual position action create
- manual position action update
- manual position action delete
- roll workflow
- import batch completion

### Holding snapshot refresh

Recalculate after:
- manual holding create
- manual holding event create
- manual holding event update
- manual holding event delete
- assignment flow that creates a holding
- import batch completion

## Dashboard Behavior

Dashboard no longer needs to recalculate Holdings PnL line by line.

It now reads:
- Positions PnL from `SUM(position_pnl_snapshots.net_cash_flow)`
- Holdings PnL from `SUM(holding_pnl_snapshots.estimated_realized_pnl)`
- Open Holding Cost from `SUM(holding_pnl_snapshots.estimated_open_cost)`

All sums are broker-scoped through `broker_account_id`.

## Why not a single dashboard table first

A single `dashboard_summary` table would be harder to keep correct because:
- one action/event can affect one entity but not the whole broker
- rollback/import/manual edits would need broad invalidation logic
- holdings cost basis depends on ordered event history, so the entity-level cache is the correct source of truth

Broker-level totals are better treated as fast aggregates over snapshot rows.

## Current Scope

Implemented now:
- snapshot tables
- snapshot recalculation service
- dashboard totals switched to snapshot aggregates
- holdings list page switched to snapshot-backed open-cost / average-cost display
- holding detail page switched to snapshot-backed summary cards
- position detail page switched to snapshot-backed realized cash summary
- backfill run against current local data

## Future Improvements

- add a maintenance admin action to rebuild all snapshots
- extend snapshot-backed reads to any future reporting/export screens
- optionally add nightly verification/rebuild if large imports become common
