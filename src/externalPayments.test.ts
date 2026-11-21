import { expect, it } from "vitest";
import { externalPaymentUrl, outsidePaymentName } from "./externalPayments";
import { bankBrand, methodBrand } from "./paymentBrands";
import { paymentBrandAssets } from "./paymentBrandAssets";
import { CARD_NETWORKS } from "../supabase/functions/_shared/card-networks";
import { BANK_NAMES } from "../supabase/functions/_shared/bank-linking";
it("uses fixed provider destinations and validates recipient identifiers without treating navigation as payment", () => {
  expect(externalPaymentUrl("venmo", "@sample-roommate")).toBe(
    "https://venmo.com/u/sample-roommate",
  );
  expect(() => externalPaymentUrl("venmo", "https://evil.test/pay")).toThrow();
  expect(externalPaymentUrl("zelle", "roommate@example.test")).toBe(
    "https://www.zelle.com/get-started",
  );
  expect(externalPaymentUrl("zelle", "(415) 555-0123")).toBe(
    "https://www.zelle.com/get-started",
  );
  expect(() => externalPaymentUrl("zelle", "1234567812345678")).toThrow();
  expect(outsidePaymentName()).toBe("Cash");
});
it("bundles logos for all requested banks, cards and outside providers, while preserving unknown-method fallbacks", () => {
  for (const bank of BANK_NAMES)
    expect(paymentBrandAssets[bankBrand(bank)!]).toBeTruthy();
  for (const network of CARD_NETWORKS)
    expect(paymentBrandAssets[network.id]).toBeTruthy();
  expect(paymentBrandAssets.venmo).toBeTruthy();
  expect(paymentBrandAssets.zelle).toBeTruthy();
  expect(bankBrand("JPMORGAN CHASE BANK NA")).toBe("chase");
  expect(bankBrand("U.S. BANK N.A.")).toBe("us-bank");
  expect(bankBrand("Citizens Bank")).toBeUndefined();
  expect(bankBrand("Unknown community bank")).toBeUndefined();
  expect(
    methodBrand({
      brand: "amex",
      funding: "credit",
      label: "American Express",
    }),
  ).toBe("amex");
  expect(methodBrand({ funding: "bank", label: "Wells Fargo •••• 1234" })).toBe(
    "wells-fargo",
  );
  for (const asset of Object.values(paymentBrandAssets)) {
    if (asset.format === "svg") {
      expect(asset.content).toContain("<svg");
      expect(asset.content).not.toMatch(/<script|<foreignObject|<image\b/i);
    } else expect(asset.content).toMatch(/^data:image\/png;base64,/);
  }
});
