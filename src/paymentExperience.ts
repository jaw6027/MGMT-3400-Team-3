import {
  failureExplanation,
  arrivalEstimate,
} from "../supabase/functions/_shared/payment-safety";
import { paymentStatus } from "../supabase/functions/_shared/payment-rules";
import { Due, Payment } from "./payments";
import {
  dueDate,
  nextMonthlyDate,
} from "../supabase/functions/_shared/payment-rules";
export {
  paymentStatus,
  shouldRemind,
  nextMonthlyDate,
} from "../supabase/functions/_shared/payment-rules";

export function upcomingPayment(due: Due, payments: Payment[], today: string) {
  let date = dueDate(today.slice(0, 7), due.day);
  const created = due.created_at?.slice(0, 10) || today;
  if (date < created)
    date = nextMonthlyDate(due.day, created > today ? created : today);
  let payment = payments.find((p) => p.dueId === due.id && p.dueDate === date);
  while (payment?.status === "succeeded") {
    date = nextMonthlyDate(
      due.day,
      new Date(Date.parse(`${date}T00:00:00Z`) + 86400000)
        .toISOString()
        .slice(0, 10),
    );
    payment = payments.find((p) => p.dueId === due.id && p.dueDate === date);
  }
  return {
    due,
    date,
    payment,
    overdue: date < today && !due.paused && !payment,
  };
}
export function nextChargeDate(due: Due, payments: Payment[], today: string) {
  if (due.paused || !due.automatic) return null;
  let date = nextMonthlyDate(due.day, today);
  while (payments.some((p) => p.dueId === due.id && p.dueDate === date))
    date = nextMonthlyDate(
      due.day,
      new Date(Date.parse(`${date}T00:00:00Z`) + 86400000)
        .toISOString()
        .slice(0, 10),
    );
  return date;
}
export function receiptText(
  payment: Payment,
  recipient: string,
  method: string,
  demo: boolean,
) {
  const amount = (n: number) => `$${(n / 100).toFixed(2)} USD`;
  return [
    "SplitCart payment receipt",
    demo ? "DEMO — no money moved" : "",
    `Reference: ${payment.id}`,
    `Date: ${payment.created_at}`,
    `Recipient: ${recipient}`,
    `Method: ${payment.methodLabel || method || "Unavailable (older payment)"}`,
    `Status: ${paymentStatus(payment.status).label}`,
    payment.status === "failed"
      ? `Why it failed: ${failureExplanation(payment.failureCode)}`
      : "",
    payment.recipient !== "app" &&
    arrivalEstimate(payment.created_at, payment.funding, payment.status)
      ? `Estimated recipient bank arrival: ${arrivalEstimate(payment.created_at, payment.funding, payment.status)!.earliest} – ${arrivalEstimate(payment.created_at, payment.funding, payment.status)!.latest}. Planning estimate only; bank holidays, reviews and payout schedules may delay arrival.`
      : "",
    `Payment amount: ${amount(payment.cents)}`,
    `Credit-card surcharge: ${amount(payment.fee)}`,
    `Total: ${amount(payment.cents + payment.fee)}`,
    payment.status === "succeeded"
      ? "Payment completed."
      : "This is a payment record, not proof of a completed payment.",
  ]
    .filter(Boolean)
    .join("\n");
}
