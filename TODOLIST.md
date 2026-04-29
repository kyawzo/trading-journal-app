# Trading Journal App TODO List

Status legend:
- `Done`: implemented and validated
- `Not Yet`: planned, not fully implemented

## Currency Policy Hardening

| Item | Status |
|---|---|
| Remove manual currency selection from holdings and positions create/edit flows | `Done` |
| Auto-derive transaction currency from broker account base currency | `Done` |
| Enforce currency consistency in import preview (block mismatch) | `Done` |
| Enforce currency consistency in import commit/run import (block mismatch) | `Done` |
| Show active broker label with currency across portal pages | `Done` |
| Keep separate broker accounts per currency for isolated cash ledger balances | `Done` (supported model + validation + labels, with continued UX guidance improvements) |

## Currency UX Improvements

| Item | Status |
|---|---|
| Show clearer currency guidance in import screen before upload | `Done` |
| Suggest matching broker account(s) by CSV currency during preview errors | `Done` |
| Highlight selected account currency prominently near `Run Import` action | `Done` |

## Notes

- Current design supports creating multiple accounts under the same broker with different base currencies (for example `MooMoo USD` and `MooMoo SGD`).
- Import now expects one-currency-per-file and one-currency-per-target-account.

## Management Reports Roadmap (User Perspective)

| Report / Capability | Why It Helps Users | Status |
|---|---|---|
| Trading Summary (Options) (period P/L, win rate, avg winner/loser) | Quick health check of options performance without digging into raw trades | `Done` |
| Strategy Performance (CSP, CC, spreads, etc.) | Shows which strategies are actually working over time | `Not Yet` |
| Realized vs Unrealized P/L by account and currency | Separates closed results from open exposure and prevents mixed-currency confusion | `Not Yet` |
| Monthly Performance Trend (Options) | Helps users see consistency, drawdowns, and recovery patterns in options positions | `Done` |
| Holding Performance Snapshot | Shows open stock holdings, realized from sold lots, and cost basis quality | `Not Yet` |
| Risk & Exposure View (symbol concentration, strategy concentration) | Warns when portfolio is too concentrated in one name or one strategy | `Not Yet` |
| Execution Quality Report (fees, slippage proxy, discipline ratings) | Helps improve process quality, not just outcome | `Not Yet` |
| Import Quality Report (imported rows, failed rows, rollback events) | Builds trust in data quality and audit trail | `Not Yet` |
| Cash Flow Report (deposits, withdrawals, premiums, fees, dividends) | Gives clear money-in/money-out visibility for each broker account | `Not Yet` |
| Journal Insight Report (common mistakes, best setups, lessons tags) | Converts journaling into actionable behavior improvements | `Not Yet` |
| Tax-Oriented Export View (realized transactions by year) | Makes year-end review and accountant handoff easier | `Not Needed (SG personal use)` |
| Downloadable Reports (CSV/PDF) | Lets users share/save reports outside the app | `Not Yet` |

### Suggested Implementation Phases

| Phase | Scope | Status |
|---|---|---|
| Phase 1 - Foundation | Trading Summary (Options), Monthly Trend, Cash Flow Report | `In Progress` |
| Phase 2 - Strategy & Risk | Strategy Performance, Exposure View, Realized vs Unrealized | `Not Yet` |
| Phase 3 - Process Quality | Execution Quality, Import Quality, Journal Insight | `Not Yet` |
| Phase 4 - Delivery | CSV/PDF downloadable reports (tax-oriented export excluded for SG personal use) | `Not Yet` |
