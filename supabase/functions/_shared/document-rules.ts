/** Shared by native/web clients and private document services. Money is integer cents. */
export const spendingCategories = [
  "Rent",
  "Internet",
  "Subscriptions",
  "Dining",
  "Groceries",
  "Household",
  "Utilities",
  "Food & drinks",
  "Other",
] as const;
export type ReceiptDocument = {
  sha256: string;
  mime: string;
  name: string;
  kind: "receipt" | "utility";
  reference: string;
};
export const documentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];
export function validateDocument(
  type: string,
  size: number,
  bytes?: Uint8Array,
) {
  if (!documentTypes.includes(type))
    throw new Error("Choose a JPEG, PNG, WebP image or PDF document.");
  if (!size || size > 5 * 1024 * 1024)
    throw new Error("Choose a document up to 5 MB.");
  if (bytes) {
    const head = String.fromCharCode(...bytes.subarray(0, 12));
    const valid =
      type === "application/pdf"
        ? head.startsWith("%PDF-")
        : type === "image/png"
          ? bytes[0] === 137 && head.slice(1, 4) === "PNG"
          : type === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : head.startsWith("RIFF") && head.slice(8, 12) === "WEBP";
    if (!valid)
      throw new Error(
        "The file contents do not match its document type. Choose an original photo or PDF.",
      );
  }
}
export const normalizeDocumentText = (text?: string) =>
  (text || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export type DocumentExpense = {
  id: string;
  household_id: string;
  name: string;
  date: string;
  cents: number;
  store: string;
  receipt: string | null;
  receipt_document?: ReceiptDocument | null;
  duplicate_confirmations?: string[];
};
export function documentMatches(
  candidate: DocumentExpense,
  expenses: DocumentExpense[],
) {
  const exact: DocumentExpense[] = [],
    suspected: DocumentExpense[] = [];
  if (!candidate.receipt && !candidate.receipt_document?.reference)
    return { exact, suspected };
  const original = expenses.find(
    (e) => e.id === candidate.id && e.household_id === candidate.household_id,
  );
  const unchangedDocument =
    !!original &&
    ((!!candidate.receipt && original.receipt === candidate.receipt) ||
      (!!candidate.receipt_document?.sha256 &&
        original.receipt_document?.sha256 ===
          candidate.receipt_document.sha256));
  const merchant = normalizeDocumentText(candidate.store),
    reference = normalizeDocumentText(candidate.receipt_document?.reference);
  for (const other of expenses) {
    if (
      other.id === candidate.id ||
      other.household_id !== candidate.household_id
    )
      continue;
    if (
      (candidate.receipt && candidate.receipt === other.receipt) ||
      (candidate.receipt_document?.sha256 &&
        candidate.receipt_document.sha256 === other.receipt_document?.sha256)
    ) {
      if (!unchangedDocument) exact.push(other);
      continue;
    }
    const otherMerchant = normalizeDocumentText(other.store);
    const sameFacts =
      candidate.date === other.date && candidate.cents === other.cents;
    const sameMerchant = !!merchant && merchant === otherMerchant;
    const sameReference =
      !!reference &&
      reference === normalizeDocumentText(other.receipt_document?.reference);
    if (
      (sameMerchant && sameFacts) ||
      (sameReference &&
        (sameMerchant || (sameFacts && (!merchant || !otherMerchant))))
    )
      suspected.push(other);
  }
  return { exact, suspected };
}
export function assertDocumentDuplicates(
  candidate: DocumentExpense,
  expenses: DocumentExpense[],
) {
  const matches = documentMatches(candidate, expenses);
  if (matches.exact.length)
    throw new Error(
      `Exact duplicate document: already recorded as ${matches.exact[0].name}. Use the existing purchase; this file cannot create a second expense.`,
    );
  if (
    matches.suspected.some(
      (e) => !candidate.duplicate_confirmations?.includes(e.id),
    )
  )
    throw new Error(
      "Possible duplicate document. Review the matching household purchases and confirm these are different expenses.",
    );
}
export function validateDocumentReview(
  e: DocumentExpense & { document_reviewed?: boolean },
) {
  const doc = e.receipt_document;
  if (!doc) return;
  if (
    !e.receipt ||
    !/^[a-f0-9]{64}$/.test(doc.sha256) ||
    !documentTypes.includes(doc.mime) ||
    typeof doc.name !== "string" ||
    doc.name.length < 1 ||
    doc.name.length > 120 ||
    !["receipt", "utility"].includes(doc.kind) ||
    typeof doc.reference !== "string" ||
    doc.reference.length > 120
  )
    throw new Error("Attach and verify an original household document.");
  if (e.document_reviewed !== true)
    throw new Error("Review the document, date and total before saving.");
}
