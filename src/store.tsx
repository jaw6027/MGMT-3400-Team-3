import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Data, Expense, Repayment, validateExpense, canEdit } from "./core";
import { demoData, DEMO_USER } from "./demo";
import {
  supabase,
  client,
  demoDefault,
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
type AccountUser = { id: string; name: string; email?: string };
const empty: Data = {
  household: null,
  members: [],
  expenses: [],
  repayments: [],
};
const Context = createContext<any>(null);
export function Provider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Data>(empty),
    [demo, setDemo] = useState(demoDefault),
    [user, setUser] = useState<AccountUser | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [householdIntent, setHouseholdIntent] =
    useState<HouseholdIntent | null>(null);
  const [householdWelcome, setHouseholdWelcome] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const refresh = async () => {
    const d = await loadData();
    setData(d);
  };
  useEffect(() => {
    let alive = true;
    if (demo) {
      (async () => {
        try {
          const raw = await AsyncStorage.getItem("splitcart-demo-v1");
          if (alive) {
            setData(raw ? JSON.parse(raw) : demoData());
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
      if (account !== loadedAccount) {
        setData(empty);
        setHouseholdIntent(null);
        setHouseholdWelcome(false);
        setError("");
        loadedAccount = account;
      }
      setLoading(true);
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
  const saveExpense = async (e: Expense) => {
    validateExpense(e, dataRef.current.members);
    const old = dataRef.current.expenses.find((x) => x.id === e.id);
    if (old && !canEdit(user!.id, old, dataRef.current.members))
      throw new Error("Only the roommate who paid can change this purchase.");
    if (demo)
      await persist({
        ...dataRef.current,
        expenses: [e, ...dataRef.current.expenses.filter((x) => x.id !== e.id)],
      });
    else {
      await saveLiveExpense(e);
      await refresh();
    }
  };
  const deleteExpense = async (e: Expense) => {
    if (!canEdit(user!.id, e, dataRef.current.members))
      throw new Error("Only the roommate who paid can delete this purchase.");
    if (demo)
      await persist({
        ...dataRef.current,
        expenses: dataRef.current.expenses.filter((x) => x.id !== e.id),
      });
    else {
      const { error } = await client().rpc("delete_expense", {
        expense_id: e.id,
      });
      if (error) throw error;
      await refresh();
    }
  };
  const repay = async (r: Repayment) => {
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
        user,
        demo: demo || browserPreviewEnabled,
        loading,
        error,
        setError,
        refresh,
        saveExpense,
        deleteExpense,
        repay,
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
          const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
            key.startsWith("splitcart-payments-demo-v1-"),
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
  user: AccountUser | null;
  demo: boolean;
  loading: boolean;
  error: string;
  setError: (s: string) => void;
  refresh: () => Promise<void>;
  saveExpense: (e: Expense) => Promise<void>;
  deleteExpense: (e: Expense) => Promise<void>;
  repay: (r: Repayment) => Promise<void>;
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
