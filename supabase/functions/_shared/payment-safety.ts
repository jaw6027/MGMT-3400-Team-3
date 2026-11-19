export const DUPLICATE_MESSAGE =
  "Possible duplicate payment. Check Activity and pending cash confirmations before paying again. A matching completed payment is protected for 10 minutes.";
export function matchingPayment(
  rows: {
    id: string;
    recipient: string;
    cents: number;
    status: string;
    created_at: string;
    completed_at?: string | null;
    requestId?: string;
  }[],
  recipient: string,
  cents: number,
  now = Date.now(),
  excludeId?: string,
  requestId?: string,
) {
  return rows.find(
    (p) =>
      p.id !== excludeId &&
      p.recipient === recipient &&
      p.cents === cents &&
      (["created", "processing", "requires_action"].includes(p.status) ||
        (p.status === "succeeded" &&
          !(requestId && p.requestId === requestId) &&
          Date.parse(p.completed_at || p.created_at) > now - 600000)),
  );
}
// Only return curated explanations. Provider messages can include private data.
export function failureExplanation(code?: string | null) {
  switch (code) {
    case "insufficient_funds":
      return "There were insufficient funds. Check your available balance, then refresh this payment before making a new attempt.";
    case "account_closed":
    case "bank_account_closed":
      return "The bank account is closed. Link and verify another eligible account before paying again.";
    case "invalid_account_number":
    case "no_account":
    case "invalid_routing_number":
      return "The bank could not validate the account details. Relink the account securely and complete verification.";
    case "debit_not_authorized":
    case "debit_not_authorized_match":
    case "bank_account_restricted":
    case "account_frozen":
      return "The bank did not authorize this debit. Contact your bank and review the account before using another payment method.";
    case "expired_card":
      return "The card has expired. Add an up-to-date card and check the original payment status before paying again.";
    case "incorrect_cvc":
    case "incorrect_number":
      return "The card details could not be verified. Update them on the secure provider page.";
    case "authentication_required":
      return "Your bank requires authentication. Open the original payment’s authentication step rather than creating a second payment.";
    case "card_declined":
    case "generic_decline":
    case "do_not_honor":
      return "The issuer declined the payment without a specific reason. Contact the issuer or choose another method after checking Activity.";
    case "processing_error":
      return "The provider could not process the payment. Refresh its status and check your bank before trying again.";
    default:
      return "The provider did not give a specific reason. Refresh payment status and contact your bank or support with the payment reference before retrying.";
  }
}
export function safeFailureCode(
  error?: { code?: string | null; decline_code?: string | null } | null,
) {
  const code = error?.decline_code || error?.code;
  return code && /^[a-z_]{1,80}$/.test(code) ? code : null;
}
// This is a planning estimate, NOT a confirmed destination-bank payout date.
// Weekends are excluded; holidays, first payouts and bank reviews may add time.
export function arrivalEstimate(
  created: string,
  funding?: string,
  status?: string,
  now = Date.now(),
) {
  if (!["created", "processing", "succeeded"].includes(status || ""))
    return null;
  const start = new Date(created);
  if (!Number.isFinite(start.getTime()) || !funding) return null;
  const add = (days: number) => {
    const d = new Date(start);
    while (days) {
      d.setUTCDate(d.getUTCDate() + 1);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days--;
    }
    return d.toISOString().slice(0, 10);
  };
  const earliest = add(funding === "bank" ? 5 : 2),
    latest = add(funding === "bank" ? 9 : 5);
  return { earliest, latest, overdue: now > Date.parse(latest + "T23:59:59Z") };
}
