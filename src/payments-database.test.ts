import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";
let db: PGlite;
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002";
const house = "20000000-0000-4000-8000-000000000001",
  ma = "30000000-0000-4000-8000-000000000001",
  mb = "30000000-0000-4000-8000-000000000002",
  order = "40000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema storage;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage,public to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;`);
  await db.exec(
    readFileSync("supabase/migrations/202611140001_splitcart.sql", "utf8"),
  );
  await db.exec(
    readFileSync("supabase/migrations/202611170001_payments.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202611180002_payment_experience.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202611180003_payment_verification_updates.sql",
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202611180004_cash_confirmation_recovery.sql",
      "utf8",
    ),
  );
  await db.exec(`insert into auth.users values('${a}','{}'),('${b}','{}');
    insert into households(id,name,currency) values('${house}','Home','USD');
    insert into members(id,household_id,user_id,name) values('${ma}','${house}','${a}','Alex'),('${mb}','${house}','${b}','Jordan');
    insert into billing_accounts(user_id,customer_id) values('${a}','cus_a');
    insert into payment_orders(id,user_id,household_id,from_id,recipient_id,cents,fee,funding,payment_method,stripe_intent)
    values('${order}','${a}','${house}','${ma}','${mb}',10000,250,'credit','pm_card','pi_paid');`);
});
afterAll(async () => {
  await db?.close();
});
it("denies both authenticated and anonymous access to provider contacts and payment state", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    for (const table of [
      "billing_accounts",
      "payment_dues",
      "payment_orders",
      "payment_reminder_deliveries",
      "payment_requests",
      "payment_notifications",
      "bank_link_attempts",
      "payment_update_deliveries",
      "mfa_recovery_codes",
    ])
      await expect(db.query(`select * from ${table}`)).rejects.toThrow(
        /permission denied/,
      );
    await expect(
      db.query("update payment_orders set status='succeeded'"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select complete_payment($1,'pi_paid')", [order]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select reverse_payment($1,'refunded')", [order]),
    ).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
  }
});
it("requires autopay consent and protects fee integrity at the database boundary", async () => {
  await expect(
    db.query(
      `insert into payment_dues(user_id,household_id,recipient_id,cents,due_day,automatic,payment_method) values('${a}','${house}','${mb}',100,1,true,'pm_bank')`,
    ),
  ).rejects.toThrow(/check constraint/);
  await expect(
    db.query("update payment_orders set funding='bank' where id=$1", [order]),
  ).rejects.toThrow(/check constraint/);
  await expect(
    db.query("update payment_orders set fee=0 where id=$1", [order]),
  ).rejects.toThrow(/check constraint/);
});
it("atomically records principal once, rejects mismatched intents and reverses refunded credit", async () => {
  await db.exec("set role service_role");
  await expect(
    db.query("select complete_payment($1,'pi_wrong')", [order]),
  ).rejects.toThrow(/Unknown payment/);
  await db.query("select complete_payment($1,'pi_paid')", [order]);
  await db.query("select complete_payment($1,'pi_paid')", [order]);
  await db.exec("reset role");
  expect(
    (
      await db.query<{ cents: number }>(
        "select cents from repayments where id=$1",
        [order],
      )
    ).rows,
  ).toEqual([{ cents: 10000 }]);
  await db.exec("set role service_role");
  await db.query("select reverse_payment($1,'refunded')", [order]);
  await db.query("select complete_payment($1,'pi_paid')", [order]);
  await db.exec("reset role");
  expect(
    (await db.query("select * from repayments where id=$1", [order])).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query<{ status: string }>(
        "select status from payment_orders where id=$1",
        [order],
      )
    ).rows[0].status,
  ).toBe("refunded");
});

it("rate limits verification texts and keeps the claim service-only", async () => {
  await db.exec("set role authenticated");
  await expect(
    db.query("select claim_phone_verification($1)", [a]),
  ).rejects.toThrow(/permission denied/);
  await db.exec("reset role; set role service_role");
  await db.query("select claim_phone_verification($1)", [a]);
  await expect(
    db.query("select claim_phone_verification($1)", [a]),
  ).rejects.toThrow(/Wait a minute/);
  await db.exec("reset role");
});

