# Bank/card payments, monthly dues, and reminders

Open **Balances → Manage payments**. Existing manual repayment recording still works.

- Link a US bank account to pay using Stripe Checkout. Account/routing numbers are entered only on Stripe's hosted page. Stripe supports instant verification or its hosted microdeposit verification flow. A method must finish setup before use.
- Add a credit/debit card using Stripe Checkout. Card numbers and CVCs never enter SplitCart's forms, storage, logs, or database. Unsupported/unknown card funding types are rejected.
- Set up a separate receiving bank through Stripe Connect Express onboarding. Receiving requires the recipient's identity/bank verification, active transfers capability, and enabled payouts. Deposits follow Stripe's payout schedule; this is not an instant transfer or payroll service.
- Review principal, surcharge, and total before paying another active roommate or SplitCart. The server computes **2.5% on credit cards only**, rounded to the nearest cent. Bank and debit have no surcharge. A $10.20 credit payment costs $10.46; the recipient receives $10.20. Stripe's processing fees are the platform's cost and are not added as another customer surcharge. App payments are available only when `APP_DUES_CENTS` is configured by the operator; the client cannot choose that price.
- A fixed monthly due specifies the recipient, amount, and day (1–28, UTC). Reminder-only dues do not require a linked payment method or the recipient to have a receiving bank. Enable bank autopay and authorize the amount/method before saving. It does not automatically calculate a changing household balance. Cancel the due to stop future attempts; a payment already in flight can still complete. Autopay uses bank accounts only, avoiding recurring card surcharges. Due changes require canceling and creating a new authorization.
- Opt into email and/or text reminders 7, 3, or 1 days before, or on the due date. These apply to saved monthly dues. Emails use the authenticated account's verified email. Texts require Twilio Verify ownership verification, a verified account email, and explicit opt-in. Verification requests are limited to one per minute and five per hour per account. Turn channels off in the app; email messages have an unsubscribe confirmation link. Configure Twilio Advanced Opt-Out for STOP/START; Twilio blocks opted-out deliveries and the service disables the local SMS preference when Twilio reports error 21610. Re-enabling after STOP also requires START at Twilio and enabling the app preference.

## Demo versus live

Demo mode has sample bank/card/receiving accounts, fee previews, simulated one-time payments, and locally persisted plans/preferences. The displayed code `123456` verifies only a demo phone. No real details are requested, no funds move, and no recurring charges/text/email jobs run in demo mode. Reset demo data clears payment demo preferences/history too.

Live processing uses the `payments` Supabase Edge Function and migration `202611170001_payments.sql` in addition to the original migration. The current repository includes no provider credentials or deployed payment service. No live transfer, live notification, hosted provider onboarding, physical-device return flow, or production scheduler has been validated by the local tests.

## Activate a test integration

1. Configure a Supabase project and existing application auth/database using README.md. Install the Supabase CLI and Deno 2.6+. Authenticate the CLI through its secure login flow and link the project (`supabase link --project-ref YOUR_PROJECT_REF`), then apply **both** migrations using `supabase db push`. Do not reset a production database.
2. Create a Stripe Connect platform approved for your household-dues/payment business model. Enable Express accounts, US transfers, cards, US bank debits, and Financial Connections/hosted verification. Stripe eligibility for roommate transfers and card surcharging varies; confirm platform approval and applicable card-network/local requirements before switching to live keys. The implementation currently supports **USD and US bank accounts only**. All other existing app currencies remain available for expense tracking and manual repayments.
3. Copy `supabase/functions/.env.example` to the ignored `.env.local` alongside it. Enter server credentials securely there or in Supabase's Edge Function Secrets settings. Never put server keys in the mobile/web `.env`, public Expo variables, Git, screenshots, or chat. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied by hosted Supabase. Use test Stripe keys first. Set `APP_URL` to the accessible HTTPS web app's root URL; it controls CORS and provider return URLs. Native apps open hosted pages externally; return to the app and use Refresh payment status afterward.
4. Provision a Twilio Verify service and a Messaging Service with a registered sender, country permissions, opt-out handling, and fraud/rate controls. Trial accounts send only to approved numbers. Configure the four Twilio variables in the example. Configure a Resend verified sending domain and `REMINDER_FROM_EMAIL` plus `RESEND_API_KEY`. Set a strong random `PAYMENT_JOB_SECRET` (separate from all provider keys). `APP_DUES_CENTS=0` disables SplitCart app dues; set an integer cent amount of at least 50 to offer app payments.
5. Upload server secrets with `supabase secrets set --env-file supabase/functions/.env.local`, then `supabase functions deploy payments`. The committed function config disables gateway JWT verification **only because the handler separately authenticates all user actions with Supabase `getUser`, webhook requests with Stripe signatures, and jobs with the independent scheduler bearer secret**. Do not remove those checks.
6. Register `https://YOUR_PROJECT.supabase.co/functions/v1/payments/webhook` in Stripe for `payment_intent.succeeded`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.requires_action`, `charge.refunded`, and `charge.dispute.created`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`. Use matching test/live modes. Webhook retries and app status polling reconcile payments from Stripe, rather than trusting browser redirects. Set `PAYMENTS_ENABLED=true` in **server secrets** for testing once configuration is complete.
7. Start the app with live Supabase public credentials and `EXPO_PUBLIC_DEMO_MODE=false`. Create two test users in one USD household. Verify both emails. Complete recipient Express onboarding, then sender bank/card setup on Stripe's hosted pages. Refresh payment status when returning. Exercise credit/debit/bank payments, card authentication, failed/processing payments, and webhook retries using Stripe's official test methods. Only succeeded principal enters the repayment ledger; a pending ACH payment does not. Never also record a successful bank/card payment manually.
8. Configure the recurring job below and test reminder delivery to controlled, opted-in test contacts. Verify disabled channels, phone verification failures, email unsubscribe, Twilio STOP, due cancellation, recipient leaving the household, insufficient funds, duplicate scheduler invocations, and an ACH return after initial success. Review failed deliveries/charges in the provider dashboards and database. After provider approval and end-to-end validation, switch credentials and webhook to live mode deliberately.

