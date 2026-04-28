# Trading Journal App

Trading Journal App is a broker-aware journal for options and stock trading. It helps you track positions, legs, actions, holdings, holding events, cash ledger movements, and broker CSV imports in one app.

## What This App Does

- User auth and onboarding with first broker-account setup
- Broker-scoped trading records (multi-account capable)
- Position lifecycle tracking (including roll flows)
- Holding lifecycle tracking with linked events
- Cash ledger timeline for trading-related cash movement
- MooMoo CSV import with preview/history and safe rollback support
- Cached PnL snapshots for better read performance

Main routes:

- `/dashboard`
- `/positions`
- `/holdings`
- `/cash-ledger`
- `/imports`
- `/broker-accounts`
- `/settings`

## Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Prisma 7
- PostgreSQL
- Tailwind CSS 4
- Node.js test runner + `tsx` for integration/unit-style suites

## Setup

### Prerequisites

- Node.js 20+
- PostgreSQL
- `.env` configured with `DATABASE_URL`

### Install

```bash
npm install
npx prisma generate
```

### Database

Current local workflow:

```bash
npx prisma db push
```

### Run App

```bash
npm run dev
```

### Build And Test

```bash
npm run build
npm test
npm run test:integration
```

## Dev vs Personal Deployment

Use two separate environments:

- `dev`: active coding, schema experiments, risky imports
- `personal`: stable usage with real trading data

Hard rule: never point both app instances to the same database.

Recommended DB split:

- `trading_journal_dev`
- `trading_journal_personal`

Recommended Prisma usage:

- dev: `npx prisma db push` is acceptable while iterating
- personal: prefer `npx prisma migrate deploy`

Recommended guide:

- [PERSONAL_DEPLOYMENT_SETUP.md](./PERSONAL_DEPLOYMENT_SETUP.md)

## Import and Rollback Notes

Current import focus:

- MooMoo CSV workflows
- Supports stocks/holdings and advanced options groupings (e.g. verticals, iron condors, custom roll bundles, expiry cases)

PnL snapshot tables in use:

- `position_pnl_snapshots`
- `holding_pnl_snapshots`

Rollback behavior (current):

- Batch-level rollback only (`importBatchId`)
- Hard-delete strategy (no reversal journal entries)
- Works for safe/isolated imported records
- Blocks rollback when newer dependent records make cleanup unsafe

Key idea: rollback is safety-first. If the system cannot prove a clean undo path, it blocks and preserves data integrity.

Design references:

- [IMPORT_PLAN.md](./IMPORT_PLAN.md)
- [IMPORT_ROLLBACK_PLAN.md](./IMPORT_ROLLBACK_PLAN.md)
- [PNL_SNAPSHOT_PLAN.md](./PNL_SNAPSHOT_PLAN.md)

## Notes

- This project runs on Next.js 16 and may differ from older Next.js conventions.
- For framework-sensitive changes, consult bundled docs in `node_modules/next/dist/docs/`.