it("claims one scheduled occurrence and rejects paused, stale, and foreign charges", async () => {
  const id = "60000000-0000-4000-8000-000000000001";
  await db.query(
    `insert into payment_dues(id,user_id,household_id,recipient_id,cents,due_day,automatic,payment_method,consent_at,created_at) values($1,$2,$3,$4,7500,18,true,'pm_bank',now(),'2026-01-01')`,
    [id, a, house, mb],
  );
  const data = {
    id: "70000000-0000-4000-8000-000000000001",
    user_id: a,
    household_id: house,
    from_id: ma,
    recipient_id: mb,
    cents: 7500,
    fee: 0,
    funding: "bank",
    payment_method: "pm_bank",
    method_label: "Checking 6789",
    due_id: id,
    due_date: "2026-11-18",
  };
  const call = (value: any) =>
    db.query<{ id: string }>(
      "select (reserve_due_payment($1::jsonb,true)).id",
      [JSON.stringify(value)],
    );
  await db.exec("set role authenticated");
  await expect(call(data)).rejects.toThrow(/permission denied/);
  await db.exec("reset role");
  await db.query("update payment_dues set paused=true where id=$1", [id]);
  await db.exec("set role service_role");
  await expect(call(data)).rejects.toThrow(/paused/);
  await db.exec("reset role");
  await db.query("update payment_dues set paused=false where id=$1", [id]);
  await db.exec("set role service_role");
  await expect(call({ ...data, cents: 7600 })).rejects.toThrow(
    /Schedule changed/,
  );
  await expect(call({ ...data, user_id: b })).rejects.toThrow(
    /Schedule changed/,
  );
  expect((await call(data)).rows[0].id).toBe(data.id);
  expect(
    (await call({ ...data, id: "70000000-0000-4000-8000-000000000002" }))
      .rows[0].id,
  ).toBe(data.id);
  await db.exec("reset role");
  expect(
    (await db.query("select * from payment_orders where due_id=$1", [id])).rows,
  ).toHaveLength(1);
});
it("serializes request payment and cancellation, enforces payer and amount, and keeps private alerts unique", async () => {
  const request = "80000000-0000-4000-8000-000000000001";
  await db.query(
    "insert into payment_requests(id,household_id,requester_id,payer_id,cents,note) values($1,$2,$3,$4,2500,'Groceries')",
    [request, house, mb, ma],
  );
  const data = {
    id: "90000000-0000-4000-8000-000000000001",
    user_id: a,
    household_id: house,
    from_id: ma,
    recipient_id: mb,
    cents: 2500,
    fee: 0,
    funding: "bank",
    payment_method: "pm_bank",
    method_label: "Checking",
    request_id: request,
  };
  const call = (value: any) =>
    db.query<{ id: string }>("select (reserve_request_payment($1::jsonb)).id", [
      JSON.stringify(value),
    ]);
  await db.exec("set role service_role");
  await expect(call({ ...data, cents: 3000 })).rejects.toThrow(/match/);
  await expect(call({ ...data, user_id: b })).rejects.toThrow(/match/);
  await expect(
    db.query("select cancel_payment_request($1,$2)", [request, ma]),
  ).rejects.toThrow(/unavailable/);
  expect((await call(data)).rows[0].id).toBe(data.id);
  expect(
    (await call({ ...data, id: "90000000-0000-4000-8000-000000000002" }))
      .rows[0].id,
  ).toBe(data.id);
  await expect(
    db.query("select cancel_payment_request($1,$2)", [request, mb]),
  ).rejects.toThrow(/already in progress/);
  await db.query("update payment_orders set status='failed' where id=$1", [
    data.id,
  ]);
  await db.query("select cancel_payment_request($1,$2)", [request, mb]);
  await expect(call(data)).rejects.toThrow(/unavailable/);
  await db.query(
    "insert into payment_notifications(user_id,event_key,message) values($1,'failure-1','Needs attention') on conflict do nothing",
    [a],
  );
  await db.query(
    "insert into payment_notifications(user_id,event_key,message) values($1,'failure-1','Needs attention') on conflict do nothing",
    [a],
  );
  expect(
    (
      await db.query("select * from payment_notifications where user_id=$1", [
        a,
      ])
    ).rows,
  ).toHaveLength(1);
  await db.exec("reset role");
});

