import { expect, it } from "vitest";
import { spendingBreakdown, previousMonth } from "./spending";
it("totals each recorded expense once, groups dining history and filters calendar months", () => {
  const rows = [
    { cents: 1000, date: "2026-11-01", category: "Groceries" },
    { cents: 500, date: "2026-11-02", category: "Dining" },
    { cents: 500, date: "2026-11-03", category: "Food & drinks" },
    { cents: 9000, date: "2026-10-31", category: "Internet" },
  ];
  const report = spendingBreakdown(rows, "2026-11");
  expect(report.total).toBe(2000);
  expect(report.count).toBe(3);
  expect(report.rows.find((r) => r.category === "Dining")).toMatchObject({
    cents: 1000,
    count: 2,
    percent: 50,
  });
  expect(spendingBreakdown(rows).total).toBe(11000);
  expect(spendingBreakdown([], "2026-11")).toEqual({
    total: 0,
    count: 0,
    rows: [],
  });
  expect(previousMonth("2026-01-19")).toBe("2025-12");
});
