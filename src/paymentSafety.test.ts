import { expect, it } from "vitest";
import {
  arrivalEstimate,
  failureExplanation,
  matchingPayment,
  safeFailureCode,
} from "../supabase/functions/_shared/payment-safety";
it("estimates distinct bank and card windows across weekends without claiming payout confirmation", () => {
  const created = "2026-11-20T12:00:00Z";
  expect(arrivalEstimate(created, "bank", "processing", 0)).toEqual({
    earliest: "2026-11-27",
    latest: "2026-12-03",
    overdue: false,
  });
  expect(arrivalEstimate(created, "credit", "succeeded", 0)?.earliest).toBe(
    "2026-11-24",
  );
  expect(arrivalEstimate(created, "bank", "failed")).toBeNull();
  expect(arrivalEstimate("invalid", "bank", "processing")).toBeNull();
  expect(arrivalEstimate(created, undefined, "processing")).toBeNull();
  expect(
    arrivalEstimate(created, "bank", "processing", Date.parse("2026-12-05"))
      ?.overdue,
  ).toBe(true);
});
it("detects active and recent completed duplicates independently of the selected payment method", () => {
  const now = Date.parse("2026-11-20T12:00:00Z"),
    p = {
      id: "one",
      recipient: "roommate",
      cents: 1000,
      status: "processing",
      created_at: "2025-01-01",
    };
  expect(matchingPayment([p], "roommate", 1000, now)).toBe(p);
  expect(matchingPayment([p], "roommate", 1001, now)).toBeUndefined();
  expect(matchingPayment([p], "other", 1000, now)).toBeUndefined();
  expect(matchingPayment([p], "roommate", 1000, now, "one")).toBeUndefined();
  expect(
    matchingPayment([{ ...p, status: "failed" }], "roommate", 1000, now),
  ).toBeUndefined();
  expect(
    matchingPayment(
      [{ ...p, status: "succeeded", created_at: "2026-11-20T11:55:00Z" }],
      "roommate",
      1000,
      now,
    ),
  ).toBeTruthy();
  expect(
    matchingPayment([{ ...p, status: "succeeded" }], "roommate", 1000, now),
  ).toBeUndefined();
});
it("uses safe provider codes and an honest fallback for unavailable failure causes", () => {
  expect(failureExplanation("insufficient_funds")).toContain(
    "insufficient funds",
  );
  expect(failureExplanation("account_closed")).toContain("closed");
  expect(failureExplanation(null)).toContain("did not give a specific reason");
  expect(
    safeFailureCode({
      code: "card_declined",
      decline_code: "insufficient_funds",
    }),
  ).toBe("insufficient_funds");
  expect(safeFailureCode({ code: "sensitive raw details 123" })).toBeNull();
});
