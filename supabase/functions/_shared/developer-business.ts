import { recentSecondFactor } from "./payment-rules.ts";
export const LEGAL_STRUCTURES = [
  "not_set",
  "corporation",
  "llc",
  "sole_proprietorship",
] as const;
export const TAX_CLASSIFICATIONS = [
  "not_set",
  "c_corporation",
  "s_corporation",
  "partnership",
  "disregarded_entity",
  "individual",
] as const;
export function developerVerificationExpiry(
  token: string,
  userId: string,
  now = Math.floor(Date.now() / 1000),
) {
  try {
    const raw = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(
      atob(raw.padEnd(Math.ceil(raw.length / 4) * 4, "=")),
    );
    if (claims.sub !== userId) return 0;
    const stamp = Math.max(
      0,
      ...(claims.amr || [])
        .filter(
          (m: any) => m.method === "password" && Number.isFinite(m.timestamp),
        )
        .map((m: any) => m.timestamp),
    );
    const second = recentSecondFactor(claims, now);
    return stamp <= now && now - stamp < 300 && second
      ? Math.min(stamp + 300, second)
      : 0;
  } catch {
    return 0;
  }
}
export function validateBusiness(input: any) {
  if (
    !input ||
    typeof input.legal_name !== "string" ||
    input.legal_name.trim().length > 160 ||
    !LEGAL_STRUCTURES.includes(input.legal_structure) ||
    !TAX_CLASSIFICATIONS.includes(input.tax_classification) ||
    !Number.isSafeInteger(input.version) ||
    input.version < 0
  )
    throw new Error("Enter valid business settings and refresh their version.");
  const allowed: Record<string, string[]> = {
    not_set: ["not_set"],
    corporation: ["not_set", "c_corporation", "s_corporation"],
    llc: [
      "not_set",
      "c_corporation",
      "s_corporation",
      "partnership",
      "disregarded_entity",
    ],
    sole_proprietorship: ["not_set", "individual"],
  };
  if (!allowed[input.legal_structure].includes(input.tax_classification))
    throw new Error(
      "Choose a tax classification consistent with the legal structure.",
    );
  return {
    legal_name: input.legal_name.trim(),
    legal_structure: input.legal_structure,
    tax_classification: input.tax_classification,
    version: input.version,
  };
}
