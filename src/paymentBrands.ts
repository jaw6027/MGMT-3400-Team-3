export type CardBrandId =
  "visa" | "mastercard" | "amex" | "discover" | "unionpay" | "jcb" | "diners";
export type BankBrandId =
  | "wells-fargo"
  | "chase"
  | "bank-of-america"
  | "citibank"
  | "goldman-sachs"
  | "capital-one"
  | "us-bank"
  | "pnc";
export type PaymentBrandId = CardBrandId | BankBrandId | "venmo" | "zelle";
export function bankBrand(label: string): BankBrandId | undefined {
  const id = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (id.includes("wellsfargo")) return "wells-fargo";
  if (id.includes("chase")) return "chase";
  if (id.includes("bankofamerica")) return "bank-of-america";
  if (id.includes("citibank") || id.includes("citigroup") || id === "citi")
    return "citibank";
  if (id.includes("goldmansachs")) return "goldman-sachs";
  if (id.includes("capitalone")) return "capital-one";
  if (id.includes("usbank") || id.includes("usbancorp")) return "us-bank";
  if (id.includes("pnc")) return "pnc";
  return undefined;
}
export function methodBrand(method: {
  brand?: string;
  funding: string;
  label: string;
}): PaymentBrandId | undefined {
  if (method.funding === "bank") return bankBrand(method.label);
  const known: CardBrandId[] = [
    "visa",
    "mastercard",
    "amex",
    "discover",
    "unionpay",
    "jcb",
    "diners",
  ];
  if (known.includes(method.brand as CardBrandId))
    return method.brand as CardBrandId;
  const label = method.label.toLowerCase();
  return (
    known.find((id) => new RegExp(`\\b${id}\\b`).test(label)) ||
    (label.includes("american express") ? "amex" : undefined)
  );
}
