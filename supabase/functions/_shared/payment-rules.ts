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
