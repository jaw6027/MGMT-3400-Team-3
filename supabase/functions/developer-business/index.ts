import { createClient } from "npm:@supabase/supabase-js@2.89.0";
import Stripe from "npm:stripe@17.7.0";
import {
  developerVerificationExpiry,
  validateBusiness,
} from "../_shared/developer-business.ts";
const env = (name: string) => Deno.env.get(name) || "";
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stripe = new Stripe(env("STRIPE_SECRET_KEY") || "unconfigured", {
  httpClient: Stripe.createFetchHttpClient(),
});
const noStore = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  Vary: "Origin",
};
export async function handler(req: Request) {
  const origin = req.headers.get("origin") || "",
    allowed = env("APP_URL").replace(/\/$/, "");
  const headers: Record<string, string> = {
    ...noStore,
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
  if (origin && origin === allowed)
    headers["Access-Control-Allow-Origin"] = origin;
  const send = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return send({ error: "POST required." }, 405);
  if (origin && origin !== allowed)
    return send({ error: "Origin not allowed." }, 403);
  try {
    const token = (req.headers.get("authorization") || "").replace(
      /^Bearer /,
      "",
    );
    if (!token) return send({ error: "Sign in again." }, 401);
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth.user) return send({ error: "Sign in again." }, 401);
    const raw = await req.text();
    if (raw.length > 4096) return send({ error: "Invalid request." }, 400);
    const input = JSON.parse(raw);
    const { data: developer, error: roleError } = await db
      .from("app_developers")
      .select("user_id")
      .eq("user_id", auth.user.id)
      .eq("active", true)
      .maybeSingle();
    if (roleError)
      return send({ error: "Developer access could not be verified." }, 503);
    if (input.action === "access") return send({ authorized: !!developer });
    if (!developer) return send({ error: "Developer access required." }, 403);
    const until = developerVerificationExpiry(token, auth.user.id);
    if (!until)
      return send(
        {
          error:
            "Verify your password and authenticator code before accessing business settings.",
          requiresVerification: true,
        },
        403,
      );
    const { data: billing, error: billingError } = await db
      .from("billing_accounts")
      .select("recovery_pending")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    const factors = await db.auth.admin.mfa.listFactors({
      userId: auth.user.id,
    });
    if (
      billingError ||
      billing?.recovery_pending ||
      factors.error ||
      !factors.data?.factors.some(
        (f) => f.factor_type === "totp" && f.status === "verified",
      )
    )
      return send(
        {
          error:
            "Finish authenticator recovery or verification before accessing business settings.",
        },
        403,
      );
    if (input.action === "save") {
      const business = validateBusiness(input.business);
      const { error } = await db.rpc("save_developer_business", {
        actor: auth.user.id,
        expected_version: business.version,
        business_name: business.legal_name,
        structure: business.legal_structure,
        tax: business.tax_classification,
      });
      if (error)
        return send(
          {
            error:
              error.code === "SC003"
                ? "Business settings changed. Refresh before saving."
                : "Business settings could not be saved. Refresh and check developer access.",
          },
          409,
        );
      return send({ ok: true });
    }
    if (input.action === "payout_setup") {
      if (!env("STRIPE_SECRET_KEY"))
        return send(
          { error: "The business payment account is not configured yet." },
          503,
        );
      const account = await stripe.accounts.retrieve();
      if (!/^acct_[a-zA-Z0-9]+$/.test(account.id))
        return send(
          { error: "The business Stripe account could not be verified." },
          503,
        );
      // Recheck authorization immediately before returning the sensitive workflow.
      const { data: current, error } = await db
        .from("app_developers")
        .select("user_id")
        .eq("user_id", auth.user.id)
        .eq("active", true)
        .maybeSingle();
      if (error || !current)
        return send({ error: "Developer access required." }, 403);
      const audit = await db
        .from("developer_business_audit")
        .insert({ actor_id: auth.user.id, event: "payout_settings_opened" });
      if (audit.error)
        return send(
          { error: "Business access could not be recorded. Please retry." },
          503,
        );
      return send({
        url: `https://dashboard.stripe.com/${account.id}/settings/payouts`,
        stripeAccountId: account.id,
      });
    }
    if (input.action === "status") {
      const { data: business, error } = await db
        .from("developer_business_settings")
        .select(
          "legal_name,legal_structure,tax_classification,version,updated_at",
        )
        .eq("id", true)
        .single();
      if (error)
        return send({ error: "Business settings are unavailable." }, 503);
      let finance: any = { configured: false };
      if (env("STRIPE_SECRET_KEY")) {
        try {
          const [account, balance] = await Promise.all([
            stripe.accounts.retrieve(),
            stripe.balance.retrieve(),
          ]);
          finance = {
            configured: true,
            livemode: balance.livemode,
            stripeAccountId: account.id,
            payoutsEnabled: account.payouts_enabled,
            chargesEnabled: account.charges_enabled,
            available: balance.available.map((b) => ({
              cents: b.amount,
              currency: b.currency,
            })),
            pending: balance.pending.map((b) => ({
              cents: b.amount,
              currency: b.currency,
            })),
            // Discard raw bank/routing values even if the provider includes them.
            banks:
              account.external_accounts?.data
                .filter((b) => b.object === "bank_account")
                .map((b) => ({
                  bankName: (b as Stripe.BankAccount).bank_name || "Bank",
                  last4: (b as Stripe.BankAccount).last4,
                  currency: b.currency,
                  status: (b as Stripe.BankAccount).status,
                })) || [],
          };
        } catch {
          finance = { configured: true, unavailable: true };
        }
      }
      const current = await db
        .from("app_developers")
        .select("user_id")
        .eq("user_id", auth.user.id)
        .eq("active", true)
        .maybeSingle();
      if (current.error || !current.data)
        return send({ error: "Developer access required." }, 403);
      return send({ business, finance, verifiedUntil: until });
    }
    return send({ error: "Unknown developer action." }, 400);
  } catch {
    return send(
      {
        error:
          "Business settings could not be loaded. Refresh and verify access again.",
      },
      400,
    );
  }
}
if (import.meta.main) Deno.serve(handler);
