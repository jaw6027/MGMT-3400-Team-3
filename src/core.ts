import type { SplitTemplate } from "./splitTemplates";
import { percentageSplit } from "./percentageSplit";
import type { GroceryState } from "./grocery";
import { calculateReceipt } from "./receiptItems";
import type { ReceiptDetails } from "./receiptItems";
export type Member = {
  id: string;
  user_id: string;
  name: string;
  left_at?: string | null;
};
export type Share = { member_id: string; cents: number };
export type Expense = {
  grocery_trip_id?: string | null;
  receipt_details?: ReceiptDetails | null;
  split_percentages?: Parameters<typeof percentageSplit>[1] | null;
  one_time?: boolean;
  id: string;
  household_id: string;
  name: string;
  cents: number;
  date: string;
  paid_by: string;
  category: string;
  store: string;
  notes: string;
  receipt: string | null;
  shares: Share[];
  created_at: string;
};
export type Repayment = {
  method?: "cash" | "other" | "bank_card" | "venmo" | "zelle";
  id: string;
  household_id: string;
  from_id: string;
  to_id: string;
  cents: number;
  date: string;
  recorded_by?: string;
};
export type Household = {
  id: string;
  name: string;
  currency: string;
  invite_code: string;
};
export type CashPayment = Repayment & {
  channel?: "cash" | "venmo" | "zelle";
  status: "pending" | "confirmed" | "disputed";
  proposed_by: string;
  resolved_by?: string;
  resolved_at?: string;
  created_at: string;
};
export type ShoppingItem = {
  id: string;
  household_id: string;
  name: string;
  category: string;
  catalog_id: string | null;
  item_key: string;
  assigned_to: string;
  one_time: boolean;
  expense_id: string | null;
  created_at: string;
  created_by?: string;
};
export type Chore = {
  id: string;
  household_id: string;
  catalog_id: string | null;
  name: string;
  frequency: "Daily" | "Weekly" | "Biweekly" | "Monthly";
  assignment_mode: "fixed" | "rotate";
  member_ids: string[];
  assigned_to: string;
  next_due_date: string;
  archived: boolean;
  version: number;
  created_at: string;
  created_by?: string;
  updated_at?: string;
};
export type ChoreCompletion = {
  id: string;
  household_id: string;
  chore_id: string;
  chore_name: string;
  completed_by: string;
  recorded_by: string;
  completed_on: string;
  scheduled_for: string;
  scheduled_member_id: string;
  frequency: Chore["frequency"];
  assignment_mode: Chore["assignment_mode"];
  before_due_date: string;
  before_assigned_to: string;
  advanced_schedule: boolean;
  after_version: number;
  timezone: string;
  created_at: string;
  voided_at: string | null;
  voided_by?: string | null;
};
export type Data = {
  splitTemplates?: SplitTemplate[];
  grocery?: GroceryState;
  chores?: Chore[];
  choreCompletions?: ChoreCompletion[];
  shoppingItems?: ShoppingItem[];
  cashPayments?: CashPayment[];
  household: Household | null;
  members: Member[];
  expenses: Expense[];
  repayments: Repayment[];
};
export const categories = [
  "Rent",
  "Internet",
  "Subscriptions",
  "Dining",
  "Groceries",
  "Household",
  "Utilities",
  "Food & drinks",
  "Other",
];
export function parseMoney(input: string, allowZero = false): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(input.trim()))
    throw new Error("Enter an amount with up to two decimal places.");
  const [whole, fraction = ""] = input.trim().split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (
    !Number.isSafeInteger(cents) ||
    (allowZero ? cents < 0 : cents <= 0) ||
    cents > 100000000
  )
    throw new Error("Enter an amount between 0.01 and 1,000,000.");
  return cents;
}
export function equalSplit(cents: number, ids: string[]): Share[] {
  if (
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    !ids.length ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Choose at least one roommate and a valid total.");
  const sorted = [...ids].sort();
  return sorted.map((member_id, i) => ({
    member_id,
    cents: Math.floor(cents / ids.length) + (i < cents % ids.length ? 1 : 0),
  }));
}
export function customDollarShares(
  ids: string[],
  amounts: Record<string, string>,
): Share[] {
  return ids.map((member_id) => ({
    member_id,
    cents: parseMoney(amounts[member_id] || "", true),
  }));
}

export function validateShareTotal(cents: number, shares: Share[]) {
  if (shares.reduce((sum, share) => sum + share.cents, 0) !== cents)
    throw new Error("Shares must add up to the purchase total.");
}

export const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(new Date(value).getTime()) &&
  new Date(value).toISOString().slice(0, 10) === value;
export function validateExpense(e: Expense, members: Member[]) {
  if (e.receipt_details) {
    const calculated = calculateReceipt(
      e.receipt_details,
      members.map((m) => m.id),
    );
    const canonical = (shares: Share[]) =>
      JSON.stringify(
        [...shares].sort((a, b) => a.member_id.localeCompare(b.member_id)),
      );
    if (
      e.cents !== calculated.total ||
      canonical(e.shares) !== canonical(calculated.shares)
    )
      throw new Error(
        "Receipt item totals and roommate shares must match the purchase.",
      );
  }

  if (e.one_time !== undefined && typeof e.one_time !== "boolean")
    throw new Error("Choose whether this was a one-time purchase.");
  if (!e.name.trim() || e.name.trim().length > 120)
    throw new Error("Add an item name, up to 120 characters.");
  if (!Number.isSafeInteger(e.cents) || e.cents <= 0 || e.cents > 100000000)
    throw new Error("Enter a valid purchase total.");
  if (!validDate(e.date))
    throw new Error("Use a valid date in YYYY-MM-DD format.");
  if (!members.some((m) => m.id === e.paid_by))
    throw new Error("Choose who paid.");
  if (
    !e.shares.length ||
    new Set(e.shares.map((s) => s.member_id)).size !== e.shares.length
  )
    throw new Error("Choose unique roommates to split with.");
  if (
    e.shares.some(
      (s) =>
        !Number.isSafeInteger(s.cents) ||
        s.cents < 0 ||
        !members.some((m) => m.id === s.member_id),
    )
  )
    throw new Error("Check each roommate’s share.");
  validateShareTotal(e.cents, e.shares);
  if (e.split_percentages != null) {
    if (e.receipt_details)
      throw new Error("Choose either receipt items or percentage splitting.");
    const allocated = percentageSplit(e.cents, e.split_percentages);
    const shares = new Map(
      e.shares.map(({ member_id, cents }) => [member_id, cents]),
    );
    if (
      allocated.length !== shares.size ||
      new Set(allocated.map(({ member_id }) => member_id)).size !==
        shares.size ||
      allocated.some(({ member_id, cents }) => shares.get(member_id) !== cents)
    )
      throw new Error("Shares must match the roommate percentages.");
  }
  if (!categories.includes(e.category))
    throw new Error("Choose a valid category.");
  if (e.store.length > 120 || e.notes.length > 2000)
    throw new Error("Store or notes are too long.");
}
export function balances(
  members: Member[],
  expenses: Expense[],
  repayments: Repayment[],
): Record<string, number> {
  const result: Record<string, number> = Object.fromEntries(
    members.map((m) => [m.id, 0]),
  );
  for (const e of expenses) {
    result[e.paid_by] = (result[e.paid_by] || 0) + e.cents;
    for (const s of e.shares)
      result[s.member_id] = (result[s.member_id] || 0) - s.cents;
  }
  for (const r of repayments) {
    result[r.from_id] = (result[r.from_id] || 0) + r.cents;
    result[r.to_id] = (result[r.to_id] || 0) - r.cents;
  }
  return result;
}
export function settlements(balance: Record<string, number>) {
  const debtors = Object.entries(balance)
    .filter(([, n]) => n < 0)
    .map(([id, n]) => ({ id, n: -n }))
    .sort((a, b) => b.n - a.n);
  const creditors = Object.entries(balance)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, n }))
    .sort((a, b) => b.n - a.n);
  const result: { from_id: string; to_id: string; cents: number }[] = [];
  let i = 0,
    j = 0;
  while (i < debtors.length && j < creditors.length) {
    const cents = Math.min(debtors[i].n, creditors[j].n);
    result.push({ from_id: debtors[i].id, to_id: creditors[j].id, cents });
    debtors[i].n -= cents;
    creditors[j].n -= cents;
    if (!debtors[i].n) i++;
    if (!creditors[j].n) j++;
  }
  return result;
}
export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    cents / 100,
  );
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const canEdit = (userId: string, e: Expense, members: Member[]) =>
  members.some((m) => m.id === e.paid_by && m.user_id === userId && !m.left_at);
export function validateImage(type: string, size: number) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(type))
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  if (!size || size > 5 * 1024 * 1024)
    throw new Error("Choose an image smaller than 5 MB.");
}
