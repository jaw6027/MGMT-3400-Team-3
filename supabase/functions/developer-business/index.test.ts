const uid = "10000000-0000-4000-8000-000000000001";
for (const [key, value] of Object.entries({
  SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-service-key",
  STRIPE_SECRET_KEY: "sk_test_fixture",
  APP_URL: "https://splitcart.test",
}))
  Deno.env.set(key, value);
let authenticated = true,
  developer = false,
  recovery = false,
  verifiedFactor = true,
  roleCalls = 0,
  revokeAfterFirst = false,
  versionConflict = false;
let business: any = {
  legal_name: "SplitCart Test LLC",
  legal_structure: "llc",
  tax_classification: "s_corporation",
  version: 0,
};
const requests: { url: URL; method: string; body: any }[] = [];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function token(age = 0, aal = "aal2", sub = uid) {
  const now = Math.floor(Date.now() / 1000) - age;
  return `header.${btoa(
    JSON.stringify({
      sub,
      aal,
      amr: [
        { method: "password", timestamp: now },
        { method: "totp", timestamp: now },
      ],
      user_metadata: { developer: true },
      app_metadata: { role: "developer" },
    }),
  )}.signature`;
}
function reset() {
  authenticated = true;
  developer = false;
  recovery = false;
  verifiedFactor = true;
  roleCalls = 0;
  revokeAfterFirst = false;
  versionConflict = false;
  requests.length = 0;
  business = {
    legal_name: "SplitCart Test LLC",
    legal_structure: "llc",
    tax_classification: "s_corporation",
    version: 0,
  };
  Deno.env.set("STRIPE_SECRET_KEY", "sk_test_fixture");
}
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init),
    url = new URL(req.url),
    raw = req.method === "POST" ? await req.text() : "";
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ url, method: req.method, body });
  if (url.pathname === "/auth/v1/user")
    return authenticated
      ? json({
          id: uid,
          email: "developer@example.test",
          user_metadata: { developer: true },
          app_metadata: { role: "developer" },
        })
      : json({ message: "Invalid token" }, 401);
  if (
    url.pathname.endsWith("/factors") &&
    url.pathname.startsWith("/auth/v1/admin/users/")
  )
    return json(
      verifiedFactor
        ? [{ id: "factor", status: "verified", factor_type: "totp" }]
        : [],
    );
  if (url.pathname === "/rest/v1/app_developers") {
    roleCalls++;
    assert(url.searchParams.get("user_id") === `eq.${uid}`);
    return json(
      developer && (!revokeAfterFirst || roleCalls === 1)
        ? { user_id: uid }
        : null,
    );
  }
  if (url.pathname === "/rest/v1/billing_accounts")
    return json({ recovery_pending: recovery });
  if (url.pathname === "/rest/v1/developer_business_settings")
    return json(business);
  if (url.pathname === "/rest/v1/developer_business_audit") return json(null);
  if (url.pathname === "/rest/v1/rpc/save_developer_business") {
    assert(body.actor === uid);
    if (versionConflict)
      return json({ code: "SC003", message: "Changed" }, 400);
    business = {
      legal_name: body.business_name,
      legal_structure: body.structure,
      tax_classification: body.tax,
      version: business.version + 1,
    };
    return json(business.version);
  }
  if (url.host === "api.stripe.com") {
    if (url.pathname === "/v1/account")
      return json({
        id: "acct_platform",
        payouts_enabled: true,
        charges_enabled: true,
        external_accounts: {
          data: [
            {
              id: "ba_private",
              object: "bank_account",
              bank_name: "Business bank",
              last4: "6789",
              routing_number: "123456789",
              account_number: "NEVER_EXPOSE_FULL_ACCOUNT",
              currency: "usd",
              status: "verified",
            },
          ],
        },
      });
    if (url.pathname === "/v1/balance")
      return json({
        livemode: false,
        available: [{ amount: 12345, currency: "usd" }],
        pending: [{ amount: 500, currency: "usd" }],
      });
  }
  throw new Error(`Unexpected fixture request ${req.method} ${url}`);
};
const { handler } = await import("./index.ts");
const request = (body: any, bearer = token()) =>
  handler(
    new Request("https://db.test/functions/v1/developer-business", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        origin: "https://splitcart.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
Deno.test(
  "ordinary users cannot see private business data or self-promote through claims, metadata or payloads",
  async () => {
    reset();
    const access = await request({
      action: "access",
      developer: true,
      user_id: "other",
    });
    assert(
      JSON.stringify(await access.json()) ===
        JSON.stringify({ authorized: false }),
    );
    for (const action of ["status", "save", "payout_setup"]) {
      const response = await request({
        action,
        developer: true,
        role: "developer",
        business,
      });
      assert(response.status === 403);
    }
    assert(
      !requests.some(
        (r) =>
          r.url.pathname.includes("developer_business_settings") ||
          r.url.host === "api.stripe.com",
      ),
    );
    authenticated = false;
    assert((await request({ action: "status" })).status === 401);
  },
);
Deno.test(
  "private access requires fresh password and verified TOTP, matching user and no recovery hold",
  async () => {
    reset();
    developer = true;
    for (const bearer of [
      token(301),
      token(0, "aal1"),
      token(0, "aal2", "other-user"),
    ])
      assert((await request({ action: "status" }, bearer)).status === 403);
    recovery = true;
    assert((await request({ action: "status" })).status === 403);
    recovery = false;
    verifiedFactor = false;
    assert((await request({ action: "status" })).status === 403);
    assert(!requests.some((r) => r.url.host === "api.stripe.com"));
  },
);
Deno.test(
  "authorized developers see only masked platform bank metadata and business balances",
  async () => {
    reset();
    developer = true;
    const response = await request({ action: "status" });
    assert(response.status === 200, await response.clone().text());
    const text = await response.text();
    const body = JSON.parse(text);
    assert(
      body.business.legal_structure === "llc" &&
        body.business.tax_classification === "s_corporation",
    );
    assert(body.finance.available[0].cents === 12345);
    assert(body.finance.banks[0].last4 === "6789");
    assert(
      !text.includes("123456789") &&
        !text.includes("NEVER_EXPOSE_FULL_ACCOUNT") &&
        !text.includes("fixture-service-key"),
    );
    assert(response.headers.get("Cache-Control")?.includes("no-store"));
    assert(
      !requests.some(
        (r) =>
          r.url.pathname.includes("payment_orders") ||
          r.url.pathname.includes("payment_intents") ||
          r.url.pathname.includes("transfers"),
      ),
    );
  },
);
Deno.test(
  "bank setup uses the configured platform account and requires Stripe team authorization without moving funds",
  async () => {
    reset();
    developer = true;
    const response = await request({
      action: "payout_setup",
      stripeAccountId: "acct_attacker",
      destination: "acct_attacker",
    });
    assert(response.status === 200);
    assert(
      (await response.json()).url ===
        "https://dashboard.stripe.com/acct_platform/settings/payouts",
    );
    assert(
      !requests.some(
        (r) => r.url.host === "api.stripe.com" && r.method !== "GET",
      ),
    );
    assert(
      requests.some(
        (r) =>
          r.url.pathname.endsWith("developer_business_audit") &&
          r.body.event === "payout_settings_opened",
      ),
    );
  },
);
Deno.test(
  "saving entity records validates choices, uses server identity and detects concurrent changes",
  async () => {
    reset();
    developer = true;
    let response = await request({
      action: "save",
      actor: "attacker",
      business: {
        legal_name: " SplitCart LLC ",
        legal_structure: "llc",
        tax_classification: "s_corporation",
        version: 0,
      },
    });
    assert(response.status === 200);
    assert(business.legal_name === "SplitCart LLC" && business.version === 1);
    versionConflict = true;
    response = await request({ action: "save", business });
    assert(response.status === 409);
    assert((await response.json()).error.includes("changed"));
    versionConflict = false;
    response = await request({
      action: "save",
      business: {
        ...business,
        legal_structure: "sole_proprietorship",
        tax_classification: "s_corporation",
      },
    });
    assert(response.status === 400);
    assert(
      !requests.some(
        (r) => r.url.host === "api.stripe.com" && r.method !== "GET",
      ),
    );
  },
);
Deno.test(
  "role revocation is rechecked before returning bank settings or business data",
  async () => {
    for (const action of ["status", "payout_setup"]) {
      reset();
      developer = true;
      revokeAfterFirst = true;
      const response = await request({ action });
      assert(response.status === 403);
      const text = await response.text();
      assert(!text.includes("12345") && !text.includes("dashboard.stripe.com"));
    }
  },
);
