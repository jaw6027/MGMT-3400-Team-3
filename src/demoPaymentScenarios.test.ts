import { it, expect } from "vitest";
import { demoPaymentScenario } from "./demoPaymentScenarios";
import { emptyPayments } from "./payments";
it("adds repeatable scenarios without changing real preview payments, dues, or methods", () => {
  const original = {
    ...emptyPayments,
    payments: [
      {
        id: "existing",
        recipient: "roommate",
        cents: 1000,
        fee: 0,
        status: "succeeded",
        created_at: "2026-11-19T12:00:00Z",
      },
    ],
    bankIssues: [
      {
        id: "existing-issue",
        state: "pending",
        message: "Existing pending verification",
      },
    ],
    notifications: [
      {
        id: "existing-notice",
        message: "Saved message",
        created_at: "2026-11-19",
      },
    ],
  };
  const processing = demoPaymentScenario(
    original,
    "processing",
    "roommate",
    "2026-11-19T12:00:00Z",
  );
  expect(processing.payments[0]).toMatchObject({
    status: "processing",
    funding: "bank",
    cents: 4200,
  });
  expect(
    demoPaymentScenario(processing, "processing", "roommate").payments,
  ).toHaveLength(2);
  const failed = demoPaymentScenario(processing, "failed", "roommate");
  expect(failed.payments[0].failureCode).toBe("insufficient_funds");
  const bank = demoPaymentScenario(failed, "bank", "roommate");
  expect(bank.bankIssues).toHaveLength(2);
  expect(bank.dues).toBe(original.dues);
  expect(bank.methods).toBe(original.methods);
  const cleared = demoPaymentScenario(bank, "clear", "roommate");
  expect(cleared.payments).toEqual(original.payments);
  expect(cleared.bankIssues).toEqual(original.bankIssues);
  expect(cleared.notifications).toEqual(original.notifications);
  expect(original.payments).toHaveLength(1);
});
