import { PaymentState } from "./payments";
export type DemoPaymentScenario = "processing" | "failed" | "bank" | "clear";
const prefix = "preview-scenario-";
export function demoPaymentScenario(
  state: PaymentState,
  scenario: DemoPaymentScenario,
  recipient: string,
  now = new Date().toISOString(),
): PaymentState {
  if (scenario === "clear")
    return {
      ...state,
      payments: state.payments.filter((p) => !p.id.startsWith(prefix)),
      bankIssues: state.bankIssues?.filter((p) => !p.id.startsWith(prefix)),
      notifications: state.notifications?.filter(
        (p) => !p.id.startsWith(prefix),
      ),
    };
  const id = prefix + scenario;
  const message =
    scenario === "processing"
      ? "Example payment is processing. Open Activity for its estimated bank-arrival window. No money moved."
      : scenario === "failed"
        ? "Example payment failed because of insufficient funds. Open Activity for the explanation and next step. No charge was attempted."
        : "Example linked bank needs attention. Review Accounts and update affected autopay schedules after reconnecting. No bank was disconnected.";
  const next = {
    ...state,
    notifications: [
      { id, message, created_at: now },
      ...(state.notifications || []).filter((n) => n.id !== id),
    ],
  };
  if (scenario === "bank")
    return {
      ...next,
      bankIssues: [
        {
          id,
          state: "missing",
          message:
            "Example checking •••• 6789 is no longer linked. Reconnect securely, complete verification, and review affected autopay schedules. This is a simulated bank issue.",
        },
        ...(state.bankIssues || []).filter((n) => n.id !== id),
      ],
    };
  return {
    ...next,
    payments: [
      {
        id,
        recipient,
        cents: scenario === "processing" ? 4200 : 7500,
        fee: 0,
        status: scenario === "processing" ? "processing" : "failed",
        funding: "bank",
        failureCode: scenario === "failed" ? "insufficient_funds" : undefined,
        created_at: now,
        methodLabel: "Example checking •••• 6789",
      },
      ...state.payments.filter((p) => p.id !== id),
    ],
  };
}
