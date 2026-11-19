import { describe, it, expect } from "vitest";
import { demoData } from "./demo";
import type { Data, Expense } from "./core";
import {
  addGroceryDays,
  applyGrocery,
  checkGroceryPurchase,
  checkGroceryTripExpense,
  completeGroceryRestock,
  emptyGrocery,
  groceryLocalLock,
  reopenDeletedGroceryPurchase,
  restockOwner,
  syncGroceryShopping,
  upcomingGroceries,
  type GroceryCommand,
} from "./grocery";
const day = "2026-11-19";
const config: GroceryCommand = {
  id: "configure",
  kind: "configure",
  participants: ["alex", "jordan", "sam"],
  days: 7,
  due: day,
  mode: "grocery",
  restockParticipants: ["alex", "jordan", "sam"],
  restockDays: 7,
  restockStart: day,
};
const initial = (): Data => ({ ...demoData(), grocery: emptyGrocery() });
const apply = (
  d: Data,
  c: GroceryCommand,
  user = "demo-alex",
  date = day,
  version = d.grocery?.version || 0,
) => applyGrocery(d, user, c, version, date);
const configured = () => apply(initial(), config);
const e: Expense = {
  id: "restock-expense",
  household_id: "demo-house",
  name: "Toilet paper",
  cents: 900,
  date: day,
  paid_by: "jordan",
  category: "Household",
  notes: "",
  store: "Sample",
  receipt: null,
  shares: [
    { member_id: "alex", cents: 300 },
    { member_id: "jordan", cents: 300 },
    { member_id: "sam", cents: 300 },
  ],
  created_at: day + "T12:00:00Z",
};
describe("grocery responsibility transitions", () => {
  it("creates the existing roommate roster and repeats a weekly rotation without changing expenses", () => {
    let d = configured();
    const expenses = d.expenses;
    expect(
      upcomingGroceries(d.grocery!, d.members).map((x) => x.memberId),
    ).toEqual(["alex", "jordan", "sam", "alex"]);
    for (const [i, name] of ["alex", "jordan", "sam"].entries())
      d = apply(
        d,
        { id: "trip-" + i, kind: "complete" },
        "demo-" + name,
        addGroceryDays(day, i * 7),
      );
    expect(d.grocery?.rotation?.queue).toEqual(["alex", "jordan", "sam"]);
    expect(
      d.grocery?.history.filter((e) => e.kind === "complete"),
    ).toHaveLength(3);
    expect(d.expenses).toEqual(expenses);
  });
  it("advances late completions from their actual date and blocks early or duplicate completions", () => {
    let d = configured();
    const cmd: GroceryCommand = { id: "done", kind: "complete" };
    d = apply(d, cmd, "demo-alex", "2026-11-23");
    expect(d.grocery?.rotation?.due).toBe("2026-11-30");
    expect(apply(d, cmd, "demo-alex", "2026-11-23", 1)).toEqual(d);
    expect(() =>
      apply(d, { id: "twice", kind: "complete" }, "demo-jordan", "2026-11-23"),
    ).toThrow(/not started/);
    expect(() =>
      apply(
        d,
        { id: "stale", kind: "complete" },
        "demo-jordan",
        "2026-11-30",
        1,
      ),
    ).toThrow(/changed/);
  });
  it("skips to the back without financial or completion credit and expires swaps", () => {
    let d = configured();
    d = apply(d, { id: "swap", kind: "requestSwap", target: "jordan" });
    d = apply(d, { id: "skip", kind: "skip" });
    expect(d.grocery?.rotation?.queue).toEqual(["jordan", "sam", "alex"]);
    expect(d.grocery?.rotation?.due).toBe(day);
    expect(d.grocery?.swaps[0].status).toBe("expired");
    expect(
      d.grocery?.history.filter((e) => e.kind === "complete"),
    ).toHaveLength(0);
  });
  it("requires both accounts to agree, swaps exact positions, and declines or cancels honestly", () => {
    let d = configured();
    d = apply(d, { id: "swap", kind: "requestSwap", target: "sam" });
    expect(() =>
      apply(d, {
        id: "bad",
        kind: "resolveSwap",
        swapId: "swap",
        decision: "accept",
      }),
    ).toThrow(/invited/);
    expect(() =>
      apply(
        d,
        { id: "bad", kind: "resolveSwap", swapId: "swap", decision: "accept" },
        "demo-jordan",
      ),
    ).toThrow(/invited/);
    d = apply(
      d,
      { id: "accept", kind: "resolveSwap", swapId: "swap", decision: "accept" },
      "demo-sam",
    );
    expect(d.grocery?.rotation?.queue).toEqual(["sam", "jordan", "alex"]);
    expect(() =>
      apply(
        d,
        {
          id: "again",
          kind: "resolveSwap",
          swapId: "swap",
          decision: "accept",
        },
        "demo-sam",
      ),
    ).toThrow(/no longer/);
    d = apply(
      d,
      { id: "swap2", kind: "requestSwap", target: "jordan" },
      "demo-sam",
    );
    d = apply(
      d,
      {
        id: "decline",
        kind: "resolveSwap",
        swapId: "swap2",
        decision: "decline",
      },
      "demo-jordan",
    );
    expect(d.grocery?.rotation?.queue[0]).toBe("sam");
    d = apply(
      d,
      { id: "swap3", kind: "requestSwap", target: "alex" },
      "demo-sam",
    );
    d = apply(
      d,
      {
        id: "cancel",
        kind: "resolveSwap",
        swapId: "swap3",
        decision: "cancel",
      },
      "demo-sam",
    );
    expect(d.grocery?.swaps[2].status).toBe("canceled");
  });
  it("deduplicates low reports including stale simultaneous reports and uses existing shopping identities", () => {
    let d = configured();
    const essential = d.grocery!.essentials[0];
    d.shoppingItems = [
      {
        id: "existing",
        household_id: "demo-house",
        catalog_id: "bathroom-toilet-paper",
        name: "Toilet Paper",
        category: "Bathroom",
        item_key: "catalog:bathroom-toilet-paper",
        assigned_to: "sam",
        one_time: false,
        expense_id: null,
        created_at: day,
      },
    ];
    d = apply(d, {
      id: "low1",
      kind: "low",
      essentialId: essential.id,
      shoppingId: "unused",
    });
    d = apply(
      d,
      {
        id: "low2",
        kind: "low",
        essentialId: essential.id,
        shoppingId: "unused2",
      },
      "demo-jordan",
      day,
      1,
    );
    expect(d.shoppingItems).toHaveLength(1);
    expect(d.shoppingItems![0]).toMatchObject({
      id: "existing",
      assigned_to: "alex",
    });
    expect(d.grocery!.essentials[0].shoppingId).toBe("existing");
  });
  it("purchases only by assigned restockers update stock without deciding the payer or completing a grocery trip", () => {
    let d = configured();
    const id = d.grocery!.essentials[0].id;
    d = apply(d, {
      id: "low",
      kind: "low",
      essentialId: id,
      shoppingId: "shop",
    });
    expect(() => checkGroceryPurchase(d, "demo-jordan", "shop", day)).toThrow(
      /assigned/,
    );
    expect(() =>
      checkGroceryPurchase(d, "demo-alex", "shop", day),
    ).not.toThrow();
    d = completeGroceryRestock(d, "shop", e, "demo-alex");
    expect(d.grocery!.essentials[0]).toMatchObject({
      low: false,
      lastPurchased: day,
    });
    expect(d.grocery!.rotation!.queue[0]).toBe("alex");
    expect(d.grocery!.history[0]).toMatchObject({
      kind: "restock",
      actor: "alex",
      expenseId: e.id,
    });
  });
  it("computes independent date-based restock rotation and updates linked list assignments when time advances", () => {
    let d = apply(initial(), { ...config, mode: "separate" });
    const state = d.grocery!;
    expect(
      state.essentials
        .slice(0, 3)
        .map((item) => restockOwner(state, item, d.members, day)),
    ).toEqual(["alex", "jordan", "sam"]);
    d = apply(d, {
      id: "low",
      kind: "low",
      essentialId: state.essentials[0].id,
      shoppingId: "shop",
    });
    d = syncGroceryShopping(d, addGroceryDays(day, 7));
    expect(d.shoppingItems![0].assigned_to).toBe("jordan");
    expect(d.grocery!.rotation!.queue[0]).toBe("alex");
    expect(
      restockOwner(state, state.essentials[0], d.members, "2026-11-01"),
    ).toBe("alex");
  });
  it("tracks custom quantity/brand notes, rejects duplicates, and preserves metadata on low reports", () => {
    let d = configured();
    d = apply(d, {
      id: "item",
      kind: "essential",
      item: {
        id: "custom",
        name: "Coffee beans",
        category: "Food",
        quantity: "1 scoop",
        notes: "Decaf, 1 bag",
      },
    });
    d = apply(d, {
      id: "low",
      kind: "low",
      essentialId: "custom",
      shoppingId: "coffee",
    });
    expect(d.grocery!.essentials.find((e) => e.id === "custom")).toMatchObject({
      notes: "Decaf, 1 bag",
      quantity: "1 scoop",
      low: true,
    });
    expect(() =>
      apply(d, {
        id: "dup",
        kind: "essential",
        item: {
          id: "other",
          name: " coffee  beans ",
          category: "Food",
          notes: "",
          quantity: "",
        },
      }),
    ).toThrow(/already exists/);
  });
  it("keeps surviving order on roster changes, filters departed members and rejects outsiders", () => {
    let d = configured();
    d = apply(d, { id: "done", kind: "complete" });
    d.members = d.members.map((m) =>
      m.id === "jordan" ? { ...m, left_at: day } : m,
    );
    expect(upcomingGroceries(d.grocery!, d.members)[0].memberId).toBe("sam");
    d = apply(d, {
      ...config,
      id: "config2",
      participants: ["alex", "sam", "riley"],
      restockParticipants: ["alex", "sam"],
    });
    expect(d.grocery!.rotation!.queue).toEqual(["sam", "alex", "riley"]);
    expect(() => apply(d, { id: "outsider", kind: "skip" }, "unknown")).toThrow(
      /Join/,
    );
  });
  it.each([0, 366, 2.5, NaN])("rejects invalid interval %s", (days) => {
    expect(() => apply(initial(), { ...config, days })).toThrow(/interval/);
  });
  it("rejects malformed dates, inactive/duplicate participants, self swaps and request ID reuse", () => {
    expect(() => apply(initial(), { ...config, due: "2026-02-30" })).toThrow(
      /valid/,
    );
    expect(() =>
      apply(initial(), { ...config, participants: ["alex", "alex"] }),
    ).toThrow(/distinct/);
    let d = configured();
    expect(() =>
      apply(d, { id: "self", kind: "requestSwap", target: "alex" }),
    ).toThrow(/another/);
    expect(() => apply(d, { id: "configure", kind: "skip" })).toThrow(
      /already used/,
    );
  });
  it("links grocery expenses only to the completer and reopens deleted restock purchase records", () => {
    let d = configured();
    d = apply(d, { id: "trip", kind: "complete" });
    expect(() =>
      checkGroceryTripExpense(d, "demo-alex", {
        ...e,
        grocery_trip_id: "trip",
      }),
    ).not.toThrow();
    expect(() =>
      checkGroceryTripExpense(d, "demo-jordan", {
        ...e,
        grocery_trip_id: "trip",
      }),
    ).toThrow(/trip you completed/);
    d = apply(d, {
      id: "low",
      kind: "low",
      essentialId: d.grocery!.essentials[0].id,
      shoppingId: "shop",
    });
    d = completeGroceryRestock(d, "shop", e, "demo-jordan");
    d.shoppingItems = d.shoppingItems!.map((s) => ({ ...s, expense_id: e.id }));
    expect(
      reopenDeletedGroceryPurchase(d, e.id).grocery!.essentials[0],
    ).toMatchObject({ low: true, lastPurchased: null });
  });
  it("serializes concurrent local operations and recovers the queue after a rejected write", async () => {
    let inFlight = 0,
      max = 0;
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((i) =>
        groceryLocalLock(async () => {
          inFlight++;
          max = Math.max(max, inFlight);
          await Promise.resolve();
          order.push(i);
          inFlight--;
        }),
      ),
    );
    expect(max).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    await expect(
      groceryLocalLock(async () => {
        throw new Error("storage full");
      }),
    ).rejects.toThrow("storage full");
    expect(await groceryLocalLock(async () => true)).toBe(true);
  });
});