it("requires the cash-confirmation flow and prevents clients from claiming processor confirmation", async () => {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
  for (const method of ["cash", "bank_card"])
    await expect(
      db.query(
        "insert into repayments(id,household_id,from_id,to_id,cents,date,recorded_by,method) values(gen_random_uuid(),$1,$2,$3,1250,'2026-11-18',$4,$5)",
        [house, ma, mb, a, method],
      ),
    ).rejects.toThrow(/row-level security/);
  await db.exec("reset role");
});

it("credits cash exactly once only after the receiving roommate confirms and keeps disputes uncredited", async () => {
  const id = "c0000000-0000-4000-8000-000000000001",
    disputed = "c0000000-0000-4000-8000-000000000002";
  const payload = {
    id,
    household_id: house,
    from_id: ma,
    to_id: mb,
    cents: 1250,
    date: "2026-11-18",
  };
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
  await db.query("select propose_cash_payment($1)", [JSON.stringify(payload)]);
  await db.query("select propose_cash_payment($1)", [JSON.stringify(payload)]);
  expect(
    (await db.query("select * from repayments where id=$1", [id])).rows,
  ).toHaveLength(0);
  await expect(
    db.query("select resolve_cash_payment($1,'confirmed')", [id]),
  ).rejects.toThrow(/receiving roommate/);
  await expect(
    db.query("select propose_cash_payment($1)", [
      JSON.stringify({ ...payload, cents: 1500 }),
    ]),
  ).rejects.toThrow(/cannot be changed/);
  await db.query("select propose_cash_payment($1)", [
    JSON.stringify({ ...payload, id: disputed }),
  ]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
  await db.query("select resolve_cash_payment($1,'confirmed')", [id]);
  await db.query("select resolve_cash_payment($1,'confirmed')", [id]);
  expect(
    (
      await db.query<{ cents: number; method: string }>(
        "select cents,method from repayments where id=$1",
        [id],
      )
    ).rows,
  ).toEqual([{ cents: 1250, method: "cash" }]);
  await db.query("select resolve_cash_payment($1,'disputed')", [disputed]);
  expect(
    (await db.query("select * from repayments where id=$1", [disputed])).rows,
  ).toHaveLength(0);
  await expect(
    db.query("select resolve_cash_payment($1,'confirmed')", [disputed]),
  ).rejects.toThrow(/already been resolved/);
  await db.exec("reset role");
});
it("consumes backup codes once with recovery hold and cancels autopay without removing the due", async () => {
  const hashes = Array.from({ length: 8 }, (_, i) =>
    i.toString(16).padStart(64, "0"),
  );
  await db.exec("set role authenticated");
  await expect(
    db.query("select replace_mfa_recovery_codes($1,$2)", [a, hashes]),
  ).rejects.toThrow(/permission denied/);
  await db.exec("reset role;set role service_role");
  await db.query("select replace_mfa_recovery_codes($1,$2)", [a, hashes]);
  await db.query(
    "select consume_mfa_recovery_code($1,$2,'session-reference-1')",
    [a, hashes[0]],
  );
  await expect(
    db.query("select consume_mfa_recovery_code($1,$2,'session-reference-1')", [
      a,
      hashes[0],
    ]),
  ).rejects.toThrow(/already used/);
  await expect(
    db.query("select replace_mfa_recovery_codes($1,$2)", [a, hashes]),
  ).rejects.toThrow(/unavailable/);
  const state = (
    await db.query<{ recovery_pending: boolean; recovery_session: string }>(
      "select recovery_pending,recovery_session from billing_accounts where user_id=$1",
      [a],
    )
  ).rows[0];
  expect(state.recovery_pending).toBe(true);
  expect(state.recovery_session).toBe("session-reference-1");
  const due = "60000000-0000-4000-8000-000000000001";
  await db.query("select cancel_due_autopay($1,$2)", [due, a]);
  const record = (
    await db.query<{
      automatic: boolean;
      consent_at: string | null;
      cents: number;
    }>("select automatic,consent_at,cents from payment_dues where id=$1", [due])
  ).rows[0];
  expect(record.automatic).toBe(false);
  expect(record.consent_at).toBeNull();
  expect(record.cents).toBe(7500);
  await expect(
    db.query("select cancel_due_autopay($1,$2)", [due, b]),
  ).rejects.toThrow(/unavailable/);
  await db.exec("reset role");
});
