import { client } from "./backend";
export async function paymentAction(
  action: string,
  payload: Record<string, unknown> = {},
) {
  const { data, error } = await client().functions.invoke("payments", {
    body: { ...payload, action },
  });
  if (error) {
    let message = "Payment service unavailable. Please try again later.";
    try {
      const body = await error.context?.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      /* non-JSON gateway response */
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
