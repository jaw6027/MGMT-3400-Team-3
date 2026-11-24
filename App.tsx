import { ExternalPayments } from "./src/ExternalPayments";
import GroceryRotation, { GroceryNextCard } from "./src/GroceryRotation";
import SupportChat from "./src/SupportChat";
import DeveloperBusinessSettings from "./src/DeveloperBusinessSettings";
import { ReceiptItemEditor } from "./src/ReceiptItemEditor";
import { SplitTemplates } from "./src/SplitTemplates";
import { percentageSplit } from "./src/percentageSplit";
import {
  calculateReceipt,
  receiptDraft,
  detailsFromDraft,
  ReceiptDetails,
} from "./src/receiptItems";
import { validateExtraction } from "./supabase/functions/_shared/receipt-extraction";
import { SpendingBreakdown } from "./src/SpendingBreakdown";
import ChoreTracker from "./src/ChoreTracker";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { Fraunces_500Medium } from "@expo-google-fonts/fraunces/500Medium";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  normalizeHouseholdIntent,
  signUpWithHousehold,
} from "./src/households";
import { Provider, useStore } from "./src/store";
import {
  balances,
  canEdit,
  categories,
  equalSplit,
  Expense,
  ShoppingItem,
  money,
  parseMoney,
  settlements,
  today,
  validateImage,
  validDate,
} from "./src/core";
import {
  client,
  liveConfigured,
  receiptUrl,
  uid,
  uploadReceipt,
} from "./src/backend";
import { demoReceipt } from "./src/demo";
import {
  Avatar,
  Button,
  C,
  CategoryIcon,
  Chip,
  Empty,
  Field,
  Icon,
  IconName,
  s,
  Title,
  Txt,
  Sheet,
} from "./src/ui";
import Illustration from "./src/Illustration";
import { AccessibilityProvider, AccessibilitySettings } from "./src/ui";
import PaymentsPanel from "./src/PaymentsPanel";
import { CashPayments } from "./src/CashPayments";
import {
  SecurityProvider,
  SecuritySettings,
  PasswordRecovery,
} from "./src/Security";
import { UpcomingPayments } from "./src/PaymentDashboard";
import {
  browserPreviewEnabled,
  previewSampleEmail,
  previewSamplePassword,
} from "./src/browserPreview";
import ShoppingList from "./src/ShoppingList";
import { purchaseCategory } from "./src/shopping";
type Tab =
  | "Grocery & Restock Rotation"
  | "Chore Tracker"
  | "Overview"
  | "Shopping"
  | "Purchases"
  | "Balances"
  | "Household";
