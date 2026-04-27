# MooMoo CSV Import - Planning & Implementation Guide

## 🎯 Key Specifications (Updated)
- **Status**: Import filled orders; skip Cancelled and Failed. `Option Expired` rows are supported for expiry-worthless option flows when they can be matched back to an imported/open option structure.
- **Markets**: US only (skip SG like "OV8", HK, and other non-US)
- **Transaction Types**: Stock holdings + option positions (both included)

## 📊 Data Structure
- **Holdings** (Stocks): Group ALL same ticker under ONE Holding
  - Multiple buy/sell same ticker = single Holding with multiple HoldingEvents
  - Calculate weighted average cost basis
  - Update avg price when adding/reducing position
- **Positions** (Options): Separate Position per trade
  - Multiple spreads/options same ticker = separate Positions
  - Create PositionLegs for each component
  - Create PositionActions for each trade
- **Import Broker Selection**: The user will select the broker (e.g., Moomoo, Tiger, Webull) on the import page.
- **Broker Validation**: The system must validate the selected broker against the CSV schema before starting the process.

## 📁 Holdings Example
```
CSV: Buy RGTI 50@19.25 + Buy RGTI 30@18.50 + Sell RGTI 25@20.50
→ Single Holding: RGTI
   - remainingQuantity = 25
   - costBasisPerShare = 18.96875 (weighted avg)
   - 2 HoldingEvents attached
```

## 📈 Positions Example
```
CSV: Buy SPX IC 7290/7300 + Sell SPX IC 7290/7300 + Buy SPX IC 7060/7070
→ 3 Separate Positions (different trades, even same ticker)
```

## 🚫 Skip These Rows
```
Status = "Cancelled"/"Failed" → Skip
Markets != "US"               → Skip (SG like OV8, HK, etc)
```

## 📊 Summary Output
```
✅ Holdings created: X
✅ HoldingEvents created: Y  
✅ Positions created: Z
⚠️ Skipped cancelled/failed: W
⚠️ Skipped non-US trades: V (SG: A, HK: B)
❌ Failed to import: N rows
```

---
## 1. CSV Structure Analysis
### File Format
- **Source**: MooMoo Broker - Trade History Export (CSV)
- **Delimiter**: Comma
- **Total Columns**: 40+ fields
- **Date Format**: "Mon DD, MM/YYYY HH:MM:SS TZ" (e.g., "Apr 17, 2026 10:51:28 ET")

### Scope: US Markets Only
- **Include**: US stocks and US-listed options (SPX, QQQ, individual equities, etc.)
- **Exclude**: SG stocks (e.g., "OV8"), HK stocks, and other non-US markets
- **Detection**: Check Markets column = "US" or symbol doesn't contain SG-specific patterns
- **Future Support**: HK, SG, and other markets planned for future phases

### Key Columns
| Column | Purpose | Example |
|---|---|---|
| Side | Trade direction | Buy, Sell, Short Sell |
| Symbol | Ticker or derivative contract | RGTI, SPXW260430C7290000 |
| Name | Readable name | Rigetti Computing, SPX Vertical |
| Order Price | Limit/market price | 20.50, 0.80 |
| Order Qty | Quantity ordered | 50, 1unit(s) |
| Status | Order execution status | Filled, Cancelled, Failed |
| Filled@Avg Price | Executed details | 50@19.25 |
| Order Time | When order was placed | Apr 17, 2026 10:51:28 ET |
| Fill Time | When filled/cancelled | Apr 17, 2026 05:24:44 ET |
| Fill Qty/Price/Amount | Actual execution | 50, 19.25, 962.50 |
| Commission | Trading commission | 0.99 |
| Platform Fees | Broker fees | Variable |
| Trading Fees | Exchange fees | Variable |
| SEC Fees | Regulatory fees | Variable |
| OCC Fees | Options Clearing Corp fees | Variable |
| Total | Sum of all fees | 1.24, 4.05, 3.97 |

### Transaction Types in CSV
1. **Stock Trades (Holdings)**: RGTI, SLV, AIRE (regular stock orders)
   - Each ticker can have multiple transactions (buy/sell/avg price updates)
   - Should be linked to same Holding if ticker matches
   - Track cost basis changes across multiple transactions
