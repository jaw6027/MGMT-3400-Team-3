# SplitCart

A friendly, phone-first household expense app built with **Expo SDK 54, React Native, TypeScript, and Supabase**. Includes a responsive web version and a clearly labeled, persistent demo household with four roommates, six purchases, a sample receipt, and a recorded repayment.

## Open the full browser preview — no setup

[Open SplitCart in your browser](https://raw.githack.com/jaw6027/MGMT-3400-Team-3/main/preview/index.html), then tap **Open sample household**. No installation, Supabase project, or payment account is needed. The source repository is public; the preview is served from that repository by a static-code CDN. If the CDN displays its standard confirmation page, continue to the preview.

This is a self-contained export of the actual Expo web app, including:

- Separate local preview logins and signup; creating/naming a household, copying codes, joining with another account, renaming, profiles, leaving and rejoining.
- Purchases, camera/library receipt attachment, receipt viewing, equal/custom shares, edit/delete permissions, search and filters.
- Balances, settlement suggestions, manual repayment history, and sample bank/card payments with surcharge previews.
- Monthly dues and bank-autopay consent, reminder preferences, and simulated phone verification (code **123456**).

Use **sample/made-up information only**. Preview accounts, household codes, receipts, and changes stay in the **same browser**; they are not shared across devices. The preview is a local interaction rehearsal, not real authentication or a secure shared backend. It sends no money, emails, or SMS, and automatic payments/reminders do not execute. The real Supabase/Stripe implementation remains separate and unchanged. Sign out to test another account, or use **Household → Reset demo data** to start over.

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

1. Create a Supabase project. In its SQL Editor, apply every SQL file in `supabase/migrations/` **once, in filename order**. For an existing project, apply only migrations not already installed. The base migration creates tables, RLS, and private receipts; `202611170001_payments.sql` adds payment support; `202611180001_household_signup.sql` adds retry-safe signup onboarding and household renaming. No manual public-bucket setup is necessary.
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

`npm test` runs money/balance tests and **executes the unchanged application migration against PostgreSQL through PGlite**, using minimal Supabase auth/storage scaffolding. It tests cross-household read/write isolation, anonymous access denial, payer-only mutations, transactional share validation, retry deduplication, repayment permissions, private receipt policies, and history retention/revocation after leaving. This exercises real SQL and RLS, but does not emulate the Supabase Auth or Storage HTTP services.

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
- No invite rotation, password-reset UI, account deletion/export UI, or household administration roles in this MVP. Account erasure should use a trusted server-side process that preserves/anonymizes the ledger appropriately.
- Receipt recognition, subscriptions, shopping lists, and currency conversion are deliberately deferred. Live bank/card processing and text/email reminders require the provider deployment described below.

## Project map

- `App.tsx` — responsive navigation, dashboard, history, forms, details, balances, accounts, settings.
- `src/core.ts` — integer money, validation, equal splits, balances, settlements, client permission helpers.
- `src/backend.ts` — Supabase setup, paginated reads, private receipt uploads and signed URLs.
- `src/store.tsx` — demo/live state, sessions, persistence, mutations.
- `src/households.ts` — signup household choices, validation, email-bound continuation, and setup RPC calls.
- `src/demo.ts` — sample household and local sample receipt.
- `src/ui.tsx`, `src/Illustration.tsx` — design system and original basket artwork.
- `supabase/migrations/` — deployable database and private storage setup.
- `src/*.test.ts`, `e2e/` — calculation, SQL/RLS, and browser workflow tests.

## Bank/card payments, automatic dues, and payment reminders

Open **Balances → Manage payments** for hosted bank/card setup, receiving-bank onboarding, a payment review with a **2.5% credit-card-only surcharge**, fixed monthly bank autopay, and verified email/text reminder preferences. Demo mode uses sample accounts and simulated payments; it never moves funds or sends messages. Live use requires the additional migration, deployed Edge Function, Stripe Connect, Twilio, Resend, and a recurring job. See [payment setup and operational details](docs/payments.md) for configuration, test steps, and current limits.
