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

it("starts with no developer grants and denies ordinary and developer clients direct business access", async () => {
  expect((await db.query("select * from app_developers")).rows).toHaveLength(0);
  await db.query("insert into app_developers(user_id) values($1)", [a]);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set request.jwt.claim.sub='${a}';set role ${role};`);
    for (const table of [
      "app_developers",
      "developer_business_settings",
      "developer_business_audit",
    ])
      await expect(db.query(`select * from ${table}`)).rejects.toThrow(
        "permission denied",
      );
    await expect(
      db.query("insert into app_developers(user_id) values($1)", [b]),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query(
        "select save_developer_business($1,0,'SplitCart','llc','s_corporation')",
        [a],
      ),
    ).rejects.toThrow("permission denied");
    await db.exec("reset role");
  }
});
it("permits only a trusted service call for an active developer and rejects stale edits", async () => {
  await db.exec("set role service_role");
  await db.query(
    "select save_developer_business($1,0,'SplitCart LLC','llc','s_corporation')",
    [a],
  );
  const rows = await db.query<{
    legal_structure: string;
    tax_classification: string;
    version: number;
  }>(
    "select legal_structure,tax_classification,version from developer_business_settings",
  );
  expect(rows.rows[0]).toEqual({
    legal_structure: "llc",
    tax_classification: "s_corporation",
    version: 1,
  });
  await expect(
    db.query(
      "select save_developer_business($1,0,'Overwrite','corporation','c_corporation')",
      [a],
    ),
  ).rejects.toThrow("changed");
  await expect(
    db.query(
      "select save_developer_business($1,1,'Other user','llc','s_corporation')",
      [b],
    ),
  ).rejects.toThrow("Developer access");
  expect(
    (await db.query("select * from developer_business_audit")).rows,
  ).toHaveLength(1);
  await db.query("update app_developers set active=false where user_id=$1", [
    a,
  ]);
  await expect(
    db.query(
      "select save_developer_business($1,1,'Revoked','llc','s_corporation')",
      [a],
    ),
  ).rejects.toThrow("Developer access");
  await db.exec("reset role");
});
it("keeps entity classifications coherent and never stores raw bank/routing details", async () => {
  await db.query("update app_developers set active=true where user_id=$1", [a]);
  await expect(
    db.query(
      "select save_developer_business($1,1,'Invalid','sole_proprietorship','s_corporation')",
      [a],
    ),
  ).rejects.toThrow();
  const columns = await db.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_name='developer_business_settings'",
  );
  expect(
    columns.rows.some((c) =>
      /account_number|routing_number/.test(c.column_name),
    ),
  ).toBe(false);
  const saved = await db.query<{ legal_name: string; version: number }>(
    "select legal_name,version from developer_business_settings",
  );
  expect(saved.rows[0]).toEqual({ legal_name: "SplitCart LLC", version: 1 });
});
