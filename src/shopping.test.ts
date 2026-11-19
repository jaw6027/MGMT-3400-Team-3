import { describe, it, expect } from "vitest";
import {
  canonicalShoppingItem,
  lastShoppingPurchase,
  shoppingCatalog,
  shoppingCategories,
  shoppingIdentity,
  suggestedShopper,
  validateShoppingItem,
} from "./shopping";
import { demoData } from "./demo";
import type { ShoppingItem } from "./core";
const draft = (changes: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: "list-1",
  household_id: "demo-house",
  ...canonicalShoppingItem("Milk", "Food"),
  assigned_to: "alex",
  one_time: false,
  expense_id: null,
  created_at: "2026-11-19T10:00:00Z",
  ...changes,
});
describe("workbook catalog and purchase memory", () => {
  it("imports all 61 items and eight original bold categories in workbook order", () => {
    expect(shoppingCatalog).toHaveLength(61);
    expect(new Set(shoppingCatalog.map((i) => i.id)).size).toBe(61);
    expect(shoppingCategories).toEqual([
      "Utilities",
      "Food",
      "Household Items",
      "Furniture",
      "Kitchen",
      "Bathroom",
      "Pet Supplies",
      "Subscription Services",
      "Other",
    ]);
    expect(
      shoppingCategories
        .slice(0, -1)
        .map((c) => shoppingCatalog.filter((i) => i.category === c).length),
    ).toEqual([4, 9, 12, 7, 11, 7, 5, 6]);
    expect(
      shoppingCatalog.some(
        (i) => i.name === "Home Décor" && i.category === "Furniture",
      ),
    ).toBe(true);
    expect(shoppingCatalog.at(-1)!.name).toBe("DoorDash");
  });
  it("recognizes catalog aliases and keeps custom names stable within their categories", () => {
    expect(canonicalShoppingItem("  mILK  ", "Food")).toEqual(
      canonicalShoppingItem("Milk", "Food", "food-milk"),
    );
    expect(
      shoppingIdentity(
        canonicalShoppingItem("  Hallway   Lightbulbs ", "Other"),
      ),
    ).toBe("custom:other:hallway lightbulbs");
    expect(canonicalShoppingItem("Soap", "Kitchen").item_key).not.toBe(
      canonicalShoppingItem("Soap", "Bathroom").item_key,
    );
    expect(() => canonicalShoppingItem("", "Other")).toThrow(/item name/);
    expect(() => canonicalShoppingItem("X", "Made-up category")).toThrow(
      /category/,
    );
  });
  it("requires a current assigned roommate and a boolean one-time choice", () => {
    const d = demoData();
    expect(() => validateShoppingItem(draft(), d.members)).not.toThrow();
    expect(() =>
      validateShoppingItem(draft({ assigned_to: "foreign" }), d.members),
    ).toThrow(/current roommate/);
    d.members[0].left_at = "2026-11-19";
    expect(() => validateShoppingItem(draft(), d.members)).toThrow(
      /current roommate/,
    );
  });
  it("does not confuse assignments with confirmed purchases or unrelated household items", () => {
    const d = demoData(),
      item = draft();
    expect(lastShoppingPurchase(item, [item], d.expenses)).toBeNull();
    expect(
      lastShoppingPurchase(
        item,
        [draft({ household_id: "other", expense_id: d.expenses[0].id })],
        d.expenses,
      ),
    ).toBeNull();
  });
  it("uses the latest actual payer and date, reflects edits, and ignores deleted receipts", () => {
    const d = demoData(),
      a = { ...d.expenses[0], id: "a", date: "2026-11-18", paid_by: "sam" },
      b = { ...d.expenses[0], id: "b", date: "2026-11-19", paid_by: "jordan" };
    const items = [
      draft({ expense_id: a.id, assigned_to: "alex" }),
      draft({ id: "list-2", expense_id: b.id }),
    ];
    expect(lastShoppingPurchase(draft(), items, [a, b])?.paid_by).toBe(
      "jordan",
    );
    expect(
      lastShoppingPurchase(draft(), items, [a, { ...b, paid_by: "riley" }])
        ?.paid_by,
    ).toBe("riley");
    expect(lastShoppingPurchase(draft(), items, [a])?.paid_by).toBe("sam");
  });
  it("suggests the next active roommate, without making up a first buyer or repeating one-time purchases", () => {
    const d = demoData();
    expect(suggestedShopper(null, d.members)).toBeNull();
    expect(suggestedShopper(d.expenses[0], d.members)?.id).toBe("jordan");
    expect(
      suggestedShopper({ ...d.expenses[0], one_time: true }, d.members),
    ).toBeNull();
    d.members[1].left_at = "2026-11-19";
    expect(suggestedShopper(d.expenses[0], d.members)?.id).toBe("riley");
  });
});
