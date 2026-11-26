import {
  applySubscription,
  initialSubscription,
  firstSubscriptionMember,
  settleSubscription,
  SubscriptionCommand,
} from "./subscriptions";
import {
  deleteLocalSplitTemplate,
  saveLocalSplitTemplate,
  SplitTemplate,
} from "./splitTemplates";
import {
  applyGrocery,
  emptyGrocery,
  syncGroceryShopping,
  groceryLocalLock,
  groceryEssentialFor,
  checkGroceryPurchase,
  checkGroceryTripExpense,
  completeGroceryRestock,
  reopenDeletedGroceryPurchase,
  GroceryCommand,
  GroceryState,
} from "./grocery";
import {
  canonicalChoreName,
  validateChore,
  makeChoreCompletion,
  undoChoreCompletion,
  choreTimezone,
} from "./chores";
import {
  DUPLICATE_MESSAGE,
  matchingPayment,
} from "../supabase/functions/_shared/payment-safety";
import {
  assertNoPendingDemoAppDues,
  loadPaymentExperience,
} from "./paymentStorage";
import { Linking, Platform } from "react-native";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Data,
  Expense,
  Repayment,
  CashPayment,
  ShoppingItem,
  Chore,
  ChoreCompletion,
  validateExpense,
  canEdit,
  validDate,
} from "./core";
import { demoData, DEMO_USER } from "./demo";
import {
  supabase,
  client,
  demoDefault,
  recoveryLinkAtStartup,
  loadData,
  saveLiveExpense,
} from "./backend";
import {
  HouseholdIntent,
  clearPendingHousehold,
  completeHouseholdSetup,
  householdName,
  pendingHousehold,
} from "./households";
import { browserPreviewEnabled, browserPreviewBackend } from "./browserPreview";
import { validateShoppingItem } from "./shopping";
type AccountUser = { id: string; name: string; email?: string };
const empty: Data = {
  household: null,
  members: [],
  expenses: [],
  repayments: [],
};
const Context = createContext<any>(null);
async function loadDemoHousehold(): Promise<Data> {
  return groceryLocalLock(async () => {
    const raw = await AsyncStorage.getItem("splitcart-demo-v1");
    const data: Data = raw ? JSON.parse(raw) : demoData();
    if (data.subscription) {
      const next = settleSubscription(data.subscription);
      if (JSON.stringify(next) !== JSON.stringify(data.subscription)) {
        next.version++;
        data.subscription = next;
        await AsyncStorage.setItem("splitcart-demo-v1", JSON.stringify(data));
      }
    }
    return data;
  });
}
export function Provider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Data>(empty),
    [demo, setDemo] = useState(demoDefault),
    [user, setUser] = useState<AccountUser | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [recovering, setRecovering] = useState(recoveryLinkAtStartup);
  useEffect(() => {
    if (!supabase) return;
    const recover = async (url: string | null) => {
      if (
        !url ||
        (Platform.OS !== "web" && !url.startsWith("splitcart://recovery"))
      )
        return;
      try {
        const parsed = new URL(url);
        const values = new URLSearchParams(parsed.hash.slice(1));
        if (values.get("type") !== "recovery") return;
        const access_token = values.get("access_token"),
          refresh_token = values.get("refresh_token");
        if (!access_token || !refresh_token) return;
        const { error } = await supabase!.auth.setSession({
          access_token,
          refresh_token,
        });
        if (error) throw error;
        setRecovering(true);
        setDemo(false);
        if (Platform.OS === "web")
          window.history.replaceState(
            {},
            "",
            window.location.pathname + window.location.search,
          );
      } catch {
        setError(
          "This recovery link is invalid or expired. Request another password reset.",
        );
      }
    };
    if (Platform.OS === "web") {
      const handler = () => void recover(window.location.href);
      window.addEventListener("hashchange", handler);
      return () => window.removeEventListener("hashchange", handler);
    }
    void Linking.getInitialURL().then(recover);
    const sub = Linking.addEventListener(
      "url",
      (event) => void recover(event.url),
    );
    return () => sub.remove();
  }, []);
  const [householdIntent, setHouseholdIntent] =
    useState<HouseholdIntent | null>(null);
  const [householdWelcome, setHouseholdWelcome] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const refresh = async () => {
    const d = demo ? await loadDemoHousehold() : await loadData();
    setData(d);
    dataRef.current = d;
  };
  useEffect(() => {
    let alive = true;
    if (demo) {
      (async () => {
        try {
          const loaded = await loadDemoHousehold();
          if (alive) {
            setData(loaded);
            setUser({ id: DEMO_USER, name: "Alex Morgan" });
          }
        } catch {
          if (alive) {
            setData(demoData());
            setUser({ id: DEMO_USER, name: "Alex Morgan" });
          }
        } finally {
          if (alive) setLoading(false);
        }
      })();
      return () => {
        alive = false;
      };
    }
    setLoading(true);
    if (!supabase) {
      setUser(null);
      setData(empty);
      setLoading(false);
      return;
    }
    let loadedAccount: string | null = null;
    const sync = async (session: any) => {
      if (!alive) return;
      const account = session?.user.id || null;
      const accountChanged = account !== loadedAccount;
      if (accountChanged) {
        setData(empty);
        setHouseholdIntent(null);
        setHouseholdWelcome(false);
        setError("");
        loadedAccount = account;
      }
      if (accountChanged) setLoading(true);
      setUser(
        session
          ? {
              id: session.user.id,
              email: session.user.email,
              name: session.user.user_metadata.name || "Roommate",
            }
          : null,
      );
      try {
        if (session) {
          let d = await loadData();
          const email = session.user.email;
          const intent = email
            ? await pendingHousehold(AsyncStorage, email)
            : null;
          if (!alive) return;
          setHouseholdIntent(intent);
          if (intent && !d.household) {
            try {
              await completeHouseholdSetup(client(), intent);
              await clearPendingHousehold(AsyncStorage, email);
              d = await loadData();
              if (!alive) return;
              setHouseholdIntent(null);
              setError("");
              if (intent.mode === "create") setHouseholdWelcome(true);
            } catch (e: any) {
              if (alive) setError(`Your account is ready. ${e.message}`);
            }
          } else if (intent && d.household) {
            await clearPendingHousehold(AsyncStorage, email);
            if (alive) setHouseholdIntent(null);
          }
          if (alive) setData(d);
        } else {
          setData(empty);
          setHouseholdIntent(null);
          setHouseholdWelcome(false);
        }
      } catch (e: any) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    // Serialize duplicate SIGNED_IN/TOKEN_REFRESHED events around onboarding.
    let queue = Promise.resolve();
    const enqueue = (session: any) => {
      queue = queue.then(() => sync(session));
      return queue;
    };
    supabase.auth
      .getSession()
      .then(({ data }) => enqueue(data.session))
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (_event === "PASSWORD_RECOVERY") setRecovering(true);
      if (_event === "SIGNED_OUT") setRecovering(false);
      setTimeout(() => {
        void enqueue(session);
      }, 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [demo]);
  const persist = async (d: Data) => {
    await AsyncStorage.setItem("splitcart-demo-v1", JSON.stringify(d));
    setData(d);
    dataRef.current = d;
  };
  const mutateDemoData = async (
    update: (latest: Data) => Data | Promise<Data>,
  ) => {
    const house = dataRef.current.household?.id;
    await groceryLocalLock(async () => {
      const raw = await AsyncStorage.getItem("splitcart-demo-v1");
      const latest: Data = raw ? JSON.parse(raw) : dataRef.current;
      if (latest.household?.id !== house)
        throw new Error("The active household changed. Refresh and try again.");
      await persist(syncGroceryShopping(await update(latest)));
    });
  };
  const subscriptionAction = async (
    command: SubscriptionCommand,
    version: number,
  ) => {
    if (!user || !dataRef.current.household)
      throw new Error("Sign into a household first.");
    if (demo) {
      return mutateDemoData(async (latest) => {
        if (command.type === "activate")
          await assertNoPendingDemoAppDues(latest.household!.id);
        return {
          ...latest,
          subscription: applySubscription(
            latest.subscription ||
              initialSubscription(
                latest.household!.id,
                firstSubscriptionMember(latest.members)!.user_id,
              ),
            latest.members,
            user.id,
            command,
            version,
          ),
        };
      });
    }
    if (!dataRef.current.subscriptionsAvailable)
      throw new Error(
        "Apply the household subscriptions migration before using simulated billing.",
      );
    const { error } = await client().rpc("household_subscription_apply", {
      household_id: dataRef.current.household.id,
      command,
      expected_version: version,
    });
    await refresh();
    if (error) throw error;
  };
  const changeSplitTemplate = async (
    template: SplitTemplate,
    remove = false,
  ) => {
    if (!user || template.household_id !== dataRef.current.household?.id)
      throw new Error("This template is unavailable in your household.");
    if (demo)
      return mutateDemoData((latest) => ({
        ...latest,
        splitTemplates: remove
          ? deleteLocalSplitTemplate(latest.splitTemplates || [], template)
          : saveLocalSplitTemplate(
              latest.splitTemplates || [],
              template,
              latest.members,
            ),
      }));

    if (!dataRef.current.splitTemplatesAvailable)
      throw new Error("Split templates are unavailable on this backend.");

    const { error } = remove
      ? await client().rpc("delete_split_template", {
          template_id: template.id,
          household_id: template.household_id,
          expected_version: template.version,
        })
      : await client().rpc("save_split_template", { payload: template });
    await refresh();
    if (error) throw error;
  };
  const groceryAction = async (command: GroceryCommand, version: number) => {
    const house = dataRef.current.household?.id;
    if (!house || !user) throw new Error("Join a household first.");
    if (demo)
      await groceryLocalLock(async () => {
        const raw = await AsyncStorage.getItem("splitcart-demo-v1");
        const latest: Data = raw ? JSON.parse(raw) : dataRef.current;
        if (latest.household?.id !== house)
          throw new Error(
            "The active household changed. Refresh and try again.",
          );
        await persist(applyGrocery(latest, user.id, command, version));
      });
    else {
      const { error } = await client().rpc("grocery_apply", {
        household_id: house,
        command,
        expected_version: version,
      });
      if (error) {
        await refresh();
        throw error;
      }
      await refresh();
    }
  };
  const saveExpense = async (e: Expense, shoppingId?: string) => {
    validateExpense(e, dataRef.current.members);
    const old = dataRef.current.expenses.find((x) => x.id === e.id);
    if (old && !canEdit(user!.id, old, dataRef.current.members))
      throw new Error("Only the roommate who paid can change this purchase.");
    if (demo)
      return groceryLocalLock(async () => {
        const raw = await AsyncStorage.getItem("splitcart-demo-v1");
        const latest: Data = raw ? JSON.parse(raw) : dataRef.current;
        if (latest.household?.id !== e.household_id)
          throw new Error(
            "The active household changed. Refresh and try again.",
          );
        const currentExpense = latest.expenses.find((x) => x.id === e.id);
        if (
          currentExpense &&
          !canEdit(user!.id, currentExpense, latest.members)
        )
          throw new Error(
            "Only the roommate who paid can change this purchase.",
          );
        if (
          e.grocery_trip_id &&
          e.grocery_trip_id !== currentExpense?.grocery_trip_id
        )
          checkGroceryTripExpense(latest, user!.id, e);
        const list = latest.shoppingItems || [];
        const plan = shoppingId
          ? list.find(
              (s) => s.id === shoppingId && s.household_id === e.household_id,
            )
          : null;
        if (shoppingId && !plan)
          throw new Error("This shopping item is not available.");
        if (plan?.expense_id && plan.expense_id !== e.id)
          throw new Error(
            "This shopping item already has a recorded purchase. Refresh the list.",
          );
        if (plan && !plan.expense_id)
          checkGroceryPurchase(latest, user!.id, plan.id);
        e = {
          ...e,
          one_time: e.one_time ?? old?.one_time ?? plan?.one_time ?? false,
        };
        let next: Data = {
          ...latest,
          expenses: [e, ...latest.expenses.filter((x) => x.id !== e.id)],
          shoppingItems: list.map((s) =>
            s.id === shoppingId || s.expense_id === e.id
              ? { ...s, expense_id: e.id, one_time: Boolean(e.one_time) }
              : s,
          ),
        };
        if (shoppingId && !plan?.expense_id)
          next = completeGroceryRestock(next, shoppingId, e, user!.id);
        await persist(syncGroceryShopping(next));
      });
    else {
      const payload = { ...e };
      if (!dataRef.current.percentageSplitsAvailable) {
        if (e.split_percentages != null || old?.split_percentages != null)
          throw new Error("Percentage splits are unavailable on this backend.");
        delete payload.split_percentages;
      }
      if (shoppingId) {
        const { error } = await client().rpc("save_shopping_purchase", {
          shopping_id: shoppingId,
          payload,
        });
        if (error) throw error;
      } else await saveLiveExpense(payload);
      await refresh();
    }
  };
  const deleteExpense = async (e: Expense) => {
    if (!canEdit(user!.id, e, dataRef.current.members))
      throw new Error("Only the roommate who paid can delete this purchase.");
    if (demo)
      await mutateDemoData((latest) => {
        const current = latest.expenses.find((x) => x.id === e.id);
        if (current && !canEdit(user!.id, current, latest.members))
          throw new Error(
            "Only the roommate who paid can delete this purchase.",
          );
        return {
          ...reopenDeletedGroceryPurchase(latest, e.id),
          expenses: latest.expenses.filter((x) => x.id !== e.id),
          shoppingItems: (latest.shoppingItems || []).map((s) =>
            s.expense_id === e.id ? { ...s, expense_id: null } : s,
          ),
        };
      });
    else {
      const { error } = await client().rpc("delete_expense", {
        expense_id: e.id,
      });
      if (error) throw error;
      await refresh();
    }
  };
  const saveShoppingItem = async (item: ShoppingItem) => {
    if (groceryEssentialFor(dataRef.current, item.id))
      throw new Error("Edit this essential in Grocery & Restock Rotation.");
    if (item.household_id !== dataRef.current.household?.id)
      throw new Error("Choose an item from this household.");
    validateShoppingItem(item, dataRef.current.members);
    const old = dataRef.current.shoppingItems?.find((s) => s.id === item.id);
    if (old?.expense_id)
      throw new Error(
        "Purchased items stay in history. Edit the linked purchase instead.",
      );
    if (demo)
      await mutateDemoData((latest) => {
        if (groceryEssentialFor(latest, item.id))
          throw new Error("Edit this essential in Grocery & Restock Rotation.");
        validateShoppingItem(item, latest.members);
        const current = latest.shoppingItems?.find((x) => x.id === item.id);
        if (current?.expense_id)
          throw new Error(
            "Purchased items stay in history. Edit the linked purchase instead.",
          );
        return {
          ...latest,
          shoppingItems: [
            {
              ...item,
              created_by: current?.created_by || user!.id,
              created_at: current?.created_at || item.created_at,
            },
            ...(latest.shoppingItems || []).filter((s) => s.id !== item.id),
          ],
        };
      });
    else {
      const { error } = await client().rpc("save_shopping_item", {
        payload: item,
      });
      if (error) throw error;
      await refresh();
    }
  };
  const deleteShoppingItem = async (id: string) => {
    if (groceryEssentialFor(dataRef.current, id))
      throw new Error(
        "This item is on the shared restocking list. Record its purchase or update the essential.",
      );
    const item = dataRef.current.shoppingItems?.find((s) => s.id === id);
    if (!item || item.expense_id)
      throw new Error(
        "Only planned items can be removed. Purchased items stay in history.",
      );
    if (demo)
      await mutateDemoData((latest) => {
        if (groceryEssentialFor(latest, id))
          throw new Error(
            "This item is on the shared restocking list. Record its purchase or update the essential.",
          );
        const current = latest.shoppingItems?.find((x) => x.id === id);
        if (!current || current.expense_id)
          throw new Error(
            "Only planned items can be removed. Purchased items stay in history.",
          );
        return {
          ...latest,
          shoppingItems: (latest.shoppingItems || []).filter(
            (s) => s.id !== id,
          ),
        };
      });
    else {
      const { error } = await client().rpc("delete_shopping_item", {
        shopping_id: id,
      });
      if (error) throw error;
      await refresh();
    }
  };
  const saveChore = async (item: Chore) => {
    if (item.household_id !== dataRef.current.household?.id)
      throw new Error("Choose a chore from this household.");
    validateChore(item, dataRef.current.members);
    if (demo) {
      const old = dataRef.current.chores?.find((c) => c.id === item.id);
      if (old && old.version !== item.version)
        throw new Error(
          "This chore changed. Close and reopen it before saving.",
        );
      await persist({
        ...dataRef.current,
        chores: [
          {
            ...item,
            name: canonicalChoreName(item.name, item.catalog_id),
            version: (old?.version || 0) + 1,
            created_by: old?.created_by || user!.id,
            created_at: old?.created_at || item.created_at,
          },
          ...(dataRef.current.chores || []).filter((c) => c.id !== item.id),
        ],
      });
    } else {
      const { error } = await client().rpc("save_chore", { payload: item });
      if (error) throw error;
      await refresh();
    }
  };
  const setChoreArchived = async (item: Chore, archived: boolean) => {
    if (demo) {
      const current = dataRef.current.chores?.find((c) => c.id === item.id);
      if (!current || current.version !== item.version)
        throw new Error("This chore changed. Refresh and try again.");
      await persist({
        ...dataRef.current,
        chores: dataRef.current.chores!.map((c) =>
          c.id === item.id ? { ...c, archived, version: c.version + 1 } : c,
        ),
      });
    } else {
      const { error } = await client().rpc("set_chore_archived", {
        chore_id: item.id,
        is_archived: archived,
        expected_version: item.version,
      });
      if (error) throw error;
      await refresh();
    }
  };
  const logChore = async (item: Chore, date: string, id: string) => {
    if (demo) {
      const current = dataRef.current.chores?.find((c) => c.id === item.id);
      if (!current) throw new Error("Chore unavailable.");
      const result = makeChoreCompletion(
        current,
        dataRef.current.choreCompletions || [],
        dataRef.current.members,
        user!.id,
        id,
        date,
        item.version,
        choreTimezone(),
      );
      if (!result.replayed)
        await persist({
          ...dataRef.current,
          chores: dataRef.current.chores!.map((c) =>
            c.id === item.id ? result.chore : c,
          ),
          choreCompletions: [
            result.completion,
            ...(dataRef.current.choreCompletions || []),
          ],
        });
    } else {
      const { error } = await client().rpc("log_chore_completion", {
        completion_id: id,
        chore_id: item.id,
        completed_on: date,
        expected_version: item.version,
        client_timezone: choreTimezone(),
      });
      if (error) throw error;
      await refresh();
    }
  };
  const undoChore = async (entry: ChoreCompletion) => {
    if (demo) {
      const current = dataRef.current.chores?.find(
        (c) => c.id === entry.chore_id,
      );
      if (!current) throw new Error("Chore unavailable.");
      const result = undoChoreCompletion(current, entry, user!.id);
      await persist({
        ...dataRef.current,
        chores: dataRef.current.chores!.map((c) =>
          c.id === current.id ? result.chore : c,
        ),
        choreCompletions: dataRef.current.choreCompletions!.map((c) =>
          c.id === entry.id ? result.completion : c,
        ),
      });
    } else {
      const { error } = await client().rpc("undo_chore_completion", {
        completion_id: entry.id,
      });
      if (error) throw error;
      await refresh();
    }
  };
  const repay = async (r: Repayment) => {
    if (r.method === "cash" || r.method === "venmo" || r.method === "zelle")
      throw new Error(
        "Cash payments need the receiving roommate’s confirmation.",
      );
    if (!Number.isSafeInteger(r.cents) || r.cents <= 0 || r.from_id === r.to_id)
      throw new Error("Choose two roommates and a positive amount.");
    if (demo) {
      if (dataRef.current.repayments.some((x) => x.id === r.id)) return;
      await persist({
        ...dataRef.current,
        repayments: [r, ...dataRef.current.repayments],
      });
    } else {
      const { error } = await client()
        .from("repayments")
        .insert({ ...r, recorded_by: user!.id });
      if (error && error.code !== "23505") throw error;
      await refresh();
    }
  };
  const proposeCash = async (r: Repayment) => {
    if (r.method && !["cash", "venmo", "zelle"].includes(r.method))
      throw new Error("Choose cash, Venmo or Zelle.");
    const channel =
      r.method === "venmo" || r.method === "zelle" ? r.method : "cash";
    const self = dataRef.current.members.find((m) => m.user_id === user?.id);
    if (
      !self ||
      r.household_id !== dataRef.current.household?.id ||
      !validDate(r.date) ||
      r.from_id !== self.id ||
      r.from_id === r.to_id ||
      !Number.isSafeInteger(r.cents) ||
      r.cents <= 0 ||
      r.cents > 100000000 ||
      !dataRef.current.members.some((m) => m.id === r.to_id && !m.left_at)
    )
      throw new Error("Record cash you handed to an active roommate.");
    if (demo || browserPreviewEnabled) {
      const experience = await loadPaymentExperience(
        user!.id,
        r.household_id,
        true,
      );
      const old = (dataRef.current.cashPayments || []).find(
        (p) => p.id === r.id,
      );
      if (
        !old &&
        (matchingPayment(experience.payments, r.to_id, r.cents) ||
          (dataRef.current.cashPayments || []).some(
            (p) =>
              p.from_id === r.from_id &&
              p.to_id === r.to_id &&
              p.cents === r.cents &&
              (p.status === "pending" ||
                (p.status === "confirmed" &&
                  Date.parse(p.resolved_at || "") > Date.now() - 600000)),
          ))
      )
        throw new Error(DUPLICATE_MESSAGE);
    }
    if (demo) {
      const old = (dataRef.current.cashPayments || []).find(
        (p) => p.id === r.id,
      );
      if (old) {
        if (
          old.from_id !== r.from_id ||
          old.to_id !== r.to_id ||
          old.cents !== r.cents ||
          old.date !== r.date ||
          (old.channel || "cash") !== channel
        )
          throw new Error("Cash entry cannot be changed.");
        return;
      }
      const cash: CashPayment = {
        ...r,
        method: channel,
        channel,
        status: "pending",
        proposed_by: user!.id,
        created_at: new Date().toISOString(),
      };
      await persist({
        ...dataRef.current,
        cashPayments: [cash, ...(dataRef.current.cashPayments || [])],
      });
    } else {
      const { error } = await client().rpc("propose_cash_payment", {
        payload: r,
      });
      if (error) throw error;
      await refresh();
    }
  };
  const resolveCash = async (
    id: string,
    decision: "confirmed" | "disputed",
  ) => {
    if (demo) {
      const d = dataRef.current,
        p = (d.cashPayments || []).find((p) => p.id === id),
        self = d.members.find((m) => m.user_id === user?.id && !m.left_at);
      if (!p || p.to_id !== self?.id)
        throw new Error("Only the receiver can confirm or dispute cash.");
      if (p.status === decision) return;
      if (p.status !== "pending")
        throw new Error("Cash entry already resolved.");
      await persist({
        ...d,
        cashPayments: (d.cashPayments || []).map((x) =>
          x.id === id
            ? {
                ...x,
                status: decision,
                resolved_by: user!.id,
                resolved_at: new Date().toISOString(),
              }
            : x,
        ),
        repayments:
          decision === "confirmed"
            ? [
                {
                  id: p.id,
                  household_id: p.household_id,
                  from_id: p.from_id,
                  to_id: p.to_id,
                  cents: p.cents,
                  date: p.date,
                  recorded_by: p.proposed_by,
                  method: p.channel || "cash",
                },
                ...d.repayments,
              ]
            : d.repayments,
      });
    } else {
      const { error } = await client().rpc("resolve_cash_payment", {
        cash_id: id,
        decision,
      });
      if (error) throw error;
      await refresh();
    }
  };
  const household = async (name: string, code: string, currency: string) => {
    const intent: HouseholdIntent = code
      ? { mode: "join", code }
      : { mode: "create", name: householdName(name), currency };
    if (demo) {
      if (code)
        throw new Error(
          "Invitation codes work with live accounts. Switch to live mode in settings.",
        );
      const self = dataRef.current.members.find((x) => x.user_id === user!.id)!;
      await persist({
        household: {
          id: "demo-custom",
          name: householdName(name),
          currency,
          invite_code: "DEMO-HOME",
        },
        members: [self],
        expenses: [],
        repayments: [],
      });
    } else {
      await completeHouseholdSetup(client(), intent);
      if (user?.email) await clearPendingHousehold(AsyncStorage, user.email);
      await refresh();
    }
    setHouseholdIntent(null);
    setError("");
    if (intent.mode === "create") setHouseholdWelcome(true);
  };
  const renameHousehold = async (value: string) => {
    const name = householdName(value);
    if (!dataRef.current.household) throw new Error("Join a household first.");
    if (demo)
      await persist({
        ...dataRef.current,
        household: { ...dataRef.current.household, name },
      });
    else {
      const { error } = await client().rpc("rename_household", {
        household_id: dataRef.current.household.id,
        house_name: name,
      });
      if (error) throw error;
      await refresh();
    }
  };

  const profile = async (name: string) => {
    if (!name.trim()) throw new Error("Enter your name.");
    if (demo)
      await persist({
        ...dataRef.current,
        members: dataRef.current.members.map((x) =>
          x.user_id === user!.id ? { ...x, name: name.trim() } : x,
        ),
      });
    else {
      const { error } = await client().rpc("update_profile", {
        display_name: name.trim(),
      });
      if (error) throw error;
      await refresh();
    }
    setUser({ ...user!, name: name.trim() });
  };
  const leave = async () => {
    if (demo) {
      await persist({
        ...empty,
        members: dataRef.current.members.filter((x) => x.user_id === user!.id),
      });
    } else {
      const { error } = await client().rpc("leave_household");
      if (error) throw error;
      await refresh();
    }
  };
  return (
    <Context.Provider
      value={{
        ...data,
        subscription:
          demo && data.household
            ? settleSubscription(
                data.subscription ||
                  initialSubscription(
                    data.household.id,
                    firstSubscriptionMember(data.members)?.user_id || "",
                  ),
              )
            : data.subscription,
        subscriptionsAvailable: demo || !!data.subscriptionsAvailable,
        subscriptionAction,
        percentageSplitsAvailable: demo || !!data.percentageSplitsAvailable,
        splitTemplatesAvailable: demo || !!data.splitTemplatesAvailable,
        splitTemplates: (data.splitTemplates || []).filter(
          (template) => template.household_id === data.household?.id,
        ),
        changeSplitTemplate,
        shoppingItems: syncGroceryShopping(data).shoppingItems || [],
        grocery: data.grocery || emptyGrocery(),
        groceryAction,
        chores: data.chores || [],
        choreCompletions: data.choreCompletions || [],
        saveChore,
        setChoreArchived,
        logChore,
        undoChore,
        saveShoppingItem,
        deleteShoppingItem,
        recovering,
        completeRecovery: () => setRecovering(false),
        user,
        demo: demo || browserPreviewEnabled,
        loading,
        error,
        setError,
        refresh,
        saveExpense,
        deleteExpense,
        repay,
        proposeCash,
        resolveCash,
        householdAction: household,
        householdIntent,
        householdWelcome,
        dismissHouseholdWelcome: () => setHouseholdWelcome(false),
        renameHousehold,
        profile,
        leave,
        switchMode: () => {
          if (browserPreviewEnabled) {
            void client().auth.signOut();
            return;
          }
          setData(empty);
          setUser(null);
          setHouseholdIntent(null);
          setHouseholdWelcome(false);
          setLoading(true);
          setDemo(!demo);
        },
        reset: async () => {
          const keys = (await AsyncStorage.getAllKeys()).filter(
            (key) =>
              key.startsWith("splitcart-payments-demo-v1-") ||
              key.startsWith("splitcart-requests-demo-v1-"),
          );
          if (keys.length) await AsyncStorage.multiRemove(keys);
          if (browserPreviewEnabled) {
            await browserPreviewBackend.reset();
            await client().auth.signOut();
          } else await persist(demoData());
        },
        signOut: async () => {
          if (demo) {
            setDemo(false);
            setUser(null);
          } else await client().auth.signOut();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useStore(): Data & {
  subscriptionAction: (
    command: SubscriptionCommand,
    version: number,
  ) => Promise<void>;
  percentageSplitsAvailable: boolean;
  splitTemplatesAvailable: boolean;
  splitTemplates: SplitTemplate[];
  changeSplitTemplate: (
    template: SplitTemplate,
    remove?: boolean,
  ) => Promise<void>;
  grocery: GroceryState;
  groceryAction: (command: GroceryCommand, version: number) => Promise<void>;
  recovering: boolean;
  completeRecovery: () => void;
  user: AccountUser | null;
  demo: boolean;
  loading: boolean;
  error: string;
  setError: (s: string) => void;
  refresh: () => Promise<void>;
  shoppingItems: ShoppingItem[];
  chores: Chore[];
  choreCompletions: ChoreCompletion[];
  saveChore: (item: Chore) => Promise<void>;
  setChoreArchived: (item: Chore, archived: boolean) => Promise<void>;
  logChore: (item: Chore, date: string, id: string) => Promise<void>;
  undoChore: (entry: ChoreCompletion) => Promise<void>;
  saveShoppingItem: (item: ShoppingItem) => Promise<void>;
  deleteShoppingItem: (id: string) => Promise<void>;
  saveExpense: (e: Expense, shoppingId?: string) => Promise<void>;
  deleteExpense: (e: Expense) => Promise<void>;
  repay: (r: Repayment) => Promise<void>;
  proposeCash: (r: Repayment) => Promise<void>;
  resolveCash: (
    id: string,
    decision: "confirmed" | "disputed",
  ) => Promise<void>;
  householdAction: (n: string, c: string, curr: string) => Promise<void>;
  householdIntent: HouseholdIntent | null;
  householdWelcome: boolean;
  dismissHouseholdWelcome: () => void;
  renameHousehold: (name: string) => Promise<void>;
  profile: (n: string) => Promise<void>;
  leave: () => Promise<void>;
  switchMode: () => void;
  reset: () => Promise<void>;
  signOut: () => Promise<void>;
} {
  return useContext(Context);
}
