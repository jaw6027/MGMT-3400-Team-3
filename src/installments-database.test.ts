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
  await db.exec(
    readFileSync("supabase/migrations/202611190001_payment_safety.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/202611190004_partial_recurring_categories.sql",
      "utf8",
    ),
  );
  await db.exec(`insert into auth.users values('${a}','{}'),('${b}','{}');
    insert into households(id,name,currency) values('${house}','Home','USD');
    insert into members(id,household_id,user_id,name) values('${ma}','${house}','${a}','Alex'),('${mb}','${house}','${b}','Jordan');
    insert into billing_accounts(user_id,customer_id) values('${a}','cus_a');`);
});
afterAll(async () => {
  await db?.close();
});

const rid = "60000000-0000-4000-8000-000000000001";
const makeData = (id: string, cents: number) => ({
  id,
  user_id: a,
  household_id: house,
  from_id: ma,
  recipient_id: mb,
  cents,
  fee: 0,
  funding: "bank",
  payment_method: "pm_bank",
  method_label: "Checking",
  request_id: rid,
});
const reserve = (data: object) =>
  db.query<{ p: any }>(
    "select to_jsonb(reserve_request_payment($1::jsonb)) as p",
    [JSON.stringify(data)],
  );
it("reserves partial principal safely, blocks simultaneous attempts and permits equal installments only after confirmation", async () => {
  await db.query(
    "insert into payment_requests(id,household_id,requester_id,payer_id,cents) values($1,$2,$3,$4,10000)",
    [rid, house, mb, ma],
  );
  const first = makeData(crypto.randomUUID(), 5000);
  expect((await reserve(first)).rows[0].p.cents).toBe(5000);
  expect((await reserve(first)).rows[0].p.id).toBe(first.id);
  await expect(reserve(makeData(crypto.randomUUID(), 1000))).rejects.toThrow(
    "already has a payment",
  );
  await db.query("update payment_orders set status='succeeded' where id=$1", [
    first.id,
  ]);
  await expect(reserve(makeData(crypto.randomUUID(), 5001))).rejects.toThrow(
    "remaining balance",
  );
  const second = makeData(crypto.randomUUID(), 5000);
  expect((await reserve(second)).rows[0].p.cents).toBe(5000);
  await db.query("update payment_orders set status='succeeded' where id=$1", [
    second.id,
  ]);
  await expect(reserve(makeData(crypto.randomUUID(), 50))).rejects.toThrow(
    "remaining balance",
  );
  const total = await db.query<{ cents: number }>(
    "select sum(cents)::integer as cents from payment_orders where request_id=$1 and status='succeeded'",
    [rid],
  );
  expect(total.rows[0].cents).toBe(10000);
});
it("keeps general duplicate checks and rejects client access to installment reservations", async () => {
  const data = makeData(crypto.randomUUID(), 5000);
  delete (data as any).request_id;
  await expect(
    db.query(
      `insert into payment_orders(id,user_id,household_id,from_id,recipient_id,cents,fee,funding,payment_method) values($1,$2,$3,$4,$5,5000,0,'bank','pm_bank')`,
      [data.id, a, house, ma, mb],
    ),
  ).rejects.toThrow("Possible duplicate");
  await db.exec("set role authenticated");
  await expect(reserve(makeData(crypto.randomUUID(), 500))).rejects.toThrow(
    "permission denied",
  );
  await db.exec("reset role");
});
it("stores named recurring bills and new spending categories without generating paid expenses", async () => {
  await db.query(
    "insert into payment_dues(id,user_id,household_id,recipient_id,cents,due_day,automatic,payment_method,label,category) values($1,$2,$3,$4,80000,1,false,'','Apartment rent','Rent')",
    [crypto.randomUUID(), a, house, mb],
  );
  const result = await db.query<{ label: string; category: string }>(
    "select label,category from payment_dues",
  );
  expect(result.rows[0]).toEqual({ label: "Apartment rent", category: "Rent" });
  expect((await db.query("select * from expenses")).rows).toHaveLength(0);
});

it("records a refund while another installment is processing and holds further payment attempts", async () => {
  const next = crypto.randomUUID();
  await db.query(
    "insert into payment_requests(id,household_id,requester_id,payer_id,cents) values($1,$2,$3,$4,10000)",
    [next, house, mb, ma],
  );
  const first = { ...makeData(crypto.randomUUID(), 4000), request_id: next };
  await reserve(first);
  await db.query("update payment_orders set status='succeeded' where id=$1", [
    first.id,
  ]);
  const second = { ...makeData(crypto.randomUUID(), 3000), request_id: next };
  await reserve(second);
  await db.query("update payment_orders set status='refunded' where id=$1", [
    first.id,
  ]);
  await expect(
    reserve({ ...makeData(crypto.randomUUID(), 1000), request_id: next }),
  ).rejects.toThrow("already has a payment");
});
