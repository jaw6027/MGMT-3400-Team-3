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

import { calculateReceipt, emptyReceiptDetails } from "./receiptItems";
const details = {
  ...emptyReceiptDetails(),
  items: [
    { name: "Shared groceries", cents: 3000, members: [ma, mb] },
    { name: "Personal item", cents: 1000, members: [mb] },
  ],
  taxCents: 400,
  tipCents: 200,
  discountCents: 600,
  cashbackExpectedCents: 200,
  cashbackReceivedCents: 100,
};
const makeExpense = () => ({
  id: crypto.randomUUID(),
  household_id: house,
  name: "Itemized market receipt",
  cents: 4000,
  date: "2026-11-19",
  paid_by: ma,
  category: "Groceries",
  store: "Market",
  notes: "",
  receipt: null,
  shares: calculateReceipt(details, [ma, mb]).shares,
  receipt_details: details,
  one_time: true,
});
const save = (payload: object) =>
  db.query("select save_expense($1::jsonb)", [JSON.stringify(payload)]);
it("persists itemized shares and external cashback without creating repayments or reward balances", async () => {
  await db.exec(`set request.jwt.claim.sub='${a}';set role authenticated;`);
  const expense = makeExpense();
  await save(expense);
  const result = await db.query<{
    receipt_details: any;
    cents: number;
    one_time: boolean;
  }>("select receipt_details,cents,one_time from expenses where id=$1", [
    expense.id,
  ]);
  expect(result.rows[0]).toMatchObject({
    receipt_details: details,
    cents: 4000,
    one_time: true,
  });
  expect((await db.query("select * from repayments")).rows).toHaveLength(0);
  await expect(
    save({ ...expense, shares: [{ member_id: ma, cents: 4000 }] }),
  ).rejects.toThrow("Receipt shares");
  await expect(save({ ...expense, cents: 3999 })).rejects.toThrow(
    "Receipt total",
  );
  const { receipt_details, ...oldClient } = expense;
  await expect(save(oldClient)).rejects.toThrow("current app");
  await expect(
    db.query("select save_expense_without_receipt_items($1::jsonb)", [
      JSON.stringify(expense),
    ]),
  ).rejects.toThrow("permission denied");
  await db.exec("reset role");
});
it("matches the client cent-rounding calculation and checks printed totals and cashback claims", async () => {
  await db.exec(`set request.jwt.claim.sub='${a}';set role authenticated;`);
  for (const value of [1, 2, 7, 99, 101, 10001]) {
    const d = {
      ...emptyReceiptDetails(),
      items: [{ name: "Shared odd cents", cents: value, members: [ma, mb] }],
      taxCents: 7,
      tipCents: 2,
      discountCents: 1,
    };
    const calculated = calculateReceipt(d, [ma, mb]);
    await save({
      ...makeExpense(),
      receipt_details: d,
      cents: calculated.total,
      shares: calculated.shares,
    });
  }
  await expect(
    save({
      ...makeExpense(),
      receipt_details: { ...details, sourceTotalCents: 3999 },
    }),
  ).rejects.toThrow("printed receipt total");
  await expect(
    save({
      ...makeExpense(),
      receipt_details: { ...details, cashbackReceivedCents: 4001 },
    }),
  ).rejects.toThrow("Cashback");
  await db.exec("reset role");
});
it("requires household membership and atomically limits scans to twenty per user per day", async () => {
  await db.exec(`set request.jwt.claim.sub='${a}';set role authenticated;`);
  for (let i = 0; i < 20; i++)
    await db.query("select claim_receipt_scan($1)", [house]);
  await expect(
    db.query("select claim_receipt_scan($1)", [house]),
  ).rejects.toThrow("Daily receipt scan limit");
  await expect(db.query("select * from receipt_scan_usage")).rejects.toThrow(
    "permission denied",
  );
  await expect(
    db.query("select claim_receipt_scan($1)", [crypto.randomUUID()]),
  ).rejects.toThrow("Household unavailable");
  await db.exec("reset role");
});
