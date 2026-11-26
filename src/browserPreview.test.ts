import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  },
}));
vi.mock("expo-crypto", () => ({
  randomUUID: () => randomUUID(),
  CryptoDigestAlgorithm: { SHA256: "SHA256" },
  digestStringAsync: async (_algorithm: string, value: string) =>
    createHash("sha256").update(value).digest("hex"),
}));
import {
  createBrowserPreviewBackend,
  previewOrigin,
  previewSampleEmail,
  previewSamplePassword,
} from "./browserPreview";
import { equalSplit } from "./core";
let backend: ReturnType<typeof createBrowserPreviewBackend>,
  client: SupabaseClient,
  values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  backend = createBrowserPreviewBackend({
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  });
  client = createClient(previewOrigin, "preview-public-key", {
    global: { fetch: backend.fetch },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
});
afterEach(async () => {
  await client.auth.signOut();
});
const sample = async () => {
  const r = await client.auth.signInWithPassword({
    email: previewSampleEmail,
    password: previewSamplePassword,
  });
  expect(r.error).toBeNull();
  return r.data.user!;
};
const setup = async (mode: string, name = "", code = "") =>
  client.rpc("complete_household_setup", {
    setup_mode: mode,
    house_name: name,
    house_currency: "USD",
    invitation_code: code,
  });
