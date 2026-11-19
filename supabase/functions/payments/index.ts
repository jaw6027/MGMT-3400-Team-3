import Stripe from "npm:stripe@17.7.0";
import { cardBrandName } from "../_shared/card-networks.ts";
import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import {
  quote,
  dueDate,
  reminderDate,
  validateReminder,
  shouldRemind,
  recentSecondFactor,
  paymentEvent,
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
function verifiedClaims(token: string, userId: string): any {
  try {
    const raw = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(
      atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, "=")),
    );
    return claims.sub === userId ? claims : null;
  } catch {
    return null;
  }
}
function recentPasswordExpiry(claims: any) {
  const now = Date.now() / 1000;
  const stamps = (claims?.amr || [])
    .filter((m: any) => m.method === "password" && Number.isFinite(m.timestamp))
    .map((m: any) => m.timestamp);
  const latest = Math.max(0, ...stamps);
  return latest <= now && now - latest < 300 ? latest + 300 : 0;
}
function secondFactorExpiry(token: string, userId: string) {
  const claims = verifiedClaims(token, userId),
    passwordUntil = recentPasswordExpiry(claims),
    factorUntil = recentSecondFactor(claims, Math.floor(Date.now() / 1000));
  return passwordUntil && factorUntil
    ? Math.min(passwordUntil, factorUntil)
    : 0;
}
function freshPassword(claims: any) {
  return (
    !!claims?.session_id &&
    claims.aal === "aal1" &&
    recentPasswordExpiry(claims) > 0
  );
}
async function recoveryHash(userId: string, raw: string) {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  check(/^[A-F0-9]{32}$/.test(code), "Enter a complete recovery code.");
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`${userId}:${code}`),
      ),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
