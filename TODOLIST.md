# Trading Journal App TODO List

Status legend:
- `Done`: implemented and validated
- `In Progress`: started, not yet fully complete
- `Not Needed`: intentionally excluded from current scope
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

## Listing Pagination & Filter Roadmap

| Item | Details | Status |
|---|---|---|
| Why this matters | Current listing pages still rely on simple `take: N` queries, which is fine early on but will feel slow and limiting once positions, holdings, ledger rows, and import history grow. | `Not Yet` |
| Desired outcome | Move to URL-driven pagination plus practical filter criteria so first load stays fast and users can narrow the list before loading too much data. | `Not Yet` |

### Shared Pagination Design

| Capability | Plan | Status |
|---|---|---|
| Shared URL query model | Use `page`, `pageSize`, `sort`, and page-specific filter params in the URL so lists are refresh-safe and bookmarkable | `Done` |
| Shared pager UI | Add reusable pagination controls with `Previous`, `Next`, page number, total rows, and optional page-size selector | `Done` |
| Server-side filtered queries | Apply `where`, `orderBy`, `skip`, and `take` in Prisma at page load instead of loading a large in-memory list | `Done` |
| Matching count query | Run `count()` with the same filter set so page totals stay accurate | `Done` |
| Safe default first load | Default each page to a narrow initial slice so first render stays quick even for large accounts | `Done` |
| Empty/filter state UX | Show “no results for current filters” separately from “no data yet” | `In Progress` |

### Proposed Default First-Load Strategy

| Listing | Default Slice | Notes | Status |
|---|---|---|---|
| Positions | Page 1, 20 rows, newest first, default status = open + recently updated/created closed items | Keeps the main trading workflow focused on active positions first | `Done` |
| Holdings | Page 1, 25 rows, split by active/inactive tab, newest opened first | Active tab should remain the default because it is operationally more important | `Done` |
| Cash Ledger | Page 1, 50 rows, newest first | Ledger rows are lighter, so a slightly larger page is fine | `Done` |
| Imports | Page 1, 20 rows, newest first | Import review usually starts from recent batches | `Done` |

### Proposed Filter Criteria Per Listing

| Listing | Criteria to Add First | Status |
|---|---|---|
| Positions | status, symbol search, strategy type, opened/closed date range | `Done` (status, symbol, strategy implemented; date range can be expanded next) |
| Holdings | active/inactive state, symbol search, source type, opened date range | `Done` (active/inactive, symbol, source implemented; date range can be expanded next) |
| Cash Ledger | transaction type, date range, amount direction (inflow/outflow), text/description search | `Done` |
| Imports | batch status, broker account, imported date range, file name search, failed-only toggle | `Done` |

### Implementation Phases

| Phase | Scope | Status |
|---|---|---|
| Phase A - Shared Foundation | Query parsing helpers, shared pager component, shared count + pagination conventions | `Done` |
| Phase B - Positions | Add filters + pagination to positions list first because it will likely grow fastest and has the heaviest card payload | `Done` |
| Phase C - Holdings | Add active/inactive aware pagination and lightweight holding filters | `Done` |
| Phase D - Cash Ledger | Add date/type filtering with larger page size for audit-style scrolling | `Done` |
| Phase E - Imports | Add batch-status/date/broker filtering and paged import history review | `Done` |

### Performance Notes Before Implementation

| Note | Details | Status |
|---|---|---|
| Filter before heavy joins | Prefer filtering before joining heavier related data so we do not over-fetch on first load. | `Not Yet` |
| Positions query care | Positions likely need the most care because list cards currently pull legs and actions; we should reduce card payload where possible or move some derived summary work into lighter queries/helpers. | `Not Yet` |
| URL-driven filters | Keep filters in the URL so page transitions and browser back/forward stay predictable. | `Not Yet` |
| Index review later | If query speed becomes an issue later, add or refine DB indexes after observing real usage patterns rather than guessing too early. | `Not Yet` |

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
