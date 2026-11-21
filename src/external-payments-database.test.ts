import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec(`insert into auth.users values('${a}','{}'),('${b}','{}');
    insert into households(id,name,currency) values('${house}','Home','USD');
    insert into members(id,household_id,user_id,name) values('${ma}','${house}','${a}','Alex'),('${mb}','${house}','${b}','Jordan');
    insert into billing_accounts(user_id,customer_id) values('${a}','cus_a');`);
});
afterAll(async () => {
  await db?.close();
});

const proposal = (id: string, method: string, cents = 5000) => ({
  id,
  household_id: house,
  from_id: ma,
  to_id: mb,
  cents,
  date: "2026-11-20",
  method,
});
const propose = (p: object) =>
  db.query("select propose_cash_payment($1::jsonb)", [JSON.stringify(p)]);
it("Venmo/Zelle need receiver confirmation and remain idempotent without automatic ledger credit", async () => {
  for (const [index, method] of ["venmo", "zelle"].entries()) {
    await db.exec(`set request.jwt.claim.sub='${a}';set role authenticated;`);
    const p = proposal(crypto.randomUUID(), method, 5000 + index);
    await propose(p);
    await propose(p);
    expect(
      (await db.query("select * from repayments where id=$1", [p.id])).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query<{ channel: string }>(
          "select channel from cash_payments where id=$1",
          [p.id],
        )
      ).rows[0].channel,
    ).toBe(method);
    await expect(
      db.query("select resolve_cash_payment($1,'confirmed')", [p.id]),
    ).rejects.toThrow("Only the receiving");
    await db.exec(
      `reset role;set request.jwt.claim.sub='${b}';set role authenticated;`,
    );
    await db.query("select resolve_cash_payment($1,'confirmed')", [p.id]);
    await db.query("select resolve_cash_payment($1,'confirmed')", [p.id]);
    const rows = await db.query<{ method: string }>(
      "select method from repayments where id=$1",
      [p.id],
    );
    expect(rows.rows).toEqual([{ method }]);
    await db.exec("reset role");
  }
});
it("outside reservations share duplicate protection with bank/card payments and disputes do not change balances", async () => {
  await db.exec(`set request.jwt.claim.sub='${a}';set role authenticated;`);
  const p = proposal(crypto.randomUUID(), "venmo", 7500);
  await propose(p);
  await expect(
    propose(proposal(crypto.randomUUID(), "zelle", 7500)),
  ).rejects.toThrow("Possible duplicate");
  await expect(propose({ ...p, method: "cash" })).rejects.toThrow(
    "cannot be changed",
  );
  await expect(
    db.query(
      "insert into repayments(id,household_id,from_id,to_id,cents,date,recorded_by,method) values($1,$2,$3,$4,7500,current_date,$5,'venmo')",
      [crypto.randomUUID(), house, ma, mb, a],
    ),
  ).rejects.toThrow();
  await db.exec(
    `reset role;set request.jwt.claim.sub='${b}';set role authenticated;`,
  );
  await db.query("select resolve_cash_payment($1,'disputed')", [p.id]);
  expect(
    (await db.query("select * from repayments where id=$1", [p.id])).rows,
  ).toHaveLength(0);
  await db.exec("reset role;set role service_role");
  const electronic = crypto.randomUUID();
  await db.query(
    "insert into payment_orders(id,user_id,household_id,from_id,recipient_id,cents,fee,funding,payment_method) values($1,$2,$3,$4,$5,9000,0,'bank','pm_bank')",
    [electronic, a, house, ma, mb],
  );
  await db.exec(
    `reset role;set request.jwt.claim.sub='${a}';set role authenticated;`,
  );
  await expect(
    propose(proposal(crypto.randomUUID(), "zelle", 9000)),
  ).rejects.toThrow("Possible duplicate");
  await db.exec("reset role");
});
