import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { shoppingCatalog } from "./shopping";
let db: PGlite, house: string, ma: string, mb: string, foreign: string;
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  c = "10000000-0000-4000-8000-000000000003",
  sid = "40000000-0000-4000-8000-000000000001",
  eid = "50000000-0000-4000-8000-000000000001";
const as = async (id: string) =>
  db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
const plan = (changes: Record<string, unknown> = {}) => ({
  id: sid,
  household_id: house,
  catalog_id: "food-milk",
  name: "Milk",
  category: "Food",
  assigned_to: ma,
  one_time: false,
  ...changes,
});
const purchase = (changes: Record<string, unknown> = {}) => ({
  id: eid,
  household_id: house,
  name: "Milk",
  cents: 1001,
  date: "2026-11-19",
  paid_by: ma,
  category: "Groceries",
  shares: [
    { member_id: ma, cents: 501 },
    { member_id: mb, cents: 500 },
  ],
  ...changes,
});
const rpc = (name: string, args: unknown[]) =>
  db.query<any>(
    `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
    args.map((x) => (typeof x === "object" ? JSON.stringify(x) : x)),
  );
async function rejects(query: () => Promise<unknown>, message: RegExp) {
  await db.exec("savepoint reject_case");
  await expect(query()).rejects.toThrow(message);
  await db.exec("rollback to reject_case");
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;
 insert into auth.users values('${a}','{"name":"Alex"}'),('${b}','{"name":"Jordan"}'),('${c}','{"name":"Outsider"}');`);
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
  await as(a);
  house = (await rpc("create_household", ["Our Home", "USD"])).rows[0].result;
  const code = (await db.query<any>("select invite_code from households"))
    .rows[0].invite_code;
  await as(b);
  await rpc("join_household", [code]);
  await as(a);
  const members = (await db.query<any>("select id,user_id from members")).rows;
  ma = members.find((m) => m.user_id === a).id;
  mb = members.find((m) => m.user_id === b).id;
  await as(c);
  await rpc("create_household", ["Elsewhere", "USD"]);
  foreign = (await db.query<any>("select id from members")).rows[0].id;
  await db.exec("reset role");
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin");
  await as(a);
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
it("deploys the exact spreadsheet catalog used by the app", async () => {
  const r = await db.query(
    "select id,name,category,position from shopping_catalog order by position",
  );
  expect(r.rows).toEqual(shoppingCatalog);
});
it("protects household plans, catalog writes, and private base expense functions", async () => {
  await rpc("save_shopping_item", [plan()]);
  await rejects(
    () => db.query("update shopping_items set name='forged'"),
    /permission denied/,
  );
  await rejects(
    () => db.query("delete from shopping_catalog"),
    /permission denied/,
  );
  await rejects(
    () => rpc("save_expense_without_one_time", [purchase()]),
    /permission denied/,
  );
  await as(c);
  expect((await db.query("select * from shopping_items")).rows).toHaveLength(0);
  await rejects(
    () => rpc("save_shopping_item", [plan()]),
    /Join this household|another household/,
  );
  await rejects(
    () => rpc("save_shopping_purchase", [sid, purchase()]),
    /not available/,
  );
  await rejects(() => rpc("delete_shopping_item", [sid]), /not available/);
  await db.exec("reset role;set role anon");
  await rejects(
    () => db.query("select * from shopping_items"),
    /permission denied/,
  );
  await rejects(() => rpc("save_shopping_item", [plan()]), /permission denied/);
});
it("requires valid active assignees and canonicalizes catalog/custom items", async () => {
  await rejects(
    () => rpc("save_shopping_item", [plan({ assigned_to: foreign })]),
    /current roommate/,
  );
  await rejects(
    () => rpc("save_shopping_item", [plan({ catalog_id: "invented" })]),
    /catalog/,
  );
  await rpc("save_shopping_item", [
    plan({ catalog_id: null, name: "  mILK ", category: "Food" }),
  ]);
  const row = (await db.query<any>("select * from shopping_items")).rows[0];
  expect(row.item_key).toBe("catalog:food-milk");
  expect(row.name).toBe("Milk");
  await rpc("save_shopping_item", [
    plan({ catalog_id: null, name: "Hallway Lightbulbs", category: "Other" }),
  ]);
  expect(
    (await db.query<any>("select item_key from shopping_items")).rows[0]
      .item_key,
  ).toBe("custom:other:hallway lightbulbs");
  await as(b);
  await rpc("leave_household", []);
  await as(a);
  await rejects(
    () => rpc("save_shopping_item", [plan({ assigned_to: mb })]),
    /current roommate/,
  );
});
it("logs a purchase and completes the plan atomically, including rounding and one-time status", async () => {
  await rpc("save_shopping_item", [plan({ one_time: true })]);
  await rejects(
    () =>
      rpc("save_shopping_purchase", [
        sid,
        purchase({ shares: [{ member_id: ma, cents: 1000 }] }),
      ]),
    /add up/,
  );
  expect((await db.query("select * from expenses")).rows).toHaveLength(0);
  expect(
    (await db.query<any>("select expense_id from shopping_items")).rows[0]
      .expense_id,
  ).toBeNull();
  await rpc("save_shopping_purchase", [sid, purchase()]);
  expect(
    (await db.query<any>("select one_time from expenses")).rows[0].one_time,
  ).toBe(true);
  expect(
    (await db.query<any>("select expense_id,one_time from shopping_items"))
      .rows[0],
  ).toMatchObject({ expense_id: eid, one_time: true });
  await rpc("save_shopping_purchase", [sid, purchase()]);
  expect((await db.query("select * from expenses")).rows).toHaveLength(1);
  expect((await db.query("select * from expense_shares")).rows).toHaveLength(2);
  await rejects(
    () =>
      rpc("save_shopping_purchase", [
        sid,
        purchase({ id: "50000000-0000-4000-8000-000000000002" }),
      ]),
    /already has/,
  );
  await rejects(() => rpc("delete_shopping_item", [sid]), /history/);
  await rejects(() => rpc("save_shopping_item", [plan()]), /history/);
});
it("remembers the actual payer rather than the assignee and preserves payer edit permissions", async () => {
  await rpc("save_shopping_item", [plan()]);
  await rpc("save_shopping_purchase", [
    sid,
    purchase({ paid_by: mb, one_time: false }),
  ]);
  await rejects(
    () => rpc("save_expense", [purchase({ paid_by: mb, one_time: true })]),
    /Only the roommate/,
  );
  await as(b);
  await rpc("save_expense", [purchase({ paid_by: mb, one_time: true })]);
  expect(
    (await db.query<any>("select one_time from shopping_items")).rows[0]
      .one_time,
  ).toBe(true);
  await rpc("delete_expense", [eid]);
  expect(
    (await db.query<any>("select expense_id from shopping_items")).rows[0]
      .expense_id,
  ).toBeNull();
  expect((await db.query("select * from expense_shares")).rows).toHaveLength(0);
});
it("preserves shopping and purchase history when a purchaser leaves", async () => {
  await rpc("save_shopping_item", [plan()]);
  await rpc("save_shopping_purchase", [sid, purchase()]);
  await rpc("leave_household", []);
  expect((await db.query("select * from shopping_items")).rows).toHaveLength(0);
  await as(b);
  expect((await db.query("select * from shopping_items")).rows).toHaveLength(1);
  expect(
    (await db.query<any>("select paid_by from expenses")).rows[0].paid_by,
  ).toBe(ma);
});
it("validates one-time flags without changing existing expense cent checks", async () => {
  await rejects(
    () => rpc("save_expense", [purchase({ one_time: "yes" })]),
    /one-time/,
  );
  await rpc("save_expense", [purchase({ one_time: true })]);
  await rpc("save_expense", [purchase({ name: "Updated Milk" })]);
  expect(
    (await db.query<any>("select one_time from expenses")).rows[0].one_time,
  ).toBe(true);
  await rejects(
    () => rpc("save_expense", [purchase({ cents: 0 })]),
    /add up|check constraint/,
  );
});
