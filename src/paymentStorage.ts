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
export async function loadPaymentExperience(
  user: string,
  household: string,
  demo: boolean,
): Promise<PaymentState> {
  if (!demo) return paymentAction("status");
  const raw = await AsyncStorage.getItem(paymentKey(user, household));
  return {
    ...(raw
      ? JSON.parse(raw)
      : { ...emptyPayments, available: true, appDues: 500 }),
    requests: await demoRequests(household),
  };
}
