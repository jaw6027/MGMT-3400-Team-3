import { sampleHouseholdDocument } from "./demoDocuments";
import { describe, it, expect } from "vitest";
import {
  documentMatches,
  assertDocumentDuplicates,
  validateDocument,
} from "./documents";
import type { DocumentExpense } from "../supabase/functions/_shared/document-rules";
const expense = (id: string, hash = "a".repeat(64)): DocumentExpense => ({
  id,
  household_id: "home",
  name: `Purchase ${id}`,
  date: "2026-11-26",
  cents: 1000,
  store: "Green Market",
  receipt: `home/user/${id}.pdf`,
  receipt_document: {
    sha256: hash,
    mime: "application/pdf",
    name: `${id}.pdf`,
    kind: "utility",
    reference: "INV-123",
  },
});
describe("household document protection", () => {
  it("accepts images and PDF signatures, rejects spoofed types and oversized/empty documents", () => {
    validateDocument(
      "application/pdf",
      20,
      new TextEncoder().encode("%PDF-1.4 sample"),
    );
    validateDocument("image/png", 4, new Uint8Array([137, 80, 78, 71]));
    expect(() =>
      validateDocument("image/png", 20, new TextEncoder().encode("%PDF-1.4")),
    ).toThrow("contents");
    for (const [mime, size] of [
      ["text/html", 10],
      ["application/pdf", 0],
      ["application/pdf", 5242881],
    ] as const)
      expect(() => validateDocument(mime, size)).toThrow();
  });
  it("blocks byte-identical files regardless of filename, amount, date or uploader, within one household", () => {
    const old = expense("old"),
      candidate = { ...expense("new"), cents: 1234, date: "2026-01-01" };
    expect(documentMatches(candidate, [old]).exact).toEqual([old]);
    expect(() =>
      assertDocumentDuplicates(
        { ...candidate, duplicate_confirmations: [old.id] },
        [old],
      ),
    ).toThrow("Exact duplicate");
    expect(
      documentMatches(candidate, [{ ...old, household_id: "other" }]).exact,
    ).toEqual([]);
    expect(documentMatches(old, [old]).exact).toEqual([]);
  });
  it("warns on matching merchant/date/total or invoice identity and requires current matching IDs", () => {
    const old = expense("old"),
      candidate = expense("new", "b".repeat(64));
    candidate.store = "GREEN-MARKET";
    expect(documentMatches(candidate, [old]).suspected).toEqual([old]);
    expect(() => assertDocumentDuplicates(candidate, [old])).toThrow(
      "Possible duplicate",
    );
    expect(() =>
      assertDocumentDuplicates(
        { ...candidate, duplicate_confirmations: [old.id] },
        [old],
      ),
    ).not.toThrow();
    expect(() =>
      assertDocumentDuplicates(
        { ...candidate, duplicate_confirmations: [old.id] },
        [old, expense("concurrent", "c".repeat(64))],
      ),
    ).toThrow("Possible duplicate");
    expect(
      documentMatches({ ...candidate, date: "2026-12-31", cents: 5000 }, [old])
        .suspected,
    ).toEqual([old]);
    expect(
      documentMatches(
        {
          ...candidate,
          store: "Other provider",
          receipt_document: {
            ...candidate.receipt_document!,
            reference: "other",
          },
        },
        [old],
      ).suspected,
    ).toEqual([]);
  });
  it("detects unindexed legacy attachment paths, leaves manual-only entries compatible, and releases a deleted expense", () => {
    const old = { ...expense("old"), receipt_document: null };
    expect(
      documentMatches({ ...expense("new"), receipt: old.receipt }, [old]).exact,
    ).toHaveLength(1);
    expect(
      documentMatches(
        { ...expense("manual"), receipt: null, receipt_document: null },
        [old],
      ),
    ).toEqual({ exact: [], suspected: [] });
    expect(() => assertDocumentDuplicates(expense("new"), [])).not.toThrow();
  });
});

it("provides valid, deterministic sample PDFs with explicitly known facts, rather than an OCR claim", () => {
  const sample = sampleHouseholdDocument("mixed", "USD", "2026-11-26");
  const bytes = Uint8Array.from(atob(sample.asset.uri.split(",")[1]), (c) =>
    c.charCodeAt(0),
  );
  validateDocument("application/pdf", bytes.length, bytes);
  const text = new TextDecoder().decode(bytes);
  expect(text).toContain("Known sample facts. This is not an OCR result.");
  expect(text).toContain("Total: 33.00 USD");
  expect(sample.items.map((i) => i.category)).toEqual([
    "Groceries",
    "Household",
  ]);
  const pointer = Number(text.match(/startxref\n(\d+)/)![1]);
  expect(text.slice(pointer)).toMatch(/^xref/);
  expect(sampleHouseholdDocument("mixed", "USD", "2026-11-26").asset.uri).toBe(
    sample.asset.uri,
  );
});

it("allows correcting an existing historical duplicate without creating or changing its document identity", () => {
  const original = expense("original"),
    legacyCopy = expense("legacy");
  expect(() =>
    assertDocumentDuplicates(
      { ...original, name: "Corrected title", cents: 1100 },
      [original, legacyCopy],
    ),
  ).not.toThrow();
  const manual = {
    ...expense("manual"),
    receipt: null,
    receipt_document: null,
  };
  expect(() =>
    assertDocumentDuplicates(
      {
        ...manual,
        receipt: original.receipt,
        receipt_document: original.receipt_document,
      },
      [manual, original],
    ),
  ).toThrow("Exact duplicate");
});
