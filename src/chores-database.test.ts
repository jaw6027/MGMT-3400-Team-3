import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { choreCatalog } from "./choreCatalog";
let db: PGlite, house: string, ma: string, mb: string, foreign: string;
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  c = "10000000-0000-4000-8000-000000000003",
  sid = "40000000-0000-4000-8000-000000000001",
  eid = "50000000-0000-4000-8000-000000000001",
  eid2 = "50000000-0000-4000-8000-000000000002";
const as = async (id: string) =>
  db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
const rpc = (name: string, args: unknown[]) =>
  db.query<any>(
    `select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
    args.map((x) => (typeof x === "object" ? JSON.stringify(x) : x)),
  );
async function rejects(fn: () => Promise<unknown>, message: RegExp) {
  await db.exec("savepoint reject_case");
  await expect(fn()).rejects.toThrow(message);
  await db.exec("rollback to reject_case");
}
const plan = (extra: Record<string, unknown> = {}) => ({
  id: sid,
  household_id: house,
  catalog_id: "take-out-trash",
  name: "forged",
  frequency: "Weekly",
  assignment_mode: "rotate",
  member_ids: [ma, mb],
  assigned_to: ma,
  next_due_date: "2026-01-01",
  version: 0,
  ...extra,
});
const row = async () =>
  (
    await db.query<any>(
      "select *,next_due_date::text as next_due_date from chores where id=$1",
      [sid],
    )
  ).rows[0];
const complete = (id = eid, date = "2026-01-31", version = 1, zone = "UTC") =>
  rpc("log_chore_completion", [id, sid, date, version, zone]);
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

it("deploys the spreadsheet catalog exactly", async () => {
  expect(
    (
      await db.query(
        "select id,name,source_name,position from chore_catalog order by position",
      )
    ).rows,
  ).toEqual(choreCatalog);
});
it("protects reads and every write path across households and anonymous sessions", async () => {
  await rpc("save_chore", [plan()]);
  await complete();
  for (const table of ["chores", "chore_completions", "chore_catalog"])
    await rejects(() => db.query(`delete from ${table}`), /permission denied/);
  await as(c);
  expect((await db.query("select * from chores")).rows).toHaveLength(0);
  expect((await db.query("select * from chore_completions")).rows).toHaveLength(
    0,
  );
  await rejects(() => rpc("save_chore", [plan()]), /Join/);
  await rejects(() => complete(), /not available/);
  await rejects(
    () => rpc("set_chore_archived", [sid, true, 2]),
    /not available/,
  );
  await rejects(() => rpc("undo_chore_completion", [eid]), /not available/);
  await as(a);
  await rejects(
    () => rpc("save_chore", [plan({ member_ids: [ma, foreign], version: 2 })]),
    /current household/,
  );
  await db.exec("reset role;set role anon");
  await rejects(() => complete(), /permission denied/);
  await rejects(() => db.query("select * from chores"), /permission denied/);
});
it("logs the authenticated individual, rotates atomically, and retries without duplicates", async () => {
  await rpc("save_chore", [plan()]);
  expect((await row()).name).toBe("Take Out Trash");
  await complete();
  expect(await row()).toMatchObject({
    assigned_to: mb,
    next_due_date: "2026-02-07",
    version: 2,
  });
  expect(
    (await db.query<any>("select * from chore_completions")).rows[0],
  ).toMatchObject({
    completed_by: ma,
    recorded_by: a,
    chore_name: "Take Out Trash",
  });
  await complete();
  expect((await db.query("select * from chore_completions")).rows).toHaveLength(
    1,
  );
  await rejects(() => complete(eid2, "2026-01-31", 2), /already/);
  await rejects(() => complete(eid2, "2026-02-01", 1), /changed/);
  await rejects(() => rpc("save_chore", [plan({ version: 1 })]), /changed/);
  expect((await row()).version).toBe(2);
});
it("keeps fixed owners and applies calendar month rounding", async () => {
  await rpc("save_chore", [
    plan({
      assignment_mode: "fixed",
      member_ids: [mb],
      assigned_to: mb,
      frequency: "Monthly",
    }),
  ]);
  await complete();
  expect(await row()).toMatchObject({
    assigned_to: mb,
    next_due_date: "2026-02-28",
  });
  await complete(eid2, "2025-12-01", 2);
  expect(await row()).toMatchObject({
    assigned_to: mb,
    next_due_date: "2026-02-28",
  });
  expect(
    (
      await db.query<any>(
        "select advanced_schedule from chore_completions where id=$1",
        [eid2],
      )
    ).rows[0].advanced_schedule,
  ).toBe(false);
});
it("validates date, time zone, frequency, and assignment without partial history", async () => {
  await rejects(
    () => rpc("save_chore", [plan({ frequency: "Yearly" })]),
    /Choose Daily/,
  );
  await rejects(
    () => rpc("save_chore", [plan({ member_ids: [ma] })]),
    /at least two/,
  );
  await rejects(
    () => rpc("save_chore", [plan({ catalog_id: null, name: " " })]),
    /check constraint/,
  );
  await rpc("save_chore", [plan()]);
  await rejects(() => complete(eid, "2999-01-01"), /today/);
  await rejects(() => complete(eid, "2026-01-01", 1, "invalid"), /time zone/);
  expect((await db.query("select * from chore_completions")).rows).toHaveLength(
    0,
  );
});
it("undoes only your unchanged completion and preserves archived and departed-member history", async () => {
  await rpc("save_chore", [plan()]);
  await complete();
  await as(b);
  await rejects(() => rpc("undo_chore_completion", [eid]), /own/);
  await as(a);
  await rpc("undo_chore_completion", [eid]);
  expect(await row()).toMatchObject({
    assigned_to: ma,
    next_due_date: "2026-01-01",
    version: 3,
  });
  expect(
    (await db.query<any>("select voided_at from chore_completions")).rows[0]
      .voided_at,
  ).toBeTruthy();
  await complete(eid2, "2026-01-31", 3);
  await rpc("set_chore_archived", [sid, true, 4]);
  await rejects(() => rpc("undo_chore_completion", [eid2]), /changed/);
  await rejects(
    () => complete("50000000-0000-4000-8000-000000000003", "2026-02-01", 5),
    /Restore/,
  );
  expect((await db.query("select * from chore_completions")).rows).toHaveLength(
    2,
  );
  await rpc("leave_household", []);
  expect((await db.query("select * from chores")).rows).toHaveLength(0);
  await as(b);
  expect((await db.query("select * from chore_completions")).rows).toHaveLength(
    2,
  );
  await rpc("set_chore_archived", [sid, false, 5]);
  await complete("50000000-0000-4000-8000-000000000003", "2026-02-01", 6);
  expect((await row()).assigned_to).toBe(mb);
});

it("edits upcoming custom chores without rewriting completion history", async () => {
  await rpc("save_chore", [
    plan({ catalog_id: null, name: "  Water   plants  " }),
  ]);
  await complete();
  await rpc("save_chore", [
    plan({
      catalog_id: null,
      name: "Water balcony plants",
      frequency: "Daily",
      version: 2,
    }),
  ]);
  expect(await row()).toMatchObject({
    name: "Water balcony plants",
    frequency: "Daily",
    version: 3,
  });
  expect(
    (await db.query<any>("select chore_name,frequency from chore_completions"))
      .rows[0],
  ).toMatchObject({ chore_name: "Water plants", frequency: "Weekly" });
});
it.each([
  ["Daily", "2026-02-01"],
  ["Biweekly", "2026-02-14"],
])("applies %s recurrence in the database", async (frequency, next) => {
  await rpc("save_chore", [plan({ frequency })]);
  await complete();
  expect((await row()).next_due_date).toBe(next);
});
