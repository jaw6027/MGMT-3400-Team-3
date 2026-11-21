export type OutsideChannel = "venmo" | "zelle";
export function outsidePaymentName(channel?: string) {
  return channel === "venmo" ? "Venmo" : channel === "zelle" ? "Zelle" : "Cash";
}
export function externalPaymentUrl(channel: OutsideChannel, contact: string) {
  if (channel === "venmo") {
    const username = contact.trim().replace(/^@/, "");
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username))
      throw new Error(
        "Enter the recipient’s Venmo username, not a password or card number.",
      );
    return `https://venmo.com/u/${encodeURIComponent(username)}`;
  }
  const normalized = contact.trim();
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) &&
    !/^\+?1?[2-9]\d{9}$/.test(normalized.replace(/[\s().-]/g, ""))
  )
    throw new Error(
      "Enter the recipient’s enrolled Zelle email or US mobile number, and verify it with your roommate.",
    );
  return "https://www.zelle.com/get-started";
}
