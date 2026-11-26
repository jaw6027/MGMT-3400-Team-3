import { browserPreviewEnabled } from "./browserPreview";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { paymentAction } from "./paymentApi";
import { emptyPayments, PaymentRequest, PaymentState } from "./payments";
export const paymentKey = (user: string, household: string) =>
  `splitcart-payments-demo-v1-${user}-${household}`;
const requestKey = (household: string) =>
  `splitcart-requests-demo-v1-${household}`;
export async function demoRequests(
  household: string,
): Promise<PaymentRequest[]> {
  return JSON.parse(
    (await AsyncStorage.getItem(requestKey(household))) || "[]",
  );
}
export async function saveDemoRequest(
  household: string,
  request: PaymentRequest,
) {
  const requests = await demoRequests(household);
  await AsyncStorage.setItem(
    requestKey(household),
    JSON.stringify([request, ...requests.filter((r) => r.id !== request.id)]),
  );
}
export async function demoHouseholdSubscriptionActivated(
  user: string,
  household: string,
) {
  const key = browserPreviewEnabled
    ? "splitcart-browser-preview-v1"
    : "splitcart-demo-v1";
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return false;
  const data = JSON.parse(raw);
  if (browserPreviewEnabled) {
    if (
      !data.members?.some(
        (m: any) =>
          m.user_id === user && m.household_id === household && !m.left_at,
      )
    )
      throw new Error("This household is unavailable.");
    return !!data.subscriptions?.[household]?.trial_started_at;
  }
  return (
    data.household?.id === household && !!data.subscription?.trial_started_at
  );
}
export async function assertNoPendingDemoAppDues(household: string) {
  const keys = (await AsyncStorage.getAllKeys()).filter(
    (k) =>
      k.startsWith("splitcart-payments-demo-v1-") &&
      k.endsWith(`-${household}`),
  );
  for (const key of keys) {
    const raw = await AsyncStorage.getItem(key);
    if (
      raw &&
      JSON.parse(raw).payments?.some(
        (p: any) =>
          p.recipient === "app" &&
          ["created", "processing", "requires_action"].includes(p.status),
      )
    ) {
      throw new Error(
        "Resolve the pending legacy app-dues payment before activating a subscription.",
      );
    }
  }
}
export async function loadPaymentExperience(
  user: string,
  household: string,
  demo: boolean,
): Promise<PaymentState> {
  if (!demo) return paymentAction("status");
  const raw = await AsyncStorage.getItem(paymentKey(user, household));
  const blocked = await demoHouseholdSubscriptionActivated(user, household);
  const state = {
    ...(raw
      ? JSON.parse(raw)
      : { ...emptyPayments, available: true, appDues: 500 }),
    requests: await demoRequests(household),
  };
  return blocked
    ? {
        ...state,
        appDues: 0,
        dues: state.dues.map((due: any) =>
          due.recipient === "app"
            ? { ...due, paused: true, automatic: false }
            : due,
        ),
      }
    : state;
}
