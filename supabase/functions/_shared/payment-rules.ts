// Shared by the app and the trusted payment service. Amounts are integer cents.
export type Funding = "bank" | "credit" | "debit";
export function quote(cents: number, funding: Funding) {
  if (!Number.isSafeInteger(cents) || cents < 50 || cents > 100000000)
    throw new Error("Payments must be between $0.50 and $1,000,000.");
  if (!["bank", "credit", "debit"].includes(funding))
    throw new Error("This payment method is not supported.");
  // 2.5% rounded to the nearest cent; no fee on ACH or debit.
  const fee = funding === "credit" ? Math.floor((cents * 25 + 500) / 1000) : 0;
  if (cents + fee > 99999999)
    throw new Error(
      "The payment including surcharge must not exceed $999,999.99.",
    );
  return { cents, fee, total: cents + fee };
}
export function dueDate(month: string, day: number) {
  if (
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 28
  )
    throw new Error("Choose a monthly due day from 1 to 28.");
  return `${month}-${String(day).padStart(2, "0")}`;
}
export function reminderDate(due: string, days: number) {
  if (![0, 1, 3, 7].includes(days))
    throw new Error("Choose 0, 1, 3, or 7 days before the due date.");
  const date = new Date(`${due}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
export function validateReminder(
  email: boolean,
  sms: boolean,
  phone: string,
  consent: boolean,
) {
  if ((email || sms) && !consent)
    throw new Error("Agree to receive payment reminders first.");
  if (sms && !/^\+[1-9]\d{7,14}$/.test(phone))
    throw new Error("Use an international phone number, such as +14155550123.");
}

export function paymentStatus(status: string) {
  const statuses: Record<
    string,
    { label: string; help: string; attention: boolean }
  > = {
    created: {
      label: "Pending",
      help: "Your payment is being prepared. Refresh its status before trying again.",
      attention: false,
    },
    processing: {
      label: "Processing",
      help: "Your bank is processing this payment. No action needed; balances update after confirmation.",
      attention: false,
    },
    requires_action: {
      label: "Action needed",
      help: "Complete your bank’s authentication, then refresh payment status.",
      attention: true,
    },
    succeeded: {
      label: "Completed",
      help: "Payment confirmed. The recipient’s payment amount is recorded in your balance.",
      attention: false,
    },
    failed: {
      label: "Failed",
      help: "Payment did not clear. Check your bank details and available funds. Review with support before paying this due again.",
      attention: true,
    },
    canceled: {
      label: "Canceled",
      help: "This payment was canceled. Review your balance before making a new payment.",
      attention: false,
    },
    refunded: {
      label: "Refunded",
      help: "The repayment credit has been removed. Contact support to reconcile your balance and refund.",
      attention: true,
    },
    disputed: {
      label: "Disputed",
      help: "The repayment credit has been removed. Contact support before sending another payment.",
      attention: true,
    },
  };
  return (
    statuses[status] || {
      label: "Status unavailable",
      help: "Refresh payment status before making another payment.",
      attention: true,
    }
  );
}

export function nextMonthlyDate(day: number, from: string) {
  const date = dueDate(from.slice(0, 7), day);
  if (date >= from) return date;
  const next = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return dueDate(next.toISOString().slice(0, 7), day);
}

export function shouldRemind(status: string | undefined, paused = false) {
  // Processing and disputed payments must not invite a second debit.
  return !paused && (!status || status === "canceled");
}

// Call only after the same token has been authenticated with Supabase getUser.
export function recentSecondFactor(claims: any, nowSeconds: number) {
  if (claims?.aal !== "aal2" || !Array.isArray(claims.amr)) return 0;
  const times = claims.amr
    .filter((a: any) => a.method === "totp" && Number.isFinite(a.timestamp))
    .map((a: any) => a.timestamp);
  const latest = Math.max(0, ...times);
  return latest <= nowSeconds && nowSeconds - latest < 300 ? latest + 300 : 0;
}
export function paymentEvent(status: string) {
  return status === "created" || status === "processing"
    ? "pending"
    : ["succeeded", "failed", "requires_action"].includes(status)
      ? status
      : null;
}
export function transferProgress(status: string) {
  if (status === "succeeded")
    return {
      step: 3,
      label: "Payment completed",
      detail:
        "Your payment was confirmed and the household balance was updated. The receiving bank’s payout schedule may still apply.",
    };
  if (status === "processing")
    return {
      step: 2,
      label: "Bank processing",
      detail:
        "The bank is processing this payment. No action needed; your roommate’s balance updates after confirmation.",
    };
  if (status === "created")
    return {
      step: 1,
      label: "Payment started",
      detail:
        "Waiting for the payment provider. Check status before paying again.",
    };
  return {
    step: 0,
    label: paymentStatus(status).label,
    detail: paymentStatus(status).help,
  };
}