2. **Option Positions**: SPXW260430C7290000 (individual option legs)
   - Create separate Position for each option
   - Multiple transactions same ticker create separate Positions (not aggregated like Holdings)
3. **Multi-leg Spreads**: SPX260430C7290/7300 (aggregate rows for spreads)
   - Detect by name pattern (contains "/")
   - Create single Position with multiple PositionLegs
   - Multiple spreads same ticker create separate Positions
4. **Order Status Values (IMPORT ONLY FILLED)**
   - `Filled` - **IMPORT THIS** - Order completed successfully
   - `Cancelled` - **SKIP** - Order cancelled by user (not interested)
   - `Failed` - **SKIP** - Order failed to execute (not interested)
   - `Option Expired` - **SPECIAL IMPORT CASE** - Used for expiry-worthless flows when importer can group expired option legs back onto the matching open position

## 2. Data Modeling Challenges
### Challenge 1: Multi-Row Spread Orders
**Problem**: Spreads appear on multiple rows:
- Row 1: Aggregate spread (SPX260430C7290/7300, status: Filled, qty: 1unit(s))
- Row 2: Long call leg individual fill (SPXW260430C7290000)
- Row 3: Short call leg individual fill (SPXW260430C7300000)

**Solution**:
- Detect spreads by name pattern (contains "/")
- Group related rows by Order Time proximity (within 1-2 seconds)
- Create single Position for spread
- Create individual PositionLegs for each component

### Challenge 2: Fee Aggregation
**Problem**: MooMoo splits fees into many categories; Trading Journal needs one final `fee_amount`.
**Solution (Implemented)**:
- Use `Total` column as the canonical fee source.
- Fallback to summing fee columns only when `Total` is blank/missing.
- Store final fee in a single fee field (`PositionAction.feeAmount` / `HoldingEvent.feeAmount`).

### Challenge 3: Options Symbol Parsing
**Problem**: SPXW260430C7290000 needs to be parsed into components
**Solution** (using regex or date parsing):
```
/^([A-Z]+)(\d{6})([CP])(\d+)$/
```

### Challenge 4: Holdings vs Positions Distinction
**Problem**: CSV contains both stock holdings and option positions mixed together
**Solution**:
- **Stocks (Holdings)**: Detect by LegType=STOCK (no "C" or "P" suffix, no option expiry)
  - Group multiple same-ticker stock transactions into ONE Holding
  - Calculate weighted average cost basis
  - Create separate HoldingEvent for each transaction
- **Options (Positions)**: Detect by symbol ending with C/P (e.g., SPXW)
  - Each option trade = separate Position
  - Multiple spreads or single options same ticker = separate Positions
  - Create PositionLeg for each component
  - Create PositionAction for each trade action

## 8. Error Handling Strategy
### File Upload Errors
- File not CSV $\rightarrow$ User message: "Please upload a CSV file"
- File empty $\rightarrow$ "CSV file is empty"
- File too large (>100MB) $\rightarrow$ "File too large, max 100MB"

### Parse Errors
- Invalid timestamp format $\rightarrow$ Log row, skip, continue
- Missing required column $\rightarrow$ Abort with user message showing which column
- Invalid symbol format $\rightarrow$ Log row details, skip with warning

### Import Errors
- Duplicate order detected $\rightarrow$ Skip with count summary
- Spread components mismatched $\rightarrow$ Log details, skip row
- Invalid status $\rightarrow$ Log and skip
- Database error $\rightarrow$ Rollback transaction, display error

### User Feedback
```
Import Results:
✅ 25 positions created
✅ 45 position legs created
⚠️ 3 rows skipped (cancelled orders)
⚠️ 2 rows skipped (duplicate timestamps)
❌ 1 row failed (invalid symbol)
```

## 9. Database Queries to Create
### Check for existing positions by timestamp + symbol + qty
```sql
SELECT id FROM positions 
WHERE underlying_symbol = $1 
  AND opened_at = $2 
  AND (SELECT sum(quantity) FROM position_legs WHERE position_id = positions.id) = $3
LIMIT 1
```

