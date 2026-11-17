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
