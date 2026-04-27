# Personal Deployment Setup Guide

## Goal

Use the trading journal in two separate environments:

- `dev` for ongoing feature work, testing, and risky imports
- `personal` for your real trading data and day-to-day analysis

This guide is written for a practical solo-developer setup, not a large DevOps team.

## Recommended Environment Model

Keep these fully separate:

### 1. Development Environment

Use this for:

- new features
- schema changes
- CSV edge-case testing
- import debugging
- UI experiments

Recommended database:

- `trading_journal_dev`

Recommended branch:

- `dev`

### 2. Personal / Stable Environment

Use this for:

- real trading data
- normal journaling
- analysis and reporting
- safe imports only after testing in dev

Recommended database:

- `trading_journal_personal`

Recommended branch:

- `main` or `release/personal`

## Most Important Rule

Never let the dev app and the personal app point to the same PostgreSQL database.

That is the single most important protection.

## Recommended Setup Options

### Option A: Same machine, separate app + separate DB

This is the easiest starting point.

Example:

- Dev app
  - path: current working copy
  - port: `3000`
  - DB: `trading_journal_dev`
- Personal app
  - path: second cloned folder or release copy
  - port: `3001`
  - DB: `trading_journal_personal`

This is simple and totally fine for personal use.

### Option B: Another machine or VPS

Better long-term separation.

Example:

- Current machine = development
- Another PC / mini server / VPS = personal stable app

This gives better safety because experiments and real usage are physically separated.

## Recommended Folder Layout

If using the same machine:

```text
D:\PTCL\Projects\trading-journal-app-dev
D:\PTCL\Projects\trading-journal-app-personal
```

Suggested usage:

- `trading-journal-app-dev`
  - active coding
  - feature work
  - unstable imports
- `trading-journal-app-personal`
  - stable checked-out version
  - only updated when you intentionally release

## Recommended Git Workflow

Keep it simple:

- `dev` branch
  - daily coding
  - testing
  - incomplete work allowed
- `main` or `release/personal`
  - stable version only
  - used for personal deployment

Recommended workflow:

1. Build and test new feature in `dev`
2. Verify import scenarios in dev DB
3. Commit changes
4. Merge or cherry-pick into stable branch
5. Deploy stable branch to personal environment
6. Run migrations there
7. Back up DB
8. Import real data

## Environment Variables

Use separate `.env` files or equivalent deployment variables.

### Development

Example:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/trading_journal_dev"
NEXTAUTH_URL="http://localhost:3000"
APP_BASE_URL="http://localhost:3000"
```

### Personal

Example:

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/trading_journal_personal"
NEXTAUTH_URL="http://localhost:3001"
APP_BASE_URL="http://localhost:3001"
```

If deployed to another machine/server, replace localhost and port with the real host.

## PostgreSQL Recommendation

Use separate databases:

- `trading_journal_dev`
- `trading_journal_personal`

Optional later:

- `trading_journal_test`

If you want to be even safer, use separate PostgreSQL users too:

- `tj_dev_user`
- `tj_personal_user`

That is not required, but it reduces the chance of accidental cross-use.

## Prisma Recommendation

For the personal environment:

- prefer `npx prisma migrate deploy`
- avoid casual `npx prisma db push` on the personal database

Suggested rule:

- `db push` is acceptable in dev while experimenting
- `migrate deploy` is preferred for personal/stable

## Release Checklist

Before promoting code from dev to personal:

1. Confirm the feature works in dev
2. Confirm import test files behave correctly in dev
3. Run typecheck
4. Run build
5. Commit code
6. Merge to stable branch
7. Pull stable branch in personal environment
8. Back up personal DB
9. Run Prisma migration
10. Restart app
11. Import real data

## Database Backup Advice

Before any real-data import or schema update:

- create a PostgreSQL backup

Minimum practical backup command example:

```powershell
pg_dump -U postgres -d trading_journal_personal -F c -f D:\Backups\trading_journal_personal.backup
```

Restore example:

```powershell
pg_restore -U postgres -d trading_journal_personal --clean --if-exists D:\Backups\trading_journal_personal.backup
```

You can refine this later, but even simple backups are much better than none.

## Import Safety Advice

Because import logic is still evolving:

- always test a new scenario in dev first
- only import into personal after you are satisfied with the result
- back up personal DB before large or unusual imports

Important current note:

- position-side rollback is available in MVP form
- holding-related rollback is still intentionally limited

So for holding-heavy real imports, be more cautious.

## Recommended Deployment Style For You

For your current situation, I recommend:

### Right now

- keep this current machine/project as `dev`
- continue enhancing features here
- continue testing complex import scenarios here

### Later, when ready

- create a second app copy for `personal`
- connect it to a fresh personal database
- import real data only there

This gives you the safest balance between:

- freedom to keep improving
- protection for real data
- easier recovery if a new import edge case appears

## Suggested Commands

### Dev environment

```powershell
npm install
npx prisma generate
npx prisma db push
npm run dev
```

### Personal environment

```powershell
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
npm run start
```

Adjust based on how you finally deploy.

## Practical First Version

If you want the easiest first version later:

1. Clone/copy the repo into a second folder
2. Create a second PostgreSQL database
3. Point personal `.env` to that database
4. Check out a stable branch there
5. Run migrations
6. Start the app on another port
7. Begin importing real data there only

That is already a very good and safe personal deployment setup.

## Future Improvements

Later, if you want a more mature setup, you can add:

- automated backups
- VPS deployment
- domain name + HTTPS
- CI/CD deployment from stable branch
- Docker compose for app + DB
- proper production logging/monitoring

None of those are required to start safely.

## Bottom-Line Recommendation

Best advice for now:

- one codebase, two branches
- one app for dev, one app for personal use
- two separate PostgreSQL databases
- test imports in dev first
- import real data only into personal
- back up before important imports or schema changes

That will keep you productive without putting your real trading data at unnecessary risk.
