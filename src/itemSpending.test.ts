import { it, expect } from "vitest";
import { itemSpending, spendingBreakdown } from "./spending";
import { emptyReceiptDetails } from "./receiptItems";
const mixed = {
  id: "one",
  household_id: "home",
  created_at: "2026-11-26T00:00:00Z",
  date: "2026-11-26",
  cents: 3300,
  category: "Other",
  receipt_details: {
    ...emptyReceiptDetails(),
    items: [
      { name: "Groceries", cents: 1000, members: ["a"], category: "Groceries" },
      { name: "Soap", cents: 2000, members: ["a"], category: "Household" },
    ],
    taxCents: 300,
  },
};
it("counts mixed-category receipts once and allocates all adjustments, not cashback or roommate shares", () => {
  expect(itemSpending(mixed)).toEqual([
    { category: "Groceries", cents: 1100 },
    { category: "Household", cents: 2200 },
  ]);
  const report = spendingBreakdown([mixed], "2026-11");
  expect(report.total).toBe(3300);
  expect(report.count).toBe(1);
  expect(report.rows[0]).toMatchObject({
    category: "Household",
    cents: 2200,
    count: 1,
  });
  expect(report.rows.reduce((n, r) => n + r.percent, 0)).toBeCloseTo(100);
  for (let amount = 1; amount < 400; amount++) {
    const e = {
      ...mixed,
      cents: amount + 1,
      receipt_details: {
        ...mixed.receipt_details,
        items: [
          { name: "A", members: ["a"], cents: 1, category: "Dining" },
          { name: "B", members: ["a"], cents: amount, category: "Utilities" },
        ],
        taxCents: 9,
        tipCents: 2,
        discountCents: 11,
      },
    };
    expect(itemSpending(e).reduce((n, r) => n + r.cents, 0)).toBe(e.cents);
  }
});
it("keeps old categories and calendar filters; edits, category changes and deletions recalculate immediately", () => {
  const old = {
    id: "old",
    cents: 500,
    category: "Food & drinks",
    date: "2026-10-31",
  };
  expect(spendingBreakdown([old, mixed], "2026-11").total).toBe(3300);
  expect(spendingBreakdown([old, mixed], "2026-10").rows[0].category).toBe(
    "Dining",
  );
  const edited = {
    ...mixed,
    category: "Internet",
    receipt_details: null,
    cents: 1200,
  };
  expect(spendingBreakdown([edited]).rows).toEqual([
    { category: "Internet", cents: 1200, count: 1, percent: 100 },
  ]);
  expect(spendingBreakdown([]).total).toBe(0);
  const uncategorized = {
    ...mixed,
    receipt_details: {
      ...mixed.receipt_details,
      items: mixed.receipt_details.items.map(({ category, ...item }) => item),
    },
  };
  expect(spendingBreakdown([uncategorized]).rows[0]).toMatchObject({
    category: "Other",
    cents: 3300,
  });
});
it("deduplicates identities and historical document hashes before monthly filtering without deleting history", () => {
  const meta = {
    sha256: "a".repeat(64),
    mime: "application/pdf",
    name: "bill.pdf",
    kind: "utility" as const,
    reference: "123",
  };
  const original = { ...mixed, receipt_document: meta };
  const later = {
    ...original,
    id: "two",
    date: "2026-12-01",
    created_at: "2026-12-01T00:00:00Z",
  };
  expect(spendingBreakdown([later, original]).total).toBe(3300);
  expect(spendingBreakdown([later, original]).duplicatesExcluded).toBe(1);
  expect(spendingBreakdown([later, original], "2026-12").total).toBe(0);
  expect(spendingBreakdown([original, original]).total).toBe(3300);
  expect(
    spendingBreakdown([original, { ...later, household_id: "another" }]).total,
  ).toBe(6600);
  expect([later, original]).toHaveLength(2);
});
