import { validateDocument } from "./documents";
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { AppState, Linking, Platform } from "react-native";
import { decode } from "base64-arraybuffer";
import { File } from "expo-file-system";
import * as Crypto from "expo-crypto";
import { Data, Expense } from "./core";
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
    templateData,
    percentageSplitsAvailable,
    subscriptionResult,
  ] = await Promise.all([
    c.from("households").select("*").eq("id", id).single(),
    all("members"),
    all("expenses", "*,shares:expense_shares(member_id,cents)"),
    all("repayments"),
    all("cash_payments"),
    all("shopping_items"),
    all("chores"),
    all("chore_completions"),
    // Optional schema must never block existing household data from loading.
    all("split_templates")
      .then((rows) => ({ rows, available: true }))
      .catch(() => ({ rows: [], available: false })),
    c
      .from("expenses")
      .select("split_percentages")
      .eq("household_id", id)
      .limit(0)
      .then(
        ({ error }) => !error,
        () => false,
      ),
    c.rpc("household_subscription_snapshot", { household_id: id }).then(
      ({ data, error }) => ({
        subscription: error ? undefined : data,
        available: !error,
      }),
      () => ({ subscription: undefined, available: false }),
    ),
  ]);
  if (household.error) throw household.error;
  return {
    subscription: subscriptionResult.subscription,
    subscriptionsAvailable: subscriptionResult.available,
    grocery,
    household: household.data,
    members,
    expenses,
    repayments,
    cashPayments,
    shoppingItems,
    chores,
    choreCompletions,
    percentageSplitsAvailable,
    splitTemplatesAvailable:
      percentageSplitsAvailable && templateData.available,
    splitTemplates: percentageSplitsAvailable ? templateData.rows : [],
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
  asset: import("./documents").DocumentAsset,
  household: string,
  userId: string,
) {
  const bytes = await readDocumentBytes(asset);
  const type = asset.mimeType || "image/jpeg";
  validateDocument(type, bytes.byteLength, new Uint8Array(bytes));
  const ext =
    type === "application/pdf"
      ? "pdf"
      : type === "image/png"
        ? "png"
        : type === "image/webp"
          ? "webp"
          : "jpg";
  const path = `${household}/${userId}/${uid()}.${ext}`;
  if (browserPreviewEnabled) {
    const { data, error } = await client().auth.getUser();
    if (error || data.user?.id !== userId)
      throw new Error("Log in to attach a preview receipt.");
    return browserPreviewBackend.upload(
      path,
      bytes,
      type,
      userId,
      asset.name || asset.fileName || "Household document",
    );
  }
  const { error } = await client()
    .storage.from("receipts")
    .upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw error;
  return path;
}

/** Read original bytes; hashes never depend on the file name or selected plan. */
export async function readDocumentBytes(
  asset: import("./documents").DocumentAsset,
) {
  if (asset.uri.startsWith("data:")) {
    const comma = asset.uri.indexOf(",");
    if (!asset.uri.slice(0, comma).endsWith(";base64"))
      throw new Error("Choose an original image or PDF file.");
    return decode(asset.uri.slice(comma + 1));
  }
  if (Platform.OS === "web") return (await fetch(asset.uri)).arrayBuffer();
  return decode(await new File(asset.uri).base64());
}
export async function prepareDocument(
  asset: import("./documents").DocumentAsset,
  household: string,
  userId: string,
  localOnly = false,
) {
  const bytes = await readDocumentBytes(asset);
  const mime =
    asset.mimeType ||
    (asset.name?.toLowerCase().endsWith(".pdf")
      ? "application/pdf"
      : "image/jpeg");
  validateDocument(mime, bytes.byteLength, new Uint8Array(bytes));
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes,
  );
  const sha256 = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  let document: import("./documents").ReceiptDocument = {
    sha256,
    mime,
    name: (asset.name || asset.fileName || "Household document").slice(0, 120),
    kind: "receipt",
    reference: "",
  };
  if (localOnly) {
    let binary = "";
    const values = new Uint8Array(bytes);
    for (let i = 0; i < values.length; i += 8192)
      binary += String.fromCharCode(...values.subarray(i, i + 8192));
    return { path: `data:${mime};base64,${btoa(binary)}`, document };
  }
  const path = await uploadReceipt(
    { ...asset, mimeType: mime },
    household,
    userId,
  );
  if (!browserPreviewEnabled) {
    const result = await client().functions.invoke("verify-document", {
      body: {
        household_id: household,
        receipt_path: path,
        file_name: document.name,
      },
    });
    if (result.error || !result.data?.sha256) {
      let message =
        "Document verification is unavailable. Deploy verify-document and the document migration before attaching files. Manual expenses still work.";
      try {
        const body = await result.error?.context?.json();
        if (body?.error) message = body.error;
      } catch {}
      throw new Error(message);
    }
    document = { ...document, ...result.data };
  }
  return { path, document };
}

/** Web uses a new tab; native demo data PDFs use the device's PDF/share applications. */
export async function openDocument(uri: string) {
  if (
    Platform.OS !== "web" &&
    (uri.startsWith("data:application/pdf") || uri.startsWith("file:"))
  ) {
    const Sharing = await import("expo-sharing");
    let path = uri;
    if (uri.startsWith("data:")) {
      const { Paths } = await import("expo-file-system");
      const file = new File(Paths.cache, `${uid()}.pdf`);
      file.create();
      file.write(new Uint8Array(decode(uri.slice(uri.indexOf(",") + 1))));
      path = file.uri;
    }
    if (!(await Sharing.isAvailableAsync()))
      throw new Error(
        "Open this PDF in a browser or a device with PDF sharing available.",
      );
    await Sharing.shareAsync(path, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
    });
  } else {
    await Linking.openURL(uri);
  }
}
