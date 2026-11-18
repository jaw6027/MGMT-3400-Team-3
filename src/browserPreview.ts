// Browser-only rehearsal backend. Nothing here authenticates real users, sends
// email/SMS, or processes money. Every request stays inside the current browser.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import {
  Expense,
  Household,
  Member,
  Repayment,
  canEdit,
  validateExpense,
  validateImage,
  validDate,
} from "./core";
import { demoData, demoReceipt } from "./demo";
import { householdName } from "./households";
export const browserPreviewEnabled =
  Platform.OS === "web" && process.env.EXPO_PUBLIC_BROWSER_PREVIEW === "true";
export const previewOrigin = "https://splitcart-preview.invalid";
export const previewSampleEmail = "alex@splitcart.demo";
export const previewSamplePassword = "splitcart-demo";
const key = "splitcart-browser-preview-v1";
type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem" | "removeItem">;
type User = {
  id: string;
  email: string;
  name: string;
  salt: string;
  passwordHash: string;
};
type PreviewMember = Member & { household_id: string };
type Database = {
  users: User[];
  households: Household[];
  members: PreviewMember[];
  expenses: Expense[];
  repayments: Repayment[];
  receipts: Record<string, string>;
};
const hash = (salt: string, password: string) =>
  Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    salt + password,
  );
