// Stripe's card payment type accepts the enabled networks for the merchant's
// account/country. This is a display/demo catalog, deliberately not an allowlist.
export const CARD_NETWORKS = [
  { id: "visa", name: "Visa", sampleLast4: "4242" },
  { id: "mastercard", name: "Mastercard", sampleLast4: "4444" },
  { id: "amex", name: "American Express", sampleLast4: "0005" },
  { id: "discover", name: "Discover", sampleLast4: "1117" },
  { id: "unionpay", name: "UnionPay", sampleLast4: "0005" },
  { id: "jcb", name: "JCB", sampleLast4: "0505" },
  { id: "diners", name: "Diners Club International", sampleLast4: "5904" },
] as const;
export type CardNetworkId = (typeof CARD_NETWORKS)[number]["id"];
export function cardBrandName(brand?: string | null) {
  const id = (brand || "").toLowerCase();
  const network = CARD_NETWORKS.find((n) => n.id === id);
  if (network) return network.name;
  if (!id || id === "unknown") return "Card";
  // Keep future/provider-supported brands usable without a client release.
  return id.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
export function sampleCreditCard(brand: CardNetworkId) {
  const network = CARD_NETWORKS.find((n) => n.id === brand);
  if (!network) throw new Error("Choose a sample card network.");
  return {
    id: brand === "visa" ? "demo-card" : `demo-card-${brand}`,
    funding: "credit" as const,
    brand,
    label: `Demo ${network.name} credit •••• ${network.sampleLast4}`,
  };
}
