import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
let db: PGlite;
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  outsider = "10000000-0000-4000-8000-000000000003";
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
  await db.exec(`insert into auth.users values('${a}','{}'),('${b}','{}'),('${outsider}','{}');
    insert into households(id,name,currency) values('${house}','Home','USD');
    insert into members(id,household_id,user_id,name,joined_at) values('${ma}','${house}','${a}','Alex','2026-01-01'),('${mb}','${house}','${b}','Jordan','2026-01-02');`);
});
afterAll(async () => {
  await db?.close();
});
const as = (user: string) =>
  db.exec(
    `reset role;set request.jwt.claim.sub='${user}';set role authenticated;`,
  );
const snapshot = async () =>
  (
    await db.query<any>("select household_subscription_snapshot($1) as s", [
      house,
    ])
  ).rows[0].s;
const act = async (command: object, version: number) =>
  (
    await db.query<any>(
      "select household_subscription_apply($1,$2::jsonb,$3) as s",
      [house, JSON.stringify(command), version],
    )
  ).rows[0].s;
it("enforces private household-level permissions, one trial, renewals and duplicate app-dues protection", async () => {
  await as(a);
  let s = await snapshot();
  expect(s.manager_id).toBe(a);
  await expect(
    act({ type: "activate", plan: "forged", cents: 1 }, s.version),
  ).rejects.toThrow("Choose Basic");
  s = await act(
    {
      type: "activate",
      plan: "basic",
      trial_started_at: "1900-01-01",
      cents: 1,
    },
    s.version,
  );
  expect(Date.parse(s.trial_ends_at) - Date.parse(s.trial_started_at)).toBe(
    30 * 86400000,
  );
  const trial = s.trial_started_at;
  expect(s.charges).toEqual([]);
  await expect(
    db.query("update household_subscriptions set state='{}'"),
  ).rejects.toThrow("permission denied");
  await expect(
    db.query("select subscription_locked($1)", [house]),
  ).rejects.toThrow("permission denied");
  await expect(
    act({ type: "activate", plan: "premium" }, s.version),
  ).rejects.toThrow("already");
  await expect(act({ type: "cancel" }, 0)).rejects.toThrow("changed");
  await as(b);
  expect((await snapshot()).plan).toBe("basic");
  await expect(act({ type: "cancel" }, s.version)).rejects.toThrow(
    "billing manager",
  );
  await expect(act({ type: "advance" }, s.version)).rejects.toThrow(
    "billing manager",
  );
  await as(outsider);
  await expect(snapshot()).rejects.toThrow("unavailable");
  await as(a);
  s = await act({ type: "change_plan", plan: "plus" }, s.version);
  s = await act({ type: "advance" }, s.version);
  expect(s.status).toBe("active");
  expect(s.charges[0].cents).toBe(549);
  expect((await snapshot()).charges).toHaveLength(1);
  s = await act({ type: "change_plan", plan: "premium" }, s.version);
  expect(s.plan).toBe("plus");
  expect(s.pending_plan).toBe("premium");
  s = await act({ type: "toggle_failure" }, s.version);
  s = await act({ type: "advance" }, s.version);
  expect(s.status).toBe("past_due");
  expect(s.charges[1].cents).toBe(699);
  expect(s.charges[1].status).toBe("failed");
  s = await act({ type: "retry" }, s.version);
  expect(s.charges).toHaveLength(2);
  expect(s.charges[1].status).toBe("paid");
  await expect(act({ type: "retry" }, s.version)).rejects.toThrow("no failed");
  s = await act({ type: "change_plan", plan: "basic" }, s.version);
  s = await act({ type: "advance" }, s.version);
  expect(s.plan).toBe("basic");
  expect(s.charges[2].cents).toBe(399);
  s = await act({ type: "cancel" }, s.version);
  expect((await act({ type: "resume" }, s.version)).cancel_at_period_end).toBe(
    false,
  );
  s = await snapshot();
  s = await act({ type: "cancel" }, s.version);
  s = await act({ type: "advance" }, s.version);
  expect(s.status).toBe("canceled");
  expect(s.charges).toHaveLength(3);
  s = await act({ type: "activate", plan: "premium" }, s.version);
  expect(s.trial_started_at).toBe(trial);
  expect(s.status).toBe("active");
  expect(s.charges).toHaveLength(4);
  s = await act({ type: "transfer", user_id: b }, s.version);
  await expect(act({ type: "cancel" }, s.version)).rejects.toThrow(
    "billing manager",
  );
  await as(b);
  s = await act({ type: "cancel" }, s.version);
  await as(a);
  await db.exec("select leave_household()");
  await expect(snapshot()).rejects.toThrow("unavailable");
  await as(b);
  await expect(act({ type: "claim_management" }, s.version)).rejects.toThrow(
    "first remaining",
  );
  await db.exec(
    `reset role; update members set left_at=now() where user_id='${b}';update members set left_at=null where user_id='${a}';`,
  );
  await as(a);
  s = await act({ type: "claim_management" }, s.version);
  expect(s.manager_id).toBe(a);
  await db.exec("reset role;set role service_role");
  expect(
    (
      await db.query<any>("select legacy_app_dues_allowed($1) as allowed", [
        house,
      ])
    ).rows[0].allowed,
  ).toBe(false);
  await expect(
    db.query(
      `insert into payment_orders(id,user_id,household_id,from_id,cents,fee,funding,payment_method) values(gen_random_uuid(),'${a}','${house}','${ma}',399,0,'bank','sample')`,
    ),
  ).rejects.toThrow("No duplicate app payment");
  await expect(
    db.query(
      `insert into payment_dues(user_id,household_id,cents,due_day,automatic,payment_method) values('${a}','${house}',399,1,false,'sample')`,
    ),
  ).rejects.toThrow("No duplicate app payment");
  await db.exec("reset role;set role anon");
  await expect(snapshot()).rejects.toThrow("permission denied");
  await db.exec("reset role");
});

