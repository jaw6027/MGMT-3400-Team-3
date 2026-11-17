// Exercise the real Edge handler with in-memory provider/DB responses. No API
// keys, network permission, or real financial transactions are used.
const userId = "10000000-0000-4000-8000-000000000001";
const orderId = "40000000-0000-4000-8000-000000000001";
for (const [name, value] of Object.entries({
  SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "test-key",
  STRIPE_SECRET_KEY: "sk_test_fixture",
  STRIPE_WEBHOOK_SECRET: "whsec_fixture",
  PAYMENTS_ENABLED: "true",
  APP_URL: "https://splitcart.test",
  PAYMENT_JOB_SECRET: "job-fixture",
}))
  Deno.env.set(name, value);
const NativeDate = Date;
class FixedDate extends NativeDate {
  constructor(value?: string | number) {
    super(value ?? "2026-11-17T12:00:00Z");
  }
  static override now() {
    return new NativeDate("2026-11-17T12:00:00Z").getTime();
  }
}
globalThis.Date = FixedDate as DateConstructor;
const requests: { url: URL; method: string; body: any; headers: Headers }[] =
  [];
let orders: any[] = [],
  funding = "credit",
  ownMethod = true,
  authenticated = true,
  sameHouse = true,
  automaticDues: any[] = [],
  reminderRows: any[] = [];
let intentStatus = "succeeded",
  sends = 0;
let smsSends = 0,
  smsOptedOut = false;
