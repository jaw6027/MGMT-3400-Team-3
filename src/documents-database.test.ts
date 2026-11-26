import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { calculateReceipt, emptyReceiptDetails } from "./receiptItems";
let db: PGlite;
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  c = "10000000-0000-4000-8000-000000000003";
const h = "20000000-0000-4000-8000-000000000001",
  other = "20000000-0000-4000-8000-000000000002",
  ma = "30000000-0000-4000-8000-000000000001",
  mb = "30000000-0000-4000-8000-000000000002",
  mc = "30000000-0000-4000-8000-000000000003";
const path = (user: string, name: string, house = h) =>
  `${house}/${user}/${name}.pdf`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;create table auth.users(id uuid primary key,raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage,public to anon,authenticated,service_role;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 grant select,insert,update,delete on storage.objects to authenticated;`);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await db.exec(`insert into auth.users values('${a}','{}'),('${b}','{}'),('${c}','{}');insert into households(id,name,currency) values('${h}','Home','USD'),('${other}','Other','USD');
 insert into members(id,household_id,user_id,name) values('${ma}','${h}','${a}','Alex'),('${mb}','${h}','${b}','Jordan'),('${mc}','${other}','${c}','Outsider');`);
  for (const [user, name, hash, house] of [
    [a, "first", "a", h],
    [b, "renamed", "a", h],
    [b, "similar", "b", h],
    [a, "third", "c", h],
    [a, "parallel1", "d", h],
    [a, "parallel2", "d", h],
    [c, "outside", "a", other],
  ]) {
    const file = path(user, name, house);
    await db.query(
      "insert into storage.objects(bucket_id,name) values('receipts',$1)",
      [file],
    );
    await db.query(
      "select register_verified_document($1,$2,$3,'application/pdf',$4)",
      [house, file, hash.repeat(64), `${name}.pdf`],
    );
  }
});
afterAll(async () => {
  await db?.close();
});
const as = (user: string) =>
  db.exec(
    `reset role;set request.jwt.claim.sub='${user}';set role authenticated;`,
  );
const payload = (file = path(a, "first"), payer = ma) => ({
  id: crypto.randomUUID(),
  household_id: h,
  name: "Reviewed utility bill",
  cents: 1000,
  date: "2026-11-26",
  paid_by: payer,
  category: "Utilities",
  store: "Power Company",
  notes: "",
  receipt: file,
  receipt_document: {
    sha256: "f".repeat(64),
    mime: "text/html",
    name: "forged",
    kind: "utility",
    reference: "INV-123",
  },
  document_reviewed: true,
  duplicate_confirmations: [] as string[],
  shares: [{ member_id: payer, cents: 1000 }],
});
const save = (e: object) =>
  db.query("select save_expense($1::jsonb)", [JSON.stringify(e)]);
it("uses verified hashes, blocks household-wide exact duplicates, and requires explicit suspected-duplicate confirmation", async () => {
  await as(a);
  await expect(db.query("select * from household_documents")).rejects.toThrow(
    "permission denied",
  );
  await expect(
    db.query(
      "select register_verified_document($1,$2,$3,'application/pdf','forged')",
      [h, path(a, "first"), "f".repeat(64)],
    ),
  ).rejects.toThrow("permission denied");
  const first = payload();
  await expect(save({ ...first, document_reviewed: false })).rejects.toThrow(
    "Review the document",
  );
  await save(first);
  let record = (
    await db.query<any>("select receipt_document from expenses where id=$1", [
      first.id,
    ])
  ).rows[0];
  expect(record.receipt_document).toMatchObject({
    sha256: "a".repeat(64),
    mime: "application/pdf",
    name: "first.pdf",
    kind: "utility",
    reference: "INV-123",
  });
  await as(b);
  await expect(
    save({
      ...payload(path(b, "renamed"), mb),
      cents: 2000,
      shares: [{ member_id: mb, cents: 2000 }],
      duplicate_confirmations: [first.id],
    }),
  ).rejects.toThrow("Exact duplicate");
  const similar = payload(path(b, "similar"), mb);
  await expect(save(similar)).rejects.toThrow("Possible duplicate");
  await save({ ...similar, duplicate_confirmations: [first.id] });
  expect(
    (
      await db.query<any>(
        "select duplicate_confirmations from expenses where id=$1",
        [similar.id],
      )
    ).rows[0].duplicate_confirmations,
  ).toEqual([first.id]);
  await as(a);
  await expect(
    save({ ...payload(path(a, "third")), duplicate_confirmations: [first.id] }),
  ).rejects.toThrow("Possible duplicate");
  await expect(
    db.query("select save_expense_before_documents($1::jsonb)", [
      JSON.stringify(payload()),
    ]),
  ).rejects.toThrow("permission denied");
  await expect(
    save({ ...first, receipt: path(c, "outside", other) }),
  ).rejects.toThrow("valid receipt");
  await as(c);
  await expect(save(payload())).rejects.toThrow("Household unavailable");
  expect((await db.query("select * from expenses")).rows).toHaveLength(0);
  await as(a);
  await db.query("select delete_expense($1)", [first.id]);
  await save({
    ...payload(),
    date: "2026-12-26",
    store: "Different provider",
    receipt_document: { ...first.receipt_document, reference: "NEW" },
  });
  await db.exec("reset role");
});
it("serializes concurrent duplicate saves and preserves item categories and cent-perfect splits", async () => {
  await as(a);
  const one = {
      ...payload(path(a, "parallel1")),
      store: "Parallel shop",
      receipt_document: {
        ...payload().receipt_document,
        reference: "parallel",
      },
    },
    two = {
      ...payload(path(a, "parallel2")),
      store: "Parallel shop",
      receipt_document: {
        ...payload().receipt_document,
        reference: "parallel",
      },
    };
  const results = await Promise.allSettled([save(one), save(two)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const details = {
    ...emptyReceiptDetails(),
    items: [
      { name: "Milk", cents: 1000, members: [ma, mb], category: "Groceries" },
      { name: "Soap", cents: 2000, members: [mb], category: "Household" },
    ],
    taxCents: 300,
  };
  const e = {
    ...payload(path(a, "third")),
    store: "Mixed shop",
    cents: 3300,
    receipt_details: details,
    shares: calculateReceipt(details, [ma, mb]).shares,
    receipt_document: { ...payload().receipt_document, reference: "MIXED" },
  };
  await save(e);
  const record = (
    await db.query<any>(
      "select receipt_details,cents from expenses where id=$1",
      [e.id],
    )
  ).rows[0];
  expect(record.receipt_details).toEqual(details);
  expect(record.cents).toBe(3300);
  await expect(
    save({
      ...e,
      receipt_details: {
        ...details,
        items: [{ ...details.items[0], category: "Forged" }, details.items[1]],
      },
    }),
  ).rejects.toThrow("valid category");
  await db.exec("reset role;set role anon");
  await expect(save(e)).rejects.toThrow("permission denied");
  await db.exec("reset role");
});

it("indexes legacy duplicates without deleting history or changing expense amounts and rejects registry tampering", async () => {
  const { spendingBreakdown } = await import("./spending");
  await db.exec("reset role");
  const legacyPath = path(a, "legacy");
  await db.query(
    "insert into storage.objects(bucket_id,name) values('receipts',$1)",
    [legacyPath],
  );
  for (let i = 0; i < 2; i++)
    await db.query(
      `insert into expenses(id,household_id,name,cents,date,paid_by,created_by,category,receipt) values(gen_random_uuid(),$1,$2,500,'2026-11-25',$3,$4,'Utilities',$5)`,
      [h, `Legacy bill ${i}`, ma, a, legacyPath],
    );
  const rows = async () =>
    (
      await db.query<any>(
        "select id,household_id,name,cents,date,category,receipt_document,created_at from expenses where receipt=$1 order by name",
        [legacyPath],
      )
    ).rows;
  await db.query(
    "insert into expense_shares(expense_id,member_id,cents) select id,$1,500 from expenses where receipt=$2",
    [ma, legacyPath],
  );
  const before = await rows();
  await db.query(
    "select register_verified_document($1,$2,$3,'application/pdf','old.pdf')",
    [h, legacyPath, "e".repeat(64)],
  );
  const after = await rows();
  expect(after.map(({ receipt_document, ...e }) => e)).toEqual(
    before.map(({ receipt_document, ...e }) => e),
  );
  expect(after.every((e) => e.receipt_document.sha256 === "e".repeat(64))).toBe(
    true,
  );
  expect(
    spendingBreakdown(
      after.map((e) => ({
        ...e,
        date: String(e.date),
        created_at:
          e.created_at instanceof Date
            ? e.created_at.toISOString()
            : e.created_at,
      })),
    ),
  ).toMatchObject({ total: 500, count: 1, duplicatesExcluded: 1 });
  await expect(
    db.query(
      "select register_verified_document($1,$2,$3,'application/pdf','tampered.pdf')",
      [h, legacyPath, "f".repeat(64)],
    ),
  ).rejects.toThrow("immutable document changed");
  await as(a);
  await save({
    ...payload(legacyPath),
    id: after[0].id,
    name: "Corrected legacy title",
    cents: 500,
    date: "2026-11-25",
    store: "",
    shares: [{ member_id: ma, cents: 500 }],
  });
  expect((await rows()).length).toBe(2);
  await db.exec("reset role");
});