const tabs: { name: Tab; icon: IconName }[] = [
  { name: "Overview", icon: "Home" },
  { name: "Shopping", icon: "ShoppingBasket" },
  { name: "Grocery & Restock Rotation", icon: "CalendarDays" },
  { name: "Chore Tracker", icon: "CheckCircle2" },
  { name: "Purchases", icon: "Receipt" },
  { name: "Balances", icon: "Wallet" },
  { name: "Household", icon: "Users" },
];
const shortDate = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
function ReceiptPhoto({ path, style }: any) {
  const [uri, setUri] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setFailed(false);
    receiptUrl(path)
      .then((u) => {
        if (alive) setUri(u);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return path.startsWith("data:image/svg+xml;utf8,") ? (
    <View style={style}>
      <SvgXml
        xml={decodeURIComponent(path.split("utf8,")[1])}
        width="100%"
        height="100%"
      />
    </View>
  ) : failed ? (
    <View
      style={[
        { padding: 12, backgroundColor: C.sage, justifyContent: "center" },
        style,
      ]}
    >
      <Txt style={s.muted}>Receipt unavailable. Reopen to retry.</Txt>
    </View>
  ) : uri ? (
    <Image
      accessibilityLabel="Purchase receipt"
      source={{ uri }}
      resizeMode="contain"
      onError={() => setFailed(true)}
      style={style}
    />
  ) : (
    <ActivityIndicator color={C.green} />
  );
}
export default function App() {
  const [loaded, error] = useFonts({
    DM: DMSans_400Regular,
    DMMedium: DMSans_500Medium,
    DMSemi: DMSans_600SemiBold,
    DMBold: DMSans_700Bold,
    Fraunces: Fraunces_500Medium,
  });
  if (!loaded && !error)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: C.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={C.green} />
      </View>
    );
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AccessibilityProvider>
        <Provider>
          <SecurityProvider>
            <Main />
          </SecurityProvider>
        </Provider>
      </AccessibilityProvider>
    </SafeAreaProvider>
  );
}
function Main() {
  const store = useStore();
  const { width } = useWindowDimensions();
  const desktop = width >= 1000;
  const [tab, setTab] = useState<Tab>("Overview");
  const [editor, setEditor] = useState<Expense | null | undefined>(undefined);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [groceryTripId, setGroceryTripId] = useState<string | null>(null);
  const [shoppingToLog, setShoppingToLog] = useState<ShoppingItem | null>(null);
  const [repayOpen, setRepayOpen] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const notify = (m: string) => setToast(m);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    setTab("Overview");
    setEditor(undefined);
    setShoppingToLog(null);
    setGroceryTripId(null);
    setDetail(null);
    setRepayOpen(false);
    setReceipt(null);
  }, [store.demo, store.user?.id]);
  const current = store.members.find((m) => m.user_id === store.user?.id);
  const fmt = (n: number) => money(n, store.household?.currency);
  const b = balances(store.members, store.expenses, store.repayments);
  const myBalance = current ? b[current.id] || 0 : 0;
  if (store.loading)
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: C.bg,
          gap: 14,
        }}
      >
        <ActivityIndicator color={C.green} />
        <Txt>Getting your household ready…</Txt>
      </View>
    );
  if (store.recovering && store.user)
    return <PasswordRecovery onComplete={store.completeRecovery} />;
  if (!store.user)
    return (
      <>
        <Auth />
        <SupportChat key="signed-out" signedIn={false} />
      </>
    );
  if (!store.household)
    return (
      <>
        <HouseholdSetup />
        <SupportChat key={`setup-${store.user.id}`} signedIn={false} />
      </>
    );
  const nav = (name: Tab) => {
    setTab(name);
  };
  const sorted = [...store.expenses].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  );
  const refresh = async () => {
    if (store.demo) {
      notify("Demo is up to date.");
      return;
    }
    setRefreshing(true);
    try {
      await store.refresh();
    } catch (e: any) {
      store.setError(e.message);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        {desktop && (
          <View
            style={{
              width: 226,
              backgroundColor: C.white,
              borderRightWidth: 1,
              borderColor: C.line,
              padding: 23,
            }}
          >
            <Logo />
            <View style={{ height: 52 }} />
            <Txt
              style={[
                s.label,
                { fontSize: 10, marginBottom: 15, marginLeft: 12 },
              ]}
            >
              YOUR SPACE
            </Txt>
            <View style={{ gap: 8 }}>
              {tabs.map((t) => (
                <Pressable
                  key={t.name}
                  onPress={() => nav(t.name)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 13,
                    padding: 13,
                    borderRadius: 9,
                    backgroundColor: tab === t.name ? C.sage : "transparent",
                  }}
                >
                  <Icon
                    name={t.icon}
                    size={19}
                    color={tab === t.name ? C.green : C.muted}
                  />
                  <Txt
                    style={{
                      fontFamily: tab === t.name ? "DMBold" : "DMMedium",
                      color: tab === t.name ? C.green : C.muted,
                    }}
                  >
                    {t.name}
                  </Txt>
                  {t.name === "Purchases" && (
                    <View
                      style={{
                        marginLeft: "auto",
                        borderRadius: 5,
                        backgroundColor: "#F1F3EE",
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                      }}
                    >
                      <Txt style={{ fontSize: 10, color: C.muted }}>
                        {store.expenses.length}
                      </Txt>
                    </View>
                  )}
                </Pressable>
              ))}
            </View>
            <View style={{ flex: 1 }} />
            <View
              style={{
                backgroundColor: "#F5F7F0",
                padding: 16,
                borderRadius: 12,
                gap: 10,
                marginBottom: 22,
              }}
            >
              <Icon name="Leaf" color={C.green} />
              <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                A happy home starts here.
              </Txt>
              <Txt style={{ fontSize: 11, color: C.muted, lineHeight: 18 }}>
                Less money talk. More living together.
              </Txt>
            </View>
            <Pressable
              onPress={() => setTab("Household")}
              style={[
                s.row,
                {
                  gap: 10,
                  borderTopWidth: 1,
                  borderColor: C.line,
                  paddingTop: 20,
                },
              ]}
            >
              <Avatar name={current?.name || store.user.name} />
              <View style={{ flex: 1 }}>
                <Txt style={{ fontFamily: "DMBold", fontSize: 12 }}>
                  {current?.name || store.user.name}
                </Txt>
                <Txt style={{ fontSize: 10, color: C.muted, marginTop: 3 }}>
                  Your personal space
                </Txt>
              </View>
              <Icon name="Settings" size={16} color={C.muted} />
            </Pressable>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <View
            style={[
              s.between,
              {
                minHeight: 78,
                borderBottomWidth: 1,
                borderColor: C.line,
                paddingHorizontal: desktop ? 38 : 20,
                backgroundColor: C.white,
              },
            ]}
          >
            {desktop ? (
              <View
                style={[
                  s.row,
                  { gap: 9, flex: 1, minWidth: 0, marginRight: 16 },
                ]}
              >
                <View
                  style={{
                    backgroundColor: C.sage,
                    padding: 7,
                    borderRadius: 8,
                  }}
                >
                  <Icon name="Home" size={17} color={C.green} />
                </View>
                <Txt
                  numberOfLines={1}
                  style={{ fontFamily: "DMSemi", fontSize: 13, flexShrink: 1 }}
                >
                  {store.household.name}
                </Txt>
                <Icon name="ChevronDown" size={14} color={C.muted} />
                <View
                  style={{
                    width: 1,
                    height: 19,
                    backgroundColor: C.line,
                    marginHorizontal: 9,
                  }}
                />
                <Txt style={s.muted}>{tab}</Txt>
              </View>
            ) : (
              <Logo compact />
            )}
            <View style={[s.row, { gap: 14 }]}>
              {store.demo && (
                <View
                  style={{
                    paddingVertical: 5,
                    paddingHorizontal: 10,
                    borderRadius: 20,
                    backgroundColor: "#F4EEDC",
                  }}
                >
                  <Txt
                    style={{
                      fontSize: 10,
                      color: "#8F7951",
                      fontFamily: "DMBold",
                    }}
                  >
                    DEMO MODE
                  </Txt>
                </View>
              )}
              <Pressable
                accessibilityLabel="Household settings"
                onPress={() => setTab("Household")}
              >
                <Avatar name={current?.name || "Alex"} size={33} />
              </Pressable>
            </View>
          </View>
          <ScrollView
            contentContainerStyle={{
              padding: desktop ? 36 : 20,
              paddingBottom: 40,
            }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={refresh}
                tintColor={C.green}
              />
            }
          >
            <View
              style={{
                maxWidth: 1200,
                width: "100%",
                alignSelf: "center",
                gap: 26,
              }}
            >
              {store.error && (
                <View style={[s.card, { backgroundColor: "#FBEFEC", gap: 10 }]}>
                  <Txt style={{ color: C.red }}>{store.error}</Txt>
                  <Button
                    secondary
                    small
                    label="Dismiss"
                    onPress={() => store.setError("")}
                  />
                </View>
              )}
              {tab === "Overview" && (
                <>
                  <UpcomingPayments onManage={() => setTab("Balances")} />
                  <GroceryNextCard
                    onOpen={() => setTab("Grocery & Restock Rotation")}
                  />
                  <View
                    style={[
                      s.between,
                      {
                        alignItems: desktop ? "center" : "flex-start",
                        gap: 12,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={[s.row, { gap: 6, marginBottom: 8 }]}>
                        <View
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: C.green,
                          }}
                        />
                        <Txt style={s.label}>HOME, SHARED BETTER</Txt>
                      </View>
                      <Title style={{ fontSize: desktop ? 36 : 30 }}>
                        Hey {current?.name.split(" ")[0]}, welcome home.
                      </Title>
                      <Txt
                        style={{ color: C.muted, marginTop: 9, fontSize: 13 }}
                      >
                        A little less splitting hairs. A lot more splitting
                        fairly.
                      </Txt>
                    </View>
                    {desktop && (
                      <View
                        style={[
                          s.row,
                          {
                            gap: 8,
                            borderWidth: 1,
                            borderColor: C.line,
                            backgroundColor: C.white,
                            borderRadius: 8,
                            padding: 11,
                          },
                        ]}
                      >
                        <Icon name="CalendarDays" size={15} color={C.muted} />
                        <Txt style={{ fontSize: 11, color: C.muted }}>
                          {new Date().toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </Txt>
                      </View>
                    )}
                  </View>
                  <View
                    style={{
                      flexDirection: desktop ? "row" : "column",
                      gap: 20,
                    }}
                  >
                    <View
                      style={{
                        flex: 1.65,
                        minHeight: 222,
                        borderRadius: 18,
                        backgroundColor: "#EAF0DF",
                        overflow: "hidden",
                        padding: 27,
                        flexDirection: "row",
                        alignItems: "center",
                      }}
                    >
                      <View style={{ flex: 1, zIndex: 1, gap: 13 }}>
                        <Txt
                          style={{
                            fontSize: 10,
                            letterSpacing: 1.4,
                            color: "#506842",
                            fontFamily: "DMBold",
                          }}
                        >
                          GOOD ROOMMATES. GREAT BALANCE.
                        </Txt>
                        <Title style={{ fontSize: 30, lineHeight: 36 }}>
                          Shared home.{"\n"}Shared cart.
                        </Title>
                        <Txt
                          style={{
                            fontSize: 12,
                            color: "#53664E",
                            lineHeight: 20,
                            maxWidth: 235,
                          }}
                        >
                          From the weekly shop to the Wi-Fi.{"\n"}Keep track,
                          split fairly, stay even.
                        </Txt>
                        <Button
                          label="Add a purchase"
                          icon="Plus"
                          onPress={() => setEditor(null)}
                          style={{ alignSelf: "flex-start", marginTop: 3 }}
                        />
                      </View>
                      {width > 600 && (
                        <View
                          style={{
                            width: desktop ? 230 : 260,
                            alignItems: "center",
                          }}
                        >
                          <Illustration />
                        </View>
                      )}
                      {width <= 600 && (
                        <View
                          pointerEvents="none"
                          style={{
                            position: "absolute",
                            right: -98,
                            bottom: -20,
                            opacity: 0.22,
                          }}
                        >
                          <Illustration />
                        </View>
                      )}
                    </View>
                    <View
                      style={{
                        flex: 1,
                        minHeight: 222,
                        padding: 25,
                        borderRadius: 18,
                        backgroundColor: C.dark,
                        overflow: "hidden",
                        justifyContent: "space-between",
                      }}
                    >
                      <View style={[s.between, { gap: 10 }]}>
                        <Txt style={{ fontSize: 12, color: "#C9D9CB" }}>
                          Your household balance
                        </Txt>
                        <View
                          style={{
                            backgroundColor: "#39634C",
                            padding: 8,
                            borderRadius: 9,
                          }}
                        >
                          <Icon name="Wallet" color="#D5E6C7" size={18} />
                        </View>
                      </View>
                      <View>
                        <Txt
                          style={{
                            fontFamily: "DMSemi",
                            fontSize: 43,
                            color: "#FCFDF5",
                            letterSpacing: -1.5,
                          }}
                        >
                          {fmt(Math.abs(myBalance))}
                        </Txt>
                        <View style={[s.row, { gap: 5, marginTop: 3 }]}>
                          <Icon
                            name={
                              myBalance >= 0 ? "ArrowDownLeft" : "ArrowUpRight"
                            }
                            size={15}
                            color="#B9D3A4"
                          />
                          <Txt style={{ fontSize: 12, color: "#C8DCBA" }}>
                            {myBalance > 0
                              ? "You’re owed. Nice and clear."
                              : myBalance < 0
                                ? "You owe your household."
                                : "All settled up. Feels good."}
                          </Txt>
                        </View>
                      </View>
                      <Pressable
                        onPress={() => setTab("Balances")}
                        style={[
                          s.between,
                          {
                            borderTopWidth: 1,
                            borderColor: "#426750",
                            paddingTop: 15,
                            marginTop: 18,
                          },
                        ]}
                      >
                        <Txt
                          style={{
                            color: "#EEF4E5",
                            fontSize: 12,
                            fontFamily: "DMSemi",
                          }}
                        >
                          View balances
                        </Txt>
                        <Icon name="ArrowRight" size={16} color="#EEF4E5" />
                      </Pressable>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: desktop ? 18 : 9 }}>
                    {[
                      {
                        label: "Household spending",
                        value: fmt(
                          store.expenses
                            .filter(
                              (e) => e.date.slice(0, 7) === today().slice(0, 7),
                            )
                            .reduce((n, e) => n + e.cents, 0),
                        ),
                        sub: "this month",
                        icon: "ShoppingBasket",
                      },
                      {
                        label: "Shared purchases",
                        value: String(store.expenses.length),
                        sub: "little things, together",
                        icon: "Receipt",
                      },
                      {
                        label: "Under one roof",
                        value: String(
                          store.members.filter((m) => !m.left_at).length,
                        ),
                        sub: "roommates, one team",
                        icon: "Users",
                      },
                    ].map((stat) => (
                      <View
                        key={stat.label}
                        style={[
                          s.card,
                          { flex: 1, padding: desktop ? 20 : 13, gap: 12 },
                        ]}
                      >
                        <View style={s.between}>
                          <Txt
                            style={{
                              fontSize: desktop ? 12 : 10,
                              color: C.muted,
                              flex: 1,
                            }}
                          >
                            {stat.label}
                          </Txt>
                          {desktop && (
                            <Icon
                              name={stat.icon as IconName}
                              size={17}
                              color="#8D9A8B"
                            />
                          )}
                        </View>
                        <Txt
                          style={{
                            fontSize: desktop ? 27 : 21,
                            fontFamily: "DMSemi",
                            letterSpacing: -0.8,
                          }}
                        >
                          {stat.value}
                        </Txt>
                        <Txt
                          style={{
                            fontSize: desktop ? 11 : 9,
                            color: "#65745E",
                          }}
                        >
                          {stat.sub}
                        </Txt>
                      </View>
                    ))}
                  </View>
                  <SpendingBreakdown />
                  <View
                    style={{
                      flexDirection: desktop ? "row" : "column",
                      gap: 24,
                      alignItems: "flex-start",
                    }}
                  >
                    <View style={{ flex: 1.9, width: "100%", gap: 16 }}>
                      <View style={s.between}>
                        <View style={[s.row, { gap: 9 }]}>
                          <Title style={{ fontSize: 23 }}>
                            Recent purchases
                          </Title>
                          <View
                            style={{
                              backgroundColor: "#EAEFE4",
                              paddingHorizontal: 7,
                              paddingVertical: 3,
                              borderRadius: 5,
                            }}
                          >
                            <Txt style={{ fontSize: 10, color: C.green }}>
                              {store.expenses.length}
                            </Txt>
                          </View>
                        </View>
                        <Pressable
                          onPress={() => setTab("Purchases")}
                          style={[s.row, { gap: 5 }]}
                        >
                          <Txt style={s.link}>View all</Txt>
                          <Icon name="ArrowRight" size={14} color={C.green} />
                        </Pressable>
                      </View>
                      <View
                        style={[s.card, { padding: 0, overflow: "hidden" }]}
                      >
                        {sorted.length ? (
                          sorted
                            .slice(0, 5)
                            .map((e, i) => (
                              <PurchaseRow
                                key={e.id}
                                e={e}
                                onPress={() => setDetail(e)}
                                last={i === Math.min(sorted.length, 5) - 1}
                              />
                            ))
                        ) : (
                          <Empty
                            title="Your first shared purchase"
                            description="Milk, paper towels, or Friday pizza. Add it here and we’ll do the math."
                            action={
                              <Button
                                label="Add a purchase"
                                icon="Plus"
                                onPress={() => setEditor(null)}
                              />
                            }
                          />
                        )}
                      </View>
                    </View>
                    <View style={{ flex: 1, width: "100%", gap: 16 }}>
                      <Title style={{ fontSize: 23 }}>
                        Your little household
                      </Title>
                      <View style={[s.card, { padding: 21, gap: 17 }]}>
                        <View style={[s.row, { gap: 11 }]}>
                          <View
                            style={{
                              backgroundColor: C.sage,
                              padding: 11,
                              borderRadius: 11,
                            }}
                          >
                            <Icon name="Home" color={C.green} />
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                              {store.household.name}
                            </Txt>
                            <Txt
                              style={{
                                fontSize: 11,
                                color: C.muted,
                                marginTop: 3,
                              }}
                            >
                              Making shared living feel easy.
                            </Txt>
                          </View>
                        </View>
                        <View style={s.divider} />
                        {store.members
                          .filter((m) => !m.left_at)
                          .map((m, i) => (
                            <View key={m.id} style={[s.row, { gap: 10 }]}>
                              <Avatar name={m.name} index={i} size={31} />
                              <Txt style={{ fontSize: 12, flex: 1 }}>
                                {m.name}
                                {m.id === current?.id ? " (you)" : ""}
                              </Txt>
                              <View
                                style={{
                                  width: 6,
                                  height: 6,
                                  backgroundColor: "#9BB48E",
                                  borderRadius: 3,
                                }}
                              />
                            </View>
                          ))}
                        <Button
                          secondary
                          small
                          label="Manage household"
                          icon="Users"
                          onPress={() => setTab("Household")}
                        />
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          gap: 10,
                          paddingHorizontal: 12,
                        }}
                      >
                        <Icon name="Lock" size={15} color="#93A38C" />
                        <Txt
                          style={{
                            fontSize: 10,
                            color: "#65745E",
                            lineHeight: 17,
                            flex: 1,
                          }}
                        >
                          Just between housemates. Your purchases and receipts
                          stay in your household.
                        </Txt>
                      </View>
                    </View>
                  </View>
                </>
              )}
              {tab === "Grocery & Restock Rotation" && (
                <GroceryRotation
                  onShopping={() => setTab("Shopping")}
                  onPurchase={(item) => {
                    setGroceryTripId(null);
                    setShoppingToLog(item);
                    setEditor(null);
                  }}
                  onTripExpense={(id) => {
                    setShoppingToLog(null);
                    setGroceryTripId(id);
                    setEditor(null);
                  }}
                  onOpenExpense={setDetail}
                />
              )}
              {tab === "Chore Tracker" && <ChoreTracker />}
              {tab === "Shopping" && (
                <ShoppingList
                  onPurchase={(item) => {
                    setShoppingToLog(item);
                    setEditor(null);
                  }}
                  onOpenPurchase={setDetail}
                />
              )}
              {tab === "Purchases" && (
                <PurchaseHistory
                  onAdd={() => setEditor(null)}
                  onOpen={setDetail}
                />
              )}
              {tab === "Balances" && (
                <Balances onRepay={() => setRepayOpen(true)} />
              )}
              {tab === "Household" && <HouseholdSettings notify={notify} />}
              <View
                style={[
                  s.row,
                  { gap: 6, justifyContent: "center", paddingTop: 8 },
                ]}
              >
                <Icon name="Leaf" size={13} color="#9FAC97" />
                <Txt style={{ fontSize: 10, color: "#65745E" }}>
                  A little fairness goes a long way. That’s SplitCart.
                </Txt>
              </View>
            </View>
          </ScrollView>
          {!desktop && (
            <View
              style={{
                flexDirection: "row",
                backgroundColor: C.white,
                borderTopWidth: 1,
                borderColor: C.line,
                paddingTop: 8,
                paddingBottom: 8,
              }}
            >
              {tabs.map((t) => (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === t.name }}
                  accessibilityLabel={t.name}
                  key={t.name}
                  onPress={() => nav(t.name)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    alignItems: "center",
                    gap: 4,
                    paddingVertical: 7,
                    paddingHorizontal: 2,
                  }}
                >
                  <Icon
                    name={t.icon}
                    color={tab === t.name ? C.green : C.muted}
                    size={21}
                  />
                  <Txt
                    numberOfLines={1}
                    style={{
                      maxWidth: "100%",
                      textAlign: "center",
                      fontSize: 10,
                      color: tab === t.name ? C.green : C.muted,
                      fontFamily: tab === t.name ? "DMBold" : "DM",
                    }}
                  >
                    {t.name === "Chore Tracker"
                      ? "Chores"
                      : t.name === "Grocery & Restock Rotation"
                        ? "Rotation"
                        : t.name}
                  </Txt>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </View>
      <SupportChat
        key={`${store.demo}-${store.user.id}-${store.household.id}`}
        onNavigate={setTab}
      />
      {toast !== "" && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            bottom: desktop ? 25 : 90,
            alignSelf: "center",
            backgroundColor: C.dark,
            borderRadius: 10,
            padding: 15,
            maxWidth: "90%",
            flexDirection: "row",
            gap: 9,
          }}
        >
          <Icon name="CheckCircle2" size={18} color="#DAE9D0" />
          <Txt style={{ color: C.white, fontSize: 12 }}>{toast}</Txt>
        </View>
      )}
      {store.householdWelcome && (
        <Sheet
          title="Your household is ready"
          onClose={store.dismissHouseholdWelcome}
        >
          <Title style={{ fontSize: 27 }}>{store.household.name}</Title>
          <HouseholdInvitation notify={notify} />
          <Button
            label="Go to dashboard"
            icon="ArrowRight"
            onPress={() => {
              store.dismissHouseholdWelcome();
              setTab("Overview");
            }}
          />
        </Sheet>
      )}
      {editor !== undefined && (
        <PurchaseEditor
          expense={editor}
          shoppingItem={shoppingToLog || undefined}
          groceryTripId={groceryTripId || undefined}
          onClose={() => {
            setEditor(undefined);
            setShoppingToLog(null);
            setGroceryTripId(null);
          }}
          onSaved={() => {
            setEditor(undefined);
            setShoppingToLog(null);
            setGroceryTripId(null);
            notify("Purchase saved. Everyone’s share is accounted for.");
          }}
        />
      )}
      {detail && (
        <PurchaseDetail
          e={store.expenses.find((e) => e.id === detail.id) || detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditor(detail);
            setDetail(null);
          }}
          onReceipt={setReceipt}
          notify={notify}
        />
      )}
      {repayOpen && (
        <RepayModal
          onClose={() => setRepayOpen(false)}
          onSaved={(message) => {
            setRepayOpen(false);
            notify(message);
          }}
        />
      )}
      {receipt && (
        <Sheet title="Receipt" onClose={() => setReceipt(null)}>
          <ReceiptPhoto path={receipt} style={{ width: "100%", height: 550 }} />
          <Txt style={[s.muted, { textAlign: "center" }]}>
            Shared privately with your household.
          </Txt>
        </Sheet>
      )}
    </SafeAreaView>
  );
}
function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[s.row, { gap: 9 }]}>
      <View
        style={{
          width: 34,
          height: 34,
          backgroundColor: C.green,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="ShoppingBasket" size={21} color="#F1F6E9" />
      </View>
      <Txt
        style={{
          fontFamily: "DMBold",
          fontSize: compact ? 21 : 23,
          letterSpacing: -1,
        }}
      >
        SplitCart<Txt style={{ color: C.green, fontSize: 24 }}>.</Txt>
      </Txt>
    </View>
  );
}
function PurchaseRow({
  e,
  onPress,
  last = false,
}: {
  e: Expense;
  onPress: () => void;
  last?: boolean;
}) {
  const st = useStore();
  const m = st.members.find((m) => m.id === e.paid_by);
  const self = st.members.find((m) => m.user_id === st.user?.id);
  const mine = e.shares.find((s) => s.member_id === self?.id);
  const { width } = useWindowDimensions();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`View ${e.name}`}
      onPress={onPress}
      style={({ hovered }: any) => [
        s.row,
        {
          gap: 13,
          padding: 17,
          borderBottomWidth: last ? 0 : 1,
          borderColor: C.line,
          backgroundColor: hovered ? "#FAFBF7" : C.white,
        },
      ]}
    >
      <CategoryIcon category={e.category} />
      <View style={{ flex: 1, gap: 5 }}>
        <Txt style={{ fontFamily: "DMSemi", fontSize: 13 }} numberOfLines={1}>
          {e.name}
        </Txt>
        <View style={[s.row, { gap: 5 }]}>
          <Txt style={{ fontSize: 10, color: C.muted }}>
            {m?.name.split(" ")[0]} paid · {shortDate(e.date)}
          </Txt>
          {e.receipt && <Icon name="Receipt" size={11} color="#8F9A89" />}
        </View>
        {e.one_time && (
          <Txt style={{ fontSize: 10, color: C.green }}>One-time purchase</Txt>
        )}
      </View>
      {e.receipt && (
        <ReceiptPhoto
          path={e.receipt}
          style={{
            width: 28,
            height: 36,
            borderRadius: 4,
            backgroundColor: "#F4F1E9",
          }}
        />
      )}
      {width >= 1200 && (
        <View
          style={{
            padding: 6,
            borderRadius: 5,
            backgroundColor: "#F6F7F2",
            marginRight: 15,
          }}
        >
          <Txt style={{ fontSize: 9, color: "#65745E" }}>{e.category}</Txt>
        </View>
      )}
      <View style={{ gap: 5, alignItems: "flex-end" }}>
        <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
          {money(e.cents, st.household?.currency)}
        </Txt>
        <Txt style={{ fontSize: 10, color: C.muted }}>
          your share {money(mine?.cents || 0, st.household?.currency)}
        </Txt>
      </View>
      <Icon name="ChevronRight" size={13} color="#A8B0A3" />
    </Pressable>
  );
}
function PurchaseHistory({
  onAdd,
  onOpen,
}: {
  onAdd: () => void;
  onOpen: (e: Expense) => void;
}) {
  const st = useStore();
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [member, setMember] = useState("All"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [filters, setFilters] = useState(false);
  const filtered = [...st.expenses]
    .filter(
      (e) =>
        `${e.name} ${e.store} ${e.notes}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (category === "All" || e.category === category) &&
        (member === "All" || e.paid_by === member) &&
        (!from || e.date >= from) &&
        (!to || e.date <= to),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <View style={[s.between, { gap: 15 }]}>
        <View style={{ flex: 1 }}>
          <Title>Shared purchases</Title>
          <Txt style={{ color: C.muted, marginTop: 8 }}>
            The little things that make a home.
          </Txt>
        </View>
        <Button icon="Plus" label="Add purchase" onPress={onAdd} />
      </View>
      <View style={[s.card, { gap: 17 }]}>
        <View style={[s.row, { gap: 12 }]}>
          <View
            style={[
              s.row,
              {
                flex: 1,
                borderWidth: 1,
                borderColor: C.line,
                borderRadius: 9,
                paddingHorizontal: 12,
                gap: 8,
              },
            ]}
          >
            <Icon name="Search" size={18} color={C.muted} />
            <TextInput
              accessibilityLabel="Search purchases"
              value={query}
              onChangeText={setQuery}
              placeholder="Search purchases or stores…"
              placeholderTextColor={C.muted}
              style={{
                flex: 1,
                fontFamily: "DM",
                fontSize: 13,
                padding: 13,
                color: C.ink,
              }}
            />
          </View>
          <Button
            secondary
            label="Filters"
            icon="SlidersHorizontal"
            onPress={() => setFilters(!filters)}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {["All", ...categories].map((c) => (
            <Chip
              label={c}
              key={c}
              active={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </ScrollView>
        {filters && (
          <>
            <Txt style={s.label}>PAID BY</Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Chip
                label="Everyone"
                active={member === "All"}
                onPress={() => setMember("All")}
              />
              {st.members.map((m) => (
                <Chip
                  label={m.name.split(" ")[0]}
                  key={m.id}
                  active={member === m.id}
                  onPress={() => setMember(m.id)}
                />
              ))}
            </View>
            <View style={[s.row, { gap: 15 }]}>
              <Field
                label="From date"
                value={from}
                onChangeText={setFrom}
                placeholder="YYYY-MM-DD"
              />
              <Field
                label="To date"
                value={to}
                onChangeText={setTo}
                placeholder="YYYY-MM-DD"
              />
            </View>
            <Button
              secondary
              small
              label="Clear filters"
              onPress={() => {
                setCategory("All");
                setMember("All");
                setFrom("");
                setTo("");
                setQuery("");
              }}
            />
          </>
        )}
      </View>
      <View style={s.between}>
        <Txt style={s.label}>
          {filtered.length} PURCHASE{filtered.length === 1 ? "" : "S"}
        </Txt>
        <Txt style={s.muted}>
          Total{" "}
          {money(
            filtered.reduce((n, e) => n + e.cents, 0),
            st.household?.currency,
          )}
        </Txt>
      </View>
      <View style={[s.card, { padding: 0, overflow: "hidden" }]}>
        {filtered.length ? (
          filtered.map((e, i) => (
            <PurchaseRow
              key={e.id}
              e={e}
              onPress={() => onOpen(e)}
              last={i === filtered.length - 1}
            />
          ))
        ) : (
          <Empty
            title="Nothing here just yet"
            description="Try another search or add your household’s first shared purchase."
            action={<Button label="Add purchase" onPress={onAdd} icon="Plus" />}
          />
        )}
      </View>
    </>
  );
}
function Balances({ onRepay }: { onRepay: () => void }) {
  const st = useStore();
  const b = balances(st.members, st.expenses, st.repayments);
  const suggestions = settlements(b);
  const fmt = (n: number) => money(n, st.household?.currency);
  const name = (id: string) =>
    st.members.find((m) => m.id === id)?.name.split(" ")[0] ||
    "Former roommate";
  return (
    <>
      <View style={[s.between, { gap: 15 }]}>
        <View style={{ flex: 1 }}>
          <Title>All squared up.</Title>
          <Txt style={{ color: C.muted, marginTop: 8 }}>
            Clear balances. Happy housemates.
          </Txt>
        </View>
        <Button label="Record repayment" icon="Plus" onPress={onRepay} />
      </View>
      <PaymentsPanel />
      <ExternalPayments />
      <CashPayments />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        {st.members.map((m, i) => (
          <View
            key={m.id}
            style={[s.card, { flexGrow: 1, flexBasis: 180, gap: 14 }]}
          >
            <View style={[s.row, { gap: 10 }]}>
              <Avatar name={m.name} index={i} />
              <View>
                <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                  {name(m.id)}
                </Txt>
                <Txt style={s.muted}>
                  {m.left_at ? "Former roommate" : "Roommate"}
                </Txt>
              </View>
            </View>
            <Txt
              style={{
                fontSize: 27,
                fontFamily: "DMSemi",
                color: b[m.id] >= 0 ? C.green : "#B17F51",
              }}
            >
              {fmt(Math.abs(b[m.id]))}
            </Txt>
            <Txt style={s.muted}>
              {b[m.id] > 0
                ? "is owed"
                : b[m.id] < 0
                  ? "owes the household"
                  : "all settled up"}
            </Txt>
          </View>
        ))}
      </View>
      <Title style={{ fontSize: 24 }}>The easy way to settle</Title>
      <View style={[s.card, { gap: 18 }]}>
        {suggestions.length ? (
          suggestions.map((r, i) => (
            <View
              key={i}
              style={[
                s.between,
                {
                  gap: 15,
                  paddingBottom: 12,
                  borderBottomWidth: i === suggestions.length - 1 ? 0 : 1,
                  borderColor: C.line,
                },
              ]}
            >
              <View style={[s.row, { gap: 10, flex: 1 }]}>
                <Icon name="ArrowUpRight" color={C.green} />
                <Txt style={{ flex: 1, lineHeight: 23 }}>
                  <Txt style={{ fontFamily: "DMBold" }}>{name(r.from_id)}</Txt>{" "}
                  owes{" "}
                  <Txt style={{ fontFamily: "DMBold" }}>{name(r.to_id)}</Txt>
                </Txt>
              </View>
              <Txt style={{ fontFamily: "DMBold", fontSize: 18 }}>
                {fmt(r.cents)}
              </Txt>
            </View>
          ))
        ) : (
          <Empty
            title="Everyone’s even"
            description="No settling needed. Your household is all caught up."
          />
        )}
        <View
          style={[
            s.row,
            { gap: 9, backgroundColor: C.sage, padding: 13, borderRadius: 9 },
          ]}
        >
          <Icon name="Info" color={C.green} size={17} />
          <Txt
            style={{ fontSize: 11, lineHeight: 18, color: C.green, flex: 1 }}
          >
            SplitCart calculates balances and records payments. Use Manage
            payments for bank/card payments, or pay your roommate outside the
            app and record it here. Never record a bank/card payment a second
            time.
          </Txt>
        </View>
      </View>
      <Title style={{ fontSize: 24 }}>Repayment history</Title>
      <View style={[s.card, { gap: 16 }]}>
        {st.repayments.length ? (
          st.repayments.map((r) => (
            <View key={r.id} style={[s.between, { gap: 10 }]}>
              <View style={[s.row, { gap: 12, flex: 1 }]}>
                <View
                  style={{
                    backgroundColor: C.sage,
                    padding: 10,
                    borderRadius: 10,
                  }}
                >
                  <Icon name="Check" color={C.green} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontFamily: "DMSemi", fontSize: 13 }}>
                    {name(r.from_id)} paid {name(r.to_id)}
                  </Txt>
                  <Txt style={{ fontSize: 10, color: C.muted, marginTop: 5 }}>
                    {r.method === "cash"
                      ? "Cash payment"
                      : r.method === "venmo"
                        ? "Venmo · receiver confirmed"
                        : r.method === "zelle"
                          ? "Zelle · receiver confirmed"
                          : r.method === "bank_card"
                            ? "Bank / card payment"
                            : "Recorded payment"}{" "}
                    · {shortDate(r.date)}
                  </Txt>
                </View>
              </View>
              <Txt style={{ fontFamily: "DMBold" }}>{fmt(r.cents)}</Txt>
            </View>
          ))
        ) : (
          <Txt style={s.muted}>
            Repayments will appear here. Record an outside payment manually, or
            use Manage payments for bank/card payments.
          </Txt>
        )}
      </View>
    </>
  );
}
function PurchaseEditor({
  expense,
  shoppingItem,
  groceryTripId,
  onClose,
  onSaved,
}: {
  expense: Expense | null;
  shoppingItem?: ShoppingItem;
  groceryTripId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const st = useStore();
  const self = st.members.find((m) => m.user_id === st.user?.id);
  const [id] = useState(expense?.id || uid());
  const [oneTime, setOneTime] = useState(
    Boolean(expense?.one_time ?? shoppingItem?.one_time),
  );
  const [name, setName] = useState(
      expense?.name ||
        shoppingItem?.name ||
        (groceryTripId ? "Grocery trip" : ""),
    ),
    [amount, setAmount] = useState(
      expense ? (expense.cents / 100).toFixed(2) : "",
    ),
    [date, setDate] = useState(expense?.date || today()),
    [store, setStore] = useState(expense?.store || ""),
    [notes, setNotes] = useState(
      expense?.notes ||
        (shoppingItem
          ? st.grocery.essentials.find(
              (e: { shoppingId: string | null }) =>
                e.shoppingId === shoppingItem.id,
            )?.notes
          : "") ||
        "",
    ),
    [category, setCategory] = useState(
      expense?.category ||
        (shoppingItem ? purchaseCategory(shoppingItem.category) : "Groceries"),
    ),
    [paidBy, setPaidBy] = useState(
      expense?.paid_by ||
        (shoppingItem &&
        st.members.some((m) => m.id === shoppingItem.assigned_to && !m.left_at)
          ? shoppingItem.assigned_to
          : self?.id) ||
        "",
    ),
    [selected, setSelected] = useState(
      expense?.split_percentages?.map((entry) => entry.member_id) ||
        expense?.shares.map((s) => s.member_id) ||
        st.members.filter((m) => !m.left_at).map((m) => m.id),
    ),
    [splitMode, setSplitMode] = useState<"equal" | "custom" | "percentage">(
      () =>
        expense?.split_percentages
          ? "percentage"
          : expense &&
              JSON.stringify(
                [...expense.shares].sort((a, b) =>
                  a.member_id.localeCompare(b.member_id),
                ),
              ) !==
                JSON.stringify(
                  equalSplit(
                    expense.cents,
                    expense.shares.map((s) => s.member_id),
                  ),
                )
            ? "custom"
            : "equal",
    ),
    [percentages, setPercentages] = useState<Record<string, string>>(() =>
      Object.fromEntries(
        expense?.split_percentages?.map(({ member_id, percentage }) => [
          member_id,
          percentage,
        ]) || [],
      ),
    ),
    [customAmounts, setCustomAmounts] = useState<Record<string, string>>(
      Object.fromEntries(
        expense?.shares.map((s) => [s.member_id, (s.cents / 100).toFixed(2)]) ||
          [],
      ),
    ),
    [receipt, setReceipt] = useState(expense?.receipt || null),
    [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [itemized, setItemized] = useState(!!expense?.receipt_details);
  const [receiptItems, setReceiptItems] = useState(() =>
    receiptDraft(
      expense?.receipt_details,
      st.members.filter((m) => !m.left_at).map((m) => m.id),
    ),
  );
  const [receiptReviewed, setReceiptReviewed] = useState(false);
  const lock = useRef(false);
  const uploaded = useRef<string | null>(null);
  const available = st.members.filter(
    (m) =>
      !m.left_at ||
      expense?.shares.some((s) => s.member_id === m.id) ||
      expense?.paid_by === m.id,
  );
  let receiptDetails: ReceiptDetails | null = null,
    receiptCalculation: ReturnType<typeof calculateReceipt> | undefined,
    receiptError = "";
  if (itemized)
    try {
      receiptDetails = detailsFromDraft(receiptItems);
      receiptCalculation = calculateReceipt(
        receiptDetails,
        st.members.map((m) => m.id),
      );
    } catch (e) {
      receiptError = (e as Error).message;
    }
  let cents = 0;
  try {
    cents = itemized ? receiptCalculation?.total || 0 : parseMoney(amount);
  } catch {}
  const percentageEntries =
    !itemized && splitMode === "percentage"
      ? selected.map((member_id) => ({
          member_id,
          percentage: (percentages[member_id] || "").trim(),
        }))
      : null;
  let shares: Expense["shares"] = [];
  let percentageError = "";
  try {
    if (itemized) shares = receiptCalculation?.shares || [];
    else if (percentageEntries)
      shares = percentageSplit(cents, percentageEntries);
    else if (splitMode === "custom")
      shares = selected.map((member_id) => ({
        member_id,
        cents: parseMoney(customAmounts[member_id] || "", true),
      }));
    else shares = equalSplit(cents, selected);
  } catch (e) {
    if (percentageEntries) percentageError = (e as Error).message;
  }
  const pick = async (camera: boolean) => {
    if (busy) return;
    setReceiptReviewed(false);
    setError("");
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Allow photo access in your device settings to add a receipt.",
        );
      const result = camera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.8,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.8,
          });
      if (!result.canceled) {
        const a = result.assets[0];
        if (a.fileSize) validateImage(a.mimeType || "image/jpeg", a.fileSize);
        setAsset(a);
        setReceipt(a.uri);
        uploaded.current = null;
      }
    } catch (e: any) {
      setError(e.message);
    }
  };
  const scanReceipt = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      let extracted: any;
      if (st.demo) {
        setReceipt(demoReceipt);
        setAsset(null);
        uploaded.current = null;
        extracted = {
          merchant: "Green Market",
          date: null,
          currency: st.household!.currency,
          items: [
            { name: "Fresh produce", cents: 2450 },
            { name: "Pantry staples", cents: 3200 },
            { name: "Oat milk x 3", cents: 1200 },
            { name: "Bread & eggs", cents: 1700 },
          ],
          taxCents: 0,
          tipCents: 0,
          discountCents: 0,
          totalCents: 8550,
        };
      } else {
        let path = receipt;
        if (asset) {
          if (!uploaded.current)
            uploaded.current = await uploadReceipt(
              asset,
              st.household!.id,
              st.user!.id,
            );
          path = uploaded.current;
        }
        if (!path) throw new Error("Upload a receipt photo first.");
        const { data, error } = await client().functions.invoke(
          "scan-receipt",
          { body: { household_id: st.household!.id, receipt_path: path } },
        );
        if (error) {
          let message =
            "Receipt scanning is unavailable. Enter the receipt items manually.";
          try {
            const body = await error.context?.json();
            if (body?.error) message = body.error;
          } catch {}
          throw new Error(message);
        }
        extracted = validateExtraction(data, st.household!.currency);
      }
      const details: ReceiptDetails = {
        items: extracted.items.map((i: { name: string; cents: number }) => ({
          ...i,
          members: st.members.filter((m) => !m.left_at).map((m) => m.id),
        })),
        taxCents: extracted.taxCents,
        tipCents: extracted.tipCents,
        discountCents: extracted.discountCents,
        cashbackExpectedCents: 0,
        cashbackReceivedCents: 0,
        sourceTotalCents: extracted.totalCents,
      };
      setReceiptItems(receiptDraft(details));
      setItemized(true);
      setReceiptReviewed(false);
      if (!name.trim())
        setName(
          extracted.merchant
            ? `${extracted.merchant} receipt`
            : "Itemized receipt",
        );
      if (!store.trim()) setStore(extracted.merchant);
      if (extracted.date) setDate(extracted.date);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { validateExpense } = await import("./src/core");
      if (percentageError) throw new Error(percentageError);
      if (itemized && receiptError) throw new Error(receiptError);
      if (itemized && !receiptReviewed)
        throw new Error(
          "Review the receipt items, assignments and total before saving.",
        );
      const purchase: Expense = {
        id,
        one_time: oneTime,
        household_id: st.household!.id,
        grocery_trip_id: expense?.grocery_trip_id || groceryTripId || null,
        name: name.trim(),
        cents,
        receipt_details: itemized ? receiptDetails : null,
        split_percentages: percentageEntries,
        date,
        paid_by: paidBy,
        category,
        store: store.trim(),
        notes: notes.trim(),
        receipt,
        shares,
        created_at: expense?.created_at || new Date().toISOString(),
      };
      validateExpense(purchase, st.members);
      if (asset) {
        if (st.demo && !browserPreviewEnabled) {
          if (Platform.OS === "web") {
            const response = await fetch(asset.uri);
            const blob = await response.blob();
            validateImage(asset.mimeType || blob.type, blob.size);
            purchase.receipt = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          } else {
            const { File } = await import("expo-file-system");
            const file = new File(asset.uri);
            validateImage(asset.mimeType || "image/jpeg", file.size);
            purchase.receipt = `data:${asset.mimeType || "image/jpeg"};base64,${await file.base64()}`;
          }
        } else {
          if (!uploaded.current)
            uploaded.current = await uploadReceipt(
              asset,
              st.household!.id,
              st.user!.id,
            );
          purchase.receipt = uploaded.current;
        }
      }
      await st.saveExpense(purchase, shoppingItem?.id);
      onSaved();
    } catch (e: any) {
      setError(e.message || "Couldn’t save this purchase. Please try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={expense ? "Edit purchase" : "Add a purchase"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Txt style={s.muted}>Big shop or small thing, every share counts.</Txt>
      <Field
        label="What did you buy? *"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Weekly grocery run"
      />
      <View style={[s.row, { gap: 14, alignItems: "flex-start" }]}>
        <Field
          label={`Total (${st.household?.currency}) *`}
          value={itemized ? (cents / 100).toFixed(2) : amount}
          editable={!itemized}
          onChangeText={setAmount}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <Field
          label="Purchase date *"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
        />
      </View>
      <View style={{ gap: 9 }}>
        <Txt style={{ fontFamily: "DMBold", fontSize: 12 }}>Who paid? *</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {available.map((m) => (
            <Chip
              label={m.name.split(" ")[0] + (m.id === self?.id ? " (you)" : "")}
              key={m.id}
              active={paidBy === m.id}
              onPress={() => setPaidBy(m.id)}
            />
          ))}
        </View>
        {paidBy !== self?.id && (
          <Txt style={{ fontSize: 11, color: C.muted }}>
            Only the roommate who paid can edit or delete this purchase.
          </Txt>
        )}
      </View>
      <Field
        label="Store (optional)"
        value={store}
        onChangeText={setStore}
        placeholder="Where did you shop?"
      />
      <View style={{ gap: 9 }}>
        <Txt style={{ fontFamily: "DMBold", fontSize: 12 }}>Category</Txt>
        <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
          {categories.map((c) => (
            <Chip
              key={c}
              label={c}
              active={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>
      </View>
      <View style={s.divider} />
      {!itemized && (
        <>
          <View style={{ gap: 8 }}>
            <Title style={{ fontSize: 22 }}>Split with</Title>
            <View style={[s.row, { gap: 7, flexWrap: "wrap" }]}>
              <Chip
                label="Equally"
                active={splitMode === "equal"}
                onPress={() => setSplitMode("equal")}
              />
              <Chip
                label="Custom"
                active={splitMode === "custom"}
                onPress={() => {
                  setSplitMode("custom");
                  if (!Object.keys(customAmounts).length)
                    setCustomAmounts(
                      Object.fromEntries(
                        shares.map((s) => [
                          s.member_id,
                          (s.cents / 100).toFixed(2),
                        ]),
                      ),
                    );
                }}
              />
              <Chip
                label="Percentage"
                active={splitMode === "percentage"}
                onPress={() => setSplitMode("percentage")}
              />
            </View>
          </View>
          <View style={{ gap: 12 }}>
            {available.map((m, i) => (
              <View key={m.id} style={[s.row, { gap: 11 }]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Split with ${m.name}`}
                  accessibilityState={{ checked: selected.includes(m.id) }}
                  onPress={() =>
                    setSelected(
                      selected.includes(m.id)
                        ? selected.filter((x) => x !== m.id)
                        : [...selected, m.id],
                    )
                  }
                  style={[s.row, { gap: 10, flex: 1, minHeight: 44 }]}
                >
                  <View
                    style={{
                      width: 21,
                      height: 21,
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: selected.includes(m.id) ? C.green : C.line,
                      backgroundColor: selected.includes(m.id)
                        ? C.green
                        : C.white,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {selected.includes(m.id) && (
                      <Icon name="Check" size={14} color={C.white} />
                    )}
                  </View>
                  <Avatar name={m.name} index={i} size={30} />
                  <Txt style={{ fontSize: 12, flex: 1 }}>
                    {m.name}
                    {m.left_at ? " · former" : ""}
                  </Txt>
                </Pressable>
                {selected.includes(m.id) &&
                  (splitMode === "custom" ? (
                    <TextInput
                      accessibilityLabel={`${m.name} custom share`}
                      keyboardType="decimal-pad"
                      value={customAmounts[m.id] || ""}
                      placeholder="0.00"
                      onChangeText={(v) =>
                        setCustomAmounts({ ...customAmounts, [m.id]: v })
                      }
                      style={{
                        borderWidth: 1,
                        borderColor: C.line,
                        borderRadius: 7,
                        padding: 10,
                        width: 95,
                        fontFamily: "DM",
                        color: C.ink,
                        textAlign: "right",
                      }}
                    />
                  ) : splitMode === "percentage" ? (
                    <View style={[s.row, { gap: 5 }]}>
                      <TextInput
                        accessibilityLabel={`${m.name} percentage`}
                        keyboardType="decimal-pad"
                        value={percentages[m.id] || ""}
                        placeholder="0"
                        onChangeText={(value) =>
                          setPercentages((previous) => ({
                            ...previous,
                            [m.id]: value,
                          }))
                        }
                        style={{
                          borderWidth: 1,
                          borderColor: C.line,
                          borderRadius: 7,
                          padding: 8,
                          width: 64,
                          minHeight: 44,
                          fontFamily: "DM",
                          color: C.ink,
                          textAlign: "right",
                        }}
                      />
                      <Txt style={s.muted}>%</Txt>
                      <Txt
                        accessibilityLabel={`${m.name} amount owed`}
                        style={{
                          fontFamily: "DMBold",
                          fontSize: 13,
                          minWidth: 58,
                          textAlign: "right",
                        }}
                      >
                        {percentageError || !cents
                          ? "—"
                          : money(
                              shares.find((share) => share.member_id === m.id)
                                ?.cents ?? 0,
                              st.household?.currency,
                            )}
                      </Txt>
                    </View>
                  ) : (
                    <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
                      {money(
                        shares.find((s) => s.member_id === m.id)?.cents || 0,
                        st.household?.currency,
                      )}
                    </Txt>
                  ))}
              </View>
            ))}
          </View>
          <View
            style={[
              s.between,
              { backgroundColor: C.sage, padding: 13, borderRadius: 9 },
            ]}
          >
            <Txt style={{ fontSize: 12, color: C.green }}>
              Total split · {selected.length} roommates
            </Txt>
            <Txt style={{ fontFamily: "DMBold", color: C.green }}>
              {percentageEntries && (percentageError || !cents)
                ? "—"
                : money(
                    shares.reduce((n, s) => n + s.cents, 0),
                    st.household?.currency,
                  )}
            </Txt>
          </View>
          {percentageError && (
            <Txt accessibilityRole="alert" style={{ color: C.red }}>
              {percentageError}
            </Txt>
          )}
          {splitMode === "equal" && (
            <Txt style={{ fontSize: 10, color: C.muted, marginTop: -12 }}>
              Any spare cents are distributed consistently so the shares always
              match.
            </Txt>
          )}
          <SplitTemplates
            purchaseAllocations={percentageEntries}
            onApply={(allocations) => {
              setSplitMode("percentage");
              setSelected(allocations.map(({ member_id }) => member_id));
              setPercentages(
                Object.fromEntries(
                  allocations.map(({ member_id, percentage }) => [
                    member_id,
                    percentage,
                  ]),
                ),
              );
              setError("");
            }}
          />
          <View style={s.divider} />
        </>
      )}
      <View style={{ gap: 12 }}>
        <Title style={{ fontSize: 22 }}>
          Receipt <Txt style={s.muted}>(optional)</Txt>
        </Title>
        {receipt && (
          <View style={[s.row, { gap: 15 }]}>
            {asset ? (
              <Image
                source={{ uri: asset.uri }}
                style={{ height: 100, width: 85, borderRadius: 8 }}
              />
            ) : (
              <ReceiptPhoto
                path={receipt}
                style={{ height: 100, width: 85, borderRadius: 8 }}
              />
            )}
            <Button
              secondary
              small
              label="Remove"
              onPress={() => {
                setReceipt(null);
                setAsset(null);
                uploaded.current = null;
              }}
            />
          </View>
        )}
        <View style={[s.row, { gap: 10 }]}>
          <Button
            secondary
            small
            label="Take photo"
            icon="Camera"
            onPress={() => pick(true)}
          />
          <Button
            secondary
            small
            label="Choose photo"
            icon="ImageIcon"
            onPress={() => pick(false)}
          />
        </View>
        {st.demo && !receipt && (
          <Pressable
            onPress={() => {
              setReceipt(demoReceipt);
              setAsset(null);
            }}
          >
            <Txt style={s.link}>Try a sample receipt</Txt>
          </Pressable>
        )}
        <Txt style={{ fontSize: 10, color: C.muted }}>
          JPEG, PNG or WebP · up to 5 MB · private to your household
        </Txt>
        {receipt && (
          <Button
            secondary
            label={st.demo ? "Load sample receipt items" : "Scan receipt items"}
            disabled={busy}
            onPress={() => void scanReceipt()}
          />
        )}
        <Txt style={s.muted}>
          {st.demo
            ? "The sample scan loads the sample receipt’s items; it does not read uploaded images. You can enter any receipt’s items manually below."
            : "Optional scanning sends this private receipt image to the configured AI receipt service. Review every extracted item and total before saving. Manual entry works without a scanning service."}
        </Txt>
        <Button
          secondary
          label={
            itemized
              ? "Use a simple total instead"
              : "Itemize receipt and track cashback"
          }
          disabled={busy}
          onPress={() => {
            if (itemized && receiptCalculation)
              setAmount((receiptCalculation.total / 100).toFixed(2));
            setItemized(!itemized);
            setReceiptReviewed(false);
          }}
        />
        {itemized && (
          <ReceiptItemEditor
            payerId={paidBy}
            draft={receiptItems}
            onChange={(draft) => {
              setReceiptItems(draft);
              setReceiptReviewed(false);
            }}
            members={available}
            currency={st.household!.currency}
            reviewed={receiptReviewed}
            onReviewed={setReceiptReviewed}
            busy={busy}
          />
        )}
      </View>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel="One-time purchase"
        accessibilityState={{ checked: oneTime }}
        aria-checked={oneTime}
        onPress={() => setOneTime(!oneTime)}
        style={[s.row, { gap: 10, paddingVertical: 12 }]}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: C.green,
            backgroundColor: oneTime ? C.green : C.white,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {oneTime && <Icon name="Check" size={15} color={C.white} />}
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
            One-time purchase
          </Txt>
          <Txt style={s.muted}>
            Keep this in history without offering it as a repeat buy.
          </Txt>
        </View>
      </Pressable>
      {shoppingItem && (
        <Txt style={{ color: C.green, fontSize: 12 }}>
          Saving logs the actual purchase and completes “{shoppingItem.name}” on
          your household shopping list.
        </Txt>
      )}
      <Field
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        placeholder="Anything your roommates should know?"
        multiline
      />
      {error && (
        <Txt accessibilityRole="alert" style={{ color: C.red, lineHeight: 21 }}>
          {error}
        </Txt>
      )}
      <Button
        label={busy ? "Saving…" : expense ? "Save changes" : "Save purchase"}
        icon="Check"
        loading={busy}
        disabled={Boolean(percentageError)}
        onPress={save}
      />
    </Sheet>
  );
}
function PurchaseDetail({
  e,
  onClose,
  onEdit,
  onReceipt,
  notify,
}: {
  e: Expense;
  onClose: () => void;
  onEdit: () => void;
  onReceipt: (path: string) => void;
  notify: (s: string) => void;
}) {
  const st = useStore();
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const editable = canEdit(st.user!.id, e, st.members);
  const name = (id: string) =>
    st.members.find((m) => m.id === id)?.name || "Former roommate";
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await st.deleteExpense(e);
      onClose();
      notify("Purchase deleted. Balances have been updated.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Purchase details" onClose={onClose}>
      <View style={{ alignItems: "center", gap: 12 }}>
        <CategoryIcon category={e.category} size={58} />
        <Title style={{ fontSize: 28, textAlign: "center" }}>{e.name}</Title>
        <Txt style={{ fontSize: 35, fontFamily: "DMSemi" }}>
          {money(e.cents, st.household?.currency)}
        </Txt>
        <Txt style={s.muted}>
          {name(e.paid_by)} paid · {shortDate(e.date)}
        </Txt>
        <Chip label={e.category} />
        {e.one_time && (
          <Txt style={{ color: C.green, fontSize: 12 }}>One-time purchase</Txt>
        )}
      </View>
      <View style={[s.card, { gap: 15 }]}>
        {e.store && (
          <View style={s.between}>
            <Txt style={s.muted}>Store</Txt>
            <Txt>{e.store}</Txt>
          </View>
        )}
        <View style={s.between}>
          <Txt style={s.muted}>Purchase date</Txt>
          <Txt>{e.date}</Txt>
        </View>
        {e.notes && (
          <>
            <View style={s.divider} />
            <Txt style={{ lineHeight: 22 }}>{e.notes}</Txt>
          </>
        )}
      </View>
      <Title style={{ fontSize: 23 }}>Everyone’s share</Title>
      {e.shares.map((share, i) => (
        <View key={share.member_id} style={[s.row, { gap: 10 }]}>
          <Avatar name={name(share.member_id)} index={i} />
          <Txt style={{ flex: 1 }}>{name(share.member_id)}</Txt>
          <Txt style={{ fontFamily: "DMBold" }}>
            {money(share.cents, st.household?.currency)}
          </Txt>
        </View>
      ))}
      {e.receipt_details && (
        <View style={{ gap: 9 }}>
          <Title style={{ fontSize: 23 }}>Receipt expense list</Title>
          {e.receipt_details.items.map((item, index) => (
            <View key={index} style={{ gap: 3 }}>
              <Txt style={{ fontFamily: "DMBold" }}>
                {item.name} · {money(item.cents, st.household?.currency)}
              </Txt>
              <Txt style={s.muted}>
                Shared by {item.members.map(name).join(", ")}
              </Txt>
            </View>
          ))}
          <Txt>
            Tax {money(e.receipt_details.taxCents, st.household?.currency)} ·
            Tip {money(e.receipt_details.tipCents, st.household?.currency)} ·
            Discount{" "}
            {money(e.receipt_details.discountCents, st.household?.currency)}
          </Txt>
          <Txt>
            External cashback expected:{" "}
            {money(
              e.receipt_details.cashbackExpectedCents,
              st.household?.currency,
            )}{" "}
            · Reported received:{" "}
            {money(
              e.receipt_details.cashbackReceivedCents,
              st.household?.currency,
            )}
          </Txt>
          <Txt style={s.muted}>
            Cashback is self-reported and does not reduce these shares.
            SplitCart does not issue or redeem rewards.
          </Txt>
        </View>
      )}
      {e.receipt && (
        <>
          <Title style={{ fontSize: 23 }}>The receipt</Title>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open receipt viewer"
            onPress={() => onReceipt(e.receipt!)}
            style={[s.card, { alignItems: "center", gap: 10 }]}
          >
            <ReceiptPhoto
              path={e.receipt}
              style={{ height: 160, width: 120 }}
            />
            <Txt style={s.link}>View full receipt ↗</Txt>
          </Pressable>
        </>
      )}
      {editable && (
        <>
          <View style={s.divider} />
          {confirm ? (
            <View style={{ gap: 14 }}>
              <Txt style={{ color: C.red }}>
                Delete this purchase? Its shares will be removed and everyone’s
                balance will change.
              </Txt>
              <View style={[s.row, { gap: 10 }]}>
                <Button
                  label="Keep purchase"
                  secondary
                  onPress={() => setConfirm(false)}
                  disabled={busy}
                />
                <Button
                  danger
                  label="Delete purchase"
                  icon="Trash2"
                  onPress={remove}
                  loading={busy}
                />
              </View>
            </View>
          ) : (
            <View style={[s.row, { gap: 12 }]}>
              <Button
                secondary
                label="Edit purchase"
                icon="Pencil"
                onPress={onEdit}
              />
              <Button
                danger
                label="Delete"
                icon="Trash2"
                onPress={() => setConfirm(true)}
              />
            </View>
          )}
        </>
      )}
      {error && <Txt style={{ color: C.red }}>{error}</Txt>}
    </Sheet>
  );
}
function RepayModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const st = useStore();
  const self = st.members.find((m) => m.user_id === st.user?.id)!;
  const suggestions = settlements(
    balances(st.members, st.expenses, st.repayments),
  );
  const suggestion =
    suggestions.find((r) => r.from_id === self.id || r.to_id === self.id) ||
    suggestions[0];
  const [from, setFrom] = useState(suggestion?.from_id || self.id),
    [to, setTo] = useState(
      suggestion?.to_id || st.members.find((m) => m.id !== self.id)?.id || "",
    ),
    [amount, setAmount] = useState(
      suggestion ? (suggestion.cents / 100).toFixed(2) : "",
    ),
    [date, setDate] = useState(today()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "other">("other");
  const [id] = useState(uid());
  const lock = useRef(false);
  const save = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      if (from === to) throw new Error("Choose two different roommates.");
      if (from !== self.id && to !== self.id)
        throw new Error("You can only record repayments you sent or received.");
      if (!validDate(date))
        throw new Error("Use a valid date in YYYY-MM-DD format.");
      await (paymentMethod === "cash" ? st.proposeCash : st.repay)({
        id,
        household_id: st.household!.id,
        from_id: from,
        to_id: to,
        cents: parseMoney(amount),
        date,
        recorded_by: st.user!.id,
        method: paymentMethod,
      });
      onSaved(
        paymentMethod === "cash"
          ? "Cash entry sent. Your roommate must confirm receipt before balances change."
          : "Repayment recorded. Your balances are up to date.",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  return (
    <Sheet
      title="Record a repayment"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <View
        style={{
          backgroundColor: C.sage,
          padding: 15,
          borderRadius: 10,
          gap: 7,
        }}
      >
        <Txt style={{ fontFamily: "DMBold", color: C.green }}>
          Already paid your roommate?
        </Txt>
        <Txt style={{ fontSize: 12, color: C.green, lineHeight: 20 }}>
          Record a payment you sent or received outside SplitCart. This does not
          transfer money.
        </Txt>
      </View>
      <Txt style={s.label}>PAYMENT TYPE</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip
          label="Cash"
          active={paymentMethod === "cash"}
          onPress={() => {
            setPaymentMethod("cash");
            setFrom(self.id);
            if (to === self.id)
              setTo(
                st.members.find((m) => m.id !== self.id && !m.left_at)?.id ||
                  "",
              );
          }}
        />
        <Chip
          label="Other outside payment"
          active={paymentMethod === "other"}
          onPress={() => setPaymentMethod("other")}
        />
      </View>
      {paymentMethod === "cash" && (
        <Txt>
          Record only cash you handed over. Your roommate must confirm receipt
          before balances change. SplitCart does not transfer money.
        </Txt>
      )}
      <Txt style={s.label}>WHO SENT IT?</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {st.members
          .filter((m) => paymentMethod !== "cash" || m.id === self.id)
          .map((m) => (
            <Chip
              key={m.id}
              label={m.name.split(" ")[0] + (m.left_at ? " (former)" : "")}
              active={from === m.id}
              onPress={() => setFrom(m.id)}
            />
          ))}
      </View>
      <Txt style={s.label}>WHO RECEIVED IT?</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {st.members
          .filter(
            (m) => paymentMethod !== "cash" || (m.id !== self.id && !m.left_at),
          )
          .map((m) => (
            <Chip
              key={m.id}
              label={m.name.split(" ")[0] + (m.left_at ? " (former)" : "")}
              active={to === m.id}
              onPress={() => setTo(m.id)}
            />
          ))}
      </View>
      <Field
        label={`Amount (${st.household?.currency})`}
        value={amount}
        onChangeText={setAmount}
        placeholder="0.00"
        keyboardType="decimal-pad"
      />
      <Field
        label="Payment date"
        value={date}
        onChangeText={setDate}
        placeholder="YYYY-MM-DD"
      />
      {error && (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {error}
        </Txt>
      )}
      <Button
        label={
          paymentMethod === "cash"
            ? "Send cash for confirmation"
            : "Confirm recorded payment"
        }
        icon="Check"
        loading={busy}
        onPress={save}
      />
    </Sheet>
  );
}
function HouseholdInvitation({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const st = useStore();
  const [error, setError] = useState("");
  const [sharing, setSharing] = useState(false);
  const share = async () => {
    if (sharing) return;
    setSharing(true);
    setError("");
    try {
      const code = st.household!.invite_code;
      if (Platform.OS === "web") {
        if (!navigator.clipboard)
          throw new Error(
            "Select the code above to copy it, then share it privately with your roommates.",
          );
        await navigator.clipboard.writeText(code);
        notify(
          "Invitation code copied. Share it privately with your roommates.",
        );
      } else {
        await Share.share({
          message: `Join ${st.household!.name} on SplitCart. Create your own account, choose “Join with a code”, and enter: ${code}`,
        });
      }
    } catch (e: any) {
      setError(e.message || "Select and copy the code above to share it.");
    } finally {
      setSharing(false);
    }
  };
  return (
    <View style={{ gap: 14 }}>
      <Title style={{ fontSize: 23 }}>Invite your roommates</Title>
      <Txt style={{ color: C.muted, fontSize: 12, lineHeight: 20 }}>
        Everyone creates their own login. Ask them to choose “Join with a code”
        during signup and enter your household’s code below.
      </Txt>
      <View style={{ backgroundColor: C.sage, padding: 17, borderRadius: 10 }}>
        <Txt
          selectable
          accessibilityLabel="Household invitation code"
          style={{
            fontFamily: "DMBold",
            fontSize: 17,
            letterSpacing: 1,
            color: C.green,
          }}
        >
          {st.household &&
            (/^[a-f0-9]{32}$/i.test(st.household.invite_code)
              ? st.household.invite_code.match(/.{1,4}/g)?.join(" ")
              : st.household.invite_code)}
        </Txt>
      </View>
      <Button
        secondary
        icon="Copy"
        label={
          Platform.OS === "web"
            ? "Copy invitation code"
            : "Share invitation code"
        }
        loading={sharing}
        onPress={share}
      />
      <Txt style={{ fontSize: 11, color: C.muted, lineHeight: 18 }}>
        {st.demo
          ? browserPreviewEnabled
            ? "Preview codes link separate sample logins in this browser only. No email is sent and nothing syncs between devices."
            : "Sample code only. Enable live accounts to invite real roommates."
          : "This code gives access to your household’s shared purchases and receipts. Share it only with your roommates."}
      </Txt>
      {error !== "" && (
        <Txt accessibilityRole="alert" style={{ color: C.red }}>
          {error}
        </Txt>
      )}
    </View>
  );
}

function HouseholdSettings({ notify }: { notify: (m: string) => void }) {
  const st = useStore();
  const self = st.members.find((m) => m.user_id === st.user?.id)!;
  const [houseName, setHouseName] = useState(st.household?.name || "");
  useEffect(() => {
    setHouseName(st.household?.name || "");
  }, [st.household?.name]);
  const [name, setName] = useState(self.name),
    [busy, setBusy] = useState(false),
    [leave, setLeave] = useState(false),
    [error, setError] = useState(""),
    [reset, setReset] = useState(false);
  const run = async (action: () => Promise<any>, message: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      notify(message);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <DeveloperBusinessSettings />
      <SecuritySettings />
      <AccessibilitySettings />
      <View>
        <Title>Your household</Title>
        <Txt style={{ color: C.muted, marginTop: 8 }}>
          The people who make your place, your place.
        </Txt>
      </View>
      <View style={[s.card, { gap: 20 }]}>
        <View style={[s.row, { gap: 16 }]}>
          <View
            style={{ padding: 17, borderRadius: 13, backgroundColor: C.sage }}
          >
            <Icon name="Home" color={C.green} size={28} />
          </View>
          <View style={{ flex: 1 }}>
            <Title style={{ fontSize: 25 }}>{st.household?.name}</Title>
            <Txt style={{ color: C.muted, fontSize: 12, marginTop: 5 }}>
              {st.household?.currency} · One household, one currency
            </Txt>
          </View>
        </View>
        <View style={s.divider} />
        <Txt style={s.label}>YOUR ROOMMATES</Txt>
        {st.members.map((m, i) => (
          <View key={m.id} style={[s.row, { gap: 12 }]}>
            <Avatar name={m.name} index={i} size={40} />
            <View style={{ flex: 1 }}>
              <Txt style={{ fontFamily: "DMSemi" }}>
                {m.name}
                {m.user_id === st.user?.id ? " (you)" : ""}
              </Txt>
              <Txt style={[s.muted, { marginTop: 4 }]}>
                {m.left_at
                  ? "Former roommate · history preserved"
                  : "Household member"}
              </Txt>
            </View>
            <Icon
              name={m.left_at ? "LogOut" : "CheckCircle2"}
              size={18}
              color={m.left_at ? C.muted : "#93AE83"}
            />
          </View>
        ))}
      </View>
      <View style={[s.card, { gap: 17 }]}>
        <Title style={{ fontSize: 23 }}>Make it your home</Title>
        <Field
          label="Household name"
          value={houseName}
          onChangeText={setHouseName}
          placeholder="Choose any name, up to 80 characters"
          maxLength={80}
        />
        <Txt style={s.muted}>
          Any current roommate can update the name. Your code and shared history
          stay the same.
        </Txt>
        <Button
          secondary
          label="Save household name"
          icon="Check"
          loading={busy}
          onPress={() =>
            run(
              () => st.renameHousehold(houseName),
              "Your household name has been updated.",
            )
          }
          style={{ alignSelf: "flex-start" }}
        />
      </View>
      <View style={s.card}>
        <HouseholdInvitation notify={notify} />
      </View>
      <View style={[s.card, { gap: 17 }]}>
        <Title style={{ fontSize: 23 }}>Your profile</Title>
        <Field label="Display name" value={name} onChangeText={setName} />
        <Button
          label="Save profile"
          secondary
          icon="Check"
          loading={busy}
          onPress={() =>
            run(() => st.profile(name), "Your profile has been updated.")
          }
          style={{ alignSelf: "flex-start" }}
        />
      </View>
      <View style={[s.card, { gap: 16 }]}>
        <Title style={{ fontSize: 23 }}>Settings</Title>
        <Txt style={{ fontSize: 12, color: C.muted, lineHeight: 20 }}>
          {st.demo
            ? browserPreviewEnabled
              ? "Full browser preview: use made-up account details and sample receipts. Purchases, local accounts, codes, and payment simulations are saved only in this browser. No real money, emails, or texts are sent."
              : "You’re exploring SplitCart with a sample household. Demo changes are saved on this device."
            : "You’re using a live Supabase household. Pull down on a screen to refresh shared activity."}
        </Txt>
        <Button
          secondary
          icon="RefreshCw"
          label={
            browserPreviewEnabled
              ? "Switch preview account"
              : st.demo
                ? "Switch to live accounts"
                : "Explore demo mode"
          }
          onPress={st.switchMode}
        />
        {!browserPreviewEnabled && !liveConfigured && st.demo && (
          <Txt style={{ fontSize: 11, color: C.muted, lineHeight: 18 }}>
            Live setup: add your Supabase URL and public anon key to .env, apply
            the migration, then restart Expo. Full steps are in the README.
          </Txt>
        )}
        {st.demo && (
          <Button
            secondary
            label="Reset demo data"
            onPress={() => setReset(true)}
          />
        )}
        <Button
          secondary
          label="Sign out"
          icon="LogOut"
          onPress={() => run(st.signOut, "Signed out.")}
        />
        <View style={s.divider} />
        <Txt style={{ fontSize: 12, color: C.muted, lineHeight: 20 }}>
          Leaving preserves all purchases, shares, and repayments for the
          remaining household members. You’ll lose access to this household and
          its receipts.
        </Txt>
        <Button
          danger
          label="Leave household"
          icon="LogOut"
          onPress={() => setLeave(true)}
          style={{ alignSelf: "flex-start" }}
        />
        {error && <Txt style={{ color: C.red }}>{error}</Txt>}
      </View>
      {leave && (
        <Sheet title="Leave this household?" onClose={() => setLeave(false)}>
          <Txt style={{ lineHeight: 23 }}>
            Your expense and repayment history will stay with{" "}
            {st.household?.name}. Any outstanding balance still needs to be
            settled. You can rejoin later using an invitation code.
          </Txt>
          <Button
            danger
            label="Confirm leave household"
            loading={busy}
            onPress={() => run(st.leave, "You’ve left the household.")}
          />
          <Button secondary label="Stay home" onPress={() => setLeave(false)} />
        </Sheet>
      )}
      {reset && (
        <Sheet title="Reset the demo?" onClose={() => setReset(false)}>
          <Txt>
            This will replace your demo changes with the original sample
            household.
          </Txt>
          <Button
            label="Reset demo"
            loading={busy}
            onPress={() =>
              run(async () => {
                await st.reset();
                setReset(false);
              }, "Demo reset. Fresh start!")
            }
          />
          <Button
            secondary
            label="Keep my changes"
            onPress={() => setReset(false)}
          />
        </Sheet>
      )}
    </>
  );
}
type HouseholdChoicesProps = {
  join: boolean;
  setJoin: (value: boolean) => void;
  name: string;
  setName: (value: string) => void;
  code: string;
  setCode: (value: string) => void;
  currency: string;
  setCurrency: (value: string) => void;
};
function HouseholdChoices({
  join,
  setJoin,
  name,
  setName,
  code,
  setCode,
  currency,
  setCurrency,
}: HouseholdChoicesProps) {
  return (
    <View style={{ gap: 17 }}>
      <Txt style={{ fontFamily: "DMBold", fontSize: 13 }}>
        Separate logins. One shared household.
      </Txt>
      <View style={{ flexDirection: "row", gap: 9, flexWrap: "wrap" }}>
        <Chip
          label="Create a household"
          active={!join}
          onPress={() => setJoin(false)}
        />
        <Chip
          label="Join with a code"
          active={join}
          onPress={() => setJoin(true)}
        />
      </View>
      {join ? (
        <>
          <Field
            label="Invitation code"
            value={code}
            onChangeText={setCode}
            placeholder="Code from your roommate"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={128}
          />
          <Txt style={s.muted}>
            Use your own email and password. This code links you to your
            roommates’ household.
          </Txt>
        </>
      ) : (
        <>
          <Field
            label="Household name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. The Maple Street Crew"
            maxLength={80}
          />
          <Txt style={s.muted}>
            Choose any name. We’ll give you a private invitation code to share
            after creating your household.
          </Txt>
          <Txt style={s.label}>HOUSEHOLD CURRENCY</Txt>
          <View style={{ flexDirection: "row", gap: 7, flexWrap: "wrap" }}>
            {["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => (
              <Chip
                key={c}
                label={c}
                active={currency === c}
                onPress={() => setCurrency(c)}
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}
function HouseholdSetup() {
  const st = useStore();
  const pending = st.householdIntent;
  const [join, setJoin] = useState(pending?.mode === "join"),
    [name, setName] = useState(pending?.mode === "create" ? pending.name : ""),
    [code, setCode] = useState(pending?.mode === "join" ? pending.code : ""),
    [currency, setCurrency] = useState(
      pending?.mode === "create" ? pending.currency : "USD",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (join ? !code.trim() : !name.trim())
        throw new Error(
          join ? "Enter your invitation code." : "Give your household a name.",
        );
      await st.householdAction(name, join ? code : "", currency);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          flexGrow: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ maxWidth: 450, width: "100%", gap: 24 }}>
          <Logo />
          <View style={{ alignItems: "center" }}>
            <Illustration />
          </View>
          <Title style={{ textAlign: "center" }}>
            Every good home starts here.
          </Title>
          <Txt style={{ textAlign: "center", color: C.muted, lineHeight: 23 }}>
            Create your shared space or join your roommates. We’ll handle the
            splitting.
          </Txt>
          <HouseholdChoices
            join={join}
            setJoin={setJoin}
            name={name}
            setName={setName}
            code={code}
            setCode={setCode}
            currency={currency}
            setCurrency={setCurrency}
          />
          {(error || st.error) && (
            <Txt accessibilityRole="alert" style={{ color: C.red }}>
              {error || st.error}
            </Txt>
          )}
          <Button
            label={join ? "Join household" : "Create household"}
            icon="ArrowRight"
            loading={busy}
            onPress={save}
          />
          <Button secondary label="Sign out" onPress={st.signOut} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
function Auth() {
  const st = useStore();
  const [join, setJoin] = useState(false),
    [houseName, setHouseName] = useState(""),
    [code, setCode] = useState(""),
    [currency, setCurrency] = useState("USD");
  const lock = useRef(false);
  const [forgot, setForgot] = useState(false);
  const [signup, setSignup] = useState(false),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const submit = async () => {
    if (lock.current) return;
    lock.current = true;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (forgot) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw new Error("Enter a valid email address.");
        if (browserPreviewEnabled)
          setMessage(
            "Preview only: no password-reset email was sent. Use a sample login or your existing preview password.",
          );
        else {
          const { error } = await client().auth.resetPasswordForEmail(
            email.trim(),
            {
              redirectTo:
                Platform.OS === "web"
                  ? window.location.origin + window.location.pathname
                  : "splitcart://recovery",
            },
          );
          if (error) throw error;
          setMessage(
            "If an account exists for this email, you’ll receive a password-reset link. Check your inbox and spam folder.",
          );
        }
        return;
      }
      if (signup && !name.trim()) throw new Error("Tell us your name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error("Enter a valid email address.");
      if (password.length < 8)
        throw new Error("Use a password with at least 8 characters.");
      const intent = signup
        ? normalizeHouseholdIntent(
            join
              ? { mode: "join", code }
              : { mode: "create", name: houseName, currency },
          )
        : null;
      const c = client();
      let data;
      if (signup && intent) {
        data = await signUpWithHousehold(c.auth, AsyncStorage, {
          email,
          password,
          name,
          household: intent,
        });
      } else {
        const result = await c.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (result.error) throw result.error;
        data = result.data;
      }
      if (signup && !data.session)
        setMessage(
          "Check your email to confirm your account, then come back and log in. Your household choice is saved on this device and will be completed after you log in.",
        );
    } catch (e: any) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 26,
          flexGrow: 1,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <View style={{ width: "100%", maxWidth: 420, gap: 21 }}>
          <Logo />
          {browserPreviewEnabled && (
            <Button
              secondary
              label={
                browserPreviewEnabled
                  ? "Open sample household"
                  : "Explore the demo"
              }
              icon="Leaf"
              loading={browserPreviewEnabled && busy}
              onPress={
                browserPreviewEnabled
                  ? async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const { error } =
                          await client().auth.signInWithPassword({
                            email: previewSampleEmail,
                            password: previewSamplePassword,
                          });
                        if (error) throw error;
                      } catch (e: any) {
                        setError(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }
                  : st.switchMode
              }
            />
          )}
          <View style={{ alignItems: "center", marginVertical: 4 }}>
            <Illustration />
          </View>
          <Title style={{ fontSize: 37, textAlign: "center" }}>
            {forgot
              ? "Reset your password."
              : signup
                ? "A happier home starts here."
                : "Welcome home."}
          </Title>
          <Txt style={{ textAlign: "center", color: C.muted, lineHeight: 22 }}>
            Shared purchases. Fair splits. More time for the good stuff.
          </Txt>
          {browserPreviewEnabled && (
            <View
              style={{
                backgroundColor: C.sage,
                padding: 14,
                borderRadius: 10,
                gap: 7,
              }}
            >
              <Txt style={{ fontFamily: "DMBold", color: C.green }}>
                Interactive browser preview
              </Txt>
              <Txt style={{ fontSize: 12, lineHeight: 20, color: C.green }}>
                Use made-up details. Accounts and household codes work in this
                browser only. Payments, email, and SMS are simulations.
              </Txt>
              <Txt style={{ fontSize: 11, color: C.green }}>
                Sample logins: alex@splitcart.demo, jordan@splitcart.demo,
                sam@splitcart.demo, riley@splitcart.demo. Password:
                splitcart-demo
              </Txt>
            </View>
          )}
          {signup && (
            <Field
              label="Your name"
              value={name}
              onChangeText={setName}
              placeholder="Alex Morgan"
            />
          )}
          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            placeholder="you@example.com"
          />
          {!forgot && (
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="At least 8 characters"
            />
          )}
          {signup && (
            <View style={[s.card, { gap: 15 }]}>
              <HouseholdChoices
                join={join}
                setJoin={setJoin}
                name={houseName}
                setName={setHouseName}
                code={code}
                setCode={setCode}
                currency={currency}
                setCurrency={setCurrency}
              />
            </View>
          )}
          {error && (
            <Txt
              accessibilityRole="alert"
              style={{ color: C.red, lineHeight: 22 }}
            >
              {error}
            </Txt>
          )}
          {message && (
            <Txt style={{ color: C.green, lineHeight: 22 }}>{message}</Txt>
          )}
          <Button
            label={
              forgot
                ? "Send password reset link"
                : signup
                  ? "Create account"
                  : "Log in"
            }
            icon="ArrowRight"
            loading={busy}
            onPress={submit}
          />
          {!signup && (
            <Button
              secondary
              label={forgot ? "Back to login" : "Forgot password?"}
              disabled={busy}
              onPress={() => {
                setForgot(!forgot);
                setError("");
                setMessage("");
              }}
            />
          )}
          {!forgot && (
            <Pressable
              onPress={() => {
                setSignup(!signup);
                setError("");
                setMessage("");
              }}
            >
              <Txt
                style={{ textAlign: "center", fontSize: 12, color: C.green }}
              >
                {signup
                  ? "Already at home here? Log in"
                  : "New to SplitCart? Create an account"}
              </Txt>
            </Pressable>
          )}
          <View style={s.divider} />
          {!browserPreviewEnabled && (
            <Button
              secondary
              label="Explore the demo"
              icon="Leaf"
              onPress={st.switchMode}
            />
          )}
          <Txt style={{ fontSize: 10, color: C.muted, textAlign: "center" }}>
            A sample home, ready to explore. No account needed.
          </Txt>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
