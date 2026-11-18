// Supabase Auth HTTP is simulated; REST requests execute the real application
// migrations and RLS in PostgreSQL (PGlite). No production credentials required.
import { test, expect, Page, Route } from "@playwright/test";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

async function backend(page: Page) {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync("supabase/migrations/" + file, "utf8"));
  const users = new Map<string, any>();
  let confirmEmail = false;
  let queue = Promise.resolve();
  const setupCalls: any[] = [];
  const recoveryCalls: any[] = [],
    passwordUpdates: any[] = [];
  const session = (user: any) => ({
    access_token: `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })).toString("base64url")}.test-signature`,
    refresh_token: randomUUID(),
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user,
  });
  const handler = async (route: Route) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    const respond = (data: any, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(data),
      });
    try {
      if (req.method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers": "*",
            "access-control-allow-methods": "*",
          },
        });
        return;
      }
      if (path.endsWith("/recover")) {
        recoveryCalls.push({
          body: req.postDataJSON(),
          redirect: url.searchParams.get("redirect_to"),
        });
        await respond({});
        return;
      }
      if (path.endsWith("/signup")) {
        const body = req.postDataJSON();
        const user = {
          id: randomUUID(),
          email: body.email,
          user_metadata: body.data,
          identities: [{ id: randomUUID() }],
          aud: "authenticated",
          role: "authenticated",
          created_at: new Date().toISOString(),
        };
        users.set(body.email, user);
        await db.exec("reset role");
        await db.query("insert into auth.users values($1,$2)", [
          user.id,
          JSON.stringify(user.user_metadata),
        ]);
        await respond(confirmEmail ? { user, session: null } : session(user));
        return;
      }
      if (path.endsWith("/token")) {
        const user = users.get(req.postDataJSON().email);
        await respond(
          user ? session(user) : { message: "Invalid login credentials" },
          user ? 200 : 400,
        );
        return;
      }
      const bearer = req.headers().authorization?.split(" ")[1];
      let sub = "";
      try {
        sub = JSON.parse(
          Buffer.from(bearer!.split(".")[1], "base64url").toString(),
        ).sub;
      } catch {}
      const user = [...users.values()].find((u) => u.id === sub);
      if (path.endsWith("/user")) {
        if (req.method() === "PUT" && user)
          passwordUpdates.push(req.postDataJSON());
        await respond(user || { message: "Not logged in" }, user ? 200 : 401);
        return;
      }
      if (path.endsWith("/logout")) {
        await route.fulfill({ status: 204 });
        return;
      }
      if (!user) {
        await respond({ message: "Not authenticated" }, 401);
        return;
      }
      await db.exec("reset role;set role authenticated");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        sub,
      ]);
      if (path.includes("/rpc/")) {
        const name = path.split("/").pop(),
          body = req.postDataJSON();
        if (name === "complete_household_setup") {
          setupCalls.push({ user: sub, ...body });
          const r = await db.query<any>(
            "select complete_household_setup($1,$2,$3,$4) as id",
            [
              body.setup_mode,
              body.house_name,
              body.house_currency,
              body.invitation_code,
            ],
          );
          await respond(r.rows[0].id);
          return;
        }
        if (name === "rename_household") {
          await db.query("select rename_household($1,$2)", [
            body.household_id,
            body.house_name,
          ]);
          await respond(null);
          return;
        }
        await respond({ message: "Unexpected RPC " + name }, 400);
        return;
      }
      const value = (key: string) =>
        url.searchParams.get(key)?.replace(/^eq\./, "");
      if (path.endsWith("/members")) {
        if (url.searchParams.get("select") === "household_id") {
          const r = await db.query(
            "select household_id from members where user_id=$1 and left_at is null",
            [value("user_id")],
          );
          await respond(r.rows);
        } else {
          const r = await db.query(
            "select * from members where household_id=$1 order by id",
            [value("household_id")],
          );
          await respond(r.rows);
        }
        return;
      }
      if (path.endsWith("/households")) {
        const r = await db.query("select * from households where id=$1", [
          value("id"),
        ]);
        await respond(r.rows[0]);
        return;
      }
      if (
        path.endsWith("/expenses") ||
        path.endsWith("/repayments") ||
        path.endsWith("/cash_payments")
      ) {
        await respond([]);
        return;
      }
      await respond({ message: "Unexpected request " + path }, 400);
    } catch (e: any) {
      await respond({ message: e.message, code: e.code }, 400);
    } finally {
      release();
    }
  };
  await page.route("https://splitcart-test.supabase.co/**", handler);
  return {
    setupCalls,
    users,
    session,
    recoveryCalls,
    passwordUpdates,
    requireConfirmation: () => {
      confirmEmail = true;
    },
    close: async () => {
      await queue;
      await db.close();
    },
  };
}
async function liveSignup(page: Page) {
  await page.goto("/");
  await page.getByText("Recent purchases", { exact: true }).waitFor();
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await page
    .getByRole("button", { name: "Switch to live accounts", exact: true })
    .click();
  await page
    .getByText("New to SplitCart? Create an account", { exact: true })
    .click();
}
async function credentials(page: Page, name: string, email: string) {
  await page.getByLabel("Your name", { exact: true }).fill(name);
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("password123");
}
async function signOut(page: Page) {
  await page.getByRole("tab", { name: "Household", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByText("Welcome home.", { exact: true }).waitFor();
}

test("independent signups share one named household and code, with persisted membership and renaming", async ({
  page,
}) => {
  const api = await backend(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await liveSignup(page);
    await credentials(page, "Alex Home", "alex@example.com");
    await page
      .getByLabel("Household name", { exact: true })
      .fill("Maple Street Crew");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByText("Your household is ready", { exact: true }),
    ).toBeVisible();
    const displayed = await page
      .getByLabel("Household invitation code", { exact: true })
      .innerText();
    const code = displayed.replace(/\s/g, "");
    expect(code).toMatch(/^[a-f0-9]{32}$/);
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page
      .getByRole("button", { name: "Copy invitation code", exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      code,
    );
    await page
      .getByRole("button", { name: "Go to dashboard", exact: true })
      .click();
    await expect(
      page.getByText("Hey Alex, welcome home.", { exact: true }),
    ).toBeVisible();
    await signOut(page);
    await page
      .getByText("New to SplitCart? Create an account", { exact: true })
      .click();
    await credentials(page, "Jordan Roommate", "jordan@example.com");
    await page
      .getByRole("button", { name: "Join with a code", exact: true })
      .click();
    await page.getByLabel("Invitation code", { exact: true }).fill(
      code
        .toUpperCase()
        .match(/.{1,4}/g)!
        .join(" "),
    );
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByText("Hey Jordan, welcome home.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Household", exact: true }).click();
    await expect(page.getByText("Alex Home", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Jordan Roommate (you)", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Household invitation code")).toHaveText(
      displayed,
    );
    await page
      .getByLabel("Household name", { exact: true })
      .fill("The Cozy Corner");
    await page
      .getByRole("button", { name: "Save household name", exact: true })
      .click();
    await expect(
      page.getByText("Your household name has been updated.", { exact: true }),
    ).toBeVisible();
    await signOut(page);
    await page
      .getByLabel("Email address", { exact: true })
      .fill("alex@example.com");
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(
      page.getByText("The Cozy Corner", { exact: true }).first(),
    ).toBeVisible();
    expect(api.users.size).toBe(2);
    expect(new Set(api.setupCalls.map((x) => x.user)).size).toBe(2);
    expect(errors).toEqual([]);
  } finally {
    await api.close();
  }
});
test("email confirmation preserves the household choice until the account logs in", async ({
  page,
}) => {
  const api = await backend(page);
  api.requireConfirmation();
  try {
    await liveSignup(page);
    await credentials(page, "Pat Confirm", "pat@example.com");
    await page.getByLabel("Household name", { exact: true }).fill("Pine House");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByText("Check your email to confirm your account,", {
        exact: false,
      }),
    ).toBeVisible();
    expect(api.setupCalls).toHaveLength(0);
    const saved = await page.evaluate(() =>
      localStorage.getItem("splitcart-household-signup-v1:pat@example.com"),
    );
    expect(JSON.parse(saved!)).toEqual({
      mode: "create",
      name: "Pine House",
      currency: "USD",
    });
    await page
      .getByText("Already at home here? Log in", { exact: true })
      .click();
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(
      page.getByText("Your household is ready", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("splitcart-household-signup-v1:pat@example.com"),
      ),
    ).toBeNull();
    expect(api.setupCalls).toHaveLength(1);
  } finally {
    await api.close();
  }
});
test("an incorrect signup code keeps the separate account and offers recovery without another signup", async ({
  page,
}) => {
  const api = await backend(page);
  try {
    await liveSignup(page);
    await credentials(page, "Wrong Code", "wrong@example.com");
    await page
      .getByRole("button", { name: "Join with a code", exact: true })
      .click();
    await page
      .getByLabel("Invitation code", { exact: true })
      .fill("not-a-real-code");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await expect(
      page.getByText("Your account is ready.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Invitation code", { exact: true }),
    ).toHaveValue("not-a-real-code");
    expect(api.users.size).toBe(1);
    await page
      .getByRole("button", { name: "Create a household", exact: true })
      .click();
    await page
      .getByLabel("Household name", { exact: true })
      .fill("A Fresh Start");
    await page
      .getByRole("button", { name: "Create household", exact: true })
      .click();
    await expect(
      page.getByText("Your household is ready", { exact: true }),
    ).toBeVisible();
    expect(api.users.size).toBe(1);
  } finally {
    await api.close();
  }
});