## Recurring job (required for live autopay/reminders)

Call `POST https://YOUR_PROJECT.supabase.co/functions/v1/payments/run` every 15 minutes with `Authorization: Bearer <PAYMENT_JOB_SECRET>` from a trusted scheduler. The job operates on UTC calendar dates. It charges a due once on its due day and sends a reminder once on the chosen reminder date. It does not catch up charges/reminders from missed calendar dates, so monitor scheduler health. It does not debit again after a failed charge; the user must review payment activity. Payment statuses needing authentication can be resumed from the app. Never put the job credential in the client.

For hosted Supabase, enable `pg_cron` and `pg_net` in the dashboard and securely create Vault secrets named `splitcart_payment_job_secret` (matching `PAYMENT_JOB_SECRET`) and `splitcart_functions_url` (the `https://YOUR_PROJECT.supabase.co/functions/v1` base). Then run this non-secret SQL once:

```sql
select cron.schedule('splitcart-payments', '*/15 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='splitcart_functions_url') || '/payments/run',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='splitcart_payment_job_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
$$);
```

Check `cron.job_run_details`, `net._http_response`, and function logs without exposing headers/credentials. A successful HTTP response includes `visited` and `failures`; nonzero failures need investigation. Small household workloads fit a single job; large installations should move to a queue with per-item retry/lease monitoring.

## Reliability and operational boundaries

Payment creation/confirmation uses stable Stripe idempotency keys. A unique `(due_id,due_date)` prevents duplicate monthly charges. The unconfirmed PaymentIntent is persisted before confirmation. An ambiguous create older than 23 hours is blocked for operator review instead of risking a new debit after Stripe expires its idempotency record. Never delete ambiguous payment records or rotate request IDs to force a retry. Browser retries retain the original request id; canceled/failed payments need a new, explicitly reviewed request.

`complete_payment` atomically updates payment status and inserts principal into the ledger once; only the server service role can call it. Payment/contact/provider tables are inaccessible to anonymous or authenticated SQL clients. User-facing API queries are explicitly scoped to the authenticated user. Recipient household membership, method ownership, fees, and app-dues prices are checked server-side at the moment of charging. Leaving/changing households stops scheduled processing for the old household.

Refund/dispute events and a confirmed late bank-payment failure remove the repayment credit and flag the order. Partial refunds conservatively revoke the entire ledger credit and require operator reconciliation; automated proportional adjustments and dispute-resolution reinstatement are not implemented. Perform refunds and appropriate destination-transfer reversals through the Stripe dashboard/approved operations workflow. Connect platform balances, processing costs, fraud, ACH returns, disputes, and negative balances require operator monitoring. A confirmed payment can later be reversed by a return/dispute.

Reminder attempts are claimed before sending so overlapping jobs cannot spam users. Resend also receives a stable idempotency key. A provider error or ambiguous timeout is marked failed and **is not blindly retried** (Twilio cannot guarantee exactly-once SMS sends). Review `payment_reminder_deliveries` and provider logs for manual resolution. “Sent” means accepted by the provider, not proof of inbox/phone delivery. The current release does not ingest downstream delivery/bounce callbacks or send a separate failure notification. Future changes should add a durable queue and delivery webhooks for higher-volume operation.

## Local checks

```sh
npm run typecheck
npm test
EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 CI=1 npm run build:web
EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 CI=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
cd supabase/functions
deno task check
deno task test
```

The Edge-handler tests mock network providers and PostgreSQL responses; they test the real handler's authorization, fee enforcement, idempotency, processing states, scheduler authorization, and repeated job runs without moving money or sending messages. PGlite separately executes both unchanged migrations and tests database privileges, fee constraints, consent, verification rate limiting, atomic completion, retries, and reversal. Browser tests exercise demo payment review/fee math, principal-only ledger updates, receiving-bank setup, autopay consent, method-removal guards, phone verification, reminder persistence, and cancellation. Use the system certificate store (`DENO_TLS_CA_STORE=system`) when needed in this cloud environment; never disable TLS verification.
