import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import { validateDocument } from "../_shared/document-rules.ts";
const env = (key: string) => Deno.env.get(key) || "";
/** No OCR/provider calls here: verifies immutable storage bytes and indexes old household uploads. */
export async function handler(req: Request) {
  const origin = req.headers.get("origin") || "",
    allowed = env("APP_URL").replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
  };
  if (origin && origin === allowed)
    headers["Access-Control-Allow-Origin"] = origin;
  const send = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (origin && origin !== allowed)
    return send({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return send({ error: "POST required." }, 405);
  try {
    const authorization = req.headers.get("authorization") || "";
    if (!authorization.startsWith("Bearer "))
      return send({ error: "Sign in before uploading a document." }, 401);
    const c = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const { data: auth, error: authError } = await c.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !auth.user)
      return send({ error: "Please sign in again." }, 401);
    const text = await req.text();
    if (text.length > 4096)
      return send({ error: "Invalid document request." }, 400);
    const { household_id, receipt_path, file_name } = JSON.parse(text);
    if (
      typeof household_id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(household_id) ||
      typeof receipt_path !== "string" ||
      receipt_path.length > 500 ||
      !receipt_path.startsWith(household_id + "/") ||
      receipt_path.split("/").some((p) => p === "." || p === "..")
    )
      return send({ error: "Choose a document from your household." }, 400);
    const { data: member, error } = await c
      .from("members")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("household_id", household_id)
      .is("left_at", null)
      .maybeSingle();
    if (error || !member) return send({ error: "Household unavailable." }, 403);
    const admin = createClient(
      env("SUPABASE_URL"),
      env("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } },
    );
    if (!receipt_path.startsWith(`${household_id}/${auth.user.id}/`)) {
      const { data: shared } = await c
        .from("expenses")
        .select("id")
        .eq("household_id", household_id)
        .eq("receipt", receipt_path)
        .limit(1);
      if (!shared?.length)
        return send({ error: "Use your own household upload folder." }, 403);
    }
    async function register(path: string, name: string) {
      const { data: file, error } = await c.storage
        .from("receipts")
        .download(path);
      if (error || !file)
        throw new Error(
          "Document could not be loaded. Restore inaccessible legacy files before adding new uploads.",
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      validateDocument(file.type, bytes.byteLength, bytes);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
      const result = await admin.rpc("register_verified_document", {
        house: household_id,
        document_path: path,
        file_hash: hash,
        file_mime: file.type,
        file_name: name.slice(0, 120),
      });
      if (result.error)
        throw new Error(
          "Document verification could not be recorded. Apply the document migration.",
        );
      return result.data;
    }
    // Index at most 50 legacy files per call. Larger households retry to finish indexing; never silently bypass it.
    const legacy = await admin
      .from("expenses")
      .select("receipt")
      .eq("household_id", household_id)
      .not("receipt", "is", null)
      .is("receipt_document", null)
      .order("id")
      .limit(51);
    if (legacy.error)
      throw new Error(
        "Document indexing is unavailable. Apply the document migration.",
      );
    const paths = [
      ...new Set(
        (legacy.data || []).slice(0, 50).map((e: any) => e.receipt as string),
      ),
    ];
    for (const path of paths)
      await register(path, "Previously uploaded document");
    if ((legacy.data || []).length > 50)
      return send(
        {
          error:
            "Indexed 50 older documents. Retry this upload to finish household duplicate protection.",
        },
        409,
      );
    return send(
      await register(
        receipt_path,
        typeof file_name === "string" ? file_name : "Household document",
      ),
    );
  } catch (e) {
    return send(
      {
        error:
          e instanceof Error
            ? e.message
            : "Document verification failed. Try again before saving.",
      },
      400,
    );
  }
}
if (import.meta.main) Deno.serve(handler);
