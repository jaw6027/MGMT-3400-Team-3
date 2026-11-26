const house = "20000000-0000-4000-8000-000000000001",
  user = "10000000-0000-4000-8000-000000000001";
for (const [key, value] of Object.entries({
  SUPABASE_URL: "https://db.test",
  SUPABASE_ANON_KEY: "anon-fixture",
  SUPABASE_SERVICE_ROLE_KEY: "service-fixture",
  APP_URL: "https://splitcart.test",
}))
  Deno.env.set(key, value);
let authenticated = true,
  member = true,
  mime = "application/pdf",
  bytes = new TextEncoder().encode("%PDF-1.4 classroom statement"),
  legacy: { receipt: string }[] = [],
  shared = false;
const registrations: any[] = [],
  downloads: string[] = [];
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const assert = (value: unknown, message = "Assertion failed") => {
  if (!value) throw new Error(message);
};
function reset() {
  authenticated = true;
  member = true;
  mime = "application/pdf";
  bytes = new TextEncoder().encode("%PDF-1.4 classroom statement");
  legacy = [];
  shared = false;
  registrations.length = 0;
  downloads.length = 0;
}
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init),
    url = new URL(request.url);
  if (url.pathname === "/auth/v1/user")
    return authenticated
      ? json({ id: user })
      : json({ message: "Invalid token" }, 401);
  if (url.pathname === "/rest/v1/members")
    return json(member ? { id: "member" } : null);
  if (url.pathname === "/rest/v1/expenses")
    return json(
      url.searchParams.get("select") === "receipt"
        ? legacy
        : shared
          ? [{ id: "expense" }]
          : [],
    );
  if (url.pathname.startsWith("/storage/v1/object/")) {
    downloads.push(url.pathname);
    return new Response(bytes.slice(), { headers: { "content-type": mime } });
  }
  if (url.pathname === "/rest/v1/rpc/register_verified_document") {
    assert(
      request.headers.get("authorization") === "Bearer service-fixture",
      "Registration must use server authority",
    );
    const body = await request.json();
    registrations.push(body);
    return json({
      sha256: body.file_hash,
      mime: body.file_mime,
      name: body.file_name,
      kind: "receipt",
      reference: "",
    });
  }
  throw new Error(`Unexpected request ${url}`);
};
const { handler } = await import("./index.ts");
const request = (
  body: unknown = {
    household_id: house,
    receipt_path: `${house}/${user}/bill.pdf`,
    file_name: "bill.pdf",
  },
  token = "fixture",
  origin = "https://splitcart.test",
) =>
  handler(
    new Request("https://db.test/functions/v1/verify-document", {
      method: "POST",
      headers: {
        authorization: token ? `Bearer ${token}` : "",
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
Deno.test(
  "document verification requires authentication and household membership before storage or service writes",
  async () => {
    reset();
    assert((await request(undefined, "")).status === 401);
    assert(!downloads.length && !registrations.length);
    authenticated = false;
    assert((await request()).status === 401);
    authenticated = true;
    member = false;
    assert((await request()).status === 403);
    member = true;
    assert(
      (
        await request({
          household_id: house,
          receipt_path: `${house}/other/file.pdf`,
        })
      ).status === 403,
    );
    assert(
      (await request(undefined, "fixture", "https://evil.test")).status === 403,
    );
    assert(!downloads.length && !registrations.length);
  },
);
Deno.test(
  "hashes actual PDF bytes, ignores a forged hash and indexes older private attachments",
  async () => {
    reset();
    legacy = [{ receipt: `${house}/legacy/old.pdf` }];
    const response = await request({
      household_id: house,
      receipt_path: `${house}/${user}/bill.pdf`,
      file_name: "renamed.pdf",
      sha256: "forged",
    });
    assert(response.status === 200);
    const result = await response.json();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const expected = Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("");
    assert(result.sha256 === expected);
    assert(registrations.length === 2);
    assert(
      registrations.every((r) => r.house === house && r.file_hash === expected),
    );
  },
);
Deno.test(
  "rejects spoofed and oversized documents before registering a fingerprint",
  async () => {
    reset();
    mime = "image/png";
    assert((await request()).status === 400);
    assert(!registrations.length);
    reset();
    bytes = new Uint8Array(5242881);
    assert((await request()).status === 400);
    assert(!registrations.length);
  },
);
Deno.test(
  "does not bypass duplicate protection when legacy indexing requires another batch",
  async () => {
    reset();
    legacy = Array.from({ length: 51 }, (_, i) => ({
      receipt: `${house}/legacy/${i}.pdf`,
    }));
    assert((await request()).status === 409);
    assert(registrations.length === 50);
    legacy = [];
    assert((await request()).status === 200);
  },
);
