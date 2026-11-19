import { expect, it } from "vitest";
import {
  CARD_NETWORKS,
  cardBrandName,
  sampleCreditCard,
} from "../supabase/functions/_shared/card-networks";
import { quote } from "./payments";
it("names all seven requested networks and keeps their saved demo cards distinct", () => {
  expect(CARD_NETWORKS.map((n) => n.name)).toEqual([
    "Visa",
    "Mastercard",
    "American Express",
    "Discover",
    "UnionPay",
    "JCB",
    "Diners Club International",
  ]);
  const cards = CARD_NETWORKS.map((n) => sampleCreditCard(n.id));
  expect(new Set(cards.map((c) => c.id)).size).toBe(7);
  for (const network of CARD_NETWORKS) {
    expect(cardBrandName(network.id)).toBe(network.name);
    const card = sampleCreditCard(network.id);
    expect(card.label).toContain(network.name);
    expect(card.label).toContain("••••");
    expect(quote(10000, card.funding).fee).toBe(250);
  }
  expect(sampleCreditCard("visa").id).toBe("demo-card");
});
it("formats provider brand names without rejecting future networks or guessing funding", () => {
  expect(cardBrandName("amex")).toBe("American Express");
  expect(cardBrandName("jcb")).toBe("JCB");
  expect(cardBrandName("diners")).toBe("Diners Club International");
  expect(cardBrandName("cartes_bancaires")).toBe("Cartes Bancaires");
  expect(cardBrandName(null)).toBe("Card");
  expect(cardBrandName("unknown")).toBe("Card");
  expect(() => quote(10000, "unknown" as any)).toThrow();
  expect(quote(10000, "debit").fee).toBe(0);
});

import { BANK_NAMES } from "../supabase/functions/_shared/bank-linking";
it("offers all eight requested banks without bypassing account verification", () => {
  expect(BANK_NAMES).toEqual([
    "Wells Fargo",
    "Chase",
    "Bank of America",
    "Citibank",
    "Goldman Sachs",
    "Capital One",
    "US Bank",
    "PNC Bank",
  ]);
});
