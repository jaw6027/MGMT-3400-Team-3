# Household subscriptions (simulated classroom billing)

## Preview

Run `npm ci`, then `npm run web -- --port 3100`, or open the committed `preview/index.html` through an ordinary static web server. No Supabase project, Stripe account, card, bank account, email delivery or payment credentials are needed for either demo.

1. Open the sample household. Go to **Household → Compare plans and manage subscription**.
2. Alex is the sample household's billing manager. Select Basic ($3.99), Plus ($5.49), or Premium ($6.99), then confirm **Start 30-day trial**. Prices are USD per household per month, including households whose expense currency is different. No conversion occurs.
3. Check the trial expiration and renewal dates (UTC). The trial starts on activation, lasts exactly 30 days, and is available once per household. Selecting a different trial plan does not reset those dates.
4. In **Classroom billing simulator**, choose **Simulate failure on next payment**, then **Advance to trial expiration**. Review the failed record, then **Retry simulated payment**. Retry updates the same failed record; it does not create a second charge.
5. Schedule an upgrade or downgrade and advance to the next renewal. Changes apply at the next billing boundary, with no proration or extra mid-cycle charge. During the free trial, changes instead apply immediately to the plan that will be billed first. Selecting the current plan clears a queued change.
6. Cancel and confirm. Cancellation takes effect at the end of the current trial/paid period, without another charge. **Keep subscription renewing** reverses a scheduled cancellation. Past-due cancellation is immediate. Reactivating an ended subscription records an immediate simulated monthly charge and never grants another trial.
7. Purchases, receipts, balances and repayments remain available and unchanged. Subscription charges do not enter any expense or repayment ledger. No existing features are gated on tier or billing status.

For independent logins, use the packaged browser preview. Switch accounts under Household and log in as `jordan@splitcart.demo` (password `splitcart-demo`). Jordan sees the same plan and dates but cannot change them. Alex can transfer billing management to another active roommate. If the manager leaves, the earliest remaining member can explicitly recover management. Ordinary demo mode has only Alex's login. Browser preview accounts and subscription records are local to one browser, with no cross-device sync.

**Reset demo data** clears simulated subscriptions along with the existing sample data. Cancellation never resets trial eligibility; explicit demo reset starts the classroom rehearsal over.

## Configurable proposed benefits

`src/subscriptions.ts` is the shared UI/support configuration. Basic proposes expenses, receipt attachments, balances and shopping. Plus adds chore, grocery/restock and recurring-bill organization. Premium adds itemized splits, spending insights, percentage templates and fairness/comparison tools. These are proposals using existing functionality, not exclusive access or newly promised services. All existing functionality remains available on every tier, before activation and after cancellation. Enabling any feature restrictions requires a separate approved change.

Prices are authoritative on the server in `subscription_price` and mirrored in the TypeScript plan configuration. Future price changes require a new migration and corresponding configuration/test update. Do not edit an already-applied migration.

## Persistence and permissions

Apply `supabase/migrations/202611260001_household_subscriptions.sql` after all previous migrations to enable the same simulated feature on a configured Supabase backend. This is still simulated billing; it never invokes a real provider. The application tolerates this optional migration being absent and continues loading all existing household data.

- One private `household_subscriptions` row per household contains the lifecycle state, original trial dates, current/pending plans, manager, version, simulated clock and charge history.
- Authenticated active members can obtain a snapshot via the scoped RPC. Only the designated active billing manager can activate/change/cancel/retry/advance/transfer. Manager selection uses the earliest household membership (joined date, then ID); recovery uses the earliest remaining active member after the old manager leaves.
- Clients cannot write the table, set prices, reset a trial, supply billing dates/statuses, impersonate the manager, or alter charge records. Public RPCs accept only defined actions and validate membership server-side.
- Household row locks serialize initialization, activation and billing changes. Expected versions reject stale requests. Renewal IDs are deterministic by billing boundary; repeated refreshes do not create extra charges. The demo adapters use the existing local-data lock, including Web Locks when available.
- Renewals reconcile lazily when the subscription is loaded/refreshed or an action runs. There is no timer worker, external scheduler, webhook or actual monthly debit. Simulator advances affect subscriptions only. Monthly renewals use UTC calendar months and clamp dates at month end; the initial trial is exactly 30 days.
- Subscription cancellation does not delete or rewrite household financial history. A manager transfer does not restart the trial. Failure creates subscription status/history only, never a roommate debt.

## Legacy app-dues protection

Subscriptions remain separate from roommate payments. Once a household has activated a subscription, legacy app dues stay disabled even after subscription cancellation, preventing a second billing path from silently resuming.

The migration pauses and disables automatic legacy app schedules for every household member on activation, while preserving their records. Activation refuses to overlap an existing created/processing/action-required app payment. Database triggers lock the same household and reject new legacy app payment orders or unpaused app schedules after activation, before the existing payment service can create a provider intent. This also protects the existing background payment job. Roommate payment orders and schedules are unaffected.

Both classroom modes hide the app-dues destination, display legacy app schedules as paused, and check fresh household activation before confirming a legacy app payment or saving an app schedule. Historic app payments remain in Activity. No live payment service deployment or modification is necessary for the database trigger protection, but the new migration must be applied for a configured backend.

## Verification

- `npm run typecheck`
- `npm test` (includes subscription unit, database, preview backend and existing regression tests)
- `npm run test:db`
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- subscriptions.spec.ts`
- `npm run build:web`
- `npm run build:preview`
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e:preview -- subscriptions.spec.ts`

Use the project's normal Playwright browser installation if the Chromium executable above differs. On a managed cloud computer, avoid reserved service ports: an alternate Playwright config can point the ordinary app at port 3100 and the static preview at 3101. Existing default configs retain their original ports for classmates' workflows.

Database tests apply every migration using PGlite and validate authorization, stale requests, one trial, all prices, renewal, retries, cancellation, recovery, ledger preservation, legacy schedule suspension and app-order rejection. Browser tests exercise the lifecycle, two separate preview accounts, responsive layouts and absence of Stripe requests from the subscription flow.

## Limits

This intentionally provides no real checkout, credentials, provider subscription, tax calculation, refunds, prorated invoices, email notices, or feature entitlements. The demo is a local rehearsal rather than secure authentication. Configured Supabase mode adds server permissions but still uses simulated billing. Before any production monetization, separately review tier restrictions and ownership policies, add provider-confirmed billing integration and background reconciliation, and complete staging validation. No receipt-upload or spending-chart work is part of this change.
