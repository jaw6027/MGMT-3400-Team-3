import { expect, it } from "vitest";
import {
  calculateReceipt,
  emptyReceiptDetails,
  detailsFromDraft,
  receiptDraft,
} from "./receiptItems";
import { validateExpense, Expense } from "./core";
it("assigns item costs and distributes tax, tips and discounts exactly without subtracting external cashback", () => {
  const details = {
    ...emptyReceiptDetails(),
    items: [
      { name: "Shared groceries", cents: 3000, members: ["a", "b"] },
      { name: "Personal item", cents: 1000, members: ["b"] },
    ],
    taxCents: 400,
    tipCents: 200,
    discountCents: 600,
    cashbackExpectedCents: 200,
    cashbackReceivedCents: 100,
  };
  expect(calculateReceipt(details, ["a", "b"])).toEqual({
    subtotal: 4000,
    total: 4000,
    shares: [
      { member_id: "a", cents: 1500 },
      { member_id: "b", cents: 2500 },
    ],
  });
  expect(detailsFromDraft(receiptDraft(details))).toEqual(details);
  expect(
    calculateReceipt(
      {
        ...details,
        items: [{ name: "Odd total", cents: 99, members: ["a", "b"] }],
        taxCents: 1,
        tipCents: 0,
        discountCents: 0,
        cashbackExpectedCents: 0,
        cashbackReceivedCents: 0,
      },
      ["a", "b"],
    ).shares,
  ).toEqual([
    { member_id: "a", cents: 51 },
    { member_id: "b", cents: 49 },
  ]);
});
it("rejects missing assignments, mismatched printed totals, invalid money, and reward claims above receipt value", () => {
  const d = {
    ...emptyReceiptDetails(),
    items: [{ name: "Groceries", cents: 1000, members: ["a"] }],
  };
  expect(() =>
    calculateReceipt({ ...d, items: [{ ...d.items[0], members: [] }] }, ["a"]),
  ).toThrow("Assign");
  expect(() =>
    calculateReceipt({ ...d, sourceTotalCents: 999 }, ["a"]),
  ).toThrow("printed");
  expect(() =>
    calculateReceipt({ ...d, cashbackReceivedCents: 1001 }, ["a"]),
  ).toThrow("cashback");
  expect(() =>
    detailsFromDraft({ ...receiptDraft(d), tax: "1.999" }),
  ).toThrow();
  const expense = {
    id: "e",
    household_id: "h",
    name: "Market",
    cents: 1000,
    date: "2026-11-19",
    paid_by: "a",
    category: "Groceries",
    store: "",
    notes: "",
    receipt: null,
    created_at: "2026-11-19",
    shares: [{ member_id: "a", cents: 1000 }],
    receipt_details: d,
  } satisfies Expense;
  expect(() =>
    validateExpense(expense, [{ id: "a", name: "Alex", user_id: "u" }]),
  ).not.toThrow();
  expect(() =>
    validateExpense({ ...expense, cents: 1001 }, [
      { id: "a", name: "Alex", user_id: "u" },
    ]),
  ).toThrow("Receipt item totals");
});
it("keeps proportional allocations deterministic and totals exact over varying cent amounts", () => {
  for (let cents = 1; cents < 120; cents++) {
    const details = {
      ...emptyReceiptDetails(),
      items: [{ name: "Item", cents, members: ["b", "a"] }],
      taxCents: 7,
      tipCents: 2,
      discountCents: 1,
    };
    const result = calculateReceipt(details, ["a", "b"]);
    expect(result.shares.reduce((n, p) => n + p.cents, 0)).toBe(cents + 8);
    expect(
      calculateReceipt(
        { ...details, items: [{ ...details.items[0], members: ["a", "b"] }] },
        ["a", "b"],
      ).shares,
    ).toEqual(result.shares);
  }
});
