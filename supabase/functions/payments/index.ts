import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import {
  quote,
  dueDate,
  reminderDate,
  validateReminder,
  type Funding,
} from "../_shared/payment-rules.ts";

const env = (name: string) => Deno.env.get(name) || "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const stripe = new Stripe(env("STRIPE_SECRET_KEY") || "unconfigured", {
  httpClient: Stripe.createFetchHttpClient(),
});
const enabled = () =>
  env("PAYMENTS_ENABLED") === "true" &&
  !!env("STRIPE_SECRET_KEY") &&
  !!env("APP_URL");
const appDues = () => {
  const n = Number(env("APP_DUES_CENTS"));
  return Number.isSafeInteger(n) && n >= 50 && n <= 100000000 ? n : 0;
};
const uuid = (s: unknown) =>
  typeof s === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
function check(yes: unknown, message: string): asserts yes {
  if (!yes) throw new Error(message);
}
function result<T>({ data, error }: { data: T; error: any }): T {
  if (error) throw new Error("Payment data could not be saved. Please retry.");
  return data;
}
async function account(userId: string) {
  result(
    await db
      .from("billing_accounts")
      .upsert(
        { user_id: userId },
        { onConflict: "user_id", ignoreDuplicates: true },
      ),
  );
  return result(
    await db
      .from("billing_accounts")
      .select("*")
      .eq("user_id", userId)
      .single(),
  );
}
async function customer(user: any, a: any) {
  if (a.customer_id) return a.customer_id as string;
  const c = await stripe.customers.create(
    { metadata: { splitcart_user: user.id }, email: user.email },
    { idempotencyKey: `customer-${user.id}` },
  );
  result(
    await db
      .from("billing_accounts")
      .update({ customer_id: c.id })
      .eq("user_id", user.id),
  );
  a.customer_id = c.id;
  return c.id;
}
async function member(userId: string) {
  const m = result(
    await db
      .from("members")
      .select("*,households(currency)")
      .eq("user_id", userId)
      .is("left_at", null)
      .single(),
  );
  check(m, "Join a household first.");
  check(
    m.households.currency === "USD",
    "Bank and card payments currently support USD households only.",
  );
  return m;
}
async function recipient(
  self: any,
  id: string | null,
  receivingRequired = true,
) {
  if (!id || id === "app") return null;
  const m = result(
    await db
      .from("members")
      .select("*")
      .eq("id", id)
      .eq("household_id", self.household_id)
      .is("left_at", null)
      .maybeSingle(),
  );
  check(
    m && m.user_id !== self.user_id,
    "Choose another active roommate in your household.",
  );
  if (!receivingRequired) return { member: m, destination: "" };
  const a = result(
    await db
      .from("billing_accounts")
      .select("connect_id")
      .eq("user_id", m.user_id)
      .maybeSingle(),
  );
  check(a?.connect_id, "Your roommate must set up receiving payments first.");
  const connected = await stripe.accounts.retrieve(a.connect_id);
  check(
    connected.payouts_enabled && connected.capabilities?.transfers === "active",
    "Your roommate’s bank setup is not ready to receive payments.",
  );
  return { member: m, destination: a.connect_id as string };
}
async function method(customerId: string, id: string) {
  check(
    typeof customerId === "string" && customerId.startsWith("cus_"),
    "Add a payment method first.",
  );
  check(
    typeof id === "string" && id.startsWith("pm_"),
    "Choose a saved payment method.",
  );
  const pm = await stripe.paymentMethods.retrieve(id);
  check(
    pm.customer === customerId,
    "This payment method does not belong to your account.",
  );
  const funding: Funding | undefined =
    pm.type === "us_bank_account"
      ? "bank"
      : pm.type === "card" && ["credit", "debit"].includes(pm.card!.funding)
        ? (pm.card!.funding as Funding)
        : undefined;
  check(
    funding,
    "Only verified US bank accounts, credit cards, and debit cards are supported.",
  );
  return { pm, funding };
}
function methodLabel(pm: Stripe.PaymentMethod) {
  return pm.type === "us_bank_account"
    ? `${pm.us_bank_account?.bank_name || "Bank"} •••• ${pm.us_bank_account?.last4}`
    : `${pm.card?.brand} ${pm.card?.funding} •••• ${pm.card?.last4}`;
}
async function syncIntent(order: any, pi: Stripe.PaymentIntent) {
  check(
    pi.metadata.order_id === order.id &&
      pi.amount === order.cents + order.fee &&
      pi.currency === "usd",
    "Payment verification failed.",
  );
  // A terminal reversal must never be overwritten by a late success event.
  if (["refunded", "disputed"].includes(order.status)) return;
  if (
    order.status === "succeeded" &&
    ["requires_payment_method", "canceled"].includes(pi.status)
  ) {
    result(
      await db.rpc("reverse_payment", {
        order_id: order.id,
        new_status: "failed",
      }),
    );
    return;
  }
  if (pi.status === "succeeded")
    result(
      await db.rpc("complete_payment", {
        order_id: order.id,
        intent_id: pi.id,
      }),
    );
  else {
    const status =
      pi.status === "processing"
        ? "processing"
        : pi.status === "requires_action"
          ? "requires_action"
          : pi.status === "canceled"
            ? "canceled"
            : pi.status === "requires_payment_method"
              ? "failed"
              : "created";
    result(
      await db
        .from("payment_orders")
        .update({ status })
        .eq("id", order.id)
        .in("status", ["created", "processing", "requires_action", "failed"]),
    );
  }
}
async function charge(user: any, input: any, due?: any) {
  check(enabled(), "Live payments are not activated yet.");
  const self = await member(user.id),
    a = await account(user.id);
  check(a.customer_id, "Add a bank account or card first.");
  const { pm, funding } = await method(a.customer_id, input.method);
  const to = await recipient(self, input.recipient);
  const cents = Number(input.cents);
  if (!to)
    check(
      appDues() > 0 && cents === appDues(),
      "The app payment amount has changed or is unavailable. Refresh before paying.",
    );
  const q = quote(cents, funding);
  check(
    input.consent === true && input.total === q.total,
    "Review the total and authorize this payment.",
  );
  check(uuid(input.id), "Invalid payment request identifier.");
  let order = result(
    await db
      .from("payment_orders")
      .select("*")
      .eq("id", input.id)
      .maybeSingle(),
  );
  if (!order) {
    const inserted = await db
      .from("payment_orders")
      .insert({
        id: input.id,
        user_id: user.id,
        household_id: self.household_id,
        from_id: self.id,
        recipient_id: to?.member.id || null,
        cents,
        fee: q.fee,
        funding,
        payment_method: pm.id,
        destination: to?.destination || null,
        due_id: due?.id || null,
        due_date: due?.date || null,
      })
      .select()
      .single();
    if (inserted.error?.code === "23505") {
      order = due
        ? result(
            await db
              .from("payment_orders")
              .select("*")
              .eq("due_id", due.id)
              .eq("due_date", due.date)
              .single(),
          )
        : result(
            await db
              .from("payment_orders")
              .select("*")
              .eq("id", input.id)
              .single(),
          );
    } else order = result(inserted);
  }
  check(
    order.user_id === user.id &&
      order.cents === cents &&
      order.payment_method === pm.id &&
      order.recipient_id === (to?.member.id || null) &&
      order.fee === q.fee,
    "A payment request cannot be changed. Start a new payment.",
  );
  if (
    ["succeeded", "refunded", "disputed", "canceled", "failed"].includes(
      order.status,
    )
  )
    return order;
  // Do not retry a provider create after its 24-hour idempotency retention window.
  check(
    order.stripe_intent ||
      Date.now() - Date.parse(order.created_at) < 23 * 60 * 60 * 1000,
    "This payment needs support review before retrying.",
  );
  let pi: Stripe.PaymentIntent;
  if (order.stripe_intent)
    pi = await stripe.paymentIntents.retrieve(order.stripe_intent);
  else {
    // Persist the unconfirmed intent before confirmation, so even a very fast
    // webhook can reconcile it. Stable idempotency keys prevent duplicate debits.
    pi = await stripe.paymentIntents.create(
      {
        amount: q.total,
        currency: "usd",
        customer: a.customer_id,
        payment_method: pm.id,
        payment_method_types: [funding === "bank" ? "us_bank_account" : "card"],
        ...(to
          ? { transfer_data: { destination: order.destination, amount: cents } }
          : {}),
        metadata: { order_id: order.id },
        description: "SplitCart payment",
      },
      { idempotencyKey: `order-${order.id}` },
    );
    result(
      await db
        .from("payment_orders")
        .update({ stripe_intent: pi.id })
        .eq("id", order.id),
    );
    order.stripe_intent = pi.id;
  }
  if (pi.status === "requires_confirmation") {
    try {
      pi = await stripe.paymentIntents.confirm(
        pi.id,
        { off_session: !!due, return_url: env("APP_URL") },
        { idempotencyKey: `confirm-${order.id}` },
      );
    } catch (error) {
      if (
        error instanceof Stripe.errors.StripeCardError &&
        error.payment_intent
      )
        pi = error.payment_intent as Stripe.PaymentIntent;
      else throw error;
    }
  }
  await syncIntent(order, pi);
  const saved = result(
    await db.from("payment_orders").select("*").eq("id", order.id).single(),
  );
  return {
    ...saved,
    authenticationUrl: pi.next_action?.redirect_to_url?.url || null,
  };
}
async function status(user: any) {
  const a = await account(user.id);
  const methods: any[] = [];
  let payoutReady = false;
  if (enabled()) {
    if (a.customer_id) {
      for (const type of ["card", "us_bank_account"] as const) {
        for await (const pm of stripe.paymentMethods.list({
          customer: a.customer_id,
          type,
          limit: 100,
        })) {
          if (
            pm.type === "card" &&
            !["credit", "debit"].includes(pm.card!.funding)
          )
            continue;
          methods.push({
            id: pm.id,
            label: methodLabel(pm),
            funding: pm.type === "us_bank_account" ? "bank" : pm.card!.funding,
          });
        }
      }
    }
    if (a.connect_id) {
      const c = await stripe.accounts.retrieve(a.connect_id);
      payoutReady = !!(
        c.payouts_enabled && c.capabilities?.transfers === "active"
      );
    }
    // Polling also repairs a lost/delayed webhook without trusting browser redirects.
    const pending = result(
      await db
        .from("payment_orders")
        .select("*")
        .eq("user_id", user.id)
        .in("status", ["created", "processing", "requires_action"])
        .not("stripe_intent", "is", null)
        .limit(20),
    );
    for (const order of pending || [])
      await syncIntent(
        order,
        await stripe.paymentIntents.retrieve(order.stripe_intent),
      );
  }
  const dues = result(
    await db
      .from("payment_dues")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  );
  const payments = result(
    await db
      .from("payment_orders")
      .select("id,cents,fee,status,created_at,recipient_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
  );
  return {
    phoneVerified: a.phone_verified,
    available: enabled(),
    appDues: appDues(),
    payoutReady,
    methods,
    reminder: {
      email: a.email_reminders,
      sms: a.sms_reminders,
      phone: a.phone || "",
      days: a.reminder_days,
      consent: !!a.reminder_consent_at,
    },
    dues: (dues || []).map((d: any) => ({
      id: d.id,
      recipient: d.recipient_id || "app",
      cents: d.cents,
      day: d.due_day,
      automatic: d.automatic,
      method: d.payment_method,
      consent: !!d.consent_at,
    })),
    payments: (payments || []).map((p: any) => ({
      ...p,
      recipient: p.recipient_id || "app",
    })),
  };
}
async function twilio(path: string, fields: Record<string, string>) {
  check(
    env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN"),
    "Text reminders are not configured yet.",
  );
  const response = await fetch(`https://${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env("TWILIO_ACCOUNT_SID")}:${env("TWILIO_AUTH_TOKEN")}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(fields),
  });
  const json = await response.json();
  if (!response.ok)
    throw new Error(
      json.code === 21610
        ? "SMS_OPTED_OUT"
        : "Text delivery failed. Check the number or try again later.",
    );
  return json;
}
async function remind(d: any, date: string, a: any, user: any) {
  const text = `SplitCart: your $${(d.cents / 100).toFixed(2)} due is on ${date} (UTC). ${d.automatic ? "Autopay is enabled; check payment status in the app." : "Open SplitCart to review and pay."}`;
  for (const channel of ["email", "sms"]) {
    if (
      !(channel === "email"
        ? a.email_reminders && user.email_confirmed_at
        : a.sms_reminders && a.phone_verified)
    )
      continue;
    // Claim before sending: concurrent scheduler runs cannot send duplicates.
    // Ambiguous deliveries remain claimed for operator review, never blind retry.
    const claim = await db
      .from("payment_reminder_deliveries")
      .insert({ due_id: d.id, due_date: date, channel, status: "sending" });
    if (claim.error?.code === "23505") continue;
    result(claim);
    try {
      if (channel === "sms") {
        check(
          env("TWILIO_MESSAGING_SERVICE_SID"),
          "Text reminders are not configured yet.",
        );
        await twilio(
          `api.twilio.com/2010-04-01/Accounts/${env("TWILIO_ACCOUNT_SID")}/Messages.json`,
          {
            To: a.phone,
            MessagingServiceSid: env("TWILIO_MESSAGING_SERVICE_SID"),
            Body: `${text} Reply STOP to opt out.`,
          },
        );
      } else {
        check(
          env("RESEND_API_KEY") && env("REMINDER_FROM_EMAIL"),
          "Email reminders are not configured yet.",
        );
        const stop = `${env("SUPABASE_URL")}/functions/v1/payments/unsubscribe?token=${a.unsubscribe_token}`;
        const sent = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env("RESEND_API_KEY")}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `reminder-${d.id}-${date}`,
          },
          body: JSON.stringify({
            from: env("REMINDER_FROM_EMAIL"),
            to: [user.email],
            subject: "Your SplitCart payment reminder",
            text: `${text}\n\nTurn off email reminders: ${stop}`,
          }),
        });
        check(sent.ok, "Email delivery failed.");
      }
      result(
        await db
          .from("payment_reminder_deliveries")
          .update({ status: "sent" })
          .eq("due_id", d.id)
          .eq("due_date", date)
          .eq("channel", channel),
      );
    } catch (e) {
      result(
        await db
          .from("payment_reminder_deliveries")
          .update({ status: "failed" })
          .eq("due_id", d.id)
          .eq("due_date", date)
          .eq("channel", channel),
      );
      if (e instanceof Error && e.message === "SMS_OPTED_OUT")
        result(
          await db
            .from("billing_accounts")
            .update({ sms_reminders: false })
            .eq("user_id", user.id),
        );
    }
  }
}
async function worker() {
  const now = new Date(),
    today = now.toISOString().slice(0, 10);
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  )
    .toISOString()
    .slice(0, 7);
  let visited = 0,
    failures = 0;
  for (let offset = 0; ; offset += 100) {
    const dues = result(
      await db
        .from("payment_dues")
        .select("*")
        .order("id")
        .range(offset, offset + 99),
    );
    for (const d of dues || []) {
      visited++;
      try {
        const a = await account(d.user_id);
        const { data, error } = await db.auth.admin.getUserById(d.user_id);
        check(!error && data.user, "Account unavailable.");
        const user = data.user;
        // Recheck household membership before either sending or charging.
        const self = await member(user.id);
        if (self.household_id !== d.household_id) continue;
        await recipient(self, d.recipient_id, false);
        if (!d.recipient_id)
          check(
            d.cents === appDues() && appDues() > 0,
            "App dues changed; review the schedule.",
          );
        for (const month of [today.slice(0, 7), next]) {
          const date = dueDate(month, d.due_day);
          const existing = result(
            await db
              .from("payment_orders")
              .select("id,status")
              .eq("due_id", d.id)
              .eq("due_date", date)
              .maybeSingle(),
          );
          if (
            a.reminder_consent_at &&
            reminderDate(date, a.reminder_days) === today &&
            existing?.status !== "succeeded"
          )
            await remind(d, date, a, user);
          if (date === today && d.automatic && d.consent_at) {
            check(a.customer_id, "No payment method.");
            const m = await method(a.customer_id, d.payment_method);
            // Do not silently increase an automatic fee if card funding changes.
            check(
              m.funding === "bank",
              "Automatic dues require a bank account.",
            );
            await charge(
              user,
              {
                id: existing?.id || crypto.randomUUID(),
                method: d.payment_method,
                recipient: d.recipient_id || "app",
                cents: d.cents,
                total: d.cents,
                consent: true,
              },
              { id: d.id, date },
            );
          }
        }
      } catch {
        failures++;
      }
    }
    if (!dues || dues.length < 100) break;
  }
  return { visited, failures };
}
async function secretMatches(actual: string, expected: string) {
  if (!expected) return false;
  const hash = async (s: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    );
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  return a.reduce((n, v, i) => n | (v ^ b[i]), 0) === 0;
}
async function webhook(req: Request) {
  check(env("STRIPE_WEBHOOK_SECRET"), "Webhook not configured.");
  const event = await stripe.webhooks.constructEventAsync(
    await req.text(),
    req.headers.get("stripe-signature") || "",
    env("STRIPE_WEBHOOK_SECRET"),
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
  if (event.type.startsWith("payment_intent.")) {
    const pi = event.data.object as Stripe.PaymentIntent;
    const order = result(
      await db
        .from("payment_orders")
        .select("*")
        .eq("stripe_intent", pi.id)
        .maybeSingle(),
    );
    if (order)
      await syncIntent(order, await stripe.paymentIntents.retrieve(pi.id));
  }
  if (["charge.refunded", "charge.dispute.created"].includes(event.type)) {
    const object = event.data.object as any;
    const intent = object.payment_intent;
    const order = result(
      await db
        .from("payment_orders")
        .select("*")
        .eq("stripe_intent", intent)
        .maybeSingle(),
    );
    if (order) {
      // Partial refunds need a proportional ledger model; conservatively revoke
      // the repayment credit and flag the order for operator reconciliation.
      result(
        await db.rpc("reverse_payment", {
          order_id: order.id,
          new_status:
            event.type === "charge.refunded" ? "refunded" : "disputed",
        }),
      );
    }
  }
  return { received: true };
}
export async function handler(req: Request) {
  const origin = req.headers.get("origin"),
    allowed = env("APP_URL") ? new URL(env("APP_URL")).origin : "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
  if (origin === allowed) headers["Access-Control-Allow-Origin"] = allowed;
  const send = (data: unknown, code = 200) =>
    new Response(JSON.stringify(data), { status: code, headers });
  try {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/webhook")) {
      check(req.method === "POST", "POST required.");
      return send(await webhook(req));
    }
    if (url.pathname.endsWith("/run")) {
      if (
        req.method !== "POST" ||
        !(await secretMatches(
          req.headers.get("authorization") || "",
          `Bearer ${env("PAYMENT_JOB_SECRET")}`,
        )) ||
        !env("PAYMENT_JOB_SECRET")
      )
        return send({ error: "Unauthorized" }, 401);
      return send(await worker());
    }
    if (url.pathname.endsWith("/unsubscribe")) {
      const token = url.searchParams.get("token");
      check(uuid(token), "Invalid unsubscribe link.");
      if (req.method === "POST") {
        result(
          await db
            .from("billing_accounts")
            .update({ email_reminders: false })
            .eq("unsubscribe_token", token),
        );
        return new Response("Email reminders have been turned off.", {
          headers: { "Content-Type": "text/plain" },
        });
      }
      check(req.method === "GET", "GET or POST required.");
      return new Response(
        '<!doctype html><title>SplitCart reminders</title><h1>Email reminders</h1><form method="post"><button>Turn off email reminders</button></form>',
        {
          headers: {
            "Content-Type": "text/html",
            "Content-Security-Policy":
              "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
            "Referrer-Policy": "no-referrer",
          },
        },
      );
    }
    if (origin && origin !== allowed)
      return send({ error: "Origin not allowed" }, 403);
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    check(req.method === "POST", "POST required.");
    const token = (req.headers.get("authorization") || "").replace(
      /^Bearer /,
      "",
    );
    const auth = await db.auth.getUser(token);
    if (auth.error || !auth.data.user)
      return send({ error: "Please sign in again." }, 401);
    const user = auth.data.user,
      input = await req.json(),
      a = await account(user.id);
    const action = input.action;
    if (action === "status") return send(await status(user));
    if (action === "cancel_due") {
      result(
        await db
          .from("payment_dues")
          .delete()
          .eq("id", input.id)
          .eq("user_id", user.id),
      );
      return send({ ok: true });
    }
    if (action === "reminders") {
      const r = input.reminder;
      check(
        r &&
          typeof r.email === "boolean" &&
          typeof r.sms === "boolean" &&
          typeof r.phone === "string",
        "Invalid reminder preferences.",
      );
      validateReminder(r.email, r.sms, r.phone, r.consent === true);
      reminderDate("2026-01-15", r.days);
      if (r.email)
        check(
          user.email_confirmed_at &&
            env("RESEND_API_KEY") &&
            env("REMINDER_FROM_EMAIL"),
          "Verify your account email and configure email delivery first.",
        );
      if (r.sms)
        check(
          a.phone_verified &&
            r.phone === a.phone &&
            env("TWILIO_MESSAGING_SERVICE_SID"),
          "Verify your phone before enabling text reminders.",
        );
      result(
        await db
          .from("billing_accounts")
          .update({
            email_reminders: r.email,
            sms_reminders: r.sms,
            reminder_days: r.days,
            reminder_consent_at: r.consent ? new Date().toISOString() : null,
          })
          .eq("user_id", user.id),
      );
      return send({ ok: true });
    }
    if (action === "phone_start" || action === "phone_confirm") {
      check(
        user.email_confirmed_at,
        "Verify your account email before requesting texts.",
      );
      check(
        /^\+[1-9]\d{7,14}$/.test(input.phone),
        "Enter an international phone number.",
      );
      check(
        input.consent === true,
        "Agree to receive a verification text first.",
      );
      check(
        env("TWILIO_VERIFY_SERVICE_SID"),
        "Phone verification is not configured yet.",
      );
      const base = `verify.twilio.com/v2/Services/${env("TWILIO_VERIFY_SERVICE_SID")}`;
      if (action === "phone_start") {
        const claim = await db.rpc("claim_phone_verification", {
          account_user: user.id,
        });
        check(
          !claim.error,
          "Verification limit reached. Wait before requesting another code.",
        );
        await twilio(`${base}/Verifications`, {
          To: input.phone,
          Channel: "sms",
        });
      } else {
        check(/^\d{4,10}$/.test(input.code), "Enter the verification code.");
        const verified = await twilio(`${base}/VerificationCheck`, {
          To: input.phone,
          Code: input.code,
        });
        check(verified.status === "approved", "That code was not accepted.");
        result(
          await db
            .from("billing_accounts")
            .update({
              phone: input.phone,
              phone_verified: true,
              sms_reminders: false,
            })
            .eq("user_id", user.id),
        );
      }
      return send({ ok: true });
    }
    if (action === "save_due") {
      const d = input.due,
        self = await member(user.id);
      check(d && typeof d.automatic === "boolean", "Invalid monthly due.");
      dueDate("2026-01", d.day);
      if (d.automatic) check(enabled(), "Live payments are not activated yet.");
      const m = d.automatic ? await method(a.customer_id, d.method) : null;
      const to = await recipient(self, d.recipient, d.automatic);
      quote(d.cents, m?.funding || "bank");
      if (!to)
        check(
          d.cents === appDues() && appDues() > 0,
          "App dues are unavailable or have changed.",
        );
      if (d.automatic)
        check(
          m?.funding === "bank" && d.consent === true,
          "Choose a bank account and authorize automatic payments.",
        );
      result(
        await db.from("payment_dues").insert({
          user_id: user.id,
          household_id: self.household_id,
          recipient_id: to?.member.id || null,
          cents: d.cents,
          due_day: d.day,
          automatic: d.automatic,
          payment_method: d.automatic ? d.method : "",
          consent_at: d.consent ? new Date().toISOString() : null,
        }),
      );
      return send({ ok: true });
    }
    check(enabled(), "Live payments are not activated yet.");
    if (action === "setup") {
      const c = await customer(user, a);
      check(["bank", "card"].includes(input.kind), "Choose bank or card.");
      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        customer: c,
        currency: "usd",
        payment_method_types: [
          input.kind === "bank" ? "us_bank_account" : "card",
        ],
        ...(input.kind === "bank"
          ? {
              payment_method_options: {
                us_bank_account: {
                  verification_method: "automatic" as const,
                  financial_connections: {
                    permissions: ["payment_method" as const],
                  },
                },
              },
            }
          : {}),
        success_url: env("APP_URL"),
        cancel_url: env("APP_URL"),
      });
      return send({ url: session.url });
    }
    if (action === "payout_setup") {
      if (!a.connect_id) {
        const c = await stripe.accounts.create(
          {
            type: "express",
            country: "US",
            email: user.email,
            capabilities: { transfers: { requested: true } },
            metadata: { splitcart_user: user.id },
          },
          { idempotencyKey: `connect-${user.id}` },
        );
        result(
          await db
            .from("billing_accounts")
            .update({ connect_id: c.id })
            .eq("user_id", user.id),
        );
        a.connect_id = c.id;
      }
      const link = await stripe.accountLinks.create({
        account: a.connect_id,
        type: "account_onboarding",
        refresh_url: env("APP_URL"),
        return_url: env("APP_URL"),
      });
      return send({ url: link.url });
    }
    if (action === "remove_method") {
      const m = await method(a.customer_id, input.id);
      const dues = result(
        await db
          .from("payment_dues")
          .select("id")
          .eq("user_id", user.id)
          .eq("payment_method", input.id)
          .eq("automatic", true),
      );
      check(
        !dues?.length,
        "Cancel automatic dues using this method before removing it.",
      );
      await stripe.paymentMethods.detach(m.pm.id);
      return send({ ok: true });
    }
    if (action === "authenticate") {
      const order = result(
        await db
          .from("payment_orders")
          .select("*")
          .eq("id", input.id)
          .eq("user_id", user.id)
          .single(),
      );
      check(order?.stripe_intent, "Payment not found.");
      const pi = await stripe.paymentIntents.retrieve(order.stripe_intent);
      await syncIntent(order, pi);
      return send({
        url: pi.next_action?.redirect_to_url?.url || null,
        status: pi.status,
      });
    }
    if (action === "pay") return send(await charge(user, input));
    return send({ error: "Unknown payment action." }, 400);
  } catch (e) {
    // Never return a provider response, credentials, or full financial objects.
    const message =
      e instanceof Stripe.errors.StripeError
        ? "The payment provider could not complete this request. Refresh payment status before retrying."
        : e instanceof Error
          ? e.message
          : "Payment request failed.";
    return send({ error: message }, 400);
  }
}
if (import.meta.main) Deno.serve(handler);