it("pauses every legacy app schedule, blocks activation during an in-flight app charge and preserves purchases and repayments", async () => {
  const u = "10000000-0000-4000-8000-000000000004",
    v = "10000000-0000-4000-8000-000000000005";
  const h = "20000000-0000-4000-8000-000000000004",
    m = "30000000-0000-4000-8000-000000000004",
    n = "30000000-0000-4000-8000-000000000005";
  const payment = "40000000-0000-4000-8000-000000000004";
  await db.exec(`reset role;
    insert into auth.users values('${u}','{}'),('${v}','{}');
    insert into households(id,name,currency) values('${h}','Another home','EUR');
    insert into members(id,household_id,user_id,name,joined_at) values('${m}','${h}','${u}','Manager','2026-01-01'),('${n}','${h}','${v}','Roommate','2026-01-02');
    insert into expenses(id,household_id,name,cents,date,paid_by,created_by,category) values(gen_random_uuid(),'${h}','Existing expense',1000,current_date,'${m}','${u}','Utilities');
    insert into repayments(id,household_id,from_id,to_id,cents,date,recorded_by) values(gen_random_uuid(),'${h}','${m}','${n}',100,current_date,'${u}');
    insert into payment_dues(user_id,household_id,cents,due_day,automatic,payment_method,consent_at) values('${u}','${h}',500,1,true,'sample',now()),('${v}','${h}',500,1,false,'sample',null);
    insert into payment_orders(id,user_id,household_id,from_id,cents,fee,funding,payment_method,status) values('${payment}','${u}','${h}','${m}',500,0,'bank','sample','processing');`);
  const history = async () => {
    await db.exec("reset role");
    return (
      await db.query<any>(
        "select (select jsonb_agg(e) from expenses e where household_id=$1) as expenses,(select jsonb_agg(r) from repayments r where household_id=$1) as repayments",
        [h],
      )
    ).rows[0];
  };
  const before = await history();
  await as(u);
  const get = async () =>
    (
      await db.query<any>("select household_subscription_snapshot($1) as s", [
        h,
      ])
    ).rows[0].s;
  const change = async (command: object, version: number) =>
    (
      await db.query<any>(
        "select household_subscription_apply($1,$2::jsonb,$3) as s",
        [h, JSON.stringify(command), version],
      )
    ).rows[0].s;
  let s = await get();
  await expect(
    change({ type: "activate", plan: "plus" }, s.version),
  ).rejects.toThrow("pending legacy");
  await db.exec(
    `reset role;update payment_orders set status='failed' where id='${payment}'`,
  );
  await as(u);
  s = await change({ type: "activate", plan: "plus" }, s.version);
  await db.exec("reset role");
  const dues = (
    await db.query<any>(
      "select paused,automatic from payment_dues where household_id=$1",
      [h],
    )
  ).rows;
  expect(dues).toHaveLength(2);
  expect(dues.every((d) => d.paused && !d.automatic)).toBe(true);
  await as(u);
  const results = await Promise.allSettled([
    change({ type: "change_plan", plan: "premium" }, s.version),
    change({ type: "cancel" }, s.version),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  s = await get();
  s = await change({ type: "advance" }, s.version);
  s = await change({ type: "cancel" }, s.version);
  s = await change({ type: "advance" }, s.version);
  expect(s.status).toBe("canceled");
  expect(await history()).toEqual(before);
  await as(v);
  await expect(
    db.query("select household_subscription_snapshot($1)", [house]),
  ).rejects.toThrow("unavailable");
  await db.exec("reset role");
});

it("keeps database lifecycle behavior identical to the classroom state machine", async () => {
  const { applySubscription, initialSubscription } =
    await import("./subscriptions");
  const u = "10000000-0000-4000-8000-000000000006",
    h = "20000000-0000-4000-8000-000000000006";
  await db.exec(
    `reset role;insert into auth.users values('${u}','{}');insert into households(id,name,currency) values('${h}','Parity home','USD');insert into members(household_id,user_id,name) values('${h}','${u}','Manager');`,
  );
  await as(u);
  let model = initialSubscription(h, u);
  const execute = async (
    command: import("./subscriptions").SubscriptionCommand,
  ) => {
    const server = (
      await db.query<any>(
        "select household_subscription_apply($1,$2::jsonb,$3) as s",
        [h, JSON.stringify(command), model.version],
      )
    ).rows[0].s;
    model = applySubscription(
      model,
      [{ user_id: u }],
      u,
      command,
      model.version,
      server.trial_started_at,
    );
    expect(server).toEqual(model);
  };
  await execute({ type: "activate", plan: "basic" });
  await execute({ type: "change_plan", plan: "plus" });
  await execute({ type: "toggle_failure" });
  await execute({ type: "advance" });
  await execute({ type: "retry" });
  await execute({ type: "change_plan", plan: "premium" });
  await execute({ type: "advance" });
  await execute({ type: "change_plan", plan: "basic" });
  await execute({ type: "cancel" });
  await execute({ type: "resume" });
  await execute({ type: "advance" });
  await execute({ type: "cancel" });
  await execute({ type: "advance" });
  await execute({ type: "activate", plan: "basic" });
  await db.exec("reset role");
});