describe("self-contained browser rehearsal backend", () => {
  it("opens sample accounts, validates passwords and never calls the network", async () => {
    const u = await sample();
    expect(u.email).toBe(previewSampleEmail);
    expect((await client.auth.getUser()).data.user!.id).toBe(u.id);
    const r = await client
      .from("expenses")
      .select("*")
      .eq("household_id", "demo-house");
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(6);
    await client.auth.signOut();
    expect(
      (
        await client.auth.signInWithPassword({
          email: previewSampleEmail,
          password: "wrong-password",
        })
      ).error,
    ).not.toBeNull();
    const rejected = await backend.fetch("https://unconfigured.example.test");
    expect(rejected.status).toBe(400);
  });
  it("keeps passwords out of persisted preview data and creates linked independent accounts", async () => {
    let r = await client.auth.signUp({
      email: "creator@example.test",
      password: "made-up-password",
      options: { data: { name: "Creator" } },
    });
    expect(r.error).toBeNull();
    const created = await setup("create", "Preview Family");
    expect(created.error).toBeNull();
    const id = created.data;
    const house = (
      await client.from("households").select("*").eq("id", id).single()
    ).data;
    expect(house.name).toBe("Preview Family");
    await client.auth.signOut();
    r = await client.auth.signUp({
      email: "roommate@example.test",
      password: "made-up-password",
      options: { data: { name: "Roommate" } },
    });
    expect(r.error).toBeNull();
    expect(
      (await setup("join", "", house.invite_code.toUpperCase())).data,
    ).toBe(id);
    const members = await client
      .from("members")
      .select("*")
      .eq("household_id", id);
    expect(members.data).toHaveLength(2);
    expect(new Set(members.data!.map((m) => m.user_id)).size).toBe(2);
    expect([...values.values()].join("")).not.toContain("made-up-password");
    expect((await setup("create", "Duplicate")).data).toBe(id);
  });
  it("isolates other households and retains history after leaving", async () => {
    await sample();
    await client.rpc("leave_household");
    expect(
      (
        await client
          .from("expenses")
          .select("*")
          .eq("household_id", "demo-house")
      ).data,
    ).toHaveLength(0);
    await setup("create", "New place");
    await client.auth.signOut();
    await client.auth.signInWithPassword({
      email: "jordan@splitcart.demo",
      password: previewSamplePassword,
    });
    expect(
      (
        await client
          .from("expenses")
          .select("*")
          .eq("household_id", "demo-house")
      ).data,
    ).toHaveLength(6);
    expect(
      (
        await client
          .from("members")
          .select("*")
          .eq("household_id", "demo-house")
      ).data!.find((m) => m.user_id === "demo-alex").left_at,
    ).toBeTruthy();
  });
  it("enforces payer-only edits, cent totals, and duplicate-free repayments", async () => {
    const u = await sample();
    const payload = {
      id: "new-expense",
      household_id: "demo-house",
      name: "Preview soap",
      cents: 1001,
      date: "2026-11-18",
      paid_by: "alex",
      category: "Household",
      store: "Shop",
      notes: "",
      receipt: null,
      shares: equalSplit(1001, ["alex", "jordan", "sam", "riley"]),
    };
    expect((await client.rpc("save_expense", { payload })).error).toBeNull();
    expect((await client.rpc("save_expense", { payload })).error).toBeNull();
    expect(
      (
        await client
          .from("expenses")
          .select("*")
          .eq("household_id", "demo-house")
      ).data,
    ).toHaveLength(7);
    expect(
      (
        await client.rpc("save_expense", {
          payload: { ...payload, shares: [{ member_id: "alex", cents: 1000 }] },
        })
      ).error,
    ).not.toBeNull();
    const r = {
      id: "new-repayment",
      household_id: "demo-house",
      from_id: "alex",
      to_id: "jordan",
      cents: 100,
      date: "2026-11-18",
      recorded_by: u.id,
    };
    expect((await client.from("repayments").insert(r)).error).toBeNull();
    expect((await client.from("repayments").insert(r)).error!.code).toBe(
      "23505",
    );
    await client.auth.signOut();
    await client.auth.signInWithPassword({
      email: "jordan@splitcart.demo",
      password: previewSamplePassword,
    });
    expect(
      (await client.rpc("delete_expense", { expense_id: payload.id })).error,
    ).not.toBeNull();
    expect(
      (
        await client.rpc("save_expense", {
          payload: { ...payload, name: "Unauthorized" },
        })
      ).error,
    ).not.toBeNull();
  });
  it("persists uploaded receipts, restricts their household, and validates size and type", async () => {
    const u = await sample(),
      path = `demo-house/${u.id}/test.png`,
      bytes = new Uint8Array([137, 80, 78, 71]).buffer;
    await backend.upload(path, bytes, "image/png", u.id);
    expect(await backend.receipt(path, u.id)).toBe(
      "data:image/png;base64,iVBORw==",
    );
    await expect(
      backend.upload(path, new ArrayBuffer(5242881), "image/png", u.id),
    ).rejects.toThrow(/5 MB/);
    await expect(
      backend.upload(path, bytes, "image/svg+xml", u.id),
    ).rejects.toThrow(/JPEG/);
    await client.rpc("leave_household");
    await expect(backend.receipt(path, u.id)).rejects.toThrow(/not available/);
  });
  it("renames without changing invite codes and resumes data with a new backend instance", async () => {
    const u = await sample();
    expect(
      (
        await client.rpc("rename_household", {
          household_id: "demo-house",
          house_name: "Cozy preview",
        })
      ).error,
    ).toBeNull();
    const again = createBrowserPreviewBackend({
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    });
    const second = createClient(previewOrigin, "preview-public-key", {
      global: { fetch: again.fetch },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    await second.auth.signInWithPassword({
      email: u.email!,
      password: previewSamplePassword,
    });
    const house = (
      await second
        .from("households")
        .select("*")
        .eq("id", "demo-house")
        .single()
    ).data;
    expect(house.name).toBe("Cozy preview");
    expect(house.invite_code).toBe("DEMO-GREEN");
    await second.auth.signOut();
  });
});

it("persists grocery rotations, serializes competing writes, deduplicates restocks and honors real preview-account agreement", async () => {
  await sample();
  const house = "demo-house",
    day = new Date().toISOString().slice(0, 10);
  let r = await client.rpc("grocery_apply", {
    household_id: house,
    expected_version: 0,
    command: {
      id: randomUUID(),
      kind: "configure",
      participants: ["alex", "jordan", "sam"],
      days: 7,
      due: day,
      mode: "grocery",
      restockParticipants: ["alex", "jordan", "sam"],
      restockDays: 7,
      restockStart: day,
    },
  });
  expect(r.error).toBeNull();
  const essential = r.data.essentials[0].id;
  const low = () =>
    client.rpc("grocery_apply", {
      household_id: house,
      expected_version: 1,
      command: {
        id: randomUUID(),
        kind: "low",
        essentialId: essential,
        shoppingId: randomUUID(),
      },
    });
  const reports = await Promise.all([low(), low()]);
  expect(reports.every((x) => !x.error)).toBe(true);
  const items = await client
    .from("shopping_items")
    .select("*")
    .eq("household_id", house);
  expect(items.data).toHaveLength(1);
  expect(items.data![0].assigned_to).toBe("alex");
  const swap = randomUUID();
  r = await client.rpc("grocery_apply", {
    household_id: house,
    expected_version: 2,
    command: { id: swap, kind: "requestSwap", target: "jordan" },
  });
  expect(r.error).toBeNull();
  const resolve = () =>
    client.rpc("grocery_apply", {
      household_id: house,
      expected_version: 3,
      command: {
        id: randomUUID(),
        kind: "resolveSwap",
        swapId: swap,
        decision: "accept",
      },
    });
  expect((await resolve()).error?.message).toMatch(/invited/);
  await client.auth.signOut();
  await client.auth.signInWithPassword({
    email: "jordan@splitcart.demo",
    password: previewSamplePassword,
  });
  expect((await resolve()).error).toBeNull();
  const complete = () =>
    client.rpc("grocery_apply", {
      household_id: house,
      expected_version: 4,
      command: { id: randomUUID(), kind: "complete" },
    });
  const results = await Promise.all([complete(), complete()]);
  expect(results.filter((x) => !x.error)).toHaveLength(1);
  expect(results.find((x) => x.error)?.error?.message).toMatch(/changed/);
  const saved = await client.rpc("grocery_snapshot", { household_id: house });
  expect(saved.data.rotation.queue).toEqual(["alex", "sam", "jordan"]);
  expect(
    saved.data.history.filter((e: any) => e.kind === "complete"),
  ).toHaveLength(1);
  expect([...values.values()].join("")).toContain(swap);
  await client.auth.signUp({
    email: "other-grocery@example.test",
    password: "made-up-password",
    options: { data: { name: "Other" } },
  });
  await setup("create", "Other grocery household");
  expect(
    (await client.rpc("grocery_snapshot", { household_id: house })).error
      ?.message,
  ).toMatch(/not available/);
});

describe("shared household subscription rehearsal", () => {
  it("persists a single trial across accounts and rejects stale or unauthorized changes", async () => {
    await sample();
    const snapshot = () =>
      client.rpc("household_subscription_snapshot", {
        household_id: "demo-house",
      });
    const action = (command: object, version: number) =>
      client.rpc("household_subscription_apply", {
        household_id: "demo-house",
        command,
        expected_version: version,
      });
    let current = (await snapshot()).data;
    const activated = await action(
      { type: "activate", plan: "basic" },
      current.version,
    );
    expect(activated.error).toBeNull();
    current = activated.data;
    expect(current.charges).toEqual([]);
    expect((await action({ type: "cancel" }, 0)).error?.message).toContain(
      "changed",
    );
    await client.auth.signOut();
    await client.auth.signInWithPassword({
      email: "jordan@splitcart.demo",
      password: previewSamplePassword,
    });
    expect((await snapshot()).data).toEqual(current);
    expect(
      (await action({ type: "advance" }, current.version)).error?.message,
    ).toContain("billing manager");
    expect(
      (await action({ type: "activate", plan: "premium" }, current.version))
        .error?.message,
    ).toContain("billing manager");
    await client.auth.signOut();
    await sample();
    const results = await Promise.all([
      action({ type: "activate", plan: "premium" }, current.version),
      action({ type: "advance" }, current.version),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    const renewed = (await snapshot()).data;
    expect(renewed.status).toBe("active");
    expect(renewed.charges).toHaveLength(1);
    expect(renewed.charges[0].cents).toBe(399);
    expect((await snapshot()).data.charges).toHaveLength(1);
    expect(
      (
        await client
          .from("expenses")
          .select("*")
          .eq("household_id", "demo-house")
      ).data,
    ).toHaveLength(6);
  });
});
