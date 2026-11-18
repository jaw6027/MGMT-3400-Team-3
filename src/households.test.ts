import { describe, it, expect, vi } from "vitest";
import {
  clearPendingHousehold,
  completeHouseholdSetup,
  householdName,
  normalizeHouseholdIntent,
  pendingHousehold,
  pendingHouseholdKey,
  signUpWithHousehold,
} from "./households";
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
  };
}
describe("household signup choices", () => {
  it("accepts personal household names and normalizes pasted codes", () => {
    expect(householdName("  Maple Street • Flat #4 🏠  ")).toBe(
      "Maple Street • Flat #4 🏠",
    );
    expect(
      normalizeHouseholdIntent({ mode: "join", code: " ABCD EFGH\n1234 " }),
    ).toEqual({ mode: "join", code: "abcdefgh1234" });
    expect(() => householdName(" ")).toThrow(/1 and 80/);
    expect(() => householdName("x".repeat(81))).toThrow(/1 and 80/);
    expect(() => normalizeHouseholdIntent({ mode: "join", code: " " })).toThrow(
      /invitation code/,
    );
  });
  it("persists the choice before auth fires, bound only to the matching email", async () => {
    const s = storage();
    const auth = {
      signUp: vi.fn(async () => {
        expect(await pendingHousehold(s, "alex@example.com")).toEqual({
          mode: "join",
          code: "abcdef",
        });
        expect(
          await pendingHousehold(s, "someone-else@example.com"),
        ).toBeNull();
        return { data: { user: null, session: null }, error: null };
      }),
    };
    await signUpWithHousehold(auth as any, s, {
      email: " Alex@Example.com ",
      password: "password123",
      name: " Alex ",
      household: { mode: "join", code: "ABC DEF" },
    });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "alex@example.com",
      password: "password123",
      options: { data: { name: "Alex" } },
    });
    expect([...s.values.values()].join("")).not.toContain("password123");
    // The choice remains until the user confirms their email and signs in.
    expect(await pendingHousehold(s, "alex@example.com")).not.toBeNull();
    await clearPendingHousehold(s, "alex@example.com");
    expect(await pendingHousehold(s, "alex@example.com")).toBeNull();
  });
  it("does not create an account for missing household details", async () => {
    const s = storage(),
      auth = { signUp: vi.fn() };
    await expect(
      signUpWithHousehold(auth as any, s, {
        email: "a@b.com",
        password: "password123",
        name: "Alex",
        household: { mode: "create", name: "", currency: "USD" },
      }),
    ).rejects.toThrow(/household a name/);
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(s.values.size).toBe(0);
  });
  it("cleans up the pending code when signup fails", async () => {
    const s = storage(),
      auth = {
        signUp: vi.fn(async () => ({
          data: { user: null, session: null },
          error: new Error("Signup failed"),
        })),
      };
    await expect(
      signUpWithHousehold(auth as any, s, {
        email: "a@b.com",
        password: "password123",
        name: "Alex",
        household: { mode: "join", code: "abc" },
      }),
    ).rejects.toThrow("Signup failed");
    expect(s.values.size).toBe(0);
  });
  it("discards malformed saved choices", async () => {
    const s = storage();
    await s.setItem(pendingHouseholdKey("a@b.com"), '{"mode":"join"}');
    expect(await pendingHousehold(s, "a@b.com")).toBeNull();
    expect(s.values.size).toBe(0);
  });
  it("uses the authenticated setup RPC and surfaces invalid-code errors", async () => {
    const backend = { rpc: vi.fn(async () => ({ error: null })) };
    await completeHouseholdSetup(backend, {
      mode: "create",
      name: " Our Home ",
      currency: "EUR",
    });
    expect(backend.rpc).toHaveBeenCalledWith("complete_household_setup", {
      setup_mode: "create",
      house_name: "Our Home",
      house_currency: "EUR",
      invitation_code: "",
    });
    const failure = {
      rpc: vi.fn(async () => ({
        error: { message: "That invitation code didn’t match a household." },
      })),
    };
    await expect(
      completeHouseholdSetup(failure, { mode: "join", code: "not-real" }),
    ).rejects.toThrow(/didn’t match/);
  });
});