### Get all legs for position (to verify spread structure)
```sql
SELECT * FROM position_legs 
WHERE position_id = $1 
ORDER BY leg_role
```

## 10. Next Steps After Import Completion
- [ ] Display import summary on dashboard
- [ ] Allow user to edit imported positions (fix titles, add thesis)
- [ ] Link imported positions to existing holdings if applicable
- [ ] Generate performance report from imported data
- [ ] Allow exports to CSV/PDF

---
## 12. Current Import Behavior (Implemented)
- Processing order:
  - Rows are processed in chronological order using `Order Time` first, then `Fill Time` fallback.
- Quantity/amount reconciliation:
  - When `Fill Qty` differs from `Filled@Avg Price` quantity (or appears partial), importer resolves quantity using the highest reliable filled quantity signal (`Fill Qty`, `Filled@Avg`, `Order Qty`).
  - In mismatch cases, amount is recomputed from resolved quantity × resolved price so holdings/options cash math stays consistent.
  - MooMoo continuation fill rows with blank symbol/side are merged back into the prior component row so split fills still import at the correct total quantity/average price.
- Scope filtering:
  - Importable rows are `Status = Filled` and `Markets = US`.
  - `Cancelled`, `Failed`, non-US rows are skipped.
  - `Option Expired` rows are imported only for supported expiry-worthless option workflows.
- Holdings behavior:
  - Holdings are grouped by symbol per broker account while active.
  - If a holding is fully closed (`remaining_quantity = 0`), the next buy opens a new holding cycle (new holding record).
  - If a sell appears without enough open quantity, importer auto-seeds opening inventory with `TRANSFER_IN` event to preserve import continuity.