const a = {
  user_id: userId,
  customer_id: "cus_user",
  connect_id: null,
  phone: "",
  phone_verified: false,
  email_reminders: true,
  sms_reminders: false,
  reminder_days: 0,
  reminder_consent_at: "2026-01-01",
  unsubscribe_token: "50000000-0000-4000-8000-000000000001",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function reset() {
  orders = [];
  requests.length = 0;
  funding = "credit";
  ownMethod = true;
  authenticated = true;
  sameHouse = true;
  automaticDues = [];
  reminderRows = [];
  intentStatus = "succeeded";
  sends = 0;
  smsSends = 0;
  smsOptedOut = false;
  Object.assign(a, {
    phone: "",
    phone_verified: false,
    email_reminders: true,
    sms_reminders: false,
  });
}
function tableForRpc(url: URL) {
  return url.pathname.split("/").pop();
}
globalThis.fetch = async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const req = new Request(input, init),
    url = new URL(req.url),
    raw = await req.text();
  const body = raw
    ? req.headers.get("content-type")?.includes("json")
      ? JSON.parse(raw)
      : Object.fromEntries(new URLSearchParams(raw))
    : null;
  requests.push({ url, method: req.method, body, headers: req.headers });
  const one = req.headers.get("accept")?.includes("object+json");
  const rows = (items: any[]) => json(one ? items[0] || null : items);
  if (url.host === "api.stripe.com") {
    if (url.pathname.startsWith("/v1/payment_methods/"))
      return json({
        id: "pm_fixture",
        customer: ownMethod ? "cus_user" : "cus_someone_else",
        type: funding === "bank" ? "us_bank_account" : "card",
        card: { funding, last4: "4242", brand: "visa" },
      });
    if (url.pathname.startsWith("/v1/accounts/"))
      return json({
        payouts_enabled: true,
        capabilities: { transfers: "active" },
      });
    if (url.pathname === "/v1/payment_intents" && req.method === "POST")
      return json({
        id: "pi_fixture",
        status: "requires_confirmation",
        amount: Number(body.amount),
        currency: "usd",
        metadata: { order_id: orders[0].id },
      });
    if (url.pathname.startsWith("/v1/payment_intents/pi_fixture"))
      return json({
        id: "pi_fixture",
        status: intentStatus,
        amount: orders[0].cents + orders[0].fee,
        currency: "usd",
        metadata: { order_id: orders[0].id },
      });
  }
  if (url.host === "verify.twilio.com")
    return json({ status: body.Code === "123456" ? "approved" : "pending" });
  if (url.host === "api.twilio.com") {
    smsSends++;
    return smsOptedOut
      ? json({ code: 21610 }, 400)
      : json({ sid: "SM_fixture" });
  }
  if (tableForRpc(url) === "claim_phone_verification") return json(null);
  if (url.pathname === "/auth/v1/user")
    return authenticated
      ? json({
          id: userId,
          email: "alex@example.test",
          email_confirmed_at: "2026-01-01",
        })
      : json({ message: "Invalid JWT", code: "bad_jwt" }, 401);
  if (url.pathname.startsWith("/auth/v1/admin/users/"))
    return json({
      id: userId,
      email: "alex@example.test",
      email_confirmed_at: "2026-01-01",
    });
  const table = url.pathname.split("/").pop();
  if (table === "billing_accounts") {
    if (req.method !== "GET") {
      if (req.method === "PATCH") Object.assign(a, body);
      return json(null);
    }
    return rows(
      url.searchParams.has("user_id") &&
        url.searchParams.get("select") === "connect_id"
        ? [{ connect_id: "acct_receiver" }]
        : [a],
    );
  }
  if (table === "members") {
    if (url.searchParams.has("user_id"))
      return rows([
        {
          id: "self",
          user_id: userId,
          household_id: "home",
          households: { currency: "USD" },
        },
      ]);
    return rows(
      sameHouse
        ? [{ id: "roommate", user_id: "other-user", household_id: "home" }]
        : [],
    );
  }
  if (table === "payment_orders") {
    if (req.method === "POST") {
      const row = {
        ...body,
        status: "created",
        created_at: new Date().toISOString(),
      };
      orders.push(row);
      return json(row);
    }
    let matching = orders;
    for (const field of [
      "id",
      "due_id",
      "due_date",
      "user_id",
      "stripe_intent",
    ])
      if (url.searchParams.get(field)?.startsWith("eq."))
        matching = matching.filter(
          (o) => o[field] === url.searchParams.get(field)!.slice(3),
        );
    if (req.method === "PATCH") {
      for (const o of matching) Object.assign(o, body);
      return json(null);
    }
    return rows(matching);
  }
  if (table === "complete_payment") {
    orders.find((o) => o.id === body.order_id).status = "succeeded";
    return json(null);
  }
  if (table === "reverse_payment") {
    orders.find((o) => o.id === body.order_id).status = body.new_status;
    return json(null);
  }
  if (table === "payment_dues") {
    if (req.method === "POST") {
      automaticDues.push(body);
      return json(null);
    }
    return rows(automaticDues);
  }
  if (table === "payment_reminder_deliveries") {
    if (req.method === "POST") {
      if (
        reminderRows.some(
          (r) =>
            r.due_id === body.due_id &&
            r.due_date === body.due_date &&
            r.channel === body.channel,
        )
      )
        return json({ code: "23505" }, 409);
      reminderRows.push(body);
    }
    return json(null);
  }
  if (url.host === "api.resend.com") {
    sends++;
    return json({ id: "email_fixture" });
  }
  throw new Error(`Unexpected mock request: ${req.method} ${url}`);
};
const { handler } = await import("./index.ts");
const request = (body: any, path = "", bearer = "user-fixture") =>
  handler(
    new Request(`https://db.test/functions/v1/payments${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
    }),
  );
const payment = () => ({
  action: "pay",
  id: orderId,
  method: "pm_fixture",
  recipient: "roommate",
  cents: 1000,
  total: 1025,
  consent: true,
});
Deno.test("payment handler authorization and fee integrity", async () => {
  reset();
  authenticated = false;
  assert((await request(payment())).status === 401);
  authenticated = true;
  ownMethod = false;
  assert((await request(payment())).status === 400);
  assert(!requests.some((r) => r.url.pathname === "/v1/payment_intents"));
  ownMethod = true;
  sameHouse = false;
  assert((await request(payment())).status === 400);
  sameHouse = true;
  assert(
    (await request({ ...payment(), total: 1000 })).status === 400,
    "Client cannot waive credit surcharge",
  );
  assert(!orders.length);
});
Deno.test(
  "confirmed credit payment uses server-calculated fee and stable idempotency keys",
  async () => {
    reset();
    const response = await request(payment());
    assert(response.status === 200, await response.clone().text());
    assert((await response.json()).status === "succeeded");
    const create = requests.find(
      (r) => r.url.pathname === "/v1/payment_intents",
    )!;
    assert(create.body.amount === "1025");
    assert(create.body["transfer_data[amount]"] === "1000");
    assert(create.headers.get("idempotency-key") === `order-${orderId}`);
    await request(payment());
    assert(
      requests.filter((r) => r.url.pathname === "/v1/payment_intents")
        .length === 1,
      "Retry must not debit twice",
    );
    assert(
      (await request({ ...payment(), cents: 2000, total: 2050 })).status ===
        400,
    );
  },
);
Deno.test(
  "bank and debit do not receive a surcharge; processing does not credit the ledger",
  async () => {
    for (const type of ["bank", "debit"]) {
      reset();
      funding = type;
      intentStatus = "processing";
      const response = await request({ ...payment(), total: 1000 });
      assert(response.status === 200, await response.clone().text());
      assert((await response.json()).status === "processing");
      assert(orders[0].fee === 0);
      assert(
        !requests.some((r) => r.url.pathname.endsWith("/complete_payment")),
      );
    }
  },
);
Deno.test(
  "scheduler rejects missing/wrong secrets and invalid Stripe signatures",
  async () => {
    reset();
    assert((await request({}, "/run", "wrong")).status === 401);
    assert((await request({}, "/webhook")).status === 400);
    assert(!orders.length);
  },
);
Deno.test(
  "scheduled bank dues and email reminders are claimed once across repeated runs",
  async () => {
    reset();
    funding = "bank";
    Deno.env.set("RESEND_API_KEY", "re_fixture");
    Deno.env.set("REMINDER_FROM_EMAIL", "SplitCart <billing@example.test>");
    const day = new Date().getUTCDate();
    automaticDues = [
      {
        id: "60000000-0000-4000-8000-000000000001",
        user_id: userId,
        household_id: "home",
        recipient_id: "roommate",
        cents: 1000,
        due_day: day,
        automatic: true,
        consent_at: "2026-01-01",
        payment_method: "pm_fixture",
      },
    ];
    const first = await request({}, "/run", "job-fixture");
    assert(first.status === 200);
    assert((await first.json()).failures === 0);
    await request({}, "/run", "job-fixture");
    assert(orders.length === 1 && orders[0].status === "succeeded");
    assert(sends === 1, "Only one reminder should be sent");
    assert(
      requests.filter((r) => r.url.pathname === "/v1/payment_intents")
        .length === 1,
    );
  },
);
Deno.test(
  "scheduled dues require bank funding and a fresh consent; unsupported funding is blocked",
  async () => {
    reset();
    const due = {
      recipient: "roommate",
      cents: 1000,
      day: 1,
      automatic: true,
      method: "pm_fixture",
      consent: true,
    };
    assert(
      (await request({ action: "save_due", due })).status === 400,
      "Credit cannot be used for bank autopay",
    );
    funding = "bank";
    assert(
      (await request({ action: "save_due", due: { ...due, consent: false } }))
        .status === 400,
    );
    funding = "unknown";
    assert((await request(payment())).status === 400);
    assert(!orders.length);
  },
);

Deno.test(
  "signed Stripe webhooks reconcile late success and bank failure",
  async () => {
    reset();
    orders = [
      {
        id: orderId,
        user_id: userId,
        cents: 1000,
        fee: 25,
        stripe_intent: "pi_fixture",
        status: "processing",
      },
    ];
    const signed = async () => {
      const raw = JSON.stringify({
        id: "evt_fixture",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_fixture" } },
      });
      const time = Math.floor(Date.now() / 1000);
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode("whsec_fixture"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = Array.from(
        new Uint8Array(
          await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(`${time}.${raw}`),
          ),
        ),
      )
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
      return handler(
        new Request("https://db.test/functions/v1/payments/webhook", {
          method: "POST",
          headers: { "stripe-signature": `t=${time},v1=${signature}` },
          body: raw,
        }),
      );
    };
    assert((await signed()).status === 200);
    assert(orders[0].status === "succeeded");
    intentStatus = "requires_payment_method";
    assert((await signed()).status === 200);
    assert(
      orders[0].status === "failed",
      "Read current provider state instead of trusting stale event data",
    );
  },
);

Deno.test("reminder-only dues do not require bank or card setup", async () => {
  reset();
  const response = await request({
    action: "save_due",
    due: {
      recipient: "roommate",
      cents: 2500,
      day: 8,
      automatic: false,
      method: "",
      consent: false,
    },
  });
  assert(response.status === 200, await response.clone().text());
  assert(automaticDues.length === 1 && !automaticDues[0].automatic);
  assert(!requests.some((r) => r.url.host === "api.stripe.com"));
});

Deno.test(
  "texts require opt-in and verified ownership, and Twilio STOP disables reminders",
  async () => {
    reset();
    for (const key of [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_VERIFY_SERVICE_SID",
      "TWILIO_MESSAGING_SERVICE_SID",
    ])
      Deno.env.set(key, "fixture");
    const phone = "+12025550123";
    assert(
      (await request({ action: "phone_start", phone, consent: false }))
        .status === 400,
    );
    assert(!requests.some((r) => r.url.host === "verify.twilio.com"));
    const reminder = { email: false, sms: true, phone, days: 0, consent: true };
    assert(
      (await request({ action: "reminders", reminder })).status === 400,
      "Unverified phones cannot receive dues reminders",
    );
    assert(
      (await request({ action: "phone_start", phone, consent: true }))
        .status === 200,
    );
    assert(
      (
        await request({
          action: "phone_confirm",
          phone,
          code: "000000",
          consent: true,
        })
      ).status === 400,
    );
    assert(
      (
        await request({
          action: "phone_confirm",
          phone,
          code: "123456",
          consent: true,
        })
      ).status === 200,
    );
    assert((await request({ action: "reminders", reminder })).status === 200);
    automaticDues = [
      {
        id: "60000000-0000-4000-8000-000000000001",
        user_id: userId,
        household_id: "home",
        recipient_id: "roommate",
        cents: 1000,
        due_day: 17,
        automatic: false,
        payment_method: "",
      },
    ];
    smsOptedOut = true;
    const run = await request({}, "/run", "job-fixture");
    assert(run.status === 200 && smsSends === 1);
    assert(!a.sms_reminders, "An opted-out number must be disabled locally");
  },
);
