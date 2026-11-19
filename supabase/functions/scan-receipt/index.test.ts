const house = "20000000-0000-4000-8000-000000000001";
for (const [key, value] of Object.entries({
  SUPABASE_URL: "https://db.test",
  SUPABASE_ANON_KEY: "anon-fixture",
  OPENAI_API_KEY: "ocr-fixture",
  APP_URL: "https://splitcart.test",
}))
  Deno.env.set(key, value);
let authenticated = true,
  member = true,
  quota = true,
  providerStatus = 200,
  providerCalls = 0,
  storageCalls = 0;
let extraction: any;
const requests: { url: string; body: any; headers: Headers }[] = [];
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const assert = (value: unknown, message = "Assertion failed") => {
  if (!value) throw new Error(message);
};
function reset() {
  authenticated = true;
  member = true;
  quota = true;
  providerStatus = 200;
  providerCalls = 0;
  storageCalls = 0;
  requests.length = 0;
  Deno.env.set("OPENAI_API_KEY", "ocr-fixture");
  extraction = {
    merchant: "Market",
    date: "2026-11-19",
    currency: "USD",
    items: [{ name: "Groceries", cents: 1000 }],
    taxCents: 100,
    tipCents: 0,
    discountCents: 0,
    totalCents: 1100,
  };
}
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init),
    url = new URL(req.url);
  const body = req.method === "POST" ? await req.json() : null;
  requests.push({ url: req.url, body, headers: req.headers });
  if (url.pathname === "/auth/v1/user")
    return authenticated
      ? json({ id: "10000000-0000-4000-8000-000000000001" })
      : json({ message: "Invalid token" }, 401);
  if (url.pathname === "/rest/v1/members")
    return json(member ? { id: "member" } : null);
  if (url.pathname === "/rest/v1/households") return json({ currency: "USD" });
  if (url.pathname === "/rest/v1/rpc/claim_receipt_scan")
    return quota
      ? json(null)
      : json({ message: "Daily receipt scan limit" }, 400);
  if (url.pathname.startsWith("/storage/v1/object/")) {
    storageCalls++;
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { "Content-Type": "image/png" },
    });
  }
  if (url.href === "https://api.openai.com/v1/chat/completions") {
    providerCalls++;
    return providerStatus === 200
      ? json({
          choices: [{ message: { content: JSON.stringify(extraction) } }],
        })
      : json({ error: "Secret provider account detail" }, providerStatus);
  }
  throw new Error(`Unexpected mock request ${url}`);
};
const { handler } = await import("./index.ts");
const request = (
  body: unknown = {
    household_id: house,
    receipt_path: `${house}/user/receipt.png`,
  },
  token = "user-fixture",
  origin = "https://splitcart.test",
) =>
  handler(
    new Request("https://db.test/functions/v1/scan-receipt", {
      method: "POST",
      headers: {
        Authorization: token ? `Bearer ${token}` : "",
        origin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
Deno.test(
  "receipt OCR requires authentication and active household membership before reading private images",
  async () => {
    reset();
    assert((await request(undefined, "")).status === 401);
    assert(storageCalls === 0 && providerCalls === 0);
    authenticated = false;
    assert((await request()).status === 401);
    assert(storageCalls === 0);
    reset();
    member = false;
    assert((await request()).status === 403);
    assert(storageCalls === 0 && providerCalls === 0);
    reset();
    assert(
      (
        await request({
          household_id: house,
          receipt_path: "other-house/receipt.png",
        })
      ).status === 400,
    );
    assert(storageCalls === 0);
    assert(
      (await request(undefined, "user", "https://untrusted.test")).status ===
        403,
    );
  },
);
Deno.test(
  "receipt OCR returns reviewable facts with strict schema and never assigns roommates or credits cashback",
  async () => {
    reset();
    const response = await request();
    const body = await response.json();
    assert(response.status === 200, JSON.stringify(body));
    assert(
      body.needsReview && body.totalsMatch && body.items[0].cents === 1000,
    );
    assert(body.cashback === undefined && body.items[0].members === undefined);
    const provider = requests.find((r) =>
      r.url.startsWith("https://api.openai.com"),
    )!;
    assert(provider.body.response_format.json_schema.strict === true);
    assert(
      provider.body.messages[1].content[1].image_url.url.startsWith(
        "data:image/png;base64,",
      ),
    );
    extraction.totalCents = 1101;
    const mismatch = await (await request()).json();
    assert(mismatch.needsReview && mismatch.totalsMatch === false);
  },
);
Deno.test(
  "missing service configuration, scan quotas and provider failures leave manual receipt entry available",
  async () => {
    reset();
    Deno.env.delete("OPENAI_API_KEY");
    const missing = await request();
    assert(missing.status === 503);
    assert((await missing.json()).error.includes("manually"));
    assert(providerCalls === 0);
    reset();
    quota = false;
    assert((await request()).status === 429);
    assert(providerCalls === 0);
    reset();
    providerStatus = 500;
    const failed = await request();
    assert(failed.status === 502);
    assert(!JSON.stringify(await failed.json()).includes("Secret provider"));
    reset();
    extraction.items = [];
    assert((await request()).status === 422);
    reset();
    extraction.currency = "EUR";
    assert((await request()).status === 422);
  },
);