test("password reset requests use a neutral response and recovery links open the new-password form", async ({
  page,
}) => {
  const api = await backend(page);
  try {
    await liveSignup(page);
    await credentials(page, "Recovery User", "recovery@example.com");
    await page
      .getByLabel("Household name", { exact: true })
      .fill("Recovery Home");
    await page
      .getByRole("button", { name: "Create account", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Go to dashboard", exact: true })
      .click();
    await signOut(page);
    await page
      .getByRole("button", { name: "Forgot password?", exact: true })
      .click();
    await page
      .getByLabel("Email address", { exact: true })
      .fill("recovery@example.com");
    await page
      .getByRole("button", { name: "Send password reset link", exact: true })
      .click();
    await expect(
      page.getByText(/If an account exists for this email/),
    ).toBeVisible();
    expect(api.recoveryCalls).toHaveLength(1);
    expect(api.recoveryCalls[0].body.email).toBe("recovery@example.com");
    expect(api.recoveryCalls[0].redirect).toBe("http://localhost:8082/");
    const session = api.session(api.users.get("recovery@example.com"));
    const fragment = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: "3600",
      token_type: "bearer",
      type: "recovery",
    });
    await page.goto("/#" + fragment.toString());
    await expect(
      page.getByText("Choose a new password", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("New password", { exact: true })
      .fill("new-password123");
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("different-password");
    await page
      .getByRole("button", { name: "Save new password", exact: true })
      .click();
    await expect(
      page.getByText("The passwords do not match.", { exact: true }),
    ).toBeVisible();
    expect(api.passwordUpdates).toHaveLength(0);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("new-password123");
    await page
      .getByRole("button", { name: "Save new password", exact: true })
      .click();
    await expect(
      page.getByText("Hey Recovery, welcome home.", { exact: true }),
    ).toBeVisible();
    expect(api.passwordUpdates[0].password).toBe("new-password123");
    await signOut(page);
    await page.goto("/?source=recovery#" + fragment.toString());
    await expect(
      page.getByText("Choose a new password", { exact: true }),
    ).toBeVisible();
  } finally {
    await api.close();
  }
});
