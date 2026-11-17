# SplitCart

A friendly, phone-first household expense app built with **Expo SDK 54, React Native, TypeScript, and Supabase**. Includes a responsive web version and a clearly labeled, persistent demo household with four roommates, six purchases, a sample receipt, and a recorded repayment.

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

1. Create a Supabase project. In its SQL Editor, run **all of** `supabase/migrations/202611140001_splitcart.sql` once. This creates tables, indexes, validation RPCs, RLS policies, and the private `receipts` bucket with its image allowlist and 5 MB limit. No manual public-bucket setup is necessary.
2. Copy your project URL and **public anon key** from Project Settings → API into `.env`:

   ```dotenv
   EXPO_PUBLIC_DEMO_MODE=false
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
   ```

   Expo public variables are bundled into the app. **Never use a service-role key, database password, or other secret here.** The anon key identifies the project; authenticated JWTs and RLS control access. `.env` is gitignored.
3. Enable email/password authentication in Supabase Auth. Configure your production email delivery and confirmation settings. For email confirmation, open the confirmation link in your email, then return to SplitCart and log in. Set the Auth Site URL to an accessible web URL (for local browser testing, `http://localhost:8081`). This MVP does not automatically import native confirmation-link sessions.
4. Restart Expo after changing variables: `npx expo start --clear`.
5. Sign up, log in, and create a household. Choose USD, EUR, GBP, CAD, or AUD. A household uses one currency and performs no conversion.
6. Copy the invitation code from Household and share it privately. Another account can join with that code. Each account has one active household. Leaving preserves purchases, shares, membership names, and repayments. Rejoining the same household restores the original membership ID.

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
```

Playwright starts Expo web automatically or uses an existing server on port 8081. To use a system Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`. Tests cover phone purchase creation, invalid custom totals, edit/share preservation, receipt viewing, deletion confirmation, payer restrictions, repayments, profile persistence, desktop filtering, and the unconfigured live-login fallback. The fallback check assumes the example environment with empty live credentials.

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
- `src/demo.ts` — sample household and local sample receipt.
- `src/ui.tsx`, `src/Illustration.tsx` — design system and original basket artwork.
- `supabase/migrations/` — deployable database and private storage setup.
- `src/*.test.ts`, `e2e/` — calculation, SQL/RLS, and browser workflow tests.

## Bank/card payments, automatic dues, and payment reminders

Open **Balances → Manage payments** for hosted bank/card setup, receiving-bank onboarding, a payment review with a **2.5% credit-card-only surcharge**, fixed monthly bank autopay, and verified email/text reminder preferences. Demo mode uses sample accounts and simulated payments; it never moves funds or sends messages. Live use requires the additional migration, deployed Edge Function, Stripe Connect, Twilio, Resend, and a recurring job. See [payment setup and operational details](docs/payments.md) for configuration, test steps, and current limits.
