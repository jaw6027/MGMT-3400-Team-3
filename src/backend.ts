import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { decode } from "base64-arraybuffer";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { Data, Expense, validateImage } from "./core";
import {
  browserPreviewEnabled,
  browserPreviewBackend,
  previewOrigin,
} from "./browserPreview";
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const liveConfigured = Boolean(url && key);
export const recoveryLinkAtStartup =
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
export const demoDefault =
  !browserPreviewEnabled &&
  !recoveryLinkAtStartup &&
  process.env.EXPO_PUBLIC_DEMO_MODE !== "false";
export const supabase =
  liveConfigured || browserPreviewEnabled
    ? createClient(
        browserPreviewEnabled ? previewOrigin : url!,
        browserPreviewEnabled ? "preview-public-key" : key!,
        {
          ...(browserPreviewEnabled
            ? { global: { fetch: browserPreviewBackend.fetch } }
            : {}),
          auth: {
            storage: AsyncStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: Platform.OS === "web",
          },
        },
      )
    : null;
if (Platform.OS !== "web" && supabase)
  AppState.addEventListener("change", (state) =>
    state === "active"
      ? supabase.auth.startAutoRefresh()
      : supabase.auth.stopAutoRefresh(),
  );
export const uid = () => Crypto.randomUUID();
export function client() {
  if (!supabase)
    throw new Error(
      "Live accounts need Supabase configuration. See the README, or explore demo mode.",
    );
  return supabase;
}
export async function loadData(): Promise<Data> {
  const c = client();
  const { data: mine, error: me } = await c
    .from("members")
    .select("household_id")
    .eq("user_id", (await c.auth.getUser()).data.user!.id)
    .is("left_at", null)
    .maybeSingle();
  if (me) throw me;
  if (!mine)
    return { household: null, members: [], expenses: [], repayments: [] };
  const id = mine.household_id;
  async function all(table: string, select = "*") {
    const rows: any[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await c
        .from(table)
        .select(select)
        .eq("household_id", id)
        .order("id")
        .range(offset, offset + 499);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 500) return rows;
    }
  }
  const { data: grocery, error: groceryError } = await c.rpc(
    "grocery_snapshot",
    { household_id: id },
  );
  if (groceryError)
    throw new Error(
      `Grocery rotation could not load. Apply the grocery migration and refresh. ${groceryError.message}`,
    );
  const [
    household,
    members,
    expenses,
    repayments,
    cashPayments,
    shoppingItems,
    chores,
    choreCompletions,
    splitTemplates,
  ] = await Promise.all([
    c.from("households").select("*").eq("id", id).single(),
    all("members"),
    all("expenses", "*,shares:expense_shares(member_id,cents)"),
    all("repayments"),
    all("cash_payments"),
    all("shopping_items"),
    all("chores"),
    all("chore_completions"),
    all("split_templates"),
  ]);
  if (household.error) throw household.error;
  return {
    grocery,
    household: household.data,
    members,
    expenses,
    repayments,
    cashPayments,
    shoppingItems,
    chores,
    choreCompletions,
    splitTemplates,
  };
}
export async function saveLiveExpense(e: Expense) {
  const { error } = await client().rpc("save_expense", { payload: e });
  if (error) throw error;
}
export async function receiptUrl(path: string) {
  if (
    path.startsWith("data:") ||
    path.startsWith("file:") ||
    path.startsWith("blob:")
  )
    return path;
  if (browserPreviewEnabled) {
    const { data, error } = await client().auth.getUser();
    if (error || !data.user)
      throw new Error("Log in to view this preview receipt.");
    return browserPreviewBackend.receipt(path, data.user.id);
  }
  const { data, error } = await client()
    .storage.from("receipts")
    .createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
export async function uploadReceipt(
  asset: { uri: string; mimeType?: string | null; fileSize?: number },
  household: string,
  userId: string,
) {
  let bytes: ArrayBuffer;
  if (Platform.OS === "web")
    bytes = await (await fetch(asset.uri)).arrayBuffer();
  else bytes = decode(await new File(asset.uri).base64());
  const type = asset.mimeType || "image/jpeg";
  validateImage(type, bytes.byteLength);
  const ext =
    type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const path = `${household}/${userId}/${uid()}.${ext}`;
  if (browserPreviewEnabled) {
    const { data, error } = await client().auth.getUser();
    if (error || data.user?.id !== userId)
      throw new Error("Log in to attach a preview receipt.");
    return browserPreviewBackend.upload(path, bytes, type, userId);
  }
  const { error } = await client()
    .storage.from("receipts")
    .upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw error;
  return path;
}
