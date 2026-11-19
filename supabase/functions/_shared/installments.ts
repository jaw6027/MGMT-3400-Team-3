export type RequestOrder = { cents: number; status: string };
export function requestBalance(total: number, orders: RequestOrder[]) {
  const paidCents = orders
    .filter((p) => p.status === "succeeded")
    .reduce((n, p) => n + p.cents, 0);
  const pending = orders.filter((p) =>
    ["created", "processing", "requires_action"].includes(p.status),
  );
  const reservedCents = pending.reduce((n, p) => n + p.cents, 0);
  const reviewRequired = orders.some((p) =>
    ["refunded", "disputed"].includes(p.status),
  );
  const remainingCents = Math.max(0, total - paidCents);
  return {
    paidCents,
    reservedCents,
    remainingCents,
    reviewRequired,
    status: reviewRequired
      ? "review_required"
      : pending.length
        ? pending[0].status
        : remainingCents === 0
          ? "succeeded"
          : paidCents > 0
            ? "partial"
            : "open",
  };
}
export function validateInstallment(amount: number, remaining: number) {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 50 ||
    amount > remaining ||
    (remaining - amount > 0 && remaining - amount < 50)
  )
    throw new Error(
      "Pay up to the remaining balance and leave either zero or at least $0.50 outstanding.",
    );
}
export const RECURRING_CATEGORIES = [
  "Rent",
  "Internet",
  "Utilities",
  "Subscriptions",
  "Groceries",
  "Dining",
  "Household",
  "Other",
] as const;
