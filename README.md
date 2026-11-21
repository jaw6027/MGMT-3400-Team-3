# SplitCart

A friendly, phone-first household expense app built with **Expo SDK 54, React Native, TypeScript, and Supabase**. Includes a responsive web version and a clearly labeled, persistent demo household with four roommates, six purchases, a sample receipt, and a recorded repayment.

## Open the full browser preview — no setup

[Open SplitCart in your browser](https://raw.githack.com/jaw6027/MGMT-3400-Team-3/main/preview/index.html), then tap **Open sample household**. No installation, Supabase project, or payment account is needed. The source repository is public; the preview is served from that repository by a static-code CDN. If the CDN displays its standard confirmation page, continue to the preview.

This is a self-contained export of the actual Expo web app, including:

- Separate local preview logins and signup; creating/naming a household, copying codes, joining with another account, renaming, profiles, leaving and rejoining.
- Shopping plans from 61 spreadsheet items, custom expenses, purchaser assignments, last-buyer memory, and one-time flags.
- **Chore Tracker** with 19 spreadsheet chores, custom chores, recurring schedules, fixed or rotating members, and dated completion history.
- **Grocery & Restock Rotation** with weekly/custom grocery turns, Who’s up next, agreed swaps, skips, essentials linked to the existing shopping list, in-app reminders and completion/fairness history.
- Purchases, camera/library receipt attachment, reviewable item lists, automatic item-level shares, external cashback tracking, receipt viewing, equal/custom shares, edit/delete permissions, search and filters.
- Balances, settlement suggestions, manual repayment history, and sample bank/card payments with surcharge previews.
- Named recurring rent, internet, utility and subscription bills, bank-autopay consent, pause/edit/cancel, reminders and simulated phone verification (code **123456**).
- Seven card-network samples, the credit-only 2.5% fee, two-step security, bank verification, receiver-confirmed cash, searchable history and downloadable receipts.
- Payment requests with installments and remaining balances, duplicate-payment protection, processing/arrival estimates, safe failure explanations and bank issue alerts.
- Category spending totals with monthly filters, including dining, groceries, rent, internet, utilities and subscriptions.
- **Balances → Manage payments → Explore payment demo scenarios** provides one-click processing, failure and bank-issue examples; **Clear demo scenarios** removes only those example records.

Use **sample/made-up information only**. Preview accounts, household codes, receipts, and changes stay in the **same browser**; they are not shared across devices. The preview is a local interaction rehearsal, not real authentication or a secure shared backend. It sends no money, emails, or SMS, and automatic payments/reminders do not execute. The real Supabase/Stripe implementation remains separate and unchanged. Sign out to test another account, or use **Household → Reset demo data** to start over.

For payment setup, use the simulated authenticator code **123456**. Password recovery, bank/card linking, message delivery and background automatic charges are simulations. Device biometric unlock is unavailable in a web browser.

Sample logins: `alex@splitcart.demo`, `jordan@splitcart.demo`, `sam@splitcart.demo`, `riley@splitcart.demo`. All use password `splitcart-demo`. **Open sample household** signs in as Alex without typing credentials.

Maintainers can rebuild the single-file preview with `npm run build:preview` and test the generated file with `npm run test:e2e:preview`. `preview/index.html` includes its JavaScript and fonts, so it also runs from an ordinary static web host. The build forces a browser-preview flag and clears live Supabase configuration. Do not replace your production build with this rehearsal build.

## Run immediately (no credentials)

Requires Node 20.19+ (Node 22 LTS recommended) and npm.

```sh
npm ci
cp .env.example .env
npm start
```

Demo mode is on by default. Scan the QR code with an **Expo Go version compatible with SDK 54**, or press `w` for the browser. `npm run web` also launches the browser version. Demo changes are saved locally on the device; Settings → Reset demo data restores the sample household. Demo accounts and invitation codes are fictional, and demo data never reaches Supabase.

### iOS

On macOS with Xcode and an iOS simulator installed, use `npm run ios` with compatible Expo Go. On a physical iPhone, use compatible Expo Go on the same network. The App Store's latest Expo Go might not support SDK 54; in that case, build the native app:

```sh
npx expo run:ios
```

This generates the native project locally and requires Xcode/CocoaPods. A physical-device development build requires Apple signing. EAS development builds are another option; no EAS project or signing credentials are included.

### Android

Install Android Studio, configure an emulator/Android SDK, and use `npm run android` with compatible Expo Go. Obtain an SDK 54-compatible Android Expo Go from https://expo.dev/go, or build directly:

```sh
npx expo run:android
```

For a physical Android device, scan the QR code in compatible Expo Go or connect it with USB debugging for a native build. Camera access requires a real device or configured emulator camera. Browser photo selection uses the browser's file picker.

## Enable the live Supabase backend

1. Create a Supabase project. In its SQL Editor, apply every SQL file in `supabase/migrations/` **once, in filename order**. For an existing project, apply only migrations not already installed. The base migration creates tables, RLS, and private receipts; `202611170001_payments.sql` adds payment support; `202611180001_household_signup.sql` adds retry-safe signup onboarding and household renaming; `202611180002_payment_experience.sql` adds paused schedules, payment requests, private account alerts, and serialized occurrence payments; `202611180003_payment_verification_updates.sql` adds cash labels, bank-link progress, and notification delivery claims; `202611180004_cash_confirmation_recovery.sql` adds receiver-approved cash, cancel-autopay transactions, and hashed one-time MFA recovery codes. No manual public-bucket setup is necessary.
2. Copy your project URL and **public anon key** from Project Settings → API into `.env`:

   ```dotenv
   EXPO_PUBLIC_DEMO_MODE=false
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
   ```

   Expo public variables are bundled into the app. **Never use a service-role key, database password, or other secret here.** The anon key identifies the project; authenticated JWTs and RLS control access. `.env` is gitignored.
3. Enable email/password authentication in Supabase Auth. Configure your production email delivery and confirmation settings. For email confirmation, open the confirmation link in your email, then return to SplitCart and log in. Set the Auth Site URL to an accessible web URL (for local browser testing, `http://localhost:8081`). This MVP does not automatically import native confirmation-link sessions.
4. Restart Expo after changing variables: `npx expo start --clear`.
5. During signup, the first roommate selects **Create a household**, chooses any household name (1–80 characters), and chooses USD, EUR, GBP, CAD, or AUD. After authentication, SplitCart creates the household and immediately displays its private invitation code. A household uses one currency and performs no conversion.
6. Other roommates select **Join with a code** during signup, enter that code, and use **their own email address and password**. Once authenticated, each separate account joins the same household and sees its shared activity. Codes accept pasted spaces and either letter case. The code can be copied on web or shared through the native share sheet; find it again under **Household → Invite your roommates**. Each account has one active household. Leaving preserves purchases, shares, membership names, and repayments. Rejoining the same household restores the original membership ID.

### Household signup and names

Email confirmation remains required when configured in Supabase. SplitCart saves the household choice **on the signup device, keyed to that email address**, and finishes creating/joining only after the account signs in. Passwords are never saved in this pending choice, and invitation codes are not put into signup metadata or public URLs. If confirmation or login happens on another device, that device asks the user to enter the code or household name again. An invalid code leaves the new login intact and offers a correction screen; the user does not need to sign up twice.

Any current member can change the name under **Household → Make it your home → Save household name**. Names do not have to be unique, so separate households can choose the same name. Renaming preserves membership, the invitation code, purchases, repayments, and payment setup. Only authenticated members of that household can rename it. Treat the high-entropy invitation code like a private invitation: anyone who receives it can join with their own authenticated account.

Onboarding is serialized on the client and protected by a per-account transaction lock on the server. Retried signup completion does not create duplicate households or move an account that already belongs to a household. Existing create/join flows, expense permissions, and payment features remain available. Actual multiple-account membership requires the configured live backend; demo invitation codes are only samples.

For local Supabase development, install the Supabase CLI and Docker, then run:

```sh
supabase start
supabase db reset
supabase status
```

Use the displayed local API URL and anon key. The included config enables local email/password signup without confirmation. For Android emulators use `http://10.0.2.2:54321`; for physical phones use the computer's LAN IP, with suitable local firewall access. `localhost` on a phone points to the phone itself. Do not disable email confirmation in production without considering your account policy.

## What works

- Email/password signup and login, persistent sessions, sign out, and profile-name updates.
- Create/join a household, private invitation codes, multiple roommates, and leaving/rejoining while retaining history.
- Log or edit item, cost, date, payer, store, category, notes, and optional receipt. Take a photo or choose from the library. Preview equal or custom shares before saving.
- Household dashboard and purchase feed; search item/store/notes; filter by payer, category, and date range. Details show each share and a larger receipt viewer.
- Only the **current payer** can edit/delete a saved purchase. Any active roommate may log a purchase on behalf of another payer. Changing the payer transfers edit permission. Deletion requires confirmation.
- Net balances and simplified settlement suggestions across all purchases and recorded repayments, including former roommates. Record a repayment you sent or received; it is clearly labeled and does **not** transfer money.
- Friendly empty/loading/error states, validation, duplicate-submit guards, stable purchase/repayment IDs, and local demo persistence.

## Household shopping list

Open **Shopping → Add item**. The catalog imports all **61 items** from *Shared Expense List - Split Cart.xlsx*, grouped by its eight bold headings: **Utilities, Food, Household Items, Furniture, Kitchen, Bathroom, Pet Supplies, Subscription Services**. Original item names and order are preserved; heading colons and trailing cell whitespace are trimmed. **Other** is available for custom expenses. The workbook is treated as data and is not shipped with its personal file metadata.

Choose a catalog item, or select **Custom expense** and enter a name/category. Choose a current roommate under **Who will purchase this?** before adding it. Mark **One-time purchase** if appropriate. Planned items can be reassigned or removed with confirmation. Plans do not affect anyone’s balance.

Use **Log purchase** to enter the actual total, date, payer, receipt and individual shares through the existing purchase form. Saving creates the expense and completes the plan atomically. The actual payer can differ from the assigned shopper. One-time status can be chosen at planning time or on any purchase form, and is visible in purchase history/details. Purchased items retain their history; use the original purchase’s edit/delete permissions for corrections.

**Purchase memory** automatically shows the latest actual payer and date for that item after a linked purchase is logged. For repeat buys, it suggests the next active roommate after the previous buyer and always lets the user override the assignment. This is deterministic history-based automation, not an external AI model: it does not guess who bought an item, treat an assignment as a purchase, or infer receipt line items. Imported catalog IDs keep items consistent; custom names are matched case-insensitively within the same shopping category. Unlinked older purchases are not guessed from their names.

One-time purchases stay in history but have no **Buy again** shortcut and do not trigger a next-buyer suggestion. Users can explicitly add the item again if their plans change. Editing a linked expense updates its payer/date and one-time status in purchase memory. Deleting the expense reopens its planned item and removes that deleted purchase from memory. Former roommates’ historical purchases remain visible to current household members.

For live storage, apply **`supabase/migrations/202611190002_shopping_list.sql`** after earlier migrations. It seeds the same catalog, adds private household list storage, preserves existing expense validation/permissions, and records list completion and expense shares in one transaction. Only authenticated active household members can read/write their household’s plans; direct table writes and hidden base-expense RPC calls are denied. Duplicate completion requests cannot create a second expense. Both normal demo mode and the self-contained browser preview support the shopping flow without backend credentials.

## Chore Tracker

Open **Chore Tracker** (the **Chores** tab on phones). Choose **Add chore** to pick one of all **19 chores** from *Chore Chart - SplitCart.xlsx*, or **Custom chore** to name your own. The spreadsheet contains a single “Chore List” heading; its rows are kept in order. Trailing whitespace is trimmed and “Refridgerator” is displayed as “Refrigerator”; the original spelling remains in catalog `source_name` for reference.

Choose **Daily**, **Weekly**, **Biweekly** (14 days), or **Monthly**, and an initial due date. **Fixed member** assigns one current roommate indefinitely, until edited. **Take turns** uses at least two selected roommates, in selection order; choose the first member separately. Completing a chore advances to the member after the actual completer in that roster, skipping people who have left. Any current household member may help with another person’s assigned chore, but completion credit always belongs to the logged-in account.

**Log completion** lets you enter the day you actually did the chore, previews the next assignment/due date, and records it in **Completion history**. The next due date is based on the completed day, rather than the missed due date. Monthly dates clamp to the last day when necessary (January 31 → February 28/29). Older, backfilled completions add history without resetting the upcoming turn or date. Future dates are rejected using the device’s time zone (checked against server time in live mode). One completion per chore per calendar day is allowed; chores do not automatically mark themselves complete.

**Edit** changes upcoming chores. **Archive** removes a chore from Upcoming and retains its history; archived chores can be edited and restored. Users can **Undo my completion** only on their own most recent unchanged chore action. Undo restores the prior schedule and keeps the original record labeled **Undone**. Later edits, archiving, or completions prevent rollback of an older action. Leaving a household revokes access and preserves history; rotating chores skip departed roommates. If a fixed assignee leaves, reassign the chore before logging it.

Both demo modes support this feature without credentials; browser preview data stays in that browser. For a real shared backend, apply **`supabase/migrations/202611190003_chore_tracker.sql`** after the earlier migrations before deploying this app. It seeds the same catalog, enables household-scoped RLS, denies direct chore/history writes, derives completion authors from authentication, and serializes version-checked schedule changes and completion logging in database transactions. No new environment variables or external AI/payment services are needed for chores. Recurrence is a due-date tracker; background reminders and push notifications are not included.

Screenshots from the actual browser preview: [Chore Tracker](docs/previews/chore-tracker.png) and [completion history](docs/previews/chore-history.png).

## Money, permissions, and reliability

All money is stored and calculated in **integer cents**. Decimal strings are parsed without multiplying floating-point input. Equal splits sort membership IDs and distribute the remaining cents one by one, so shares always total the purchase. Custom splits must match exactly; individual shares may be zero. Purchase/repayment totals are capped at 1,000,000 currency units.

`save_expense` validates and saves the purchase and all shares in one database transaction. Table constraints enforce required fields and valid totals. Clients have no direct expense/share write grants. RPCs enforce active household membership, payer permissions, valid participants, unique shares, exact share totals, and private receipt paths. Receipt objects cannot be overwritten or deleted by clients. Manual repayments are append-only, require the recorder to be an active member and sender/recipient, and cannot link members of different households.

RLS protects household, purchase, share, repayment, and receipt reads. Private receipt previews use signed URLs that expire after five minutes; an already-issued URL can remain valid until it expires. The client and storage bucket validate JPEG/PNG/WebP types and a 5 MB maximum. MIME allowlists are not malware scanning. No OCR or receipt text extraction runs.

Household data refreshes on login, after your own writes, and on pull-to-refresh. Fetching paginates rather than silently stopping at Supabase's default row limit. Live mode requires a network connection; there is no offline write queue or realtime subscription. Retry after an error. Stable IDs prevent duplicate ledger rows for retries of the same form submission. Separate new forms intentionally create new purchases.

## Tests and builds

```sh
npm run typecheck
npm test
npm run test:db
npm run build:web
npx expo export --platform ios --platform android
```

`npm test` runs money/balance tests and **executes the application migrations against PostgreSQL through PGlite**, using minimal Supabase auth/storage scaffolding. It tests cross-household read/write isolation, anonymous access denial, payer-only mutations, transactional share validation, retry deduplication, repayment permissions, private receipt policies, and history retention/revocation after leaving. Chore tests cover all four recurrences, monthly/leap-year rounding, fixed and rotating assignments, departed members, backdated/future dates, duplicate/stale submissions, authorized undo, and private history. This exercises real SQL and RLS, but does not emulate the Supabase Auth or Storage HTTP services.

Browser tests:

```sh
npx playwright install chromium
npm run test:e2e
npm run test:e2e:households
```

Playwright starts Expo web automatically or uses an existing server on port 8081. To use a system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`. Tests cover phone purchase creation, invalid custom totals, edit/share preservation, receipt viewing, deletion confirmation, payer restrictions, repayments, profile persistence, desktop filtering, and the unconfigured live-login fallback. The fallback check assumes the example environment with empty live credentials. The separate household suite starts Expo on port 8082 with a clearly fictional Supabase endpoint. It simulates Auth HTTP responses while executing the real SQL migrations/RLS in PGlite, and exercises separate-account household signup, code-based joining, email-confirmation continuation, incorrect-code recovery, code copying, and renaming. It does not contact a hosted Supabase project.

## First-release boundaries

- Live credentials are not provided. Hosted authentication, email delivery, Storage HTTP uploads, and native camera permissions need a final integration check against your Supabase project and physical devices. Browser flows, SQL access rules, calculations, and bundle exports are verified locally.
- Use pull-to-refresh to see another roommate's latest changes. No realtime sync, offline queue, push notifications, or multi-household switcher.
- A manually recorded repayment is an append-only ledger entry; editing/reversing manual repayments is not included. Double-check before confirming.
- Client deletion removes a purchase and its shares. Original receipt files remain private, including abandoned uploads. Add a trusted scheduled cleanup job after choosing a retention policy; no service credentials belong in the client.
- No invite rotation, account deletion/export UI, or household administration roles in this MVP. Account erasure should use a trusted server-side process that preserves/anonymizes the ledger appropriately.
- Receipt recognition, subscriptions, and currency conversion are deliberately deferred. Live bank/card processing and text/email reminders require the provider deployment described below.

## Project map

- `App.tsx` — responsive navigation, dashboard, history, forms, details, balances, accounts, settings.
- `src/core.ts` — integer money, validation, equal splits, balances, settlements, client permission helpers.
- `src/ChoreTracker.tsx`, `src/chores.ts`, `src/choreCatalog.ts` — spreadsheet/custom chores, recurrence, rotation, and dated household completion history.
- `src/ShoppingList.tsx`, `src/shopping.ts`, `src/shoppingCatalog.ts` — categorized planning, spreadsheet catalog, assignments, factual purchase memory, and repeat-buyer suggestions.
- `src/backend.ts` — Supabase setup, paginated reads, private receipt uploads and signed URLs.
- `src/store.tsx` — demo/live state, sessions, persistence, mutations.
- `src/households.ts` — signup household choices, validation, email-bound continuation, and setup RPC calls.
- `src/demo.ts` — sample household and local sample receipt.
- `src/ui.tsx`, `src/Illustration.tsx` — design system and original basket artwork.
- `supabase/migrations/` — deployable database and private storage setup.
- `src/*.test.ts`, `e2e/` — calculation, SQL/RLS, and browser workflow tests.

## Bank/card payments, automatic dues, and payment reminders

Open **Balances → Manage payments** for hosted bank/card setup, receiving-bank onboarding, a payment review with a **2.5% credit-card-only surcharge**, fixed monthly bank autopay, and verified email/text reminder preferences. Demo mode uses sample accounts and simulated payments; it never moves funds or sends messages. Live use requires the additional migration, deployed Edge Function, Stripe Connect, Twilio, Resend, and a recurring job. See [payment setup and operational details](docs/payments.md) for configuration, test steps, and current limits.

The home screen includes an **Upcoming payments** dashboard. Payment controls are organized into **Upcoming**, **Accounts**, **Pay**, **Autopay**, **Reminders**, **Requests**, and **Activity**. Accounts explains paying versus receiving setup. Pay shows a running fee estimate and the selected method in the final confirmation. Autopay keeps the recipient, amount, bank, and consent together, supports editing and pausing without deleting the schedule, and shows the next automatic charge. Requests attach a purchase to a specific roommate’s requested amount; completed payments update the request status. Activity has status explanations, search, and downloadable text receipts (native uses the share sheet). Reminders shows phone verification and timing, hiding completed verification steps until the number changes. Autopay covers fixed monthly dues, not a changing household balance; reminder dates use UTC.

Screenshots of the actual sample-account flows: [upcoming payments and history](docs/previews/experience.png), [payment requests](docs/previews/requests.png), [the original four payment screens](docs/previews/overview.png), [bank and card setup](docs/previews/accounts.png), [credit-card fee preview](docs/previews/payment.png), [monthly bank autopay](docs/previews/autopay.png), and [email/text reminders](docs/previews/reminders.png).


## Recovery, device unlock, and accessibility

**Forgot password?** requests a Supabase recovery email with a neutral response. Add your exact web app URL and `splitcart://recovery` to Supabase Auth’s allowed redirect URLs and configure recovery-email delivery. Open the recovery link to choose and confirm a new password. Browser preview displays an explicit simulation message and never sends a reset email or changes a preview password. Native implicit recovery links are handled by the app; test link delivery and expired links on physical devices before release.

**Household → Account security** enables optional biometric unlock on supported iOS/Android devices with enrolled biometrics. Enabling/disabling requires a biometric check; the app locks on launch and after backgrounding. The lock does not replace server authentication or encrypt stored Supabase sessions. Signing out from the lock clears this device’s unlock preference so a subsequent password login can recover access if biometrics become unavailable. Face ID requires a native development/production build with the included permission plugin; Expo Go does not support Face ID. Web disables the biometric option. Physical-device biometric behavior still needs validation.

**Household → Accessibility** provides a persistent larger-text preference in addition to native system text scaling. Shared buttons/chips have at least 44-point targets, labels wrap, input placeholders use the stronger muted-text contrast, headings are announced, and buttons expose disabled/busy states. Verify screen-reader behavior with VoiceOver/TalkBack on real devices.


## Bank verification, cash, and payment notices

**Balances → Manage payments → Accounts** requires an authenticator-app check before opening bank/card or receiving-bank setup. Add SplitCart to your authenticator using the QR code or enrollment key, then verify your current password and its six-digit code. The payment service validates both a fresh password proof and an authenticated Supabase AAL2/TOTP claim; linking unlocks for five minutes. Enable TOTP MFA in Supabase Auth before live use. Biometric app unlock and phone verification do not replace this check. Create eight backup codes after a fresh authenticator check and save them privately. A lost authenticator can be recovered with a fresh password login plus one unused backup code. Financial linking remains locked until a replacement authenticator is verified. Without backup codes, contact the operator for identity-verified recovery; password reset alone cannot bypass the second factor.

Bank ownership progress comes from Stripe: details needed, verification pending, verified, failed, or expired. Complete required test-deposit verification on Stripe’s secure page, then refresh status. Pending banks cannot pay or fund autopay. Existing bank methods are checked against successful SetupIntents. Receiving-bank progress separately shows missing details, provider review, restrictions, or readiness.

**Record repayment → Cash** sends a cash entry to the receiving roommate for confirmation or dispute. Pending and disputed entries do not update balances. Only a receiver-confirmed entry enters the ledger once, without moving money or sending a processor-confirmed payment notice. Other outside-payment recording remains available. Direct cash ledger inserts and client claims of processor-confirmed bank/card payment are blocked.

**Reminders** adds separate opt-ins for email/text advance autopay notices and payment-status updates. Advance notices are sent one day before a scheduled bank charge. Pending, successful, failed, and authentication-required updates are claimed once per payment/event/channel/recipient. They use the existing verified, opted-in email/text channels; in-app updates are also available. Recipient notifications and incoming progress expose the amount/status without sharing the sender’s masked payment method or surcharge. The demo simulates bank security with code **123456** and requires **Complete sample bank verification** before using a sample bank; no real MFA, email, texts, or transfers run there.

Apply all migrations before deploying the updated `payments` function. The scheduled job also reconciles recent pending payments and delivers unclaimed updates for orders created in the last seven days; signed webhooks and app refresh handle later updates. Existing orders are excluded from retroactive notifications. Hosted MFA, real bank verification, SMS/email delivery, and physical-device behavior still need test-provider integration checks.

Latest screen previews: [two-step verification](docs/previews/two-step-verification.png), [bank verification progress](docs/previews/bank-verification-progress.png), [roommate payment progress](docs/previews/payment-progress.png), [cash payment recording](docs/previews/cash-payment.png), and [autopay/status notice preferences](docs/previews/payment-notices.png).


## Cash confirmation, verification recovery, and canceling autopay

**Balances → Cash confirmations** shows cash awaiting review. Only the sender can propose a cash entry; only the receiving roommate can confirm or dispute it. Confirming adds a single repayment; retries cannot credit it twice. A dispute leaves balances unchanged and both roommates should resolve it before creating a corrected entry. Existing cash repayments recorded before this migration retain their prior balances rather than being retroactively reversed. Cash confirmation settles the household ledger; it does not automatically cancel or pay a separate monthly schedule.

**Accounts → Bank verification** offers **Continue bank setup** for unfinished provider setup, **Complete bank verification** for required test deposits, and **Restart bank verification** after failure/expiry. Deposit arrival dates are shown only when the provider supplies one. A temporary progress outage never marks a bank verified. All financial setup and verification links still require a fresh two-step check.

**Accounts → Create backup codes** shows eight codes once. Each can be redeemed once together with a fresh password login. Only SHA-256 hashes are stored by the live service; codes are generated with 128 bits of cryptographic randomness. Replacing codes invalidates the previous set. **Lost your authenticator?** removes old factors only after both proofs, then requires enrollment and verification of a replacement before linking financial details. A reset interrupted by a provider error can resume in its original fresh password session. If that session expires, use another unused code after signing in again; if old factors were already removed, sign in and complete replacement enrollment. Keep backup codes offline and out of screenshots. The sample flow uses password `splitcart-demo` and simulated MFA; it never resets real authenticators.

**Autopay → Cancel autopay** asks for confirmation, revokes future automatic-charge authorization, and keeps the monthly due and payment history for manual payment. It does not erase money owed or reverse a bank payment already processing. Re-enabling requires fresh authorization. **Remove monthly due** removes the schedule; it remains separate from canceling autopay. No “skip this month” option is added.

Apply migration `202611180004_cash_confirmation_recovery.sql` before deploying the updated app and payment function. Validate factor-reset/session behavior, bank verification, and notification delivery with a hosted test project and physical devices before production use.

Updated screen previews: [cash awaiting receiver approval](docs/previews/cash-confirmation.png), [confirmed cash](docs/previews/cash-confirmed.png), [bank verification recovery](docs/previews/bank-verification-recovery.png), [lost-authenticator recovery](docs/previews/authenticator-recovery.png), and [canceling autopay](docs/previews/cancel-autopay.png).

## Card networks

Secure card setup uses Stripe’s general `card` payment type without a SplitCart brand restriction. The app names **Visa, Mastercard, American Express, Discover, UnionPay, JCB, and Diners Club International** in Accounts and displays the brand Stripe detects on saved cards, payment reviews, and new receipts. Live card setup detects the network automatically; users do not select a brand or enter card numbers in SplitCart itself.

The browser demo includes a selector for all seven networks and distinct masked sample cards. The existing two-step security check still applies before adding cards. The **2.5% surcharge applies only when Stripe classifies the card as credit**; debit remains surcharge-free. Prepaid or unknown funding classifications remain unsupported rather than being guessed from the brand. The catalog is not an allowlist: other eligible provider-supported networks are not blocked solely because they are absent from this display list.

Actual acceptance depends on Stripe account eligibility, account country, issuer, currency, and authentication support. [Stripe’s card-brand capabilities](https://docs.stripe.com/payments/cards#online-card-brand-capabilities) currently list all seven requested networks for US Stripe accounts. Confirm the account’s payment-method settings and test each applicable network using Stripe’s official test methods before live deployment. No additional database migration is required for this update; deploy the updated app and payment function for the new card labels.

Bank linking includes guidance for Wells Fargo, Chase, Bank of America, Citibank, Goldman Sachs, Capital One, US Bank, and PNC Bank, plus a secure account-and-routing-number entry point with provider-supported manual entry and microdeposit verification. Eligibility depends on the specific account and provider; the list does not restrict other banks or guarantee all products at a named bank. Fresh two-step security and bank ownership verification remain mandatory. Receiving-bank onboarding is separate. See [bank coverage details](docs/payments.md#bank-coverage-and-manual-account-entry).

Previews: [seven card networks](docs/previews/card-networks.png), [credit payment review](docs/previews/card-network-review.png), and [bank linking options](docs/previews/bank-linking-options.png).

## Payment safeguards and clearer status

SplitCart now blocks matching pending bank/card/cash payments and protects recent equal-amount completions for ten minutes. Activity shows dated recipient-bank arrival estimates, explains provider-reported failures, and warns when an estimate has passed. Accounts highlights bank verification, availability and receiving-bank issues. Health transitions generate deduplicated in-app alerts and opted-in email/text status notifications; the existing payment job checks bank health in the background.

Apply `202611190001_payment_safety.sql` before deploying the updated app and payment function. Arrival windows are planning estimates, not confirmed payouts; live bank/Stripe configuration and staging verification are still required. See [payment safety and bank health](docs/payments.md#duplicate-protection-arrival-estimates-and-bank-health).

New simulated screen previews: [duplicate protection](docs/previews/duplicate-payment-protection.png), [processing and estimated arrival](docs/previews/payment-processing-arrival.png), [bank issue alert](docs/previews/linked-bank-alert.png), and [failure explanation](docs/previews/payment-failure-reason.png).

## Installments, recurring bills, and spending breakdown

- **Payment requests:** pay part now and the rest later, with paid/processing/remaining balances shared between roommates. Confirmed principal counts toward the request; credit fees stay separate. Server reservations prevent overpayment and concurrent duplicate attempts.
- **Recurring bills:** name monthly rent, internet, utilities, subscriptions, and other dues in Autopay. Choose a manual due or authorize bank autopay, then view the named schedule in Upcoming. These schedules pay eligible household recipients; external biller integrations are not included.
- **Spending by category:** Overview shows amounts, percentages and purchase counts for this month, last month or all time. New purchase categories include Rent, Internet, Subscriptions and Dining. Reports exclude repayments, fees, planned shopping and future schedules.

Deploy migration `202611190004_partial_recurring_categories.sql` before the updated payment function/app. Scheduled monthly occurrences remain full-amount payments; installment tracking is available on payment requests. See [details and deployment notes](docs/payments.md#partial-requests-named-recurring-bills-and-spending-categories).

Previews: [partial payment](docs/previews/partial-payments.png), [recurring bills](docs/previews/recurring-bills.png), [spending breakdown](docs/previews/spending-breakdown.png).

## Receipt items and cashback tracking

In **Add a purchase → Receipt**, upload a photo and choose **Itemize receipt and track cashback**. Enter line totals and assign each item to the people sharing it. SplitCart calculates the full total and each person's share, including proportional tax, tip and discount, with cent-perfect reconciliation. Review the items before saving. Details retain the item list and assignments alongside the photo.

An optional server-side **Scan receipt items** integration can extract receipt facts for review. Configure and deploy `scan-receipt` with a server-only `OPENAI_API_KEY` to enable it; manual entry always works. The browser preview offers **Load sample receipt items** using the known sample image, rather than pretending to scan uploaded images. Apply migration `202611190005_itemized_receipts.sql` before deployment. See [configuration, limits and privacy](docs/payments.md#itemized-receipts-and-external-cashback-tracking).

Cashback fields track **external card or retailer rewards** that you expect or report as received. They do not change roommate debts or spending. SplitCart does not fund, verify, issue, pay out or redeem cashback. A separate summary appears under the category breakdown when rewards have been recorded.

Receipt previews: [calculated roommate amounts](docs/previews/receipt-item-split.png), [itemized receipt with photo](docs/previews/itemized-receipt-details.png), and [external cashback tracker](docs/previews/cashback-tracker.png).

## Developer-only business and payout-bank settings

The live app now supports **Household → Developer business settings** for explicitly approved app-developer accounts. Ordinary users and public-demo accounts never see these controls. Server-side role checks, private database tables and fresh password/TOTP verification protect business profile and financial responses; frontend visibility alone is not the security boundary.

Developers can record the business legal name, Corporation/LLC/Sole proprietorship structure, and a compatible tax classification such as C corporation or S corporation. This is an internal record, not a filing or tax election. The business-funds panel shows available/pending Stripe platform balances and masked bank metadata, and opens Stripe's secure business payout-bank settings for account/routing entry. SplitCart never stores full bank numbers or initiates a payout from this screen. Roommate payment destinations stay unchanged.

Deploy migration `202611190006_developer_business.sql` and `developer-business`, then have a trusted database operator grant the verified developers' Auth UUIDs. No users are granted access automatically. See [provisioning, privacy and deployment](docs/payments.md#private-developer-business-settings). The public preview intentionally contains no developer account, private-data sample or developer-mode bypass.

## In-app support assistant

Use the floating chat button for **SplitMate Assistant**, SplitCart’s local support guide. It offers step-by-step help, suggested questions and shortcuts to existing screens in both the app and packaged browser demo. No external AI API or paid service is required. Subscription plans/prices and the public support contact are explicitly marked as undefined until the team configures them. See [assistant behavior, editable FAQ content and testing](docs/support-assistant.md).

## Grocery & Restock Rotation

Open **Rotation** on a phone or **Grocery & Restock Rotation** in the sidebar. Choose participants and cadence, see who is next, mark a completed turn, or request an agreed swap. Report essentials as Running Low to place them on the existing shared shopping list with the responsible shopper and shopping notes. Grocery duty and expense shares stay separate. Both demo modes persist changes locally; the browser preview’s separate sample accounts demonstrate swap acceptance in the same browser. Grocery reminders are in-app only.

For live mode, apply `202611190007_grocery_rotation.sql` after prior migrations before deploying. See [demo walkthrough, scheduling rules, storage limitations and tests](docs/grocery-rotation.md). The assistant now also understands short prompts such as “rent,” “owe,” “low,” “swap,” “who’s next,” and contextual “how?”.

## Venmo / Zelle and bank-card logos

**Balances → Venmo & Zelle** provides an outside-payment flow: open the recipient's Venmo profile or find your participating Zelle bank, complete payment there, then record it in SplitCart. The receiving roommate must confirm it before the balance changes, and can dispute it. Navigation is not a transfer or a settlement confirmation. Contacts are entered once and are not stored; SplitCart does not link outside-service credentials or add its card surcharge to these records. The demo simulates navigation and confirmations without moving money.

All seven requested card networks and eight banks now have bundled provider artwork beside their names, with logos on recognized saved methods and Venmo/Zelle choices. Logos load locally in the web preview and native app; unknown providers retain a generic icon. See [artwork sources](assets/payment-brands/SOURCES.md).

Apply `202611210001_external_payments.sql` before deploying the updated app. Cash confirmations and duplicate safeguards are preserved. Outside payments do not automatically settle a request/monthly due or cancel autopay; review overlapping schedules before paying. See [flow details and limitations](docs/payments.md#venmo-zelle-and-provider-logos).

Visual previews: [bank logos](docs/previews/bank-logos.png), [card logos](docs/previews/card-logos.png), [Venmo](docs/previews/venmo-outside-payment.png), [Zelle](docs/previews/zelle-outside-payment.png).
