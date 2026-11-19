// Guidance only: eligibility is determined by Stripe and the specific account,
// not by a bank-name allowlist. Never collect raw account numbers in SplitCart.
export const BANK_NAMES = [
  "Wells Fargo",
  "Chase",
  "Bank of America",
  "Citibank",
  "Goldman Sachs",
  "Capital One",
  "US Bank",
  "PNC Bank",
] as const;
