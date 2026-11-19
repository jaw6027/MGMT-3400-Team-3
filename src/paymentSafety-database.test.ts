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
  await db.exec(`insert into auth.users values('${a}','{}'),('${b}','{}');
    insert into households(id,name,currency) values('${house}','Home','USD');
    insert into members(id,household_id,user_id,name) values('${ma}','${house}','${a}','Alex'),('${mb}','${house}','${b}','Jordan');
    insert into billing_accounts(user_id,customer_id) values('${a}','cus_a');`);
});
afterAll(async () => {
  await db?.close();
});
const insertOrder = (id: string, cents: number) =>
  db.query(
    `insert into payment_orders(id,user_id,household_id,from_id,recipient_id,cents,fee,funding,payment_method) values($1,$2,$3,$4,$5,$6,0,'bank','pm_bank')`,
    [id, a, house, ma, mb, cents],
  );
const insertCash = (id: string, cents: number) =>
  db.query(
    `insert into cash_payments(id,household_id,from_id,to_id,cents,date,proposed_by) values($1,$2,$3,$4,$5,current_date,$6)`,
    [id, house, ma, mb, cents, a],
  );
it("blocks new references across payment methods and cash while permitting unrelated payments", async () => {
  const id = crypto.randomUUID();
  await insertOrder(id, 2345);
  await expect(insertOrder(crypto.randomUUID(), 2345)).rejects.toThrow(
    "Possible duplicate",
  );
  await expect(insertCash(crypto.randomUUID(), 2345)).rejects.toThrow(
    "Possible duplicate",
  );
  await insertCash(crypto.randomUUID(), 2346);
  await expect(insertOrder(crypto.randomUUID(), 2346)).rejects.toThrow(
    "Possible duplicate",
  );
  await db.query("update payment_orders set status='failed' where id=$1", [id]);
  await insertOrder(crypto.randomUUID(), 2345);
});
it("protects recent completed payments, preserves history, and permits later distinct payments", async () => {
  const id = crypto.randomUUID();
  await insertOrder(id, 3456);
  await db.query("update payment_orders set status='succeeded' where id=$1", [
    id,
  ]);
  await expect(insertOrder(crypto.randomUUID(), 3456)).rejects.toThrow(
    "Possible duplicate",
  );
  await db.query(
    "update payment_orders set completed_at=now()-interval '11 minutes' where id=$1",
    [id],
  );
  await insertOrder(crypto.randomUUID(), 3456);
  const saved = await db.query(
    "select id from payment_orders where cents=3456",
  );
  expect(saved.rows).toHaveLength(2);
});
it("deduplicates bank alerts atomically, announces recovery and protects health data from clients", async () => {
  const call = (state: string) =>
    db.query<{ id: string | null }>(
      "select record_bank_health($1,'pm_bank',$2,'Bank needs attention') as id",
      [a, state],
    );
  expect((await call("ready")).rows[0].id).toBeNull();
  expect((await call("blocked")).rows[0].id).toBeTruthy();
  expect((await call("blocked")).rows[0].id).toBeNull();
  expect((await call("ready")).rows[0].id).toBeTruthy();
  expect(
    (await db.query("select * from payment_notifications")).rows,
  ).toHaveLength(2);
  await db.exec("set role authenticated");
  await expect(db.query("select * from bank_health")).rejects.toThrow();
  await expect(call("blocked")).rejects.toThrow();
  await db.exec("reset role");
});
