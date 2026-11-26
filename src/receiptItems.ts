import { spendingCategories } from "./documents";
import type { Share } from "./core";
export type ReceiptItem = {
  name: string;
  cents: number;
  members: string[];
  category?: string;
};
export type ReceiptDetails = {
  items: ReceiptItem[];
  taxCents: number;
  tipCents: number;
  discountCents: number;
  cashbackExpectedCents: number;
  cashbackReceivedCents: number;
  sourceTotalCents?: number;
};
export const emptyReceiptDetails = (): ReceiptDetails => ({
  items: [],
  taxCents: 0,
  tipCents: 0,
  discountCents: 0,
  cashbackExpectedCents: 0,
  cashbackReceivedCents: 0,
});
export function calculateReceipt(
  details: ReceiptDetails,
  allowedIds: string[],
) {
  if (
    !details ||
    !Array.isArray(details.items) ||
    !details.items.length ||
    details.items.length > 100
  )
    throw new Error("Add between 1 and 100 receipt items.");
  const weights = new Map<string, number>();
  let subtotal = 0;
  for (const item of details.items) {
    if (
      item.category !== undefined &&
      !spendingCategories.includes(item.category as any)
    )
      throw new Error("Choose a valid category for each receipt item.");
    if (
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 120 ||
      !Number.isSafeInteger(item.cents) ||
      item.cents < 1 ||
      item.cents > 100000000
    )
      throw new Error(
        "Give every receipt item a name and positive line total.",
      );
    if (
      !Array.isArray(item.members) ||
      !item.members.length ||
      new Set(item.members).size !== item.members.length ||
      item.members.some((id) => !allowedIds.includes(id))
    )
      throw new Error(
        "Assign every receipt item to at least one household member.",
      );
    for (const [index, member_id] of [...item.members].sort().entries()) {
      const cents =
        Math.floor(item.cents / item.members.length) +
        (index < item.cents % item.members.length ? 1 : 0);
      weights.set(member_id, (weights.get(member_id) || 0) + cents);
    }
    subtotal += item.cents;
  }
  for (const value of [
    details.taxCents,
    details.tipCents,
    details.discountCents,
    details.cashbackExpectedCents,
    details.cashbackReceivedCents,
  ])
    if (!Number.isSafeInteger(value) || value < 0 || value > 100000000)
      throw new Error(
        "Receipt adjustments and cashback must be nonnegative amounts.",
      );
  const total =
    subtotal + details.taxCents + details.tipCents - details.discountCents;
  if (
    subtotal > 100000000 ||
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > 100000000
  )
    throw new Error(
      "Check the receipt total and discount; the final amount must be positive and at most 1,000,000.",
    );
  if (
    details.sourceTotalCents !== undefined &&
    (!Number.isSafeInteger(details.sourceTotalCents) ||
      details.sourceTotalCents !== total)
  )
    throw new Error(
      "Receipt items and adjustments do not match the printed receipt total. Review the amounts before saving.",
    );
  if (
    details.cashbackExpectedCents > total ||
    details.cashbackReceivedCents > total
  )
    throw new Error("Tracked cashback cannot exceed this receipt’s total.");
  const parts = [...weights].map(([member_id, weight]) => {
    const product = BigInt(total) * BigInt(weight);
    return {
      member_id,
      cents: Number(product / BigInt(subtotal)),
      remainder: product % BigInt(subtotal),
    };
  });
  let remaining = total - parts.reduce((n, p) => n + p.cents, 0);
  parts.sort((a, b) =>
    a.remainder === b.remainder
      ? a.member_id.localeCompare(b.member_id)
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (const p of parts) {
    if (remaining <= 0) break;
    p.cents++;
    remaining--;
  }
  const shares: Share[] = parts
    .sort((a, b) => a.member_id.localeCompare(b.member_id))
    .map(({ member_id, cents }) => ({ member_id, cents }));
  return { subtotal, total, shares };
}
export type ReceiptDraft = {
  items: {
    name: string;
    amount: string;
    members: string[];
    category?: string;
  }[];
  tax: string;
  tip: string;
  discount: string;
  expected: string;
  received: string;
  printedTotal: string;
};
export function receiptDraft(
  details?: ReceiptDetails | null,
  memberIds: string[] = [],
): ReceiptDraft {
  const amount = (n?: number) => ((n || 0) / 100).toFixed(2);
  return {
    items: details?.items.map((i) => ({
      ...(i.category ? { category: i.category } : {}),
      name: i.name,
      amount: amount(i.cents),
      members: [...i.members],
    })) || [{ name: "", amount: "", members: memberIds }],
    tax: amount(details?.taxCents),
    tip: amount(details?.tipCents),
    discount: amount(details?.discountCents),
    expected: amount(details?.cashbackExpectedCents),
    received: amount(details?.cashbackReceivedCents),
    printedTotal:
      details?.sourceTotalCents === undefined
        ? ""
        : amount(details.sourceTotalCents),
  };
}
export function detailsFromDraft(draft: ReceiptDraft): ReceiptDetails {
  const cents = (value: string) => {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim()))
      throw new Error(
        "Use amounts with up to two decimal places for every receipt item and adjustment.",
      );
    const [whole, fraction = ""] = value.trim().split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  };
  return {
    items: draft.items.map((i) => ({
      ...(i.category ? { category: i.category } : {}),
      name: i.name.trim(),
      cents: cents(i.amount),
      members: i.members,
    })),
    taxCents: cents(draft.tax),
    tipCents: cents(draft.tip),
    discountCents: cents(draft.discount),
    cashbackExpectedCents: cents(draft.expected),
    cashbackReceivedCents: cents(draft.received),
    ...(draft.printedTotal.trim()
      ? { sourceTotalCents: cents(draft.printedTotal) }
      : {}),
  };
}
