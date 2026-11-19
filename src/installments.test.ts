import { expect, it } from "vitest";
import {
  requestBalance,
  validateInstallment,
} from "../supabase/functions/_shared/installments";
import { matchingPayment } from "../supabase/functions/_shared/payment-safety";
it("tracks confirmed principal separately from fees, processing reservations, and remaining debt", () => {
  expect(
    requestBalance(10000, [
      { cents: 3000, status: "succeeded" },
      { cents: 2000, status: "processing" },
      { cents: 4000, status: "failed" },
    ]),
  ).toMatchObject({
    paidCents: 3000,
    reservedCents: 2000,
    remainingCents: 7000,
    status: "processing",
  });
  expect(
    requestBalance(10000, [{ cents: 3000, status: "succeeded" }]).status,
  ).toBe("partial");
  expect(
    requestBalance(10000, [
      { cents: 3000, status: "succeeded" },
      { cents: 7000, status: "succeeded" },
    ]).status,
  ).toBe("succeeded");
  expect(
    requestBalance(10000, [{ cents: 3000, status: "refunded" }]).reviewRequired,
  ).toBe(true);
  expect(() => validateInstallment(10001, 10000)).toThrow();
  expect(() => validateInstallment(9999, 10000)).toThrow();
  expect(() => validateInstallment(10000, 10000)).not.toThrow();
});
it("allows equal cleared installments on the same capped request without weakening unrelated duplicate checks", () => {
  const p = {
    id: "p",
    requestId: "r",
    cents: 5000,
    recipient: "roommate",
    status: "succeeded",
    created_at: new Date().toISOString(),
  };
  expect(
    matchingPayment([p], "roommate", 5000, Date.now(), undefined, "r"),
  ).toBeUndefined();
  expect(matchingPayment([p], "roommate", 5000)).toBe(p);
  expect(
    matchingPayment(
      [{ ...p, status: "processing" }],
      "roommate",
      5000,
      Date.now(),
      undefined,
      "r",
    ),
  ).toBeTruthy();
});