async function finishRecoveryReset(userId: string) {
  const factors = await db.auth.admin.mfa.listFactors({ userId });
  check(
    !factors.error && factors.data,
    "Authenticator recovery could not finish. Use Resume recovery to retry.",
  );
  for (const factor of factors.data.factors) {
    const removed = await db.auth.admin.mfa.deleteFactor({
      userId,
      id: factor.id,
    });
    check(
      !removed.error,
      "Authenticator recovery could not finish. Use Resume recovery to retry.",
    );
  }
  const current = await account(userId);
  await notify(
    userId,
    "Authenticator recovery started. Financial linking remains locked until a replacement authenticator is verified.",
    `recovery-start-${current.recovery_started}`,
  );
}
async function bankVerified(customerId: string, methodId: string) {
  for await (const setup of stripe.setupIntents.list({
    customer: customerId,
    payment_method: methodId,
    limit: 100,
  }))
    if (setup.status === "succeeded") return true;
  return false;
}
async function bankAttempt(row: any) {
  const session = await stripe.checkout.sessions.retrieve(row.session_id, {
    expand: ["setup_intent.payment_method"],
  });
  let setup = session.setup_intent;
  if (typeof setup === "string")
    setup = await stripe.setupIntents.retrieve(setup, {
      expand: ["payment_method"],
    });
  const pm =
    setup && typeof setup.payment_method === "object"
      ? setup.payment_method
      : null;
  const url =
    setup?.next_action?.verify_with_microdeposits?.hosted_verification_url;
  const state =
    session.status === "expired"
      ? "expired"
      : setup?.status === "succeeded"
        ? "verified"
        : setup?.status === "canceled" ||
            (session.status === "complete" &&
              setup?.status === "requires_payment_method")
          ? "failed"
          : url ||
              setup?.status === "processing" ||
              setup?.status === "requires_action"
            ? "verification_pending"
            : "awaiting_details";
  return {
    id: row.id,
    label: pm ? methodLabel(pm) : "Linked bank",
    status: state,
    canVerify: state === "verification_pending" && !!url,
    canResume: state === "awaiting_details" && !!session.url,
    arrivalDate: setup?.next_action?.verify_with_microdeposits?.arrival_date
      ? new Date(
          setup.next_action.verify_with_microdeposits.arrival_date * 1000,
        )
          .toISOString()
          .slice(0, 10)
      : undefined,
    url:
      state === "verification_pending"
        ? url
        : state === "awaiting_details"
          ? session.url
          : null,
  };
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
async function notify(
  userId: string,
  message: string,
  eventKey: string = crypto.randomUUID(),
) {
  result(
    await db
      .from("payment_notifications")
      .upsert(
        { user_id: userId, event_key: eventKey, message },
        { onConflict: "user_id,event_key", ignoreDuplicates: true },
      ),
  );
}
async function failedAutopay(order: any) {
  if (!order.due_id) return;
  const d = result(
    await db
      .from("payment_dues")
      .select("*")
      .eq("id", order.due_id)
      .maybeSingle(),
  );
  if (!d || !(order.automatic ?? d.automatic)) return;
  await notify(
    order.user_id,
    `Automatic payment of $${(order.cents / 100).toFixed(2)} for ${order.due_date} needs attention. Check payment activity and your bank before paying again.`,
    `autopay-${order.due_id}-${order.due_date}`,
  );
  const a = await account(order.user_id);
  const { data } = await db.auth.admin.getUserById(order.user_id);
  if (data.user && a.reminder_consent_at && !a.payment_updates)
    await remind(d, order.due_date, a, data.user, "failure");
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
  if (funding === "bank")
    check(
      await bankVerified(customerId, id),
      "Bank verification is pending. Complete bank verification in Accounts before paying.",
    );
  return { pm, funding };
}
function methodLabel(pm: Stripe.PaymentMethod) {
  return pm.type === "us_bank_account"
    ? `${pm.us_bank_account?.bank_name || "Bank"} •••• ${pm.us_bank_account?.last4}`
    : `${cardBrandName(pm.card?.brand)} ${pm.card?.funding} •••• ${pm.card?.last4}`;
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
    await failedAutopay(order);
    await paymentUpdate({ ...order, status: "failed" });
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
    if (["failed", "requires_action"].includes(status))
      await failedAutopay(order);
  }
  const saved = result(
    await db.from("payment_orders").select("*").eq("id", order.id).single(),
  );
  await paymentUpdate(saved);
}
async function charge(user: any, input: any, due?: any) {
  check(enabled(), "Live payments are not activated yet.");
  const self = await member(user.id),
    a = await account(user.id);
  check(a.customer_id, "Add a bank account or card first.");
  const { pm, funding } = await method(a.customer_id, input.method);
  if (input.dueId && !due) {
    check(uuid(input.dueId), "Invalid scheduled due.");
    const d = result(
      await db
        .from("payment_dues")
        .select("*")
        .eq("id", input.dueId)
        .eq("user_id", user.id)
        .eq("household_id", self.household_id)
        .single(),
    );
    check(
      d &&
        typeof input.dueDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) &&
        dueDate(input.dueDate.slice(0, 7), d.due_day) === input.dueDate &&
        input.dueDate >= d.created_at.slice(0, 10),
      "Invalid scheduled occurrence.",
    );
    check(
      input.cents === d.cents && input.recipient === (d.recipient_id || "app"),
      "The schedule changed. Refresh before paying.",
    );
    due = { id: d.id, date: input.dueDate, offSession: false };
  }
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
    const orderData = {
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
      method_label: methodLabel(pm),
      request_id: input.requestId || null,
      automatic: !!due?.offSession,
    };
    check(
      !input.requestId || (!due && uuid(input.requestId)),
      "Invalid request payment.",
    );
    const inserted = input.requestId
      ? await db.rpc("reserve_request_payment", { order_data: orderData })
      : due
        ? await db.rpc("reserve_due_payment", {
            order_data: orderData,
            off_session: !!due.offSession,
          })
        : await db.from("payment_orders").insert(orderData).select().single();
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
        { off_session: !!due?.offSession, return_url: env("APP_URL") },
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
  let payoutStatus = "not_started";
  const bankLinks: any[] = [];
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
            brand: pm.type === "card" ? pm.card?.brand : undefined,
            funding: pm.type === "us_bank_account" ? "bank" : pm.card!.funding,
            verification:
              pm.type === "us_bank_account"
                ? (await bankVerified(a.customer_id, pm.id))
                  ? "verified"
                  : "pending"
                : undefined,
          });
        }
      }
    }
    if (a.connect_id) {
      const c = await stripe.accounts.retrieve(a.connect_id);
      payoutReady = !!(
        c.payouts_enabled && c.capabilities?.transfers === "active"
      );
      payoutStatus = payoutReady
        ? "ready"
        : c.requirements?.currently_due?.length
          ? "needs_details"
          : c.requirements?.disabled_reason
            ? "restricted"
            : "verification_pending";
    }
    const attempts = result(
      await db
        .from("bank_link_attempts")
        .select("id,session_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    );
    for (const row of attempts || []) {
      try {
        const { url, ...progress } = await bankAttempt(row);
        bankLinks.push(progress);
      } catch {
        bankLinks.push({
          id: row.id,
          label: "Linked bank",
          status: "unavailable",
          canVerify: false,
          canResume: false,
        });
      }
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
  const self = result(
    await db
      .from("members")
      .select("id,household_id")
      .eq("user_id", user.id)
      .is("left_at", null)
      .maybeSingle(),
  );
  const dues = self
    ? result(
        await db
          .from("payment_dues")
          .select("*")
          .eq("user_id", user.id)
          .eq("household_id", self.household_id)
          .order("created_at", { ascending: false }),
      )
    : [];
  const payments: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = result(
      await db
        .from("payment_orders")
        .select(
          "id,cents,fee,status,created_at,recipient_id,method_label,payment_method,due_id,due_date,request_id",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + 499),
    );
    payments.push(...(page || []));
    if (!page || page.length < 500) break;
  }
  const requests = self
    ? result(
        await db
          .from("payment_requests")
          .select("*,payment_orders(status)")
          .eq("household_id", self.household_id)
          .or(`requester_id.eq.${self.id},payer_id.eq.${self.id}`)
          .order("created_at", { ascending: false })
          .limit(100),
      )
    : [];
  const notifications = result(
    await db
      .from("payment_notifications")
      .select("id,message,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
  );
  const incoming = self
    ? result(
        await db
          .from("payment_orders")
          .select("id,cents,status,created_at,from_id")
          .eq("recipient_id", self.id)
          .eq("household_id", self.household_id)
          .order("created_at", { ascending: false })
          .limit(100),
      )
    : [];
  return {
    bankLinks,
    payoutStatus,
    incomingPayments: (incoming || []).map((p: any) => ({
      ...p,
      sender: p.from_id,
    })),
    requests: (requests || []).map((r: any) => ({
      id: r.id,
      requester: r.requester_id,
      payer: r.payer_id,
      cents: r.cents,
      note: r.note,
      expenseId: r.expense_id,
      canceled: r.canceled,
      created_at: r.created_at,
      status: r.canceled
        ? "canceled"
        : r.payment_orders?.find(
            (p: any) => !["failed", "canceled"].includes(p.status),
          )?.status || "open",
    })),
    notifications,
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
      autopayNotices: a.autopay_notices,
      paymentUpdates: a.payment_updates,
    },
    dues: (dues || []).map((d: any) => ({
      id: d.id,
      recipient: d.recipient_id || "app",
      cents: d.cents,
      day: d.due_day,
      automatic: d.automatic,
      method: d.payment_method,
      consent: !!d.consent_at,
      paused: d.paused,
      created_at: d.created_at,
    })),
    payments: (payments || []).map((p: any) => ({
      ...p,
      recipient: p.recipient_id || "app",
      methodLabel: p.method_label,
      dueId: p.due_id,
      dueDate: p.due_date,
      requestId: p.request_id,
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
async function billingMessage(
  channel: string,
  a: any,
  user: any,
  text: string,
  subject: string,
  key: string,
) {
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
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        from: env("REMINDER_FROM_EMAIL"),
        to: [user.email],
        subject,
        text: `${text}\n\nTurn off email reminders: ${stop}`,
      }),
    });
    check(response.ok, "Email delivery failed.");
  }
}
async function paymentUpdate(order: any) {
  const event = paymentEvent(order.status);
  if (!event || order.notify_events === false) return;
  const targets = [{ id: order.user_id, incoming: false }];
  if (order.recipient_id) {
    const receiver = result(
      await db
        .from("members")
        .select("user_id,household_id,left_at")
        .eq("id", order.recipient_id)
        .maybeSingle(),
    );
    if (
      receiver &&
      !receiver.left_at &&
      receiver.household_id === order.household_id &&
      receiver.user_id !== order.user_id
    )
      targets.push({ id: receiver.user_id, incoming: true });
  }
  for (const target of targets) {
    const prefix = target.incoming
      ? "An incoming roommate payment"
      : "Your payment";
    const text = `SplitCart: ${prefix} of $${(order.cents / 100).toFixed(2)} ${event === "pending" ? "is pending. Wait for confirmation before making another payment." : event === "succeeded" ? "was successful. The household balance has been updated; bank payout timing may still apply." : event === "failed" ? "failed. Check Activity and your bank before trying again." : "needs bank authentication. Open Activity for next steps."} Reference ${order.id}.`;
    await notify(target.id, text, `payment-${order.id}-${event}`);
    const a = await account(target.id);
    if (!a.payment_updates || !a.reminder_consent_at) continue;
    const { data } = await db.auth.admin.getUserById(target.id);
    const user = data.user;
    if (!user) continue;
    for (const channel of ["email", "sms"]) {
      if (
        !(channel === "email"
          ? a.email_reminders && user.email_confirmed_at
          : a.sms_reminders && a.phone_verified)
      )
        continue;
      const latest = result(
        await db
          .from("payment_orders")
          .select("status")
          .eq("id", order.id)
          .single(),
      );
      if (paymentEvent(latest?.status || "") !== event) continue;
      const claim = await db.from("payment_update_deliveries").insert({
        order_id: order.id,
        user_id: target.id,
        event,
        channel,
        status: "sending",
      });
      if (claim.error?.code === "23505") continue;
      result(claim);
      let state = "sent";
      try {
        await billingMessage(
          channel,
          a,
          user,
          text,
          "Your SplitCart payment update",
          `payment-${order.id}-${target.id}-${event}-${channel}`,
        );
      } catch (e) {
        state = "failed";
        if (e instanceof Error && e.message === "SMS_OPTED_OUT")
          result(
            await db
              .from("billing_accounts")
              .update({ sms_reminders: false })
              .eq("user_id", target.id),
          );
      }
      result(
        await db
          .from("payment_update_deliveries")
          .update({ status: state })
          .eq("order_id", order.id)
          .eq("user_id", target.id)
          .eq("event", event)
          .eq("channel", channel),
      );
    }
  }
}
async function remind(d: any, date: string, a: any, user: any, kind = "due") {
  const text =
    kind === "autopay"
      ? `SplitCart: autopay will charge $${(d.cents / 100).toFixed(2)} to ${d.method_label || "your selected bank"} on ${date} (UTC). No surcharge. Open Autopay to review or pause future payments.`
      : kind === "failure"
        ? `SplitCart: automatic payment of $${(d.cents / 100).toFixed(2)} for ${date} needs attention. Check payment activity and your bank before paying again.`
        : `SplitCart: your $${(d.cents / 100).toFixed(2)} due is on ${date} (UTC). ${d.automatic ? "Autopay is enabled; check payment status in the app." : "Open SplitCart to review and pay."}`;
  for (const channel of ["email", "sms"]) {
    if (
      !(channel === "email"
        ? a.email_reminders && user.email_confirmed_at
        : a.sms_reminders && a.phone_verified)
    )
      continue;
    const latest = result(
      await db
        .from("payment_orders")
        .select("status")
        .eq("due_id", d.id)
        .eq("due_date", date)
        .maybeSingle(),
    );
    if (
      kind === "due" || kind === "autopay"
        ? !shouldRemind(latest?.status, d.paused)
        : latest?.status === "succeeded"
    )
      continue;
    // Claim before sending: concurrent scheduler runs cannot send duplicates.
    // Ambiguous deliveries remain claimed for operator review, never blind retry.
    const claim = await db.from("payment_reminder_deliveries").insert({
      due_id: d.id,
      due_date: date,
      channel,
      kind,
      status: "sending",
    });
    if (claim.error?.code === "23505") continue;
    result(claim);
    try {
      await billingMessage(
        channel,
        a,
        user,
        text,
        kind === "failure"
          ? "Your SplitCart automatic payment needs attention"
          : kind === "autopay"
            ? "Your SplitCart autopay is scheduled for tomorrow"
            : "Your SplitCart payment reminder",
        `reminder-${kind}-${d.id}-${date}-${channel}`,
      );
      result(
        await db
          .from("payment_reminder_deliveries")
          .update({ status: "sent" })
          .eq("due_id", d.id)
          .eq("due_date", date)
          .eq("channel", channel)
          .eq("kind", kind),
      );
    } catch (e) {
      result(
        await db
          .from("payment_reminder_deliveries")
          .update({ status: "failed" })
          .eq("due_id", d.id)
          .eq("due_date", date)
          .eq("channel", channel)
          .eq("kind", kind),
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
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  for (let offset = 0; ; offset += 100) {
    const orders = result(
      await db
        .from("payment_orders")
        .select("*")
        .eq("notify_events", true)
        .gte("created_at", since)
        .order("id")
        .range(offset, offset + 99),
    );
    for (const order of orders || []) {
      try {
        if (
          order.stripe_intent &&
          ["created", "processing", "requires_action"].includes(order.status)
        )
          await syncIntent(
            order,
            await stripe.paymentIntents.retrieve(order.stripe_intent),
          );
        else await paymentUpdate(order);
      } catch {
        failures++;
      }
    }
    if (!orders || orders.length < 100) break;
  }
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
        if (d.paused) continue;
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
          if (d.created_at && date < d.created_at.slice(0, 10)) continue;
          const existing = result(
            await db
              .from("payment_orders")
              .select("id,status")
              .eq("due_id", d.id)
              .eq("due_date", date)
              .maybeSingle(),
          );
          if (
            d.automatic &&
            d.consent_at &&
            reminderDate(date, 1) === today &&
            shouldRemind(existing?.status, d.paused)
          ) {
            await notify(
              d.user_id,
              `Autopay of $${(d.cents / 100).toFixed(2)} is scheduled for ${date} (UTC). Open Autopay to review the bank or pause future payments.`,
              `autopay-notice-${d.id}-${date}`,
            );
            if (a.autopay_notices && a.reminder_consent_at) {
              const bank = await method(a.customer_id, d.payment_method);
              await remind(
                { ...d, method_label: methodLabel(bank.pm) },
                date,
                a,
                user,
                "autopay",
              );
            }
          }
          if (
            a.reminder_consent_at &&
            reminderDate(date, a.reminder_days) === today &&
            !(d.automatic && a.autopay_notices && a.reminder_days === 1) &&
            shouldRemind(existing?.status, d.paused)
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
              { id: d.id, date, offSession: true },
            );
          }
        }
      } catch {
        failures++;
        if (
          d.automatic &&
          !d.paused &&
          dueDate(today.slice(0, 7), d.due_day) === today
        ) {
          try {
            await failedAutopay({
              due_id: d.id,
              due_date: today,
              cents: d.cents,
              user_id: d.user_id,
            });
          } catch {
            /* Next scheduler run retries the durable alert. */
          }
        }
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
    let verifiedUntil = secondFactorExpiry(token, user.id);
    const claims = verifiedClaims(token, user.id);
    if (a.recovery_pending) {
      const lastTotp = Math.max(
        0,
        ...(claims?.amr || [])
          .filter((m: any) => m.method === "totp")
          .map((m: any) => m.timestamp),
      );
      if (
        verifiedUntil > 0 &&
        lastTotp > Math.floor(Date.parse(a.recovery_started) / 1000) &&
        user.factors?.some(
          (f) =>
            f.status === "verified" &&
            Date.parse(f.created_at) >= Date.parse(a.recovery_started),
        )
      ) {
        result(
          await db
            .from("billing_accounts")
            .update({ recovery_pending: false, recovery_session: null })
            .eq("user_id", user.id),
        );
        a.recovery_pending = false;
        await notify(
          user.id,
          "Replacement authenticator verified. Financial linking is available after a fresh two-step check.",
          `recovery-complete-${a.recovery_started}`,
        );
      } else verifiedUntil = 0;
    }
    if (action === "generate_recovery_codes") {
      check(
        user.email_confirmed_at && verifiedUntil > 0 && !a.recovery_pending,
        "Complete a fresh two-step check before creating backup codes.",
      );
      const codes = Array.from({ length: 8 }, () =>
        Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("")
          .toUpperCase()
          .match(/.{4}/g)!
          .join("-"),
      );
      const hashes = await Promise.all(
        codes.map((code) => recoveryHash(user.id, code)),
      );
      result(
        await db.rpc("replace_mfa_recovery_codes", {
          account_user: user.id,
          hashes,
        }),
      );
      await notify(
        user.id,
        "New authenticator backup codes were created. Previous backup codes no longer work.",
      );
      return send({ codes });
    }
    if (action === "recover_mfa" || action === "resume_mfa_recovery") {
      check(
        user.email_confirmed_at && freshPassword(claims),
        "Sign in again with your password before using authenticator recovery.",
      );
      if (action === "recover_mfa") {
        check(typeof input.code === "string", "Enter a recovery code.");
        const hashed_code = await recoveryHash(user.id, input.code);
        const consumed = await db.rpc("consume_mfa_recovery_code", {
          account_user: user.id,
          hashed_code,
          session_reference: claims.session_id,
        });
        check(!consumed.error, "Recovery code is invalid or already used.");
      } else
        check(
          a.recovery_pending && a.recovery_session === claims.session_id,
          "Resume recovery from the same password-verified session, or use another unused recovery code.",
        );
      await finishRecoveryReset(user.id);
      return send({ ok: true });
    }
    if (action === "status") {
      const remaining = result(
        await db
          .from("mfa_recovery_codes")
          .select("code_hash")
          .eq("user_id", user.id)
          .is("used_at", null),
      );
      return send({
        ...(await status(user)),
        security: {
          verifiedUntil,
          recoveryCodesRemaining: remaining?.length || 0,
          recoveryPending: !!a.recovery_pending,
          canResumeRecovery: !!(
            a.recovery_pending &&
            freshPassword(claims) &&
            a.recovery_session === claims.session_id
          ),
        },
      });
    }
    if (action === "cancel_autopay") {
      check(uuid(input.id), "Choose a scheduled due.");
      result(
        await db.rpc("cancel_due_autopay", {
          due_uuid: input.id,
          account_user: user.id,
        }),
      );
      await notify(
        user.id,
        "Autopay was canceled. The monthly due remains for manual payment; a bank payment already processing may still complete.",
      );
      return send({ ok: true });
    }
    if (["setup", "payout_setup", "bank_verification"].includes(action))
      check(
        user.email_confirmed_at && verifiedUntil > 0,
        "Verify your email and complete a fresh two-step security check in Accounts before linking financial details.",
      );
    if (action === "bank_verification") {
      check(enabled(), "Live payments are not activated yet.");
      const row = result(
        await db
          .from("bank_link_attempts")
          .select("*")
          .eq("id", input.id)
          .eq("user_id", user.id)
          .single(),
      );
      const progress = await bankAttempt(row);
      check(
        progress.url && new URL(progress.url).protocol === "https:",
        "No verification step is available. Refresh bank progress.",
      );
      return send({ url: progress.url });
    }
    if (action === "pause_due") {
      check(
        input.paused === true,
        "Use edit schedule and fresh authorization to resume autopay.",
      );
      const updated = result(
        await db
          .from("payment_dues")
          .update({ paused: true })
          .eq("id", input.id)
          .eq("user_id", user.id)
          .select("id")
          .single(),
      );
      check(updated, "Schedule unavailable.");
      await notify(
        user.id,
        "A monthly payment schedule was paused. Payments already processing may still complete.",
      );
      return send({ ok: true });
    }
    if (action === "create_request") {
      const self = await member(user.id),
        r = input.request;
      check(
        r && uuid(r.id) && typeof r.note === "string" && r.note.length <= 240,
        "Invalid payment request.",
      );
      quote(r.cents, "bank");
      const payer = await recipient(self, r.payer, false);
      check(payer, "Choose a roommate.");
      if (r.expenseId) {
        const expense = result(
          await db
            .from("expenses")
            .select("id")
            .eq("id", r.expenseId)
            .eq("household_id", self.household_id)
            .maybeSingle(),
        );
        check(expense, "Choose an expense in this household.");
      }
      result(
        await db.from("payment_requests").upsert(
          {
            id: r.id,
            household_id: self.household_id,
            requester_id: self.id,
            payer_id: payer.member.id,
            cents: r.cents,
            note: r.note,
            expense_id: r.expenseId || null,
          },
          { onConflict: "id", ignoreDuplicates: true },
        ),
      );
      await notify(
        payer.member.user_id,
        "A roommate sent you a payment request. Open Requests to review it.",
        `request-${r.id}`,
      );
      return send({ ok: true });
    }
    if (action === "cancel_request") {
      const self = await member(user.id);
      result(
        await db.rpc("cancel_payment_request", {
          request_uuid: input.id,
          member_uuid: self.id,
        }),
      );
      return send({ ok: true });
    }
    if (action === "cancel_due") {
      result(
        await db
          .from("payment_dues")
          .delete()
          .eq("id", input.id)
          .eq("user_id", user.id),
      );
      await notify(user.id, "A monthly payment schedule was canceled.");
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
            autopay_notices: r.autopayNotices === true,
            payment_updates: r.paymentUpdates === true,
            reminder_consent_at: r.consent ? new Date().toISOString() : null,
          })
          .eq("user_id", user.id),
      );
      await notify(
        user.id,
        "Payment reminder preferences were changed. Review Reminders if you did not make this change.",
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
    if (action === "save_due" || action === "update_due") {
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
      if (action === "update_due") {
        const prior = result(
          await db
            .from("payment_dues")
            .select("id,recipient_id")
            .eq("id", d.id)
            .eq("user_id", user.id)
            .eq("household_id", self.household_id)
            .single(),
        );
        check(
          prior && prior.recipient_id === (to?.member.id || null),
          "Schedule unavailable or recipient changed.",
        );
      }
      const schedule = {
        user_id: user.id,
        household_id: self.household_id,
        recipient_id: to?.member.id || null,
        cents: d.cents,
        due_day: d.day,
        automatic: d.automatic,
        payment_method: d.automatic ? d.method : "",
        consent_at: d.consent ? new Date().toISOString() : null,
        paused: false,
      };
      result(
        action === "update_due"
          ? await db
              .from("payment_dues")
              .update(schedule)
              .eq("id", d.id)
              .eq("user_id", user.id)
          : await db.from("payment_dues").insert(schedule),
      );
      await notify(
        user.id,
        action === "update_due"
          ? "A monthly payment schedule was updated. Review the amount, bank, and next charge in Autopay."
          : "A monthly payment schedule was created.",
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
        // Stripe's generic card type accepts eligible networks, including all
        // seven in our catalog. Do not add a brand restriction here.
        payment_method_types: [
          input.kind === "bank" ? "us_bank_account" : "card",
        ],
        ...(input.kind === "bank"
          ? {
              payment_method_options: {
                us_bank_account: {
                  // Automatic keeps instant linking and provider-supported
                  // manual entry/microdeposit fallback available for any bank.
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
      if (input.kind === "bank")
        result(
          await db
            .from("bank_link_attempts")
            .insert({ user_id: user.id, session_id: session.id }),
        );
      await notify(
        user.id,
        "Secure payment-method setup was opened. Return to Accounts to verify any changes.",
      );
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
      await notify(
        user.id,
        "Receiving-bank setup was opened. Review Accounts if you did not make this change.",
      );
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
      await notify(
        user.id,
        "A payment method was removed. Review Accounts if you did not make this change.",
      );
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
