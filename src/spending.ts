import { Expense } from "./core";
export function spendingBreakdown(
  expenses: Pick<Expense, "cents" | "category" | "date">[],
  month?: string,
) {
  const groups = new Map<string, { cents: number; count: number }>();
  for (const e of expenses) {
    if (month && e.date.slice(0, 7) !== month) continue;
    // Historical food categories stay intact in records and share one report row.
    const category =
      e.category === "Food & drinks" ? "Dining" : e.category || "Other";
    const row = groups.get(category) || { cents: 0, count: 0 };
    row.cents += e.cents;
    row.count++;
    groups.set(category, row);
  }
  const total = [...groups.values()].reduce((n, r) => n + r.cents, 0);
  return {
    total,
    count: [...groups.values()].reduce((n, r) => n + r.count, 0),
    rows: [...groups.entries()]
      .map(([category, row]) => ({
        category,
        ...row,
        percent: total ? (row.cents / total) * 100 : 0,
      }))
      .sort(
        (a, b) => b.cents - a.cents || a.category.localeCompare(b.category),
      ),
  };
}
export function previousMonth(date: string) {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}
