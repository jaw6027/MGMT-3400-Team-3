import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
let db: PGlite;
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  c = "10000000-0000-4000-8000-000000000003";
const as = async (id: string) =>
  db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
const setup = async (mode: string, name = "", currency = "USD", code = "") =>
  (
    await db.query<{ house: string }>(
      "select complete_household_setup($1,$2,$3,$4) as house",
      [mode, name, currency, code],
    )
  ).rows[0].house;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;
 insert into auth.users values('${a}','{"name":"Alex"}'),('${b}','{"name":"Jordan"}'),('${c}','{"name":"Outsider"}');`);
  for (const f of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync("supabase/migrations/" + f, "utf8"));
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("begin");
});
afterEach(async () => {
  await db.exec("rollback;reset role");
});
it("links distinct accounts with a private code and gives both access to the named household", async () => {
  await as(a);
  const house = await setup("create", "  Maple Street • Flat #4 🏠  ", "EUR");
  const created = (await db.query<any>("select * from households")).rows[0];
  expect(created.name).toBe("Maple Street • Flat #4 🏠");
  expect(created.currency).toBe("EUR");
  expect(created.invite_code).toMatch(/^[a-f0-9]{32}$/);
  await as(b);
  expect((await db.query("select * from households")).rows).toHaveLength(0);
  expect(
    await setup(
      "join",
      "",
      "USD",
      created.invite_code
        .toUpperCase()
        .match(/.{1,4}/g)
        .join(" "),
    ),
  ).toBe(house);
  const members = (
    await db.query<any>("select user_id,name from members order by user_id")
  ).rows;
  expect(members).toEqual([
    { user_id: a, name: "Alex" },
    { user_id: b, name: "Jordan" },
  ]);
  expect(
    (await db.query<any>("select name from households")).rows[0].name,
  ).toBe(created.name);
  await as(c);
  expect((await db.query("select * from households")).rows).toHaveLength(0);
});
it("does not link an account for an invalid code and can retry with the correct one", async () => {
  await as(a);
  const house = await setup("create", "Our home");
  const code = (await db.query<any>("select invite_code from households"))
    .rows[0].invite_code;
  await as(b);
  await db.exec("savepoint bad_code");
  await expect(setup("join", "", "USD", "wrong-code")).rejects.toThrow(
    /didn’t match/,
  );
  await db.exec("rollback to bad_code");
  expect((await db.query("select * from members")).rows).toHaveLength(0);
  expect(await setup("join", "", "USD", code)).toBe(house);
});
it("retries do not create duplicate households or silently move an existing member", async () => {
  await as(a);
  const house = await setup("create", "Same name");
  expect(await setup("create", "Changed choice")).toBe(house);
  expect((await db.query("select * from households")).rows).toHaveLength(1);
  await as(c);
  await setup("create", "Same name");
  const otherCode = (await db.query<any>("select invite_code from households"))
    .rows[0].invite_code;
  await as(a);
  expect(await setup("join", "", "USD", otherCode)).toBe(house);
  expect(
    (
      await db.query<any>("select household_id from members where user_id=$1", [
        a,
      ])
    ).rows[0].household_id,
  ).toBe(house);
});
it("allows any active roommate to rename while preserving the code and permissions", async () => {
  await as(a);
  const house = await setup("create", "Before");
  const code = (await db.query<any>("select invite_code from households"))
    .rows[0].invite_code;
  await as(b);
  await setup("join", "", "USD", code);
  await db.query("select rename_household($1,$2)", [
    house,
    "  The Cozy Corner  ",
  ]);
  expect(
    (await db.query<any>("select name,invite_code from households")).rows[0],
  ).toEqual({ name: "The Cozy Corner", invite_code: code });
  await as(c);
  await db.exec("savepoint bad_rename");
  await expect(
    db.query("select rename_household($1,$2)", [house, "Intruder"]),
  ).rejects.toThrow(/Only current/);
  await db.exec("rollback to bad_rename");
  await as(b);
  await db.query("select leave_household()");
  await db.exec("savepoint former_rename");
  await expect(
    db.query("select rename_household($1,$2)", [house, "Former"]),
  ).rejects.toThrow(/Only current/);
  await db.exec("rollback to former_rename");
});
it("rejects invalid names and denies anonymous setup and rename", async () => {
  await as(a);
  for (const name of ["", "x".repeat(81)]) {
    await db.exec("savepoint invalid_name");
    await expect(setup("create", name)).rejects.toThrow(/1 and 80/);
    await db.exec("rollback to invalid_name");
  }
  expect((await db.query("select * from members")).rows).toHaveLength(0);
  await db.exec("reset role;set role anon;savepoint anonymous");
  await expect(setup("create", "Unauthorized")).rejects.toThrow(
    /permission denied/,
  );
  await db.exec("rollback to anonymous");
  await expect(
    db.query("select rename_household(gen_random_uuid(),$1)", ["No"]),
  ).rejects.toThrow(/permission denied/);
});
