import type { SupabaseClient } from "@supabase/supabase-js";

export type HouseholdIntent =
  | { mode: "create"; name: string; currency: string }
  | { mode: "join"; code: string };
export type OnboardingStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
type HouseholdRpc = {
  rpc(
    name: string,
    args: Record<string, string>,
  ): PromiseLike<{ error: { message: string } | null }>;
};
export const pendingHouseholdKey = (email: string) =>
  `splitcart-household-signup-v1:${email.trim().toLowerCase()}`;
export function householdName(value: string) {
  const name = value.trim();
  if (!name || [...name].length > 80)
    throw new Error("Give your household a name between 1 and 80 characters.");
  return name;
}
export function normalizeHouseholdIntent(
  intent: HouseholdIntent,
): HouseholdIntent {
  if (intent.mode === "join") {
    const code = intent.code.replace(/\s/g, "").toLowerCase();
    if (!code || code.length > 128)
      throw new Error(
        "Enter the invitation code your roommate shared with you.",
      );
    return { mode: "join", code };
  }
  if (!["USD", "EUR", "GBP", "CAD", "AUD"].includes(intent.currency))
    throw new Error("Choose a supported household currency.");
  return {
    mode: "create",
    name: householdName(intent.name),
    currency: intent.currency,
  };
}
export async function pendingHousehold(
  storage: OnboardingStorage,
  email: string,
) {
  const raw = await storage.getItem(pendingHouseholdKey(email));
  if (!raw) return null;
  try {
    const intent = JSON.parse(raw);
    if (intent?.mode !== "join" && intent?.mode !== "create") throw new Error();
    return normalizeHouseholdIntent(intent as HouseholdIntent);
  } catch {
    await clearPendingHousehold(storage, email);
    return null;
  }
}
export const clearPendingHousehold = (
  storage: OnboardingStorage,
  email: string,
) => storage.removeItem(pendingHouseholdKey(email));

// Save before signUp: Supabase can emit SIGNED_IN before signUp resolves.
// Bind the intent to the account's email, never a global "next signup" slot.
export async function signUpWithHousehold(
  auth: Pick<SupabaseClient["auth"], "signUp">,
  storage: OnboardingStorage,
  input: {
    email: string;
    password: string;
    name: string;
    household: HouseholdIntent;
  },
) {
  const intent = normalizeHouseholdIntent(input.household);
  const name = input.name.trim();
  if (!name || [...name].length > 80)
    throw new Error("Enter your name, up to 80 characters.");
  const email = input.email.trim().toLowerCase();
  await storage.setItem(pendingHouseholdKey(email), JSON.stringify(intent));
  try {
    const { data, error } = await auth.signUp({
      email,
      password: input.password,
      options: { data: { name } },
    });
    if (error) throw error;
    return data;
  } catch (error) {
    await clearPendingHousehold(storage, email);
    throw error;
  }
}
export async function completeHouseholdSetup(
  backend: HouseholdRpc,
  intent: HouseholdIntent,
) {
  const value = normalizeHouseholdIntent(intent);
  const { error } = await backend.rpc("complete_household_setup", {
    setup_mode: value.mode,
    house_name: value.mode === "create" ? value.name : "",
    house_currency: value.mode === "create" ? value.currency : "USD",
    invitation_code: value.mode === "join" ? value.code : "",
  });
  if (error) throw new Error(error.message);
}
