# Phase 8 Test Matrix

This file tracks current auth/onboarding coverage and the next automation gaps to close.

## Current Coverage Snapshot

Implemented in product:

- signup
- login
- logout
- onboarding
- first broker account creation
- opening balance creation
- user-scoped broker context
- protected portal pages
- protected core APIs

Coverage status:

- utility/unit coverage: partial
- manual integration coverage: documented
- route-handler integration coverage: still needed
- nested ownership coverage: still needs expansion

## Automated Coverage (Currently Implemented)

Command:

```bash
npm test
```

Current automated tests include utility/security checks such as:

1. `safeRedirectPath` accepts valid local paths.
2. `safeRedirectPath` rejects unsafe paths.
3. `safeRedirectPathFromReferer` only accepts same-origin referer paths.
4. `isValidEmail` accepts common valid emails.
5. `isValidEmail` rejects malformed emails.

## Manual Integration Coverage

### Auth

1. Signup success
- Go to `/signup`.
- Enter valid email, password, and matching confirmation.
- Expected: account is created and redirected to `/onboarding`.

2. Signup duplicate email
- Create an account once.
- Try again with the same email.
- Expected: duplicate-email validation is shown.

3. Signup invalid password
- Use a password below minimum requirement.
- Expected: validation error is shown and account is not created.

4. Login success
- Go to `/login`.
- Enter valid credentials.
- Expected: redirect to `/onboarding` if no broker account exists, otherwise into the portal.

5. Login wrong password
- Use an existing email with the wrong password.
- Expected: generic incorrect-credentials message.

6. Logout success
- Trigger logout from the portal nav.
- Expected: session is cleared and user returns to login/landing flow.

### Authorization

1. Unauthenticated page redirect
- Open a protected page while signed out.
- Expected: redirect to `/login` with safe next path behavior.

2. Unauthenticated API rejection
- POST to protected endpoints without a valid session.
- Expected: login redirect or authenticated rejection response.

3. User A cannot read User B data
- Create two users.
- As user A, try direct URLs for user B resources.
- Expected: no cross-user data is shown.

4. User A cannot mutate User B data
- As user A, attempt updates/deletes on user B resources.
- Expected: write is blocked and target data stays unchanged.

### Onboarding

1. New user with no broker accounts
- Signup a fresh user.
- Expected: onboarding broker form appears.

2. Creating first broker account
- Submit the onboarding broker form.
- Expected: account is created for the current user only.

3. Setting active broker
- Keep set-active enabled.
- Expected: created broker becomes active in user preference and sidebar context.

4. Creating opening balance entry
- Enter an opening balance during onboarding.
- Expected: initial cash ledger deposit row is created for that broker account.

### Settings / Account

1. Update profile
- Open Settings and save profile changes.
- Expected: user profile fields persist for the authenticated user.

2. Update password
- Submit current password + new password flow.
- Expected: password changes successfully and old password no longer works.

## Recommended Next Automation Slice

Highest-value next tests:

1. Route-handler integration tests for:
- `/api/auth/signup`
- `/api/auth/login`
- `/api/auth/logout`

2. Ownership enforcement tests for nested routes:
- position action routes
- position leg routes
- holding event routes
- import routes

3. Onboarding integration tests using a test database:
- broker account creation
- set active broker
- opening balance creation

4. Settings integration tests:
- profile update
- password update

## Exit Criteria For “Phase 8 Solid”

Phase 8 should be considered solid when:

- auth route handlers are covered by integration tests
- onboarding broker + opening balance flow is covered automatically
- nested ownership checks are covered automatically
- manual-only coverage is reduced to exploratory edge cases instead of core flows
