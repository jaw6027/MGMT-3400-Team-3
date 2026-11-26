import { spendingCategories } from "./document-rules.ts";
export const receiptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    merchant: { type: "string" },
    reference: { type: "string" },
    documentKind: { type: "string", enum: ["receipt", "utility"] },
    date: { type: ["string", "null"] },
    currency: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          cents: { type: "integer" },
          category: { type: "string", enum: [...spendingCategories] },
        },
        required: ["name", "cents", "category"],
      },
    },
    taxCents: { type: "integer" },
    tipCents: { type: "integer" },
    discountCents: { type: "integer" },
    totalCents: { type: "integer" },
  },
  required: [
    "merchant",
    "reference",
    "documentKind",
    "date",
    "currency",
    "items",
    "taxCents",
    "tipCents",
    "discountCents",
    "totalCents",
  ],
};
export function validateExtraction(value: any, currency: string) {
  if (
    !value ||
    value.currency !== currency ||
    typeof value.merchant !== "string" ||
    value.merchant.length > 120 ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 100
  )
    throw new Error(
      "The receipt could not be read in your household currency. Enter the items manually.",
    );
  if (
    value.date !== null &&
    (typeof value.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
      !Number.isFinite(Date.parse(value.date)) ||
      new Date(value.date).toISOString().slice(0, 10) !== value.date)
  )
    throw new Error(
      "The receipt date could not be read. Enter receipt items manually.",
    );
  if (
    value.items.some(
      (i: any) =>
        !i ||
        typeof i.name !== "string" ||
        !i.name.trim() ||
        i.name.length > 120 ||
        !Number.isSafeInteger(i.cents) ||
        i.cents < 1 ||
        i.cents > 100000000,
    )
  )
    throw new Error(
      "Receipt line items could not be read reliably. Enter them manually.",
    );
  if (
    [
      value.taxCents,
      value.tipCents,
      value.discountCents,
      value.totalCents,
    ].some((n) => !Number.isSafeInteger(n) || n < 0 || n > 100000000) ||
    value.totalCents < 1
  )
    throw new Error(
      "Receipt totals could not be read reliably. Enter them manually.",
    );
  if (
    (value.reference !== undefined &&
      (typeof value.reference !== "string" || value.reference.length > 120)) ||
    (value.documentKind !== undefined &&
      !["receipt", "utility"].includes(value.documentKind)) ||
    value.items.some(
      (i: any) =>
        i.category !== undefined && !spendingCategories.includes(i.category),
    )
  )
    throw new Error(
      "Review the document reference and item categories manually.",
    );
  const calculated =
    value.items.reduce((n: number, i: any) => n + i.cents, 0) +
    value.taxCents +
    value.tipCents -
    value.discountCents;
  return {
    ...value,
    needsReview: true,
    totalsMatch: calculated === value.totalCents,
  };
}