- Options behavior:
  - Short option cycle:
    - Filled `Short Sell` opens `STO`.
    - Later matching filled `Buy` closes same contract as `BTC` on the same position.
  - Long option cycle:
    - Filled `Buy` opens `BTO`.
    - Later matching filled `Sell` closes same contract as `STC` on the same position.
  - Roll-chain behavior:
    - If a short leg is closed (`BTC`) and a new short leg is opened shortly after on same underlying, importer can continue on the same position as roll chain.
    - Roll continuation is imported as roll-type action instead of creating a disconnected new position when close/open sequence is detected.
  - Leg role semantics:
    - For single-leg strategies, imported legs now use strategy roles (for example `SHORT_PUT` for CSP) instead of generic `SINGLE`.
    - Roll replacement legs preserve the prior leg role so imported roll timelines align with manual roll UI structure.
  - Spread summary row handling:
    - MooMoo vertical spreads are treated as 3-line bundles:
      - line 1 = summary row (`Vertical`, symbol contains `/`)
      - line 2 = first leg
      - line 3 = second leg
    - MooMoo iron condors are treated as 5-line bundles:
      - line 1 = summary row (`Iron Condor`)
      - line 2-5 = four component option legs
      - importer consumes the full bundle as one `IRON_CONDOR` position using component-leg contracts as the source of truth
      - same-expiry `Iron Condor` close bundles match the existing open condor and create one `BTC` action on that same position
    - MooMoo expiry-worthless flow can arrive without a spread summary row:
      - broker emits only component option rows with `Order Source = Option Expired`, zero premium, and shared timestamp
      - importer groups those component rows back onto the matching open multi-leg position and records one `EXPIRED_WORTHLESS` action
      - affected legs are marked `EXPIRED` and the position status becomes `EXPIRED`
    - MooMoo custom roll bundles are treated as multi-line bundles:
      - summary row can be `Custom(...)` with 4 component option rows
      - importer groups the whole bundle as one roll action instead of creating standalone option trades from the component rows
      - for SPX-family exports, summary rows using `SPX...` are matched to component rows using `SPXW...`
      - partial-side rolls are supported for multi-leg positions (example: rolling only the call side of an iron condor)
      - in those cases, only the matching legs are marked `ROLLED`, untouched legs remain open, and replacement legs inherit the prior leg roles
      - debit/credit classification for MooMoo custom roll summaries is driven by premium sign, not just summary side text
      - example: a `Buy` custom roll with negative premium (`-0.90`) is treated as `ROLL_CREDIT`
    - For same-expiry verticals, the component-leg symbols are treated as the contract source of truth while the summary row provides the trade/action premium + fee.
    - The two adjacent component rows are consumed as leg context and skipped from standalone position creation.
    - Same-expiry vertical bundles are treated as normal spread opens/closes.
    - Mixed-expiry spread bundles are treated as roll-style exports, where the summary row becomes one `ROLL_CREDIT`/`ROLL_DEBIT` action (premium + fee from summary).
    - For custom mixed-expiry roll bundles, importer uses component rows to identify old expiry group vs new expiry group, rolls the most recent matching open spread position forward, and preserves the trade as one position lifecycle (`STO -> ROLL_* -> BTC`).
    - Matching component rows are consumed as roll context (which leg is closed/opened) and are skipped from creating standalone action rows.
    - If no valid roll source position is found, importer safely falls back to normal spread-position import.
    - Parser supports MooMoo shorthand spread symbols where the second leg omits date/type (example: `PLTR251107P1775/1825`); missing fields are inherited from the first leg.
    - Root cause of earlier fragmented imports:
      - If the summary shorthand row was treated as insufficient and component rows were allowed to import independently, one real spread could fragment into separate `CSP` / `LONG_PUT` / spread positions.
      - The current importer prevents this by using the component rows as the leg-definition source of truth for normal same-expiry vertical bundles.
  - Spread close matching:
    - For spread summary close rows (for example `Buy` summary that closes a credit spread), importer matches an existing open spread position by underlying + leg contracts and records a close action on that same position instead of opening a new position.
    - Component leg rows in the same bundle are consumed and skipped from standalone import.
  - Spread strategy inference:
    - Same-expiry put spreads opened with credit are imported as `BULL_PUT_SPREAD`.
    - Same-expiry put spreads opened with debit are imported as `BEAR_PUT_SPREAD`.
    - Same-expiry call spreads opened with credit are imported as `BEAR_CALL_SPREAD`.
    - Same-expiry call spreads opened with debit are imported as `BULL_CALL_SPREAD`.
    - Imported spread legs are assigned strategy-appropriate short/long roles instead of generic spread placeholders.
  - UI parity for rolled legs:
    - Imported roll chains are normalized to match manual-keyed trade presentation.
    - Latest replacement contract remains visible in active `Legs`.
    - Rolled-out contract remains in `Leg History`.
  - Single-leg closes inside multi-leg positions:
    - Individual `BTC` / `STC` rows can now close a specific leg on an existing spread/IC position without spawning a new standalone position.
    - Position status becomes `PARTIALLY_CLOSED` while other active legs remain, and only becomes `CLOSED` when the last active legs are closed.
- Fees:
  - Fee source is `Total` column.
  - If `Total` is not present, fallback uses summed fee columns.
- Duplicate protection:
  - File hash is stored per broker account; same CSV cannot be imported twice for the same account.
- Strategy inference on import:
  - `STO + PUT` => `CSP`
  - `STO + CALL` + active 100+ shares => `CC`; otherwise `SHORT_CALL`
  - Inferred/created `CC` imports auto-link to matching active holding when sufficient shares exist.
  - `BTO + CALL` with long DTE => `LEAPS_CALL`; shorter DTE => `LONG_CALL`
  - `BTO + PUT` with long DTE => `LEAPS_PUT`; shorter DTE => `LONG_PUT`

## 13. Remaining Import Roadmap
- [ ] Display import summary on dashboard
- [ ] Allow user to edit imported positions after import
- [ ] Improve post-import reconciliation to existing holdings beyond current CC linking
- [ ] Generate performance/reporting views from imported data
- [ ] Allow exports to CSV/PDF
- [ ] Support other brokers (ThinkOrSwim, Interactive Brokers, etc.)
- [ ] Scheduled automatic imports
- [ ] Partial import retry for failed rows
- [ ] Import from broker APIs
- [ ] Bulk edit imported records
- [ ] Improve holdings cost-basis matching and recovery flows

## 11. Future Enhancements
- Roadmap is tracked in **13. Remaining Import Roadmap** above so implementation status and next steps stay in one place.
