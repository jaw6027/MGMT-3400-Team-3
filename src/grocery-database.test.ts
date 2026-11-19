import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { emptyGrocery, groceryToday } from "./grocery";
let db: PGlite,
  house: string,
  ma: string,
  mb: string,
  mc: string,
  foreign: string;
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  c = "10000000-0000-4000-8000-000000000003",
  outsider = "10000000-0000-4000-8000-000000000004";
const uuid = (n: number) =>
  `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let counter = 1;
const as = (id: string) =>
  db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
const rpc = (name: string, args: unknown[]) =>
  db.query<any>(
    `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
    args.map((x) => (typeof x === "object" ? JSON.stringify(x) : x)),
  );
const state = async () =>
  (await rpc("grocery_snapshot", [house])).rows[0].result;
const config = () => ({
  kind: "configure",
  participants: [ma, mb, mc],
  days: 7,
  due: groceryToday(),
  mode: "grocery",
  restockParticipants: [ma, mb, mc],
  restockDays: 7,
  restockStart: groceryToday(),
});
const act = async (command: Record<string, unknown>, version?: number) =>
  rpc("grocery_apply", [
    house,
    { id: uuid(counter++), ...command },
    version ?? (await state()).version,
  ]);
async function rejects(fn: () => Promise<unknown>, message: RegExp) {
  await db.exec("savepoint bad");
  await expect(fn()).rejects.toThrow(message);
  await db.exec("rollback to bad");
}
const expense = (id = uuid(900)) => ({
  id,
  household_id: house,
  name: "Shared grocery supplies",
  cents: 9000,
  date: groceryToday(),
  paid_by: ma,
  category: "Groceries",
  store: "Sample shop",
  notes: "",
  receipt: null,
  shares: [
    { member_id: ma, cents: 3000 },
    { member_id: mb, cents: 3000 },
    { member_id: mc, cents: 3000 },
  ],
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;
 insert into auth.users values('${a}','{"name":"Alex"}'),('${b}','{"name":"Jordan"}'),('${c}','{"name":"Sam"}'),('${outsider}','{"name":"Outsider"}');`);
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
  await as(c);
  await rpc("join_household", [code]);
  await as(a);
  const ms = (await db.query<any>("select id,user_id from members")).rows;
  ma = ms.find((m) => m.user_id === a).id;
  mb = ms.find((m) => m.user_id === b).id;
  mc = ms.find((m) => m.user_id === c).id;
  await as(outsider);
  await rpc("create_household", ["Other home", "USD"]);
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
it("starts with the same eight essentials as the local demo", async () => {
  expect(await state()).toEqual(emptyGrocery());
});
it("creates a household schedule, rejects stale writes and advances one completed turn exactly once", async () => {
  await act(config());
  expect((await state()).rotation.queue).toEqual([ma, mb, mc]);
  const id = uuid(counter++),
    command = { id, kind: "complete" };
  await rpc("grocery_apply", [house, command, 1]);
  expect(await state()).toMatchObject({
    version: 2,
    rotation: { queue: [mb, mc, ma] },
    history: [{ kind: "complete", actor: ma }, { kind: "configure" }],
  });
  await rpc("grocery_apply", [house, command, 1]);
  expect(
    (await state()).history.filter((e: any) => e.kind === "complete"),
  ).toHaveLength(1);
  await rejects(() => act({ kind: "complete" }, 1), /changed/);
  await rejects(() => act({ kind: "complete" }), /Only the roommate/);
  await as(b);
  await rejects(() => act({ kind: "complete" }), /not started/);
});
it("requires the invited account to agree and exchanges positions without losing a turn", async () => {
  await act(config());
  const id = uuid(counter++);
  await act({ id, kind: "requestSwap", target: mb });
  expect((await state()).rotation.queue).toEqual([ma, mb, mc]);
  await rejects(
    () => act({ kind: "resolveSwap", swapId: id, decision: "accept" }),
    /Only the invited/,
  );
  await as(c);
  await rejects(
    () => act({ kind: "resolveSwap", swapId: id, decision: "accept" }),
    /Only the invited/,
  );
  await as(b);
  await act({ kind: "resolveSwap", swapId: id, decision: "accept" });
  const s = await state();
  expect(s.rotation.queue).toEqual([mb, ma, mc]);
  expect(s.swaps[0].status).toBe("accepted");
  await rejects(
    () => act({ kind: "resolveSwap", swapId: id, decision: "accept" }),
    /no longer/,
  );
});
it("supports declined and canceled requests and expires a pending swap on skip", async () => {
  await act(config());
  const id = uuid(counter++);
  await act({ id, kind: "requestSwap", target: mb });
  await as(b);
  await act({ kind: "resolveSwap", swapId: id, decision: "decline" });
  expect((await state()).rotation.queue[0]).toBe(ma);
  await as(a);
  const id2 = uuid(counter++);
  await act({ id: id2, kind: "requestSwap", target: mb });
  await act({ kind: "resolveSwap", swapId: id2, decision: "cancel" });
  const id3 = uuid(counter++);
  await act({ id: id3, kind: "requestSwap", target: mc });
  await act({ kind: "skip" });
  const s = await state();
  expect(s.rotation.queue).toEqual([mb, mc, ma]);
  expect(s.rotation.due).toBe(groceryToday());
  expect(s.swaps.find((x: any) => x.id === id3).status).toBe("expired");
  expect(s.history.filter((x: any) => x.kind === "complete")).toHaveLength(0);
});
it("deduplicates low reports, reuses catalog plans and atomically connects restock purchases to shared expenses", async () => {
  await act(config());
  const essential = emptyGrocery().essentials[0],
    shopping = uuid(700);
  await rpc("save_shopping_item", [
    {
      id: shopping,
      household_id: house,
      name: "Toilet Paper",
      category: "Bathroom",
      catalog_id: "bathroom-toilet-paper",
      assigned_to: mb,
      one_time: false,
    },
  ]);
  await act({ kind: "low", essentialId: essential.id, shoppingId: uuid(701) });
  await act(
    { kind: "low", essentialId: essential.id, shoppingId: uuid(702) },
    1,
  );
  expect((await db.query("select * from shopping_items")).rows).toHaveLength(1);
  expect((await state()).essentials[0]).toMatchObject({
    low: true,
    shoppingId: shopping,
  });
  await as(b);
  await rejects(
    () => rpc("save_shopping_purchase", [shopping, expense()]),
    /assigned restocker/,
  );
  await as(a);
  await rpc("save_shopping_purchase", [shopping, expense()]);
  const s = await state();
  expect(s.essentials[0]).toMatchObject({
    low: false,
    lastPurchased: groceryToday(),
    quantity: "",
  });
  expect(s.history[0]).toMatchObject({ kind: "restock", expenseId: uuid(900) });
  expect((await db.query("select * from expense_shares")).rows).toHaveLength(3);
  await rpc("save_shopping_purchase", [shopping, expense()]);
  expect(
    (await state()).history.filter((x: any) => x.kind === "restock"),
  ).toHaveLength(1);
  await rpc("delete_expense", [uuid(900)]);
  expect((await state()).essentials[0]).toMatchObject({
    low: true,
    lastPurchased: null,
  });
});
it("prevents shopping edits or removal from bypassing an active restock assignment", async () => {
  await act(config());
  const essential = emptyGrocery().essentials[0];
  await act({ kind: "low", essentialId: essential.id, shoppingId: uuid(710) });
  await rejects(
    () =>
      rpc("save_shopping_item", [
        {
          id: uuid(710),
          household_id: house,
          name: "Forged",
          category: "Other",
          assigned_to: mb,
          one_time: false,
        },
      ]),
    /Edit this essential/,
  );
  await rejects(
    () => rpc("delete_shopping_item", [uuid(710)]),
    /shared restocking list/,
  );
  await act({
    kind: "essential",
    item: {
      id: essential.id,
      name: "Toilet Paper",
      category: "Bathroom",
      quantity: "2 rolls",
      notes: "Unscented, 12 rolls",
    },
  });
  expect((await state()).essentials[0].notes).toBe("Unscented, 12 rolls");
});
it("computes separate date-based restock duties and refreshes the existing shopping assignment", async () => {
  const previous = new Date(Date.now() - 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  await act({ ...config(), mode: "separate", restockStart: previous });
  await act({
    kind: "low",
    essentialId: emptyGrocery().essentials[0].id,
    shoppingId: uuid(720),
  });
  expect(
    (await db.query<any>("select assigned_to from shopping_items")).rows[0]
      .assigned_to,
  ).toBe(mb);
  await rejects(
    () => rpc("save_shopping_purchase", [uuid(720), expense()]),
    /assigned restocker/,
  );
  await as(b);
  await rpc("save_shopping_purchase", [uuid(720), expense()]);
  expect((await state()).rotation.queue[0]).toBe(ma);
});
it("links real shared grocery amounts to completed trips without assigning financial liability to the shopper", async () => {
  await act(config());
  const trip = uuid(counter++);
  await act({ kind: "complete", id: trip });
  const e = { ...expense(), grocery_trip_id: trip, paid_by: mb };
  await rpc("save_expense", [e]);
  expect(
    (await db.query<any>("select grocery_trip_id,paid_by,cents from expenses"))
      .rows[0],
  ).toEqual({ grocery_trip_id: trip, paid_by: mb, cents: 9000 });
  await as(b);
  await rpc("save_expense", [{ ...e, name: "Corrected groceries" }]);
  await rejects(
    () =>
      rpc("save_expense", [{ ...expense(uuid(901)), grocery_trip_id: trip }]),
    /trip you completed/,
  );
});
it("isolates every household, denies anonymous/direct writes, validates participants and protects private helper functions", async () => {
  await act(config());
  await rejects(
    () => db.query("update grocery_states set state='{}'"),
    /permission denied/,
  );
  await rejects(
    () => act({ ...config(), participants: [ma, foreign] }),
    /current household/,
  );
  await rejects(() => act({ ...config(), days: 0 }), /interval/);
  await rejects(() => act({ ...config(), participants: [ma, ma] }), /distinct/);
  await rejects(
    async () =>
      rpc("grocery_owner", [
        await state(),
        emptyGrocery().essentials[0].id,
        house,
        groceryToday(),
      ]),
    /permission denied/,
  );
  await as(outsider);
  expect((await db.query("select * from grocery_states")).rows).toHaveLength(0);
  await rejects(() => rpc("grocery_snapshot", [house]), /Join/);
  await rejects(() => act(config(), 0), /Join/);
  await db.exec("reset role;set role anon");
  await rejects(() => rpc("grocery_snapshot", [house]), /permission denied/);
});
it("filters departed members and preserves history and the surviving queue order on edits", async () => {
  await act(config());
  await act({ kind: "complete" });
  await as(b);
  await rpc("leave_household", []);
  await as(a);
  await act({
    ...config(),
    participants: [ma, mc],
    restockParticipants: [ma, mc],
  });
  expect((await state()).rotation.queue).toEqual([mc, ma]);
  expect(
    (await state()).history.some(
      (x: any) => x.kind === "complete" && x.actor === ma,
    ),
  ).toBe(true);
});
