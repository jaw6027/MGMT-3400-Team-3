import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

let db: PGlite;
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  outsider = "10000000-0000-4000-8000-000000000003";
const house = "20000000-0000-4000-8000-000000000001",
  otherHouse = "20000000-0000-4000-8000-000000000002",
  foreignMember = "30000000-0000-4000-8000-000000000003",
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
  await db.exec(`insert into auth.users values('${a}','{}'),('${b}','{}'),('${outsider}','{}');
    insert into households(id,name,currency) values('${house}','Home','USD'),('${otherHouse}','Other','USD');
    insert into members(id,household_id,user_id,name) values('${ma}','${house}','${a}','Alex'),('${mb}','${house}','${b}','Jordan'),('${foreignMember}','${otherHouse}','${outsider}','Outsider');`);
});
afterAll(async () => {
  await db?.close();
});

it("persists shared templates and enforces membership, versions, and allocation validation", async () => {
  const as = (user: string) =>
    db.exec(
      `reset role;set request.jwt.claim.sub='${user}';set role authenticated;`,
    );
  const save = (payload: object) =>
    db.query("select save_split_template($1::jsonb)", [
      JSON.stringify(payload),
    ]);
  const remove = (id: string, household: string, version: number) =>
    db.query("select delete_split_template($1::uuid,$2::uuid,$3::integer)", [
      id,
      household,
      version,
    ]);
  const read = () => db.query("select * from split_templates");
  const id = crypto.randomUUID();
  const allocations = [
    { member_id: mb, percentage: "40.25" },
    { member_id: ma, percentage: "59.75" },
  ];
  const template = {
    id,
    household_id: house,
    name: " Utilities ",
    allocations,
    version: 0,
  };
  await as(a);
  await expect(
    save({
      ...template,
      allocations: [{ member_id: ma, percentage: "99.99" }],
    }),
  ).rejects.toThrow("exactly 100%");
  await expect(
    save({
      ...template,
      allocations: [{ member_id: ma, percentage: "100.001" }],
    }),
  ).rejects.toThrow("valid percentage");
  await expect(
    save({
      ...template,
      allocations: [{ member_id: foreignMember, percentage: "100" }],
    }),
  ).rejects.toThrow("current roommates");
  await expect(
    save({ ...template, allocations: [allocations[0], allocations[0]] }),
  ).rejects.toThrow("unique roommates");
  expect((await read()).rows).toEqual([]);
  await save(template);
  expect((await read()).rows).toEqual([
    { ...template, name: "Utilities", version: 1 },
  ]);
  await expect(
    db.query("update split_templates set name='Direct write'"),
  ).rejects.toThrow("permission denied");

  await as(outsider);
  expect((await read()).rows).toEqual([]);
  await expect(save({ ...template, version: 1 })).rejects.toThrow(
    "unavailable",
  );
  await expect(
    save({
      ...template,
      household_id: otherHouse,
      allocations: [{ member_id: foreignMember, percentage: "100" }],
    }),
  ).rejects.toThrow("changed");
  await expect(remove(id, house, 1)).rejects.toThrow("unavailable");
  await expect(remove(id, otherHouse, 1)).rejects.toThrow("changed");

  await as(b);
  expect((await read()).rows).toHaveLength(1);
  await save({ ...template, name: "Common bills", version: 1 });
  await db.query("select leave_household()");
  expect((await read()).rows).toEqual([]);

  await as(a);
  await expect(save({ ...template, version: 2 })).rejects.toThrow(
    "current roommates",
  );
  expect((await read()).rows).toEqual([
    { ...template, name: "Common bills", version: 2 },
  ]);
  const repaired = [{ member_id: ma, percentage: "100" }];
  await save({
    ...template,
    name: "My bills",
    allocations: repaired,
    version: 2,
  });
  await expect(remove(id, house, 2)).rejects.toThrow("changed");
  await remove(id, house, 3);
  expect((await read()).rows).toEqual([]);
  await expect(
    save({ ...template, allocations: repaired, version: 3 }),
  ).rejects.toThrow("changed");

  await db.exec("reset role;set role anon");
  await expect(read()).rejects.toThrow("permission denied");
  await expect(save(template)).rejects.toThrow("permission denied");
  await db.exec("reset role");
});
