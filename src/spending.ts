import type { Expense } from "./core";
import { spendingCategories } from "./documents";
type SpendingExpense = Pick<Expense, "cents" | "category" | "date"> &
  Partial<
    Pick<
      Expense,
      | "id"
      | "household_id"
      | "created_at"
      | "receipt_document"
      | "receipt_details"
    >
  >;
const reportCategory = (category: string) =>
  category === "Food & drinks" ? "Dining" : category || "Other";
/** Allocate the recorded expense total across item weights, including all adjustments exactly once. */
export function itemSpending(expense: SpendingExpense) {
  const details = expense.receipt_details;
  if (!details?.items?.length)
    return [
      { category: reportCategory(expense.category), cents: expense.cents },
    ];
  const subtotal = details.items.reduce((n, i) => n + i.cents, 0);
  if (
    !Number.isSafeInteger(subtotal) ||
    subtotal <= 0 ||
    details.items.some((i) => !Number.isSafeInteger(i.cents) || i.cents < 1) ||
    subtotal + details.taxCents + details.tipCents - details.discountCents !==
      expense.cents
  )
    return [
      { category: reportCategory(expense.category), cents: expense.cents },
    ];
  const parts = details.items.map((item, index) => {
    const product = BigInt(expense.cents) * BigInt(item.cents);
    return {
      index,
      category: reportCategory(
        item.category && spendingCategories.includes(item.category as any)
          ? item.category
          : expense.category,
      ),
      cents: Number(product / BigInt(subtotal)),
      remainder: product % BigInt(subtotal),
    };
  });
  let spare = expense.cents - parts.reduce((n, p) => n + p.cents, 0);
  parts.sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const part of parts) if (spare-- > 0) part.cents++;
  return parts
    .sort((a, b) => a.index - b.index)
    .map(({ category, cents }) => ({ category, cents }));
}
export function spendingBreakdown(expenses: SpendingExpense[], month?: string) {
  const groups = new Map<string, { cents: number; count: number }>(),
    seen = new Set<string>();
  let total = 0,
    count = 0,
    duplicatesExcluded = 0;
  // Canonical historical document records are chosen before date filtering.
  const ordered = expenses
    .map((e, index) => ({ e, index }))
    .sort(
      (a, b) =>
        (a.e.created_at || "").localeCompare(b.e.created_at || "") ||
        (a.e.id || "").localeCompare(b.e.id || "") ||
        a.index - b.index,
    );
  for (const { e } of ordered) {
    const scope = e.household_id || "",
      hash = e.receipt_document?.sha256;
    const keys = [
      ...(e.id ? [`id:${scope}:${e.id}`] : []),
      ...(hash ? [`file:${scope}:${hash}`] : []),
    ];
    if (keys.some((key) => seen.has(key))) {
      if (!month || e.date.slice(0, 7) === month) duplicatesExcluded++;
      continue;
    }
    keys.forEach((key) => seen.add(key));
    if (month && e.date.slice(0, 7) !== month) continue;
    total += e.cents;
    count++;
    const expenseGroups = new Map<string, number>();
    for (const part of itemSpending(e))
      expenseGroups.set(
        part.category,
        (expenseGroups.get(part.category) || 0) + part.cents,
      );
    for (const [category, cents] of expenseGroups) {
      const row = groups.get(category) || { cents: 0, count: 0 };
      row.cents += cents;
      row.count++;
      groups.set(category, row);
    }
  }
  return {
    total,
    count,
    ...(duplicatesExcluded ? { duplicatesExcluded } : {}),
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
