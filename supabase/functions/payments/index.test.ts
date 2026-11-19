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
  reminderRows: any[] = [],
  notices: any[] = [],
  updateRows: any[] = [],
  bankAttempts: any[] = [];
let cardBrand = "visa",
  showCatalogCards = false;
let bankReady = true;
let exposeBank = false,
  bankBlocked = false,
  failureCode: string | null = null;
let bankHealth = new Map<string, string>();
let duplicateReservation = false;
let bankSessionStatus = "complete",
  factorDeleteFails = false;
let recoveryCodes: any[] = [];
let factors: any[] = [];
let intentStatus = "succeeded",
  sends = 0;
let smsSends = 0,
  smsOptedOut = false;
const a = {
  recovery_pending: false,
  recovery_started: null as string | null,
  recovery_session: null as string | null,
  payment_updates: false,
  autopay_notices: false,
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
  duplicateReservation = false;
  exposeBank = false;
  bankBlocked = false;
  failureCode = null;
  bankHealth.clear();
  requests.length = 0;
  funding = "credit";
  ownMethod = true;
  authenticated = true;
  sameHouse = true;
  automaticDues = [];
  reminderRows = [];
  notices = [];
  updateRows = [];
  bankAttempts = [];
  cardBrand = "visa";
  showCatalogCards = false;
  bankReady = true;
  bankSessionStatus = "complete";
  factorDeleteFails = false;
  recoveryCodes = [];
  factors = [
    {
      id: "b0000000-0000-4000-8000-000000000001",
      factor_type: "totp",
      status: "verified",
      created_at: "2026-01-01T00:00:00Z",
    },
  ];
  intentStatus = "succeeded";
  sends = 0;
  smsSends = 0;
  smsOptedOut = false;
  Object.assign(a, {
    recovery_pending: false,
    recovery_started: null,
    recovery_session: null,
    payment_updates: false,
    autopay_notices: false,
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
    if (url.pathname === "/v1/setup_intents")
      return json({
        data: bankReady
          ? [
              {
                id: "seti_bank",
                status: "succeeded",
                payment_method: "pm_fixture",
              },
            ]
          : [],
        has_more: false,
      });
    if (url.pathname === "/v1/checkout/sessions" && req.method === "POST")
      return json({ id: "cs_bank", url: "https://checkout.stripe.com/sample" });
    if (url.pathname === "/v1/checkout/sessions/cs_bank")
      return json({
        id: "cs_bank",
        status: bankSessionStatus,
        url: "https://checkout.stripe.com/resume-bank",
        setup_intent:
          bankSessionStatus === "open"
            ? null
            : {
                id: "seti_bank",
                status: bankReady ? "succeeded" : "requires_action",
                payment_method: {
                  id: "pm_fixture",
                  type: "us_bank_account",
                  us_bank_account: { bank_name: "Sample bank", last4: "6789" },
                },
                next_action: bankReady
                  ? null
                  : {
                      verify_with_microdeposits: {
                        hosted_verification_url:
                          "https://verify.stripe.com/sample",
                      },
                    },
              },
      });

    if (url.pathname === "/v1/payment_methods")
      return json({
        data:
          exposeBank && url.searchParams.get("type") === "us_bank_account"
            ? [
                {
                  id: "pm_fixture",
                  customer: "cus_user",
                  type: "us_bank_account",
                  us_bank_account: {
                    bank_name: "Sample bank",
                    last4: "6789",
                    status_details: {
                      blocked: bankBlocked
                        ? { reason: "bank_account_closed" }
                        : null,
                    },
                  },
                },
              ]
            : showCatalogCards && url.searchParams.get("type") === "card"
              ? [
                  "visa",
                  "mastercard",
                  "amex",
                  "discover",
                  "unionpay",
                  "jcb",
                  "diners",
                ].map((brand) => ({
                  id: `pm_${brand}`,
                  customer: "cus_user",
                  type: "card",
                  card: { funding: "credit", brand, last4: "4242" },
                }))
              : [],
        has_more: false,
      });
    if (url.pathname.startsWith("/v1/payment_methods/"))
      return json({
        id: "pm_fixture",
        customer: ownMethod ? "cus_user" : "cus_someone_else",
        type: funding === "bank" ? "us_bank_account" : "card",
        card: { funding, last4: "4242", brand: cardBrand },
        us_bank_account: {
          bank_name: "Sample bank",
          last4: "6789",
          status_details: {
            blocked: bankBlocked ? { reason: "bank_account_closed" } : null,
          },
        },
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
        last_payment_error: failureCode
          ? { code: failureCode, message: "Sensitive raw provider detail" }
          : null,
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
          factors,
          email: "alex@example.test",
          email_confirmed_at: "2026-01-01",
        })
      : json({ message: "Invalid JWT", code: "bad_jwt" }, 401);
  if (
    url.pathname.endsWith("/factors") &&
    url.pathname.startsWith("/auth/v1/admin/users/")
  )
    return json(factors);
  if (req.method === "DELETE" && url.pathname.includes("/factors/")) {
    if (factorDeleteFails)
      return json({ message: "Temporary Auth failure" }, 500);
    factors = factors.filter((f) => f.id !== url.pathname.split("/").pop());
    return json({});
  }
  if (url.pathname.startsWith("/auth/v1/admin/users/"))
    return json({
      id: userId,
      email: "alex@example.test",
      email_confirmed_at: "2026-01-01",
    });
  const table = url.pathname.split("/").pop();
  if (table === "mfa_recovery_codes")
    return rows(recoveryCodes.filter((c) => !c.used_at));
  if (table === "replace_mfa_recovery_codes") {
    recoveryCodes = body.hashes.map((code_hash: string) => ({
      code_hash,
      used_at: null,
    }));
    return json(null);
  }
  if (table === "consume_mfa_recovery_code") {
    const code = recoveryCodes.find(
      (c) => c.code_hash === body.hashed_code && !c.used_at,
    );
    if (!code) return json({ message: "Invalid recovery code" }, 400);
    code.used_at = new Date().toISOString();
    a.recovery_pending = true;
    a.recovery_started = new Date().toISOString();
    a.recovery_session = body.session_reference;
    return json(null);
  }
  if (table === "cancel_due_autopay") {
    const due = automaticDues.find(
      (d) => d.id === body.due_uuid && d.user_id === body.account_user,
    );
    if (!due) return json({ message: "Schedule unavailable" }, 400);
    Object.assign(due, {
      automatic: false,
      paused: false,
      payment_method: "",
      consent_at: null,
    });
    return json(null);
  }
  if (table === "record_bank_health") {
    const key = body.account_user + body.resource_key;
    const old = bankHealth.get(key);
    bankHealth.set(key, body.new_state);
    if (old === body.new_state || (!old && body.new_state === "ready"))
      return json(null);
    const id = crypto.randomUUID();
    notices.push({
      user_id: body.account_user,
      event_key: `bank-${id}`,
      message: body.alert_message,
    });
    return json(id);
  }
  if (table === "bank_health")
    return rows(
      [...bankHealth.keys()]
        .filter((k) => k.startsWith(userId + "pm_"))
        .map((k) => ({ resource: k.slice(userId.length) })),
    );
  if (table === "bank_health_events") return json(null);
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
  if (table === "payment_notifications") {
    if (
      req.method === "POST" &&
      !notices.some(
        (n) => n.event_key === body.event_key && n.user_id === body.user_id,
      )
    )
      notices.push(body);
    return req.method === "GET" ? rows(notices) : json(null);
  }
  if (table === "bank_link_attempts") {
    if (req.method === "POST")
      bankAttempts.push({
        id: "60000000-0000-4000-8000-000000000099",
        ...body,
      });
    let matches = bankAttempts;
    for (const key of ["id", "user_id"])
      if (url.searchParams.get(key)?.startsWith("eq."))
        matches = matches.filter(
          (r) => r[key] === url.searchParams.get(key)!.slice(3),
        );
    return req.method === "GET" ? rows(matches) : json(null);
  }
  if (table === "payment_update_deliveries") {
    if (req.method === "POST") {
      if (
        updateRows.some(
          (r) =>
            r.order_id === body.order_id &&
            r.user_id === body.user_id &&
            r.event === body.event &&
            r.channel === body.channel,
        )
      )
        return json({ code: "23505" }, 409);
      updateRows.push(body);
    }
    return json(null);
  }
  if (table === "payment_requests") return rows([]);
  if (table === "reserve_due_payment") {
    const value = body.order_data;
    let row = orders.find(
      (o) => o.due_id === value.due_id && o.due_date === value.due_date,
    );
    if (!row) {
      row = {
        ...value,
        status: "created",
        created_at: new Date().toISOString(),
      };
      orders.push(row);
    }
    return json(row);
  }
  if (table === "payment_orders") {
    if (req.method === "POST") {
      if (duplicateReservation)
        return json(
          { code: "SC001", message: "Possible duplicate payment" },
          400,
        );
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
      "recipient_id",
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
    let matching = automaticDues;
    for (const field of ["id", "user_id", "household_id"])
      if (url.searchParams.get(field)?.startsWith("eq."))
        matching = matching.filter(
          (d) => d[field] === url.searchParams.get(field)!.slice(3),
        );
    if (req.method === "PATCH") {
      for (const d of matching) Object.assign(d, body);
      return rows(matching);
    }
    return rows(matching);
  }
  if (table === "payment_reminder_deliveries") {
    if (req.method === "POST") {
      if (
        reminderRows.some(
          (r) =>
            r.due_id === body.due_id &&
            r.due_date === body.due_date &&
            r.channel === body.channel &&
            r.kind === body.kind,
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
    assert(Number(sends) === 1, "Only one reminder should be sent");
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

Deno.test(
  "cleared, processing, and paused dues do not receive pay reminders",
  async () => {
    for (const state of ["succeeded", "processing", "created", "paused"]) {
      reset();
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
          paused: state === "paused",
        },
      ];
      if (state !== "paused")
        orders = [
          {
            id: orderId,
            user_id: userId,
            due_id: automaticDues[0].id,
            due_date: "2026-11-17",
            status: state,
          },
        ];
      const response = await request({}, "/run", "job-fixture");
      assert(response.status === 200);
      assert(Number(sends) === 0, `${state} should suppress payment reminders`);
    }
  },
);
Deno.test(
  "failed autopay produces one durable warning and separate opted-in failure alerts",
  async () => {
    reset();
    funding = "bank";
    intentStatus = "requires_payment_method";
    Deno.env.set("RESEND_API_KEY", "re_fixture");
    Deno.env.set("REMINDER_FROM_EMAIL", "billing@example.test");
    automaticDues = [
      {
        id: "60000000-0000-4000-8000-000000000001",
        user_id: userId,
        household_id: "home",
        recipient_id: "roommate",
        cents: 1000,
        due_day: 17,
        automatic: true,
        consent_at: "2026-01-01",
        payment_method: "pm_fixture",
      },
    ];
    await request({}, "/run", "job-fixture");
    await request({}, "/run", "job-fixture");
    assert(orders.length === 1 && orders[0].status === "failed");
    assert(
      notices.filter((n) => n.event_key.startsWith("autopay-")).length === 1,
      "One durable autopay warning per occurrence",
    );
    assert(reminderRows.filter((r) => r.kind === "failure").length === 1);
    assert(
      Number(sends) === 2,
      "One normal due reminder and one failure alert, each claimed separately",
    );
  },
);
Deno.test(
  "manual occurrence payment stays on-session and foreign dues cannot be charged",
  async () => {
    reset();
    funding = "bank";
    const dueId = "60000000-0000-4000-8000-000000000001";
    automaticDues = [
      {
        id: dueId,
        user_id: userId,
        household_id: "home",
        recipient_id: "roommate",
        cents: 1000,
        due_day: 17,
        automatic: false,
        payment_method: "",
        created_at: "2026-01-01",
      },
    ];
    const response = await request({
      ...payment(),
      total: 1000,
      dueId,
      dueDate: "2026-11-17",
    });
    assert(response.status === 200, await response.clone().text());
    const confirm = requests.find((r) => r.url.pathname.endsWith("/confirm"));
    assert(
      confirm?.body.off_session === "false",
      "User-initiated payment must allow bank authentication",
    );
    automaticDues[0].user_id = "other-user";
    assert(
      (
        await request({
          ...payment(),
          total: 1000,
          dueId,
          dueDate: "2026-11-17",
        })
      ).status === 400,
    );
  },
);

const secondFactorToken = (
  age = 0,
  aal = "aal2",
  sub = userId,
  passwordAge = age,
) =>
  `header.${btoa(
    JSON.stringify({
      sub,
      aal,
      amr: [
        {
          method: "password",
          timestamp: Math.floor(Date.now() / 1000) - passwordAge,
        },
        { method: "totp", timestamp: Math.floor(Date.now() / 1000) - age },
      ],
    }),
  ).replace(/=/g, "")}.test-signature`;
Deno.test(
  "financial linking requires fresh AAL2 from the authenticated account and tracks verification progress",
  async () => {
    reset();
    for (const bearer of [
      "user-fixture",
      secondFactorToken(301),
      secondFactorToken(0, "aal2", userId, 301),
      secondFactorToken(0, "aal1"),
      secondFactorToken(0, "aal2", "another-user"),
    ])
      assert(
        (await request({ action: "setup", kind: "bank" }, "", bearer))
          .status === 400,
      );
    assert(
      !requests.some((r) => r.url.pathname === "/v1/checkout/sessions"),
      "Blocked linking must not reach Stripe",
    );
    const start = await request(
      { action: "setup", kind: "bank" },
      "",
      secondFactorToken(),
    );
    assert(start.status === 200, await start.clone().text());
    assert(bankAttempts.length === 1);
    bankReady = false;
    const progress = await request({ action: "status" });
    assert(progress.status === 200, await progress.clone().text());
    const data = await progress.json();
    assert(data.bankLinks[0].status === "verification_pending");
    assert(
      !data.bankLinks[0].url,
      "Verification URL must not be returned without a fresh check",
    );
    assert(
      (await request({ action: "bank_verification", id: bankAttempts[0].id }))
        .status === 400,
    );
    const verification = await request(
      { action: "bank_verification", id: bankAttempts[0].id },
      "",
      secondFactorToken(),
    );
    assert(verification.status === 200);
    assert(
      (await verification.json()).url === "https://verify.stripe.com/sample",
    );
    bankReady = true;
    assert(
      (await (await request({ action: "status" })).json()).bankLinks[0]
        .status === "verified",
    );
  },
);
Deno.test("unverified banks cannot pay or enable automatic dues", async () => {
  reset();
  funding = "bank";
  bankReady = false;
  assert((await request({ ...payment(), total: 1000 })).status === 400);
  assert(!orders.length);
  assert(
    (
      await request({
        action: "save_due",
        due: {
          recipient: "roommate",
          cents: 1000,
          day: 17,
          automatic: true,
          method: "pm_fixture",
          consent: true,
        },
      })
    ).status === 400,
  );
});
Deno.test(
  "advance autopay notices are claimed once and include amount, bank, and date",
  async () => {
    reset();
    funding = "bank";
    a.autopay_notices = true;
    a.reminder_days = 1;
    Deno.env.set("RESEND_API_KEY", "re_fixture");
    Deno.env.set("REMINDER_FROM_EMAIL", "billing@example.test");
    automaticDues = [
      {
        id: "60000000-0000-4000-8000-000000000001",
        user_id: userId,
        household_id: "home",
        recipient_id: "roommate",
        cents: 2500,
        due_day: 18,
        automatic: true,
        consent_at: "2026-01-01",
        payment_method: "pm_fixture",
      },
    ];
    await request({}, "/run", "job-fixture");
    await request({}, "/run", "job-fixture");
    assert(
      Number(sends) === 1,
      "Normal due notice must not duplicate an advance notice",
    );
    assert(reminderRows[0].kind === "autopay");
    const message = requests.find((r) => r.url.host === "api.resend.com")!.body
      .text;
    assert(
      message.includes("$25.00") &&
        message.includes("2026-11-18") &&
        message.includes("No surcharge"),
    );
    assert(!orders.length, "Advance notice must not charge early");
  },
);
Deno.test(
  "pending, successful and failed updates are deduplicated and respect opt-in",
  async () => {
    reset();
    funding = "bank";
    a.payment_updates = true;
    a.reminder_days = 0;
    Deno.env.set("RESEND_API_KEY", "re_fixture");
    Deno.env.set("REMINDER_FROM_EMAIL", "billing@example.test");
    // App dues avoid a second recipient in this delivery-count assertion.
    Deno.env.set("APP_DUES_CENTS", "1000");
    intentStatus = "processing";
    const body = { ...payment(), recipient: "app", total: 1000 };
    assert((await request(body)).status === 200);
    assert(Number(sends) === 1 && updateRows[0].event === "pending");
    await request(body);
    assert(Number(sends) === 1, "Pending must not be sent twice");
    intentStatus = "succeeded";
    await request(body);
    assert(
      Number(sends) === 2 && updateRows.some((r) => r.event === "succeeded"),
    );
    intentStatus = "requires_payment_method";
    await request({}, "/run", "job-fixture");
    // A late bank return is reconciled by a signed webhook or explicit status sync,
    // not by treating a previously completed order as a new debit.
    assert(!updateRows.some((r) => r.event === "failed"));
    reset();
    a.payment_updates = false;
    await request({ ...payment() });
    assert(Number(sends) === 0, "Disabled updates must not send email");
    reset();
    funding = "bank";
    a.payment_updates = true;
    intentStatus = "requires_payment_method";
    await request({ ...payment(), total: 1000 });
    assert(updateRows.some((r) => r.event === "failed"));
    Deno.env.set("APP_DUES_CENTS", "0");
  },
);

const passwordToken = (
  age = 0,
  session = "d0000000-0000-4000-8000-000000000001",
  method = "password",
) =>
  `header.${btoa(JSON.stringify({ sub: userId, aal: "aal1", session_id: session, amr: [{ method, timestamp: Math.floor(Date.now() / 1000) - age }] })).replace(/=/g, "")}.test-signature`;
Deno.test(
  "backup codes require fresh MFA, are stored hashed, and recover only with a fresh password session",
  async () => {
    reset();
    assert(
      (await request({ action: "generate_recovery_codes" })).status === 400,
    );
    const generated = await request(
      { action: "generate_recovery_codes" },
      "",
      secondFactorToken(),
    );
    assert(generated.status === 200, await generated.clone().text());
    const { codes } = await generated.json();
    assert(codes.length === 8 && new Set(codes).size === 8);
    assert(
      recoveryCodes.every(
        (c) =>
          /^[a-f0-9]{64}$/.test(c.code_hash) && !codes.includes(c.code_hash),
      ),
    );
    for (const token of [
      passwordToken(301),
      passwordToken(0, undefined, "recovery"),
      secondFactorToken(),
    ])
      assert(
        (await request({ action: "recover_mfa", code: codes[0] }, "", token))
          .status === 400,
      );
    assert(Number(factors.length) === 1 && !a.recovery_pending);
    const recovered = await request(
      { action: "recover_mfa", code: codes[0] },
      "",
      passwordToken(),
    );
    assert(recovered.status === 200, await recovered.clone().text());
    assert(a.recovery_pending && Number(factors.length) === 0);
    assert(recoveryCodes.filter((c) => !c.used_at).length === 7);
    assert(
      (
        await request(
          { action: "recover_mfa", code: codes[0] },
          "",
          passwordToken(),
        )
      ).status === 400,
      "Used backup code cannot be replayed",
    );
    assert(
      (
        await request(
          { action: "setup", kind: "bank" },
          "",
          secondFactorToken(),
        )
      ).status === 400,
      "Old authenticator token cannot unlock recovery hold",
    );
    // Model a replacement factor verified after recovery began.
    a.recovery_started = new NativeDate(Date.now() - 1000).toISOString();
    factors = [
      {
        id: "b0000000-0000-4000-8000-000000000002",
        factor_type: "totp",
        status: "verified",
        created_at: new Date().toISOString(),
      },
    ];
    const stale = await request(
      { action: "status" },
      "",
      secondFactorToken(10),
    );
    assert(
      (await stale.json()).security.verifiedUntil === 0 && a.recovery_pending,
    );
    const ready = await request({ action: "status" }, "", secondFactorToken());
    const data = await ready.json();
    assert(
      data.security.verifiedUntil > 0 &&
        !a.recovery_pending &&
        data.security.recoveryCodesRemaining === 7,
    );
  },
);
Deno.test(
  "cancel-autopay keeps the due and prevents the scheduler from charging it",
  async () => {
    reset();
    funding = "bank";
    const id = "60000000-0000-4000-8000-000000000001";
    automaticDues = [
      {
        id,
        user_id: userId,
        household_id: "home",
        recipient_id: "roommate",
        cents: 3500,
        due_day: 17,
        automatic: true,
        consent_at: "2026-01-01",
        payment_method: "pm_fixture",
      },
    ];
    const canceled = await request({ action: "cancel_autopay", id });
    assert(canceled.status === 200, await canceled.clone().text());
    assert(
      automaticDues.length === 1 &&
        !automaticDues[0].automatic &&
        automaticDues[0].cents === 3500,
    );
    await request({}, "/run", "job-fixture");
    assert(!orders.length, "Canceled autopay must not create a charge");
    automaticDues[0].user_id = "another-user";
    assert((await request({ action: "cancel_autopay", id })).status === 400);
  },
);

Deno.test(
  "interrupted authenticator reset can resume only in the bound password session",
  async () => {
    reset();
    const generated = await request(
      { action: "generate_recovery_codes" },
      "",
      secondFactorToken(),
    );
    const { codes } = await generated.json();
    factorDeleteFails = true;
    assert(
      (
        await request(
          { action: "recover_mfa", code: codes[0] },
          "",
          passwordToken(),
        )
      ).status === 400,
    );
    assert(a.recovery_pending);
    factorDeleteFails = false;
    assert(
      (
        await request(
          { action: "resume_mfa_recovery" },
          "",
          passwordToken(0, "another-session-reference"),
        )
      ).status === 400,
    );
    assert(
      (await request({ action: "resume_mfa_recovery" }, "", passwordToken()))
        .status === 200,
    );
    assert(Number(factors.length) === 0 && a.recovery_pending);
  },
);
Deno.test(
  "unfinished bank setup can resume securely and expired setup stays unverified",
  async () => {
    reset();
    bankAttempts = [
      {
        id: "60000000-0000-4000-8000-000000000099",
        user_id: userId,
        session_id: "cs_bank",
      },
    ];
    bankReady = false;
    bankSessionStatus = "open";
    const progress = await request({ action: "status" });
    const data = await progress.json();
    assert(
      data.bankLinks[0].status === "awaiting_details" &&
        data.bankLinks[0].canResume,
    );
    const resume = await request(
      { action: "bank_verification", id: bankAttempts[0].id },
      "",
      secondFactorToken(),
    );
    assert(resume.status === 200, await resume.clone().text());
    assert(
      (await resume.json()).url === "https://checkout.stripe.com/resume-bank",
    );
    bankSessionStatus = "expired";
    const expired = await (await request({ action: "status" })).json();
    assert(
      expired.bankLinks[0].status === "expired" &&
        !expired.bankLinks[0].canResume,
    );
  },
);

Deno.test(
  "all seven requested credit-card brands pay with the same server-calculated surcharge",
  async () => {
    const { CARD_NETWORKS } = await import("../_shared/card-networks.ts");
    for (const network of CARD_NETWORKS) {
      reset();
      cardBrand = network.id;
      const response = await request(payment());
      assert(response.status === 200, await response.clone().text());
      const saved = await response.json();
      assert(
        saved.status === "succeeded" &&
          saved.fee === 25 &&
          saved.cents === 1000,
      );
      assert(saved.method_label === `${network.name} credit •••• 4242`);
      const create = requests.find(
        (r) => r.url.pathname === "/v1/payment_intents",
      )!;
      assert(
        create.body.amount === "1025" &&
          create.body["transfer_data[amount]"] === "1000",
      );
      assert(create.body["payment_method_types[0]"] === "card");
    }
  },
);
Deno.test(
  "saved cards expose readable brands and secure setup has no brand restriction",
  async () => {
    reset();
    showCatalogCards = true;
    const { CARD_NETWORKS } = await import("../_shared/card-networks.ts");
    const response = await request({ action: "status" });
    assert(response.status === 200, await response.clone().text());
    const state = await response.json();
    assert(state.methods.length === 7);
    for (const network of CARD_NETWORKS)
      assert(
        state.methods.some(
          (m: any) =>
            m.brand === network.id &&
            m.label === `${network.name} credit •••• 4242`,
        ),
      );
    const setup = await request(
      { action: "setup", kind: "card" },
      "",
      secondFactorToken(),
    );
    assert(setup.status === 200, await setup.clone().text());
    const session = requests.find(
      (r) => r.url.pathname === "/v1/checkout/sessions",
    )!;
    assert(session.body["payment_method_types[0]"] === "card");
    assert(
      !Object.keys(session.body).some(
        (k) => k.includes("disallowed") || k.includes("allowed_brands"),
      ),
      "Do not add a brand exclusion to card setup",
    );
    reset();
    cardBrand = "amex";
    funding = "debit";
    const debit = await request({ ...payment(), total: 1000 });
    assert(debit.status === 200);
    assert(
      (await debit.json()).fee === 0,
      "Funding classification, not brand, controls the surcharge",
    );
  },
);

Deno.test(
  "bank setup permits provider manual fallback without bank-name restrictions and requires fresh security",
  async () => {
    reset();
    const response = await request(
      { action: "setup", kind: "bank" },
      "",
      secondFactorToken(),
    );
    assert(response.status === 200, await response.clone().text());
    const session = requests.find(
      (r) => r.url.pathname === "/v1/checkout/sessions",
    )!;
    assert(session.body["payment_method_types[0]"] === "us_bank_account");
    assert(
      session.body[
        "payment_method_options[us_bank_account][verification_method]"
      ] === "automatic",
    );
    assert(
      !Object.keys(session.body).some((k) =>
        /routing_number|account_number|bank_name/.test(k),
      ),
      "Collect numbers on the provider page without bank-name restrictions",
    );
    reset();
    const unverified = await request({ action: "setup", kind: "bank" });
    assert(unverified.status !== 200);
  },
);

Deno.test(
  "duplicate reservation rejects a fresh reference before contacting Stripe for a charge",
  async () => {
    reset();
    duplicateReservation = true;
    const response = await request(payment());
    assert(response.status === 400);
    assert((await response.json()).error.includes("Possible duplicate"));
    assert(!requests.some((r) => r.url.pathname === "/v1/payment_intents"));
  },
);
Deno.test(
  "failed payments expose a curated cause to both participants without raw provider details",
  async () => {
    reset();
    intentStatus = "requires_payment_method";
    failureCode = "insufficient_funds";
    const response = await request(payment());
    const saved = await response.json();
    assert(
      response.status === 200 && saved.failure_code === "insufficient_funds",
    );
    assert(notices.some((n) => n.message.includes("insufficient funds")));
    assert(!JSON.stringify(notices).includes("Sensitive raw"));
  },
);
Deno.test(
  "blocked banks stop payment and bank issues notify once per transition then announce recovery",
  async () => {
    reset();
    exposeBank = true;
    bankBlocked = true;
    funding = "bank";
    const pay = await request({ ...payment(), total: 1000 });
    assert(pay.status === 400);
    assert(!requests.some((r) => r.url.pathname === "/v1/payment_intents"));
    const first = await request({ action: "status" });
    assert(first.status === 200, await first.clone().text());
    const state = await first.json();
    assert(state.bankIssues.some((b: any) => b.state === "blocked"));
    assert(state.methods[0].issue.includes("cannot make payments"));
    const count = notices.length;
    await request({ action: "status" });
    assert(notices.length === count);
    bankBlocked = false;
    await request({ action: "status" });
    assert(notices.length === count + 1);
    assert(notices.some((n) => n.message.includes("verified and ready")));
  },
);

Deno.test(
  "bank alerts honor message preferences, avoid repeat delivery, and background audits find problems",
  async () => {
    reset();
    exposeBank = true;
    bankBlocked = true;
    a.payment_updates = true;
    await request({ action: "status" });
    assert(sends === 1);
    await request({ action: "status" });
    assert(sends === 1);
    bankBlocked = false;
    await request({ action: "status" });
    assert(Number(sends) === 2);
    a.payment_updates = false;
    bankBlocked = true;
    const response = await handler(
      new Request("https://db.test/functions/v1/payments/run", {
        method: "POST",
        headers: { Authorization: "Bearer job-fixture" },
      }),
    );
    assert(response.status === 200);
    assert(Number(sends) === 2);
    assert(notices.some((n) => n.message.includes("cannot make payments")));
  },
);
