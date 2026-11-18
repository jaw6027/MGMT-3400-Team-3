import { expect, it } from "vitest";
import {
  upcomingPayment,
  nextChargeDate,
  paymentStatus,
  receiptText,
  shouldRemind,
} from "./paymentExperience";
import { Due, Payment } from "./payments";
const due: Due = {
  id: "due",
  recipient: "roommate",
  cents: 7500,
  day: 18,
  automatic: true,
  method: "bank",
  consent: true,
  created_at: "2026-10-01T12:00:00Z",
};
const payment: Payment = {
  id: "order",
  recipient: "roommate",
  cents: 7500,
  fee: 0,
  status: "succeeded",
  created_at: "2026-11-18T12:00:00Z",
  dueId: "due",
  dueDate: "2026-11-18",
  methodLabel: "Checking •••• 6789",
};
it("advances a cleared occurrence across year boundaries and preserves processing/failed dues", () => {
  expect(upcomingPayment(due, [payment], "2026-11-18").date).toBe("2026-12-18");
  expect(
    upcomingPayment(
      { ...due, day: 28 },
      [{ ...payment, dueDate: "2026-12-28" }],
      "2026-12-28",
    ).date,
  ).toBe("2027-01-28");
  for (const status of ["processing", "failed", "requires_action"]) {
    const item = upcomingPayment(due, [{ ...payment, status }], "2026-11-20");
    expect(item.date).toBe("2026-11-18");
    expect(item.payment?.status).toBe(status);
  }
  expect(upcomingPayment(due, [], "2026-11-20").overdue).toBe(true);
  expect(
    upcomingPayment(
      { ...due, created_at: "2026-11-20T00:00:00Z" },
      [],
      "2026-11-20",
    ).date,
  ).toBe("2026-12-18");
});
it("does not claim a second automatic charge in an existing occurrence, including failures", () => {
  expect(nextChargeDate(due, [], "2026-11-18")).toBe("2026-11-18");
  expect(
    nextChargeDate(due, [{ ...payment, status: "failed" }], "2026-11-18"),
  ).toBe("2026-12-18");
  expect(nextChargeDate({ ...due, paused: true }, [], "2026-11-18")).toBeNull();
});
it("suppresses pay reminders for cleared, processing, failed, disputed and paused occurrences", () => {
  for (const status of [
    "succeeded",
    "created",
    "processing",
    "requires_action",
    "failed",
    "refunded",
    "disputed",
  ])
    expect(shouldRemind(status)).toBe(false);
  expect(shouldRemind(undefined)).toBe(true);
  expect(shouldRemind("canceled")).toBe(true);
  expect(shouldRemind(undefined, true)).toBe(false);
});
it("labels provider states and exports honest receipts without full bank/card details", () => {
  expect(paymentStatus("created").label).toBe("Pending");
  expect(paymentStatus("succeeded").label).toBe("Completed");
  expect(paymentStatus("failed").attention).toBe(true);
  const receipt = receiptText(payment, "Jordan", "", true);
  expect(receipt).toContain("DEMO — no money moved");
  expect(receipt).toContain("Checking •••• 6789");
  expect(receipt).toContain("Total: $75.00 USD");
  expect(
    receiptText({ ...payment, status: "processing" }, "Jordan", "", false),
  ).toContain("not proof of a completed payment");
});

it("requires a recent verified authenticator claim and maps honest transfer steps", async () => {
  const { recentSecondFactor, transferProgress, paymentEvent } =
    await import("../supabase/functions/_shared/payment-rules");
  expect(
    recentSecondFactor(
      { aal: "aal1", amr: [{ method: "totp", timestamp: 900 }] },
      1000,
    ),
  ).toBe(0);
  expect(
    recentSecondFactor(
      { aal: "aal2", amr: [{ method: "password", timestamp: 999 }] },
      1000,
    ),
  ).toBe(0);
  expect(
    recentSecondFactor(
      { aal: "aal2", amr: [{ method: "totp", timestamp: 699 }] },
      1000,
    ),
  ).toBe(0);
  expect(
    recentSecondFactor(
      { aal: "aal2", amr: [{ method: "totp", timestamp: 1001 }] },
      1000,
    ),
  ).toBe(0);
  expect(
    recentSecondFactor(
      { aal: "aal2", amr: [{ method: "totp", timestamp: 900 }] },
      1000,
    ),
  ).toBe(1200);
  expect(paymentEvent("created")).toBe("pending");
  expect(paymentEvent("processing")).toBe("pending");
  expect(paymentEvent("succeeded")).toBe("succeeded");
  expect(paymentEvent("refunded")).toBeNull();
  expect(transferProgress("processing").step).toBe(2);
  expect(transferProgress("succeeded").step).toBe(3);
  expect(transferProgress("failed").label).toBe("Failed");
  expect(transferProgress("succeeded").detail).toContain("payout schedule");
});
