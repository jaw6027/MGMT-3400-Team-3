// Execute the exact migration against PostgreSQL in WASM. Only Supabase-managed
// auth/storage tables and roles are stubbed; application SQL and RLS run unchanged.
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  c = "10000000-0000-4000-8000-000000000003";
let db: PGlite,
  house: string,
  other: string,
  ma: string,
  mb: string,
  mc: string;
const expense = "20000000-0000-4000-8000-000000000001";
const as = async (id: string) => {
  await db.exec(
    `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`,
  );
};
const rpc = async (name: string, args: any[]) =>
  db.query<any>(
    `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
    args,
  );
const payload = () => ({
  id: expense,
  household_id: house,
  name: "Shared groceries",
  cents: 1001,
  date: "2026-11-13",
  paid_by: ma,
  category: "Groceries",
  shares: [
    { member_id: ma, cents: 501 },
    { member_id: mb, cents: 500 },
  ],
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to authenticated;
 insert into auth.users values('${a}','{"name":"Alex"}'),('${b}','{"name":"Jordan"}'),('${c}','{"name":"Outsider"}');`);
  await db.exec(
    readFileSync("supabase/migrations/202611140001_splitcart.sql", "utf8"),
  );
  await as(a);
  house = (await rpc("create_household", ["Green House", "USD"])).rows[0]
    .result as string;
  const invite = (await db.query<any>("select invite_code from households"))
    .rows[0].invite_code;
  await as(b);
  await rpc("join_household", [invite]);
  await as(c);
  other = (await rpc("create_household", ["Other House", "USD"])).rows[0]
    .result as string;
  await as(a);
  const members = (await db.query<any>("select * from members")).rows;
  ma = members.find((m) => m.user_id === a).id;
  mb = members.find((m) => m.user_id === b).id;
  await as(c);
  mc = (await db.query<any>("select id from members")).rows[0].id;
  await as(a);
  await rpc("save_expense", [JSON.stringify(payload())]);
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential("database access and transactional invariants", () => {
  it("prevents an outsider from reading another household, purchase, or shares", async () => {
    await as(c);
    expect((await db.query("select * from expenses")).rows).toHaveLength(0);
    expect((await db.query("select * from expense_shares")).rows).toHaveLength(
      0,
    );
    expect(
      (await db.query<any>("select id from households")).rows.map((r) => r.id),
    ).toEqual([other]);
  });
  it("blocks unauthenticated RPCs and reads", async () => {
    await db.exec("reset role;set role anon;");
    await expect(db.query("select * from expenses")).rejects.toThrow(
      /permission denied/,
    );
    await expect(rpc("join_household", ["anything"])).rejects.toThrow(
      /permission denied/,
    );
  });
  it("prevents direct expense writes and changes by another roommate", async () => {
    await as(b);
    await expect(db.query("update expenses set cents=1")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      rpc("save_expense", [
        JSON.stringify({ ...payload(), name: "Unauthorized" }),
      ]),
    ).rejects.toThrow(/Only the roommate/);
    await expect(rpc("delete_expense", [expense])).rejects.toThrow(
      /Only the roommate/,
    );
  });
  it("rejects an outsider’s purchase mutation", async () => {
    await as(c);
    await expect(
      rpc("save_expense", [JSON.stringify(payload())]),
    ).rejects.toThrow(/cannot access/);
  });
  it("rejects wrong share totals and rolls back without losing prior shares", async () => {
    await as(a);
    await expect(
      rpc("save_expense", [
        JSON.stringify({
          ...payload(),
          shares: [{ member_id: ma, cents: 1000 }],
        }),
      ]),
    ).rejects.toThrow(/add up/);
    expect(
      (await db.query<any>("select sum(cents)::int as n from expense_shares"))
        .rows[0].n,
    ).toBe(1001);
  });
  it("rejects foreign household participants and duplicate shares", async () => {
    await as(a);
    await expect(
      rpc("save_expense", [
        JSON.stringify({
          ...payload(),
          shares: [{ member_id: mc, cents: 1001 }],
        }),
      ]),
    ).rejects.toThrow(/this household/);
    await expect(
      rpc("save_expense", [
        JSON.stringify({
          ...payload(),
          shares: [
            { member_id: ma, cents: 500 },
            { member_id: ma, cents: 501 },
          ],
        }),
      ]),
    ).rejects.toThrow(/only appear once/);
  });
  it("rejects negative and fractional shares and fake receipts", async () => {
    await as(a);
    for (const shares of [
      [
        { member_id: ma, cents: -1 },
        { member_id: mb, cents: 1002 },
      ],
      [
        { member_id: ma, cents: 500.5 },
        { member_id: mb, cents: 500.5 },
      ],
    ])
      await expect(
        rpc("save_expense", [JSON.stringify({ ...payload(), shares })]),
      ).rejects.toThrow(/integer cents/);
    await expect(
      rpc("save_expense", [
        JSON.stringify({ ...payload(), receipt: `${other}/${a}/fake.jpg` }),
      ]),
    ).rejects.toThrow(/valid receipt/);
  });
  it("uses the purchase ID to avoid duplicate inserts on retry", async () => {
    await as(a);
    await rpc("save_expense", [JSON.stringify(payload())]);
    expect((await db.query("select * from expenses")).rows).toHaveLength(1);
    expect((await db.query("select * from expense_shares")).rows).toHaveLength(
      2,
    );
  });
  it("restricts repayments to the recorder’s household and participation", async () => {
    await as(c);
    await expect(
      db.query(
        "insert into repayments(id,household_id,from_id,to_id,cents,date,recorded_by) values(gen_random_uuid(),$1,$2,$3,500,current_date,$4)",
        [house, ma, mb, c],
      ),
    ).rejects.toThrow(/row-level security/);
    await as(a);
    await expect(
      db.query(
        "insert into repayments(id,household_id,from_id,to_id,cents,date,recorded_by) values(gen_random_uuid(),$1,$2,$3,500,current_date,$4)",
        [house, ma, mc, a],
      ),
    ).rejects.toThrow(/row-level security/);
    await db.query(
      "insert into repayments(id,household_id,from_id,to_id,cents,date,recorded_by) values(gen_random_uuid(),$1,$2,$3,100,current_date,$4)",
      [house, mb, ma, a],
    );
  });
  it("keeps receipts private and forbids cross-house uploads and overwrites", async () => {
    await as(a);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('receipts',$1)",
      [`${house}/${a}/receipt.jpg`],
    );
    await expect(
      db.query(
        "insert into storage.objects(bucket_id,name) values('receipts',$1)",
        [`${other}/${a}/bad.jpg`],
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      db.query(
        "insert into storage.objects(bucket_id,name) values('receipts',$1)",
        [`${house}/${b}/bad.jpg`],
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      (
        await db.query(
          "update storage.objects set name='overwritten' returning *",
        )
      ).rows,
    ).toHaveLength(0);
    await as(c);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
  });
  it("preserves history when a member leaves and revokes their access", async () => {
    await as(b);
    await rpc("leave_household", []);
    expect((await db.query("select * from expenses")).rows).toHaveLength(0);
    expect((await db.query("select * from storage.objects")).rows).toHaveLength(
      0,
    );
    await as(a);
    expect((await db.query("select * from expense_shares")).rows).toHaveLength(
      2,
    );
    expect((await db.query("select * from repayments")).rows).toHaveLength(1);
    expect(
      (await db.query<any>("select left_at from members where id=$1", [mb]))
        .rows[0].left_at,
    ).toBeTruthy();
  });
  it("lets the payer edit historical shares and delete atomically", async () => {
    await as(a);
    await rpc("save_expense", [
      JSON.stringify({ ...payload(), name: "Edited groceries" }),
    ]);
    expect(
      (await db.query<any>("select name from expenses")).rows[0].name,
    ).toBe("Edited groceries");
    await rpc("delete_expense", [expense]);
    expect((await db.query("select * from expense_shares")).rows).toHaveLength(
      0,
    );
  });
});