const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  user_metadata: { name: u.name },
  aud: "authenticated",
  role: "authenticated",
  identities: [{ id: u.id }],
  created_at: "2026-11-18T00:00:00Z",
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
function tokenPayload(token: string) {
  try {
    return JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
  } catch {
    return null;
  }
}
function session(user: User) {
  const encode = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  return {
    access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, email: user.email, exp: expires_at, role: "authenticated" })}.preview-only`,
    refresh_token: `preview:${user.id}`,
    expires_in: 3600,
    expires_at,
    token_type: "bearer",
    user: publicUser(user),
  };
}
async function initial(): Promise<Database> {
  const d = demoData();
  const users = await Promise.all(
    d.members.map(async (m) => {
      const salt = Crypto.randomUUID();
      return {
        id: m.user_id,
        name: m.name,
        email: `${m.id}@splitcart.demo`,
        salt,
        passwordHash: await hash(salt, previewSamplePassword),
      };
    }),
  );
  return {
    users,
    households: [d.household!],
    members: d.members.map((m) => ({ ...m, household_id: d.household!.id })),
    expenses: d.expenses,
    repayments: d.repayments,
    receipts: {},
  };
}
export function createBrowserPreviewBackend(storage: Storage = AsyncStorage) {
  let queue = Promise.resolve();
  const serial = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const read = async () => {
    const raw = await storage.getItem(key);
    if (raw) return JSON.parse(raw) as Database;
    const d = await initial();
    await save(d);
    return d;
  };
  const save = async (db: Database) => {
    try {
      await storage.setItem(key, JSON.stringify(db));
    } catch {
      throw new Error(
        "Preview browser storage is full. Try a smaller receipt or reset the sample data.",
      );
    }
  };
  const member = (db: Database, user: string) =>
    db.members.find((m) => m.user_id === user && !m.left_at);
  const requireHouse = (db: Database, user: string, house: string) => {
    const m = member(db, user);
    if (!m || m.household_id !== house)
      throw new Error(
        "This household is not available to this preview account.",
      );
    return m;
  };
  const ensureMemberHouses = (db: Database) => {
    db.members = db.members.map((m) => ({
      ...m,
      household_id: (m as PreviewMember).household_id || "demo-house",
    }));
  };
  const fetchPreview: typeof fetch = async (input: any, init: any = {}) =>
    serial(async () => {
      try {
        const request = input instanceof Request ? input : null;
        const url = new URL(request?.url || String(input));
        if (url.origin !== previewOrigin)
          throw new Error("The preview cannot contact external services.");
        const headers = new Headers(init.headers || request?.headers);
        const method = (init.method || request?.method || "GET").toUpperCase();
        const body =
          init.body ??
          (request && method !== "GET" ? await request.text() : undefined);
        const payload = body
          ? JSON.parse(typeof body === "string" ? body : String(body))
          : {};
        const path = url.pathname;
        const db = await read();
        ensureMemberHouses(db);
        if (path === "/auth/v1/signup") {
          const email = String(payload.email || "")
              .trim()
              .toLowerCase(),
            password = String(payload.password || "");
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8)
            throw new Error(
              "Use a made-up email and a preview password of at least 8 characters.",
            );
          if (db.users.some((u) => u.email === email))
            throw new Error(
              "That preview account already exists. Log in instead.",
            );
          const name = householdName(String(payload.data?.name || "Roommate")),
            salt = Crypto.randomUUID();
          const user = {
            id: Crypto.randomUUID(),
            email,
            name,
            salt,
            passwordHash: await hash(salt, password),
          };
          db.users.push(user);
          await save(db);
          return json(session(user));
        }
        if (path === "/auth/v1/token") {
          const user =
            url.searchParams.get("grant_type") === "refresh_token"
              ? db.users.find(
                  (u) => `preview:${u.id}` === payload.refresh_token,
                )
              : db.users.find(
                  (u) =>
                    u.email ===
                    String(payload.email || "")
                      .trim()
                      .toLowerCase(),
                );
          if (
            !user ||
            (url.searchParams.get("grant_type") !== "refresh_token" &&
              (await hash(user.salt, String(payload.password || ""))) !==
                user.passwordHash)
          )
            return json(
              {
                msg: "Incorrect preview email or password.",
                error_description: "Incorrect preview email or password.",
              },
              400,
            );
          return json(session(user));
        }
        if (path === "/auth/v1/logout")
          return new Response(null, { status: 204 });
        const user = db.users.find(
          (u) =>
            u.id ===
            tokenPayload(
              headers.get("authorization")?.replace(/^Bearer /i, "") || "",
            )?.sub,
        );
        if (!user)
          return json({ message: "Log in to a preview account first." }, 401);
        if (path === "/auth/v1/user") return json(publicUser(user));
        const active = member(db, user.id) as PreviewMember | undefined;
        const filter = (name: string) =>
          url.searchParams.get(name)?.replace(/^eq\./, "");
        if (path.startsWith("/rest/v1/rpc/")) {
          const name = path.split("/").pop();
          if (name === "complete_household_setup") {
            if (active) return json(active.household_id);
            let house: Household | undefined;
            if (payload.setup_mode === "create") {
              const name = householdName(String(payload.house_name || ""));
              const currency = payload.house_currency;
              if (!["USD", "EUR", "GBP", "CAD", "AUD"].includes(currency))
                throw new Error("Choose a supported currency.");
              house = {
                id: Crypto.randomUUID(),
                name,
                currency,
                invite_code: Crypto.randomUUID().replace(/-/g, ""),
              };
              db.households.push(house);
            } else if (payload.setup_mode === "join") {
              const code = String(payload.invitation_code || "")
                .replace(/\s/g, "")
                .toLowerCase();
              house = db.households.find(
                (h) => h.invite_code.toLowerCase() === code,
              );
              if (!house)
                throw new Error(
                  "That invitation code didn’t match a household in this browser preview. Check the code and try again.",
                );
            } else
              throw new Error("Choose whether to create or join a household.");
            const old = db.members.find(
              (m) =>
                m.user_id === user.id &&
                (m as PreviewMember).household_id === house!.id,
            );
            if (old) {
              old.left_at = null;
              old.name = user.name;
            } else
              db.members.push({
                id: Crypto.randomUUID(),
                user_id: user.id,
                name: user.name,
                household_id: house.id,
              } as PreviewMember);
            await save(db);
            return json(house.id);
          }
          if (name === "rename_household") {
            requireHouse(db, user.id, payload.household_id);
            db.households.find((h) => h.id === payload.household_id)!.name =
              householdName(payload.house_name);
            await save(db);
            return json(null);
          }
          if (name === "update_profile") {
            user.name = householdName(payload.display_name);
            db.members.forEach((m) => {
              if (m.user_id === user.id && !m.left_at) m.name = user.name;
            });
            await save(db);
            return json(null);
          }
          if (name === "leave_household") {
            if (active) active.left_at = new Date().toISOString();
            await save(db);
            return json(null);
          }
          if (name === "save_expense") {
            const e = payload.payload as Expense;
            requireHouse(db, user.id, e.household_id);
            const old = db.expenses.find((x) => x.id === e.id);
            if (
              old &&
              (old.household_id !== e.household_id ||
                !canEdit(user.id, old, db.members))
            )
              throw new Error(
                "Only the roommate who paid can edit this purchase.",
              );
            const roommates = db.members.filter(
              (m) => (m as PreviewMember).household_id === e.household_id,
            );
            validateExpense(e, roommates);
            if (
              e.shares.some(
                (s) =>
                  !roommates.some(
                    (m) =>
                      m.id === s.member_id &&
                      (!m.left_at ||
                        old?.shares.some((x) => x.member_id === m.id)),
                  ),
              )
            )
              throw new Error("Choose current roommates from this household.");
            if (
              e.receipt &&
              e.receipt !== old?.receipt &&
              e.receipt !== demoReceipt &&
              !db.receipts[e.receipt]
            )
              throw new Error("Attach a valid receipt first.");
            db.expenses = [
              { ...e, created_at: old?.created_at || new Date().toISOString() },
              ...db.expenses.filter((x) => x.id !== e.id),
            ];
            await save(db);
            return json(e.id);
          }
          if (name === "delete_expense") {
            const e = db.expenses.find((e) => e.id === payload.expense_id);
            if (
              !e ||
              !active ||
              e.household_id !== active.household_id ||
              !canEdit(user.id, e, db.members)
            )
              throw new Error(
                "Only the roommate who paid can delete this purchase.",
              );
            db.expenses = db.expenses.filter(
              (e) => e.id !== payload.expense_id,
            );
            await save(db);
            return json(null);
          }
          throw new Error("This action is unavailable in the browser preview.");
        }
        if (path.startsWith("/rest/v1/")) {
          const table = path.split("/").pop();
          if (method === "POST" && table === "repayments") {
            const r = payload as Repayment;
            requireHouse(db, user.id, r.household_id);
            if (
              !Number.isSafeInteger(r.cents) ||
              r.cents <= 0 ||
              r.cents > 100000000 ||
              !validDate(r.date) ||
              r.from_id === r.to_id
            )
              throw new Error(
                "Check the repayment amount, date, and roommates.",
              );
            if (
              r.recorded_by !== user.id ||
              ![r.from_id, r.to_id].includes(active!.id) ||
              ![r.from_id, r.to_id].every((id) =>
                db.members.some(
                  (m) =>
                    m.id === id &&
                    (m as PreviewMember).household_id === r.household_id,
                ),
              )
            )
              throw new Error(
                "Record only repayments you sent or received in this household.",
              );
            if (db.repayments.some((x) => x.id === r.id))
              return json(
                { message: "Payment already recorded", code: "23505" },
                409,
              );
            db.repayments.unshift(r);
            await save(db);
            return new Response(null, { status: 201 });
          }
          if (method !== "GET")
            throw new Error("This preview write is not supported.");
          let rows: any[] = [];
          if (table === "members")
            rows = db.members.filter(
              (m) =>
                ((m as PreviewMember).household_id === active?.household_id ||
                  m.user_id === user.id) &&
                (!filter("user_id") || m.user_id === filter("user_id")) &&
                (!filter("household_id") ||
                  (m as PreviewMember).household_id ===
                    filter("household_id")) &&
                (url.searchParams.get("left_at") !== "is.null" || !m.left_at),
            );
          else if (table === "households")
            rows = db.households.filter(
              (h) =>
                h.id === active?.household_id &&
                (!filter("id") || h.id === filter("id")),
            );
          else if (table === "expenses")
            rows = db.expenses.filter(
              (e) =>
                e.household_id === active?.household_id &&
                e.household_id === filter("household_id"),
            );
          else if (table === "repayments")
            rows = db.repayments.filter(
              (e) =>
                e.household_id === active?.household_id &&
                e.household_id === filter("household_id"),
            );
          else throw new Error("Unknown preview table.");
          const offset = Number(url.searchParams.get("offset") || 0),
            limit = Number(url.searchParams.get("limit") || 10000);
          rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
          rows = rows.slice(offset, offset + limit);
          if (headers.get("accept")?.includes("vnd.pgrst.object+json"))
            return rows.length === 1
              ? json(rows[0])
              : json(
                  {
                    message: "No matching record",
                    code: "PGRST116",
                    details: "The result contains 0 rows",
                  },
                  406,
                );
          return json(rows);
        }
        throw new Error("No external services are connected in this preview.");
      } catch (error: any) {
        return json(
          {
            message:
              error.message || "The preview could not complete this action.",
          },
          400,
        );
      }
    });
  return {
    fetch: fetchPreview,
    reset: () =>
      serial(async () => {
        await storage.removeItem(key);
      }),
    receipt: (path: string, userId: string) =>
      serial(async () => {
        const db = await read();
        ensureMemberHouses(db);
        requireHouse(db, userId, path.split("/")[0]);
        const uri = db.receipts[path];
        if (!uri) throw new Error("Receipt not found in this browser preview.");
        return uri;
      }),
    upload: (path: string, bytes: ArrayBuffer, type: string, userId: string) =>
      serial(async () => {
        const db = await read();
        ensureMemberHouses(db);
        requireHouse(db, userId, path.split("/")[0]);
        if (path.split("/")[1] !== userId)
          throw new Error("Use your own household receipt folder.");
        validateImage(type, bytes.byteLength);
        let binary = "";
        new Uint8Array(bytes).forEach(
          (b) => (binary += String.fromCharCode(b)),
        );
        db.receipts[path] = `data:${type};base64,${btoa(binary)}`;
        await save(db);
        return path;
      }),
  };
}
export const browserPreviewBackend = createBrowserPreviewBackend();
