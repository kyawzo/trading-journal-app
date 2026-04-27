# Auth And Onboarding Plan

## Status Summary

Auth and onboarding are no longer just planned. The project now has a working user-owned model with onboarding and user-scoped broker context.

Implemented:

- `User` ownership across broker accounts and portfolio data
- `UserPreference` with:
  - `activeBrokerAccountId`
  - `themeMode`
- signup
- login
- logout
- protected portal pages
- protected write APIs
- onboarding flow
- first broker account creation during onboarding
- opening balance creation during onboarding
- settings/account update flow

Still remaining:

- broader automated integration coverage
- deeper nested ownership tests
- future account-management enhancements such as email verification/change flow

## Current Ownership Model

Current hierarchy:

- `User`
- `BrokerAccount`
- `Position`
- `Holding`
- `CashLedger`

With `Broker` remaining shared lookup data.

This keeps the ownership boundary clear:

- each user owns broker accounts
- each broker account owns holdings, positions, cash, and imports
- broker definitions remain reusable lookup records

## Preference Model

The app now uses per-user preference state instead of the old global-only idea.

Current preference direction:

- `UserPreference`
- active broker stored per user
- theme mode stored per user

Notes:

- some helper/file naming still uses `workspace` wording for compatibility
- behavior is now user-scoped, even where older naming remains

## What Is Already Implemented

### Phase 1: Prisma And Database Foundation

Implemented:

- `User`
- `UserPreference`
- `BrokerAccount.userId`
- user ownership carried through broker-scoped data
- bootstrap/dev support for initial user setup

### Phase 2: Authentication

Implemented:

- `/signup`
- `/login`
- logout flow
- password hashing
- session cookie/session lookup
- current-user helpers in `src/lib/auth.ts`

### Phase 3: Route And API Protection

Implemented:

- protected portal layout
- authenticated API checks on core write routes
- ownership validation through user-owned broker accounts

Core protected areas now include:

- dashboard
- positions
- holdings
- cash ledger
- broker accounts
- imports
- settings

### Phase 4: User-Aware Helpers

Implemented in practice:

- active broker/theme resolution is user-scoped
- broker scoping is driven through the authenticated user context

Partial follow-up still possible:

- rename older `workspace` helper/file wording later for clarity

### Phase 5: Onboarding Flow

Implemented:

- onboarding route
- first broker account creation
- optional set-active behavior
- optional opening balance creation
- redirect into the working app afterward

### Phase 6: UX Tasks

Implemented:

- signup page
- login page
- onboarding page
- guided broker-account-first onboarding
- settings page with profile/password controls

### Phase 7: Security Checklist

Implemented baseline:

- unique email constraint
- password hashing
- route protection
- API protection
- ownership checks on main resource flows
- safe login redirect handling
- generic login failure messaging

### Phase 8: Testing

Partially implemented:

- automated tests for redirect/email validation utilities
- manual auth/onboarding test matrix documented

Still needed:

- route-handler integration tests for signup/login/logout
- nested ownership tests for action/leg/event subroutes
- onboarding integration tests using a test database

## Recommended Next Auth Work

Highest-value remaining work:

1. Add route-handler integration tests for:
   - signup
   - login
   - logout
2. Add deeper ownership tests for nested resources:
   - position actions
   - position legs
   - holding events
   - imports rollback/import routes
3. Add onboarding integration coverage:
   - first broker account
   - set active broker
   - opening balance creation
4. Clean up naming debt:
   - reduce remaining `workspace` terminology where it now means user preference
5. Future account enhancements:
   - email change flow
   - email verification
   - stronger password policy/reset flow

## Practical Current Milestone

The app already meets this milestone:

`A user can sign up, log in, onboard with a first broker account and opening balance, and only access their own broker-scoped trading data.`
