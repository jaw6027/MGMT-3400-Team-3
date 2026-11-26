import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { equalSplit } from "./core";
import { percentageSplit } from "./percentageSplit";
let db: PGlite;
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002";
const house = "20000000-0000-4000-8000-000000000001",
  ma = "30000000-0000-4000-8000-000000000001",
  mb = "30000000-0000-4000-8000-000000000002";
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
    insert into members(id,household_id,user_id,name) values('${ma}','${house}','${a}','Alex'),('${mb}','${house}','${b}','Jordan');`);
});
afterAll(async () => {
  await db?.close();
});

it("saves percentage expenses atomically and clears percentages when switching to equal", async () => {
  await db.exec(`set request.jwt.claim.sub='${a}';set role authenticated;`);
  const percentages = [
    { member_id: mb, percentage: "50.00" },
    { member_id: ma, percentage: "50" },
  ];
  const expense = {
    id: crypto.randomUUID(),
    household_id: house,
    name: "Percentage groceries",
    cents: 101,
    date: "2026-11-19",
    paid_by: ma,
    category: "Groceries",
    store: "",
    notes: "",
    receipt: null,
    receipt_details: null,
    split_percentages: percentages,
    shares: percentageSplit(101, percentages),
  };
  const save = (payload: object) =>
    db.query("select save_expense($1::jsonb)", [JSON.stringify(payload)]);
  const stored = () =>
    db.query("select name,split_percentages from expenses where id=$1", [
      expense.id,
    ]);
  const shares = () =>
    db.query(
      "select member_id,cents from expense_shares where expense_id=$1 order by member_id",
      [expense.id],
    );

  await save(expense);
  expect((await stored()).rows).toEqual([
    { name: expense.name, split_percentages: percentages },
  ]);
  expect((await shares()).rows).toEqual([
    { member_id: ma, cents: 50 },
    { member_id: mb, cents: 51 },
  ]);
  await expect(
    save({
      ...expense,
      name: "Invalid update",
      split_percentages: [{ member_id: mb, percentage: "99.99" }],
    }),
  ).rejects.toThrow("must total exactly 100%");
  await expect(
    save({
      ...expense,
      shares: equalSplit(expense.cents, [ma, mb]),
    }),
  ).rejects.toThrow("Shares must match the roommate percentages.");
  const { split_percentages, ...oldClient } = expense;
  await expect(save(oldClient)).rejects.toThrow("current app");
  expect((await stored()).rows[0]).toMatchObject({ name: expense.name });

  const equalShares = equalSplit(expense.cents, [ma, mb]);
  await save({ ...expense, split_percentages: null, shares: equalShares });
  expect((await stored()).rows[0]).toMatchObject({ split_percentages: null });
  expect((await shares()).rows).toEqual(equalShares);
  await db.exec("reset role");
});
